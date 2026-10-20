import { INTERNAL_WIDTH, INTERNAL_HEIGHT } from '../display/constants.js';
import { DEPTH } from '../display/DepthLayers.js';

/** Vertical spacing between scanlines, in pixels. */
const LINE_SPACING = 2;
/** Alpha of each scanline. */
const LINE_ALPHA = 0.15;
/** Scanline color (near-black). */
const LINE_COLOR = 0x000000;

/**
 * Terminal-specific CRT scanline overlay (general-purpose shake/flash effects live in module 09's
 * FxManager — this is only the scanline visual used by terminal-style screens).
 *
 * Draws horizontal 1px-dark-pixel lines every `LINE_SPACING`px across the internal resolution
 * using a single `Phaser.GameObjects.Graphics` object, fixed to the camera (`setScrollFactor(0)`)
 * at `DEPTH.FX_OVERLAY`.
 *
 * OPTIONAL ENHANCEMENT: if a `ctx` with a `SettingsStore`-shaped `settingsStore` is passed, the
 * overlay starts enabled/disabled according to `settingsStore.get('video.crtEnabled')` and stays
 * in sync via `subscribe`. Without `ctx`, the overlay starts enabled and `setEnabled` is the only
 * way to control it — this is the minimum the contract requires.
 *
 * @module terminal/CRTOverlay
 */

/**
 * @param {Phaser.Scene} scene
 * @param {{ settingsStore?: import('../settings/SettingsStore.js').SettingsStore }} [ctx] - optional
 * @returns {{ setEnabled(enabled: boolean): void, destroy(): void }}
 */
export function createCRTOverlay(scene, ctx) {
  const graphics = scene.add.graphics();
  graphics.setDepth(DEPTH.FX_OVERLAY);
  graphics.setScrollFactor(0);

  graphics.fillStyle(LINE_COLOR, LINE_ALPHA);
  for (let y = 0; y < INTERNAL_HEIGHT; y += LINE_SPACING) {
    graphics.fillRect(0, y, INTERNAL_WIDTH, 1);
  }

  let unsubscribe = null;
  if (ctx && ctx.settingsStore) {
    graphics.setVisible(Boolean(ctx.settingsStore.get('video.crtEnabled')));
    unsubscribe = ctx.settingsStore.subscribe('video.crtEnabled', (enabled) => {
      graphics.setVisible(Boolean(enabled));
    });
  }

  return {
    /**
     * @param {boolean} enabled
     * @returns {void}
     */
    setEnabled(enabled) {
      graphics.setVisible(enabled);
    },
    /** @returns {void} */
    destroy() {
      if (unsubscribe) unsubscribe();
      graphics.destroy();
    },
  };
}
