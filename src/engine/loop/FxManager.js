import Phaser from 'phaser';
import { SettingsStore } from '../settings/SettingsStore.js';
import { createCRTOverlay } from '../terminal/CRTOverlay.js';

/**
 * Generic, mode-agnostic visual effect primitives (camera shake/flash, CRT scanline toggling).
 * These are plain building blocks — this module never calls itself on a timer or decides when
 * effects should fire; that decision belongs to whichever screen controller uses it.
 *
 * Typical usage from a screen controller's onUpdate:
 * // const level = LoopManager.glitchLevel();
 * // if (Math.random() < 0.002 * level) FxManager.shake(scene, 0.002 + 0.006 * level, 120);
 *
 * CROSS-MODULE DEPENDENCY (intentional, documented): `crtOverlay`/`scanlines` both delegate to
 * module 08's `createCRTOverlay` (../terminal/CRTOverlay.js). This is the one exception to this
 * module otherwise depending on nothing but module 02's constants and module 10's SettingsStore
 * — CRT scanlines and camera shake/flash are both "visual FX" conceptually, so routing scanline
 * control through FxManager avoids every caller needing to know CRTOverlay exists separately.
 *
 * @module loop/FxManager
 */

/** Scales shake intensity when `video.reducedMotion` is on — kept non-zero so feedback persists. */
const REDUCED_MOTION_SHAKE_SCALE = 0.15;
/** Scales flash duration when `video.reducedMotion` is on — kept non-zero so feedback persists. */
const REDUCED_MOTION_FLASH_SCALE = 0.15;

/** @type {WeakMap<Phaser.Scene, {setEnabled(enabled:boolean):void, destroy():void}>} */
const overlaysByScene = new WeakMap();

export const FxManager = {
  /**
   * Shakes the scene's main camera. Scaled down (not skipped) when `video.reducedMotion` is on.
   * @param {Phaser.Scene} scene
   * @param {number} intensity - Phaser camera shake intensity (small fraction, e.g. 0.01)
   * @param {number} durationMs
   * @returns {void}
   */
  shake(scene, intensity, durationMs) {
    const reducedMotion = SettingsStore.get('video.reducedMotion');
    const effectiveIntensity = reducedMotion ? intensity * REDUCED_MOTION_SHAKE_SCALE : intensity;
    // Phaser's own signature order is shake(duration, intensity) — note this is transposed
    // from this method's (scene, intensity, durationMs) parameter order.
    scene.cameras.main.shake(durationMs, effectiveIntensity);
  },

  /**
   * Flashes the scene's main camera a solid color. Scaled down (not skipped) when
   * `video.reducedMotion` is on, so a flash still briefly reads as feedback.
   * @param {Phaser.Scene} scene
   * @param {string} hexColor - e.g. "#ff0044"
   * @param {number} durationMs
   * @returns {void}
   */
  flash(scene, hexColor, durationMs) {
    const reducedMotion = SettingsStore.get('video.reducedMotion');
    const effectiveDurationMs = reducedMotion ? durationMs * REDUCED_MOTION_FLASH_SCALE : durationMs;
    const { r, g, b } = Phaser.Display.Color.HexStringToColor(hexColor);
    scene.cameras.main.flash(effectiveDurationMs, r, g, b, false);
  },

  /**
   * Enables or disables the CRT scanline overlay for a scene, delegating to module 08's
   * `createCRTOverlay`. Repeated `true` calls are idempotent (no duplicate overlay); `false`
   * destroys the overlay tied to this scene, if any.
   * @param {Phaser.Scene} scene
   * @param {boolean} enabled
   * @returns {void}
   */
  crtOverlay(scene, enabled) {
    const existing = overlaysByScene.get(scene);
    if (enabled) {
      if (existing) return;
      overlaysByScene.set(scene, createCRTOverlay(scene, { settingsStore: SettingsStore }));
    } else if (existing) {
      existing.destroy();
      overlaysByScene.delete(scene);
    }
  },

  /**
   * Alias for `crtOverlay` — the shared contract lists both `crtOverlay` and `scanlines` as
   * separate methods, but scanlines ARE the CRT overlay's visual, so both are backed by the
   * same WeakMap entry per scene (no second, separate overlay is created for this one).
   * @param {Phaser.Scene} scene
   * @param {boolean} enabled
   * @returns {void}
   */
  scanlines(scene, enabled) {
    FxManager.crtOverlay(scene, enabled);
  },
};
