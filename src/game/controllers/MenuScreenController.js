import { ScreenController } from '../../engine/screens/ScreenController.js';
import { AudioManager } from '../../engine/audio/AudioManager.js';
import { invokeAction } from '../../engine/ui/ActionRegistry.js';

/**
 * The main menu starts the game on the first click anywhere on the screen.
 * @module game/controllers/MenuScreenController
 */
export class MenuScreenController extends ScreenController {
  /** @param {object} [params] @returns {void} */
  onEnter(params) {
    AudioManager.playMusic('music:gui-menu', { loop: true });
    this._started = false;
    this._onPointerDown = () => {
      if (this._started) return;
      this._started = true;
      this.engine.scene.input.off('pointerdown', this._onPointerDown);
      invokeAction('menu-start', { scene: this.engine.scene });
    };
    this.engine.scene.input.on('pointerdown', this._onPointerDown);
  }

  /** @param {number} time @param {number} delta @returns {void} */
  onUpdate(time, delta) {}

  /**
   * No-op: the main menu is only ever the bottom of the stack (nothing is pushed under it, and
   * it is never itself pushed on top of a running game — see class docstring), so there is never
   * anywhere for 'cancel' to back out to here.
   * @param {string} action
   * @returns {void}
   */
  onInput(action) {}

  /** @returns {void} */
  onPause() {}

  /** @returns {void} */
  onResume() {}

  /** @returns {void} */
  onExit() {
    AudioManager.stopMusic();
    this.engine.scene.input.off('pointerdown', this._onPointerDown);
  }
}