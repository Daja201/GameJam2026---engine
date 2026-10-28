import { INTERNAL_WIDTH, INTERNAL_HEIGHT } from '../display/constants.js';
import { DEPTH } from '../display/DepthLayers.js';

const COMPASS_RADIUS = 23;
const BORDER_RADIUS = COMPASS_RADIUS + 1;
const COMPASS_MARGIN = 4;

/** Full map viewport: (almost) the whole internal canvas, with a border margin. */
const FULLMAP_MARGIN = 20;

const BORDER_COLOR = 0x35e0a8;
const BG_COLOR = 0x05070c;
const ARROW_COLOR = 0xff3030;
const ARROW_LENGTH = COMPASS_RADIUS - 7;

/**
 * Builds a bottom-right quest compass and a toggleable full-screen map camera.
 *
 * WHY EXTRA CAMERAS, NOT A STATIC TEXTURE: the engine's backgrounds can be arbitrarily large
 * tilemaps (see `world/BackgroundLoader.js`) with no separate "map art" asset; the full-screen
 * map uses a camera zoomed out to fit the whole map without generating separate map art.
 *
 * The screen-fixed compass and HUD are ignored by the full-map camera, while world-space content
 * remains visible on the full map.
 *
 * @param {Phaser.Scene} scene
 * @param {{ follow: Phaser.GameObjects.GameObject, mapSize: {width:number, height:number}, tileSize: {width:number, height:number}, ignore?: object[] }} opts
 * @returns {{
 *   isOpen: boolean,
 *   toggleFull(): void,
 *   closeFull(): void,
 *   setTarget(target: {x:number,y:number}|null, opts?: {questionMark?:boolean}): void,
 *   setVisible(visible: boolean): void,
 *   destroy(): void,
 * }}
 */
