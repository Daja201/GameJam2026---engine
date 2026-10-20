import { ScreenController } from '../../engine/screens/ScreenController.js';

/**
 * Example "Settings" modal: the simplest possible controller.
 *
 * FIX vs. this module's original draft: that draft assumed the controller itself must call
 * `windowFactory.build(...)` in `onEnter`. The actual `ScreenManager` (module 06) already builds
 * every window listed in the screen's manifest `ui_windows` (this screen's is `["default_panel"]`)
 * before `onEnter` runs, and closes them after `onExit` — doing it again here would build the
 * window twice. So this controller only needs to close itself when the player backs out.
 * @module game/controllers/SettingsModalController
 */
export class SettingsModalController extends ScreenController {
  /** @param {object} [params] @returns {void} */
  onEnter(params) {}

  /** @returns {void} */
  onExit() {}

  /** @param {number} time @param {number} delta @returns {void} */
  onUpdate(time, delta) {}

  /**
   * @param {string} action
   * @returns {void}
   */
  onInput(action) {
    if (action === 'cancel') this.engine.screenManager.pop();
  }

  /** @returns {void} */
  onPause() {}

  /** @returns {void} */
  onResume() {}
}
