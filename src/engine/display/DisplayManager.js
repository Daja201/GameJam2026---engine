import { INTERNAL_WIDTH, INTERNAL_HEIGHT } from './constants.js';

/**
 * Handles integer scaling of the fixed internal resolution.
 * Exported as a singleton (`DisplayManager`).
 */
export class DisplayManagerClass {
  /**
   * Largest integer n >= 1 such that INTERNAL_WIDTH*n <= windowWidth
   * and INTERNAL_HEIGHT*n <= windowHeight. Minimum return value is 1.
   * @param {number} windowWidth
   * @param {number} windowHeight
   * @returns {number}
   */
  getBestIntegerScale(windowWidth, windowHeight) {
    const n = Math.floor(
      Math.min(windowWidth / INTERNAL_WIDTH, windowHeight / INTERNAL_HEIGHT)
    );
    return Math.max(1, n);
  }

  /**
   * Applies an integer zoom to the game canvas.
   * Uses game.scale.setZoom(), never manual canvas resizing.
   * @param {Phaser.Game} game
   * @param {number} scale
   * @returns {void}
   */
  applyScale(game, scale) {
    if (this._applying) return;       // guard proti re-entry
    if (game.scale.zoom === scale) return; // nic se nemění, netřeba volat setZoom znovu
    this._applying = true;
    game.scale.setZoom(scale);
    this._applying = false;
  }

  /**
   * Re-applies the best integer scale on every browser window resize, and once immediately.
   *
   * FIX (click hit-boxes drifting away from what's drawn): this used to listen for Phaser's own
   * `game.scale.on('resize', ...)` event, which only fires when something ELSE already drove a
   * ScaleManager-recognized resize — which, back when `phaserConfig.js` used `Scale.FIT`, was
   * `FIT` reacting to the window changing size. Now that `phaserConfig.js` uses `Scale.NONE` (see
   * its own doc for why), ScaleManager does no auto-fitting of its own, so nothing would ever
   * drive that event — `DisplayManager` must listen to real window resizes directly instead. This
   * also fixes a second, separate bug the old docstring claimed was already handled but wasn't:
   * the scale was never actually applied "once now" at startup, only on the FIRST resize — so the
   * game would sit un-scaled (and in the old FIT+setZoom combo, already minutely input-misaligned)
   * until the window was resized even once.
   * @param {Phaser.Game} game
   * @returns {void}
   */
  watchResize(game) {
    const applyBestScale = () => {
      const scale = this.getBestIntegerScale(window.innerWidth, window.innerHeight);
      this.applyScale(game, scale);
    };
    window.addEventListener('resize', applyBestScale);
    // FIX (fullscreen): entering/leaving fullscreen changes window.innerWidth/innerHeight but
    // does NOT reliably fire a 'resize' event in every browser before the next paint, so without
    // this the game can sit at its old (pre-fullscreen) integer zoom for a frame or more, or not
    // re-apply at all in some browsers. 'fullscreenchange' fires exactly when that transition
    // completes, so re-run the same best-fit calculation there too.
    document.addEventListener('fullscreenchange', applyBestScale);
    applyBestScale(); // apply immediately — don't wait for the first resize to happen
  }

  /**
   * Requests fullscreen on the game's first click/keypress.
   *
   * FIX (fullscreen): browsers refuse `Element.requestFullscreen()` unless it's called
   * synchronously inside a user-gesture event handler (click/keydown/etc.) — calling it from
   * `create()` or any timer/promise callback is silently rejected. There is no way to make a page
   * enter fullscreen before the player has interacted with it at all; this is a deliberate browser
   * security restriction, not an engine limitation. This listens for the player's very first
   * pointerdown/keydown, requests fullscreen right then (still inside that same gesture), and
   * never asks again after — so from the player's perspective it feels automatic ("click to
   * start" doubles as "click to go fullscreen") without erroring on load.
   *
   * FIX (fullscreen click hitboxes offset): this fullscreens `game.canvas.parentElement`
   * (`#game-root`, per `phaserConfig.js`'s `parent` option), NEVER `game.canvas` itself. Browsers'
   * UA stylesheets force a fullscreened element's width/height to 100% with !important, which
   * would silently override the exact pixel size Phaser sets on its own canvas for integer-pixel
   * zoom — so the canvas would visibly stretch to fill the screen while Phaser's pointer-to-game
   * coordinate math kept using the old (pre-stretch) size it still thinks is current, offsetting
   * every click. Fullscreening the wrapper instead means the browser stretches THAT, while the
   * canvas inside stays an ordinary child Phaser continues to size/center itself.
   * @param {Phaser.Game} game
   * @returns {void}
   */
  requestFullscreenOnFirstInput(game) {
    const target = game.canvas.parentElement ?? game.canvas;
    const tryEnterFullscreen = () => {
      window.removeEventListener('pointerdown', tryEnterFullscreen);
      window.removeEventListener('keydown', tryEnterFullscreen);
      if (document.fullscreenElement) return; // already fullscreen (e.g. dev re-triggered this)
      target.requestFullscreen?.().catch(() => {
        // Rejected (player's browser/OS denied it, or no fullscreen support) — fail silently
        // and leave the game playable windowed; this is a nice-to-have, never a requirement.
      });
    };
    window.addEventListener('pointerdown', tryEnterFullscreen);
    window.addEventListener('keydown', tryEnterFullscreen);
  }
}

/** Singleton instance used by the rest of the engine. */
export const DisplayManager = new DisplayManagerClass();