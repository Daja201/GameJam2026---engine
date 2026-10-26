import { INTERNAL_WIDTH, INTERNAL_HEIGHT } from '../display/constants.js';
import { DEPTH } from '../display/DepthLayers.js';

/**
 * FIX (minimap ring): the minimap now sits inside `hud:minimap_ring` (see that texture's
 * generation note in main.js's preload comment) instead of a plain drawn rectangle border. The
 * ring graphic is 72x72 with its opaque interior punched transparent in a circle of
 * HOLE_RADIUS≈23px around its own center.
 *
 * To get an actually-circular minimap (not a square peeking out past the ring, nor a gap of
 * raw unscaled world showing between a too-small square and the ring's inner edge), the minimap
 * CAMERA itself — not a Container/GameObject — gets a circular geometry mask via
 * `camera.setMask()`. This is a different Phaser mechanism than the Container-nested
 * `GeometryMask` bug fixed earlier in ScrollableText.js (that one broke specifically because the
 * mask and its target were buried inside several layers of Container transforms); a camera mask
 * applies directly to the camera's own render target with no such nesting, so it doesn't share
 * that failure mode. MINIMAP_SIZE (the camera's square viewport, BEFORE masking) is sized to
 * fully cover the masked circle; everything outside the circle is then clipped away, leaving a
 * clean, gapless, perfectly circular minimap with no square corners or raw-world slivers.
 */
const RING_TEXTURE_KEY = 'hud:minimap_ring';
const RING_SIZE = 72; // native size of minimap_ring.png — kept 1:1, no scaling, for crisp pixel art
const HOLE_RADIUS = 23; // measured interior radius of the ring's transparent window, minus a ~1px safety margin
const MINIMAP_SIZE = HOLE_RADIUS * 2 + 4; // square viewport, a few px larger than the masked circle's diameter
const MINIMAP_MARGIN = 4;
// Zoomed out far enough that the ~32px-wide player sprite reads as roughly a single pixel on the
// minimap (32 * MINIMAP_ZOOM ≈ 1px), so the minimap favors showing a large stretch of the map
// over a legible player icon — on the 3904x2304 city map this shows well over half the map width
// through the ~50px circular viewport. Adjust if a specific future map's size makes this too
// zoomed in/out; this value is tuned for the current city map, not derived from it automatically.
const MINIMAP_ZOOM = 0.03;

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

  // The ring graphic's own bounding box sits in the bottom-right corner; the camera viewport is
  // then centered inside IT (not independently positioned), so the two can never drift apart.
  const ringX = INTERNAL_WIDTH - RING_SIZE - MINIMAP_MARGIN;
  const ringY = INTERNAL_HEIGHT - RING_SIZE - MINIMAP_MARGIN;
  const ringCenterX = ringX + RING_SIZE / 2;
  const ringCenterY = ringY + RING_SIZE / 2;
  const miniX = Math.round(ringCenterX - MINIMAP_SIZE / 2);
  const miniY = Math.round(ringCenterY - MINIMAP_SIZE / 2);

  const minimapCam = scene.cameras.add(miniX, miniY, MINIMAP_SIZE, MINIMAP_SIZE);
  minimapCam.setName('minimap');
  minimapCam.setZoom(MINIMAP_ZOOM);
  minimapCam.setBackgroundColor(BG_COLOR);
  minimapCam.setBounds(0, 0, mapSize.width, mapSize.height);
  minimapCam.startFollow(follow, true);

  // Circular clip for the camera above — see HOLE_RADIUS's doc. Never itself drawn (setVisible
  // false): it exists purely to hand its geometry to createGeometryMask(). `fixedPosition: true`
  // on setMask means the mask's (x, y) are screen coordinates (matching this screen-fixed HUD
  // element), not world coordinates that would scroll away from the ring as the camera follows
  // the player.
  const minimapMaskShape = scene.add.graphics();
  minimapMaskShape.fillStyle(0xffffff);
  minimapMaskShape.fillCircle(ringCenterX, ringCenterY, HOLE_RADIUS);
  minimapMaskShape.setVisible(false);
  minimapCam.setMask(minimapMaskShape.createGeometryMask(), true);

  // The ring frame itself, drawn ON TOP of the minimap camera's output (higher depth), hollow
  // center so the live (now circularly-clipped) map shows through — see RING_TEXTURE_KEY's doc.
  const minimapBorder = scene.add.image(ringX, ringY, RING_TEXTURE_KEY).setOrigin(0, 0);
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