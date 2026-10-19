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
    game.scale.setZoom(scale);
  }

  /**
   * Re-applies the best integer scale whenever Phaser's own scale manager
   * fires 'resize' (not a raw window listener). Also applies it once now.
   * @param {Phaser.Game} game
   * @returns {void}
   */
  watchResize(game) {
    // Assumption: the browser window size is the available space to fit into.
    const refit = () => {
      this.applyScale(game, this.getBestIntegerScale(window.innerWidth, window.innerHeight));
    };
    game.scale.on('resize', refit);
    refit();
  }
}

/** Singleton instance used by the rest of the engine. */
export const DisplayManager = new DisplayManagerClass();
