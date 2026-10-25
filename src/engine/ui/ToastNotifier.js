import { INTERNAL_WIDTH } from '../display/constants.js';
import { DEPTH } from '../display/DepthLayers.js';

/**
 * Small, screen-fixed "toast" notifications — the familiar top-right stacked banners most games
 * use for things like "Quest Started" / "Quest Complete" (Skyrim, The Witcher, WoW, etc. all use
 * some version of this: a small rectangle, a one-line message, an accent color by category,
 * auto-dismiss after a few seconds, multiple stack and reflow as older ones expire). Deliberately
 * simple: one rectangle + one accent bar + one line of text, slide-in from the right, hold, fade
 * out. No queueing/limits beyond what naturally fits — at jam scale that's enough.
 *
 * SCENE-SCOPED FACTORY, same shape as `terminal/CRTOverlay.js`'s `createCRTOverlay`: call once per
 * scene (e.g. in a screen controller's `onEnter`), keep the returned handle, call `destroy()` in
 * `onExit` so nothing leaks across scene restarts. This module itself holds no state of its own —
 * every active toast's GameObjects live only inside the one `scene` passed in.
 *
 * GENERIC: nothing here knows what a "quest" is — `show(message, opts)` takes a plain string and
 * an optional accent color, so any system (quests, loot, achievements...) can reuse it the same
 * way `game/controllers/WorldScreenController.js` does for quest events.
 * @module ui/ToastNotifier
 */

const TOAST_WIDTH = 176;
const TOAST_HEIGHT = 26;
const MARGIN = 4;
const GAP = 4;
const ACCENT_BAR_WIDTH = 3;
const SLIDE_MS = 180;
const HOLD_MS = 2200;
const FADE_MS = 300;

/** Default accent color when `opts.accentColor` isn't given. */
const DEFAULT_ACCENT = 0x8aa8ff;

/**
 * @param {Phaser.Scene} scene
 * @returns {{ show(message: string, opts?: { accentColor?: number }): void, destroy(): void }}
 */
export function createToastNotifier(scene) {
  /** @type {{ container: Phaser.GameObjects.Container }[]} active toasts, oldest first */
  const active = [];

  /** Re-tweens every active toast to its correct stacked y position. @returns {void} */
  function reflow() {
    active.forEach((toast, index) => {
      const y = MARGIN + index * (TOAST_HEIGHT + GAP);
      scene.tweens.add({ targets: toast.container, y, duration: 120, ease: 'Quad.easeOut' });
    });
  }

  /**
   * Shows one toast: slides in from off the right edge, holds, fades out, then removes itself
   * and reflows whatever toasts are left.
   * @param {string} message
   * @param {{ accentColor?: number }} [opts]
   * @returns {void}
   */
  function show(message, opts = {}) {
    const accentColor = opts.accentColor ?? DEFAULT_ACCENT;
    const endX = INTERNAL_WIDTH - TOAST_WIDTH - MARGIN;
    const startX = INTERNAL_WIDTH + MARGIN;

    const bg = scene.add.rectangle(0, 0, TOAST_WIDTH, TOAST_HEIGHT, 0x1a1a2a, 0.92).setOrigin(0, 0);
    bg.setStrokeStyle(1, accentColor);
    const accentBar = scene.add.rectangle(0, 0, ACCENT_BAR_WIDTH, TOAST_HEIGHT, accentColor).setOrigin(0, 0);
    const text = scene.add.text(8, TOAST_HEIGHT / 2, message, {
      fontFamily: 'monospace',
      fontSize: '8px',
      color: '#ffffff',
      wordWrap: { width: TOAST_WIDTH - 14 },
    }).setOrigin(0, 0.5);

    const container = scene.add.container(startX, MARGIN, [bg, accentBar, text]);
    container.setScrollFactor(0);
    container.setDepth(DEPTH.UI_HUD + 1);
    container.setAlpha(0);

    const entry = { container };
    active.push(entry);
    reflow();

    scene.tweens.add({
      targets: container,
      x: endX,
      alpha: 1,
      duration: SLIDE_MS,
      ease: 'Quad.easeOut',
      onComplete: () => {
        scene.time.delayedCall(HOLD_MS, () => {
          scene.tweens.add({
            targets: container,
            alpha: 0,
            x: endX + 16,
            duration: FADE_MS,
            onComplete: () => {
              container.destroy();
              const index = active.indexOf(entry);
              if (index !== -1) active.splice(index, 1);
              reflow();
            },
          });
        });
      },
    });
  }

  return {
    show,
    /** Immediately removes every active toast (no fade). @returns {void} */
    destroy() {
      for (const toast of active) {
        scene.tweens.killTweensOf(toast.container);
        toast.container.destroy();
      }
      active.length = 0;
    },
  };
}
