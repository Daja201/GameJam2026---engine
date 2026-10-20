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
   * Re-applies the best integer scale whenever Phaser's own scale manager
   * fires 'resize' (not a raw window listener). Also applies it once now.
   * @param {Phaser.Game} game
   * @returns {void}
   */
  watchResize(game) {
    game.scale.on('resize', () => {
      const scale = this.getBestIntegerScale(window.innerWidth, window.innerHeight);
      this.applyScale(game, scale);
    });
  }
}

/** Singleton instance used by the rest of the engine. */
export const DisplayManager = new DisplayManagerClass();