export function createMapOverlay(scene, opts) {
  const { follow, mapSize, tileSize, ignore = [] } = opts;

  const compassCenterX = INTERNAL_WIDTH - BORDER_RADIUS - COMPASS_MARGIN;
  const compassCenterY = INTERNAL_HEIGHT - BORDER_RADIUS - COMPASS_MARGIN;
  const compass = scene.add.graphics();
  compass.setScrollFactor(0);
  compass.setDepth(DEPTH.UI_HUD);
  const distanceLabel = scene.add.text(compassCenterX, compassCenterY - BORDER_RADIUS - 5, 'NO TARGET', {
    fontFamily: 'monospace',
    fontSize: '7px',
    color: '#ffffff',
  }).setOrigin(0.5);
  distanceLabel.setScrollFactor(0);
  distanceLabel.setDepth(DEPTH.UI_HUD);
  const questionMark = scene.add.text(compassCenterX, compassCenterY - 1, '?', {
    fontFamily: 'monospace',
    fontSize: '18px',
    fontStyle: 'bold',
    color: '#ff3030',
  }).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.UI_HUD + 1).setVisible(false);
  let questionMarkActive = false;
  let open = false;
  let hidden = false;

  const redrawCompass = (target, showQuestionMark = false) => {
    compass.clear();
    compass.fillStyle(BG_COLOR, 0.95);
    compass.fillCircle(compassCenterX, compassCenterY, COMPASS_RADIUS);
    compass.lineStyle(1, BORDER_COLOR, 1);
    compass.strokeCircle(compassCenterX, compassCenterY, BORDER_RADIUS);

    questionMarkActive = showQuestionMark;
    questionMark.setVisible(showQuestionMark && !hidden);
    if (showQuestionMark) {
      distanceLabel.setText('UNKNOWN');
      return;
    }

    if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) {
      distanceLabel.setText('NO TARGET');
      return;
    }

    const dx = target.x - follow.x;
    const dy = target.y - follow.y;
    const distanceInTiles = Math.hypot(dx / tileSize.width, dy / tileSize.height);
    distanceLabel.setText(`${Math.round(distanceInTiles)} TILES`);

    if (distanceInTiles === 0) return;
    const angle = Math.atan2(dy, dx);
    const tipX = compassCenterX + Math.cos(angle) * ARROW_LENGTH;
    const tipY = compassCenterY + Math.sin(angle) * ARROW_LENGTH;
    const headBaseX = compassCenterX + Math.cos(angle) * (ARROW_LENGTH - 6);
    const headBaseY = compassCenterY + Math.sin(angle) * (ARROW_LENGTH - 6);
    const headHalfWidth = 3;
    const perpendicularX = -Math.sin(angle) * headHalfWidth;
    const perpendicularY = Math.cos(angle) * headHalfWidth;

    compass.lineStyle(3, ARROW_COLOR, 1);
    compass.lineBetween(compassCenterX, compassCenterY, headBaseX, headBaseY);
    compass.fillStyle(ARROW_COLOR, 1);
    compass.fillTriangle(
      tipX,
      tipY,
      headBaseX + perpendicularX,
      headBaseY + perpendicularY,
      headBaseX - perpendicularX,
      headBaseY - perpendicularY,
    );
    compass.fillCircle(compassCenterX, compassCenterY, 2);
  };
  redrawCompass(null);

  const fullW = INTERNAL_WIDTH - FULLMAP_MARGIN * 2;
  const fullH = INTERNAL_HEIGHT - FULLMAP_MARGIN * 2;
  const fitZoom = Math.min(fullW / mapSize.width, fullH / mapSize.height);

  const fullmapCam = scene.cameras.add(FULLMAP_MARGIN, FULLMAP_MARGIN, fullW, fullH);
  fullmapCam.setName('fullmap');
  fullmapCam.setZoom(fitZoom);
  fullmapCam.setBackgroundColor(BG_COLOR);
  fullmapCam.centerOn(mapSize.width / 2, mapSize.height / 2);
  fullmapCam.setVisible(false);

  const fullmapDim = scene.add.rectangle(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT, 0x000000, 0.6).setOrigin(0, 0);
  fullmapDim.setScrollFactor(0);
  fullmapDim.setDepth(DEPTH.UI_HUD - 1);
  fullmapDim.setVisible(false);

  const fullmapFrame = scene.add.graphics();
  fullmapFrame.lineStyle(2, BORDER_COLOR, 1);
  fullmapFrame.strokeRect(FULLMAP_MARGIN - 2, FULLMAP_MARGIN - 2, fullW + 4, fullH + 4);
  fullmapFrame.setScrollFactor(0);
  fullmapFrame.setDepth(DEPTH.UI_HUD);
  fullmapFrame.setVisible(false);

  const fullmapHint = scene.add.text(INTERNAL_WIDTH / 2, FULLMAP_MARGIN - 4, 'FULL MAP \u2014 [M] close', {
    fontFamily: 'monospace',
    fontSize: '9px',
    color: '#baf7d6',
  }).setOrigin(0.5, 1);
  fullmapHint.setScrollFactor(0);
  fullmapHint.setDepth(DEPTH.UI_HUD);
  fullmapHint.setVisible(false);

  // Screen-fixed chrome must not appear inside the full-map camera.
  const ownChrome = [compass, distanceLabel, questionMark, fullmapDim, fullmapFrame, fullmapHint];
  const fullIgnoreList = [...ignore, ...ownChrome];
  fullmapCam.ignore(fullIgnoreList);

  return {
    get isOpen() {
      return open;
    },
    /** Opens/closes the full-screen map overlay. @returns {void} */
    toggleFull() {
      open = !open;
      fullmapCam.setVisible(open && !hidden);
      fullmapDim.setVisible(open && !hidden);
      fullmapFrame.setVisible(open && !hidden);
      fullmapHint.setVisible(open && !hidden);
      if (open) fullmapCam.centerOn(mapSize.width / 2, mapSize.height / 2);
    },
    /** Forces the full map closed (e.g. Backspace, or the owning screen being paused). @returns {void} */
    closeFull() {
      if (!open) return;
      open = false;
      fullmapCam.setVisible(false);
      fullmapDim.setVisible(false);
      fullmapFrame.setVisible(false);
      fullmapHint.setVisible(false);
    },
    /** Redraws the compass for the currently tracked location objective. @returns {void} */
    setTarget(target, opts = {}) {
      redrawCompass(target, opts.questionMark ?? false);
    },
    /**
     * Shows/hides EVERYTHING this overlay owns (compass included) — used when another screen is
     * pushed on top of the owning world screen (e.g. Settings, Quest Log): those screens' own
     * windows aren't in `ignore` (they don't exist yet when this overlay is built), so without
     * this they'd render tiny inside the full-map camera too. The full map is force-closed whenever
     * hidden, and stays closed when shown again.
     * @param {boolean} visible
     * @returns {void}
     */
    setVisible(visible) {
      hidden = !visible;
      if (hidden) this.closeFull();
      compass.setVisible(visible);
      distanceLabel.setVisible(visible);
      questionMark.setVisible(visible && questionMarkActive);
    },
    /** @returns {void} */
    destroy() {
      scene.cameras.remove(fullmapCam);
      compass.destroy();
      distanceLabel.destroy();
      questionMark.destroy();
      fullmapDim.destroy();
      fullmapFrame.destroy();
      fullmapHint.destroy();
    },
  };
}