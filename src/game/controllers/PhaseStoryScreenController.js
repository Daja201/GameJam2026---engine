import { ScreenController } from '../../engine/screens/ScreenController.js';

/**
 * Reusable, scrollable story/phase message shown over the current screen.
 * @module game/controllers/PhaseStoryScreenController
 */
export class PhaseStoryScreenController extends ScreenController {
  /**
   * @param {{text?: string}} [params]
   * @returns {void}
   */
  onEnter(params) {
    if (typeof params?.text !== 'string') {
      throw new TypeError('PhaseStoryScreenController requires a text string');
    }

    const output = this.windows[0].getElement('story_text');
    if (!output || typeof output.appendLine !== 'function') {
      throw new Error('Phase story window is missing its scrollable story_text element');
    }
    for (const line of params.text.split(/\r?\n/)) output.appendLine(line);
  }

  /** @param {string} action @returns {void} */
  onInput(action) {
    if (action === 'cancel') this.engine.screenManager.pop();
  }

  /** @param {number} time @param {number} delta @returns {void} */
  onUpdate(time, delta) {}

  /** @returns {void} */
  onExit() {}

  /** @returns {void} */
  onPause() {}

  /** @returns {void} */
  onResume() {}
}
