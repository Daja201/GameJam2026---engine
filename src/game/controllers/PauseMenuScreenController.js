import { ScreenController } from '../../engine/screens/ScreenController.js';

/**
 * The PAUSE screen, pushed on top of `world` whenever Backspace ('cancel') is pressed there (see
 * `WorldScreenController.onInput`'s 'cancel' branch). Split out from the main menu per this
 * revision's brief: `MenuScreenController` is now the boot-time main menu ONLY (a single "Start"
 * button), and this controller is the in-game pause menu, with its own Resume/Map/Inventory/
 * Quests/Settings buttons (`pause_panel`'s manifest — see that file).
 *
 * RESUME: reuses the exact same `'menu-start'` action the main menu's Start button fires (see
 * `main.js`'s registration) — that handler already checks `engine.worldController` and, when a
 * game is in progress (always true here, since this screen only ever exists pushed on top of a
 * live `world` screen), just pops this screen off instead of starting a new game. No separate
 * "resume" action needed.
 *
 * MAP / INVENTORY / QUESTS: `'pause-open-map'`, `'pause-open-inventory'`, `'pause-open-quests'`
 * (also registered in `main.js`) reach into the paused World screen underneath — see those
 * registrations' own docs, especially the map one, which has to pop this screen first since the
 * minimap/full-map belongs to `WorldScreenController`, not to this one.
 *
 * SETTINGS: reuses the main menu's `'menu-settings'` action, pushing `settings_modal` on top of
 * this screen exactly the way it does from the main menu.
 *
 * This screen has no atmosphere/motes of its own (unlike the main menu) — it's a quick modal
 * over the already-running game, so `pause_panel`'s `modal: true` dims the paused World screen
 * behind it instead.
 * @module game/controllers/PauseMenuScreenController
 */
export class PauseMenuScreenController extends ScreenController {
  /** @param {object} [params] @returns {void} */
  onEnter(params) {}

  /** @param {number} time @param {number} delta @returns {void} */
  onUpdate(time, delta) {}

  /**
   * Backspace ('cancel') here does the same thing as clicking Resume: pop back to the running
   * World screen. Reuses `pop()` directly rather than routing through the 'menu-start' action,
   * since that action's World-screen-missing branch (starting a fresh game) can never apply while
   * this screen exists at all.
   * @param {string} action
   * @returns {void}
   */
  onInput(action) {
    if (action === 'cancel') {
      this.engine.screenManager.pop();
    }
  }

  /** @returns {void} */
  onPause() {}

  /** @returns {void} */
  onResume() {}

  /** @returns {void} */
  onExit() {}
}
