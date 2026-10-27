import { INTERNAL_WIDTH, INTERNAL_HEIGHT } from '../display/constants.js';
import { DEPTH } from '../display/DepthLayers.js';

/**
 * The minimap camera is clipped to a circle via `camera.setMask()`. Its square viewport is a
 * little larger than the mask so the camera output fully covers the circle.
 */
const HOLE_RADIUS = 23;
const BORDER_RADIUS = HOLE_RADIUS + 1;
const MINIMAP_SIZE = HOLE_RADIUS * 2 + 4;
const MINIMAP_MARGIN = 4;
// FIX (minimap stuck/not following): this used to be a flat hardcoded zoom (0.03), tuned for one
// specific old 3904x2304 city map — on that map the minimap's ~50px viewport showed well over
// half the map width, which both read fine AND left plenty of room for the camera to actually pan
// as the player moved. On a SMALLER map (e.g. the current 960x960 one), that same fixed zoom made
// the viewport's implied world-window (MINIMAP_SIZE / zoom ≈ 1667px) bigger than the entire map,
// so `minimapCam.setBounds(...)` had nowhere left to let the camera scroll to — it just sat
// permanently clamped to the map's center regardless of player position, which looked like "the
// minimap doesn't move." Deriving the zoom from the actual map size instead (below) keeps the
// minimap always showing a fixed FRACTION of the map — so it both reads reasonably at any map
// size AND always has real room to pan, however big or small the current background turns out to
// be, without needing a manual retune like this every time the map changes.
const MINIMAP_VIEW_FRACTION = 0.35; // fraction of the smaller map dimension visible at once

/**
 * @param {{width:number, height:number}} mapSize
 * @returns {number} minimap camera zoom for this map's size (see MINIMAP_VIEW_FRACTION's doc)
 */
function computeMinimapZoom(mapSize) {
  const viewSpan = Math.min(mapSize.width, mapSize.height) * MINIMAP_VIEW_FRACTION;
  return MINIMAP_SIZE / viewSpan;
}

/** Full map viewport: (almost) the whole internal canvas, with a border margin. */
const FULLMAP_MARGIN = 20;

const BORDER_COLOR = 0x35e0a8;
const BG_COLOR = 0x05070c;

/**
 * Builds an always-on minimap camera (small, bottom-right, follows `opts.follow`, live-rendering
 * real world entities at tiny scale) plus a second camera for a toggleable full-screen map
 * (zoomed to fit the whole `opts.mapSize`, centered on the map). Both are genuine extra Phaser
 * cameras (`scene.cameras.add`), not a pre-rendered image, so anything that moves in the world
 * (the player, companions, pickups, interactables, other quest markers) shows up live on both —
 * this is the "full on map with a working minimap" piece.
 *
 * WHY EXTRA CAMERAS, NOT A STATIC TEXTURE: the engine's backgrounds can be arbitrarily large
 * tilemaps (see `world/BackgroundLoader.js`) with no separate "map art" asset; a second camera
 * zoomed out is the cheapest way to get a correct, always-current overview of one without
 * generating/maintaining a separate minimap image per background.
 *
 * IGNORE LISTS: screen-fixed HUD (health bar, buttons, quest/mode labels, toast notifications,
 * this overlay's own chrome) must NOT appear — tiny and doubled — inside either map camera, so
 * the caller passes every such GameObject/Container in `opts.ignore`; both map cameras call
 * `.ignore(...)` on the full list. World-space content (tilemap, actors, props) is deliberately
 * NOT ignored, since seeing those live is the whole point.
 *
 * @param {Phaser.Scene} scene
 * @param {{ follow: Phaser.GameObjects.GameObject, mapSize: {width:number, height:number}, ignore?: object[] }} opts
 * @returns {{
 *   isOpen: boolean,
 *   toggleFull(): void,
 *   closeFull(): void,
 *   setVisible(visible: boolean): void,
 *   destroy(): void,
 * }}
 */
export function createMapOverlay(scene, opts) {
  const { follow, mapSize, ignore = [] } = opts;

  const minimapCenterX = INTERNAL_WIDTH - BORDER_RADIUS - MINIMAP_MARGIN;
  const minimapCenterY = INTERNAL_HEIGHT - BORDER_RADIUS - MINIMAP_MARGIN;
  const miniX = Math.round(minimapCenterX - MINIMAP_SIZE / 2);
  const miniY = Math.round(minimapCenterY - MINIMAP_SIZE / 2);

  const minimapCam = scene.cameras.add(miniX, miniY, MINIMAP_SIZE, MINIMAP_SIZE);
  minimapCam.setName('minimap');
  minimapCam.setZoom(computeMinimapZoom(mapSize));
  minimapCam.setBackgroundColor(BG_COLOR);
  minimapCam.setBounds(0, 0, mapSize.width, mapSize.height);
  minimapCam.startFollow(follow, true);

  // The mask is screen-fixed so it stays aligned with the minimap as the camera follows the player.
  const minimapMaskShape = scene.add.graphics();
  minimapMaskShape.fillStyle(0xffffff);
  minimapMaskShape.fillCircle(minimapCenterX, minimapCenterY, HOLE_RADIUS);
  minimapMaskShape.setVisible(false);
  minimapCam.setMask(minimapMaskShape.createGeometryMask(), true);

  const minimapBorder = scene.add.graphics();
  minimapBorder.lineStyle(1, BORDER_COLOR, 1);
  minimapBorder.strokeCircle(minimapCenterX, minimapCenterY, BORDER_RADIUS);
  minimapBorder.setScrollFactor(0);
  minimapBorder.setDepth(DEPTH.UI_HUD);

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

  // Every GameObject built by this overlay is also screen-fixed chrome that must not show up
  // (tiny, duplicated) inside the two map cameras themselves.
  const ownChrome = [minimapBorder, fullmapDim, fullmapFrame, fullmapHint];
  const fullIgnoreList = [...ignore, ...ownChrome];
  minimapCam.ignore(fullIgnoreList);
  fullmapCam.ignore(fullIgnoreList);

  let open = false;
  let hidden = false;

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
    /**
     * Shows/hides EVERYTHING this overlay owns (minimap included) — used when another screen is
     * pushed on top of the owning world screen (e.g. Settings, Quest Log): those screens' own
     * windows aren't in `ignore` (they don't exist yet when this overlay is built), so without
     * this they'd render tiny inside the map cameras too. The full map is force-closed whenever
     * hidden, and stays closed when shown again.
     * @param {boolean} visible
     * @returns {void}
     */
    setVisible(visible) {
      hidden = !visible;
      if (hidden) this.closeFull();
      minimapCam.setVisible(visible);
      minimapBorder.setVisible(visible);
    },
    /** @returns {void} */
    destroy() {
      scene.cameras.remove(minimapCam);
      scene.cameras.remove(fullmapCam);
      minimapMaskShape.destroy();
      minimapBorder.destroy();
      fullmapDim.destroy();
      fullmapFrame.destroy();
      fullmapHint.destroy();
    },
  };
}