import { ScreenController } from '../../engine/screens/ScreenController.js';
import { DEPTH } from '../../engine/display/DepthLayers.js';
import { INTERNAL_WIDTH, INTERNAL_HEIGHT } from '../../engine/display/constants.js';
import { AudioManager } from '../../engine/audio/AudioManager.js';

/** How many ambient foreground motes drift across the menu. Still cheap (plain tweened rectangles, no particle manager) — this is atmosphere, not a feature. */
const MOTE_COUNT = 24;

/** Mote colors: black and navy blue, alternated (see `_spawnMote`). */
const MOTE_COLORS = [0x000000, 0x0a1a45];

/**
 * The MAIN MENU screen, shown once on boot, before any gameplay — and ONLY that now.
 *
 * FIX (start/pause split): this used to also double as the pause menu (pushed on ESC/Backspace
 * during the `world` screen), with a button column whose Start/Settings mix changed meaning and
 * whose Start button's label flipped to "Resume" depending on `engine.worldController`. Per this
 * revision's brief, the two are now two separate screens/controllers with two separate jobs: this
 * one is the main menu ONLY — a single "Start" button, nothing else — and `PauseMenuScreenController`
 * (see that file) is the pause menu, with its own Resume/Settings/Map/Inventory/Quests buttons.
 * Because this screen is never reached once a game is already running, there's no more
 * "Start-vs-Resume" ambiguity for it to resolve: its one button always just says "Start".
 *
 * START: the Start button (`menu_panel`'s `start_button`, see its manifest) fires the registered
 * UI action `'menu-start'` (handled centrally in `main.js`) — unchanged action name/handler (it
 * still also runs the quest auto-start step), since `PauseMenuScreenController`'s Resume button
 * reuses the exact same action (see that file's docstring for why that's still correct there).
 *
 * BACKGROUND: uses the `example_room` manifest (a 'static' BackgroundLoader background; its art
 * is now the school building photo, `graphics/backgrounds/example_room/room.png`) rather than
 * `city` (the `world` screen's own background) — the brief specifically asks for a menu
 * background that is NOT reused from the in-game world. See `screens/menu/manifest.json`.
 * `BackgroundLoader`'s 'static' case scales this image to fully cover the internal canvas
 * (cropped/centered, aspect preserved) regardless of the source image's own pixel size — see
 * that file's 'static' branch for why this was needed (the photo is 256x118, not 480x270).
 *
 * TITLE SLOT: `menu_panel`'s `title_label` element (a plain WindowFactory `label`) is the
 * "dedicated title slot" the brief asks for — this project has no logo image asset and
 * WindowFactory has no registered `image` element builder (see WindowFactory.js's
 * `ELEMENT_BUILDERS`), so a text label is the slot for now. It can be swapped later purely by
 * editing that one manifest field, or from code via `windowHandle.getElement('title_label')`,
 * without touching any layout code in this file or WindowFactory.
 *
 * CREDIT LINE: `menu_panel`'s `credit_label` element is a plain free-positioned label pinned to
 * the panel's bottom-left corner reading "Github: Daja201" — static text, no binding/action.
 *
 * FOREGROUND ANIMATION: `MOTE_COUNT` small black/navy-blue "motes" (alternating `MOTE_COLORS`)
 * drift upward and fade, looping forever, layered at `DEPTH.WORLD_FOREGROUND` — above the
 * background, below this screen's own window (`DEPTH.UI_WINDOW`). Deliberately simple (plain
 * tweened rectangles, no particle manager) since this is pure atmosphere.
 * @module game/controllers/MenuScreenController
 */
export class MenuScreenController extends ScreenController {
  /** @param {object} [params] @returns {void} */
  onEnter(params) {
    const { scene } = this.engine;
    AudioManager.playMusic('music:gui-menu', { loop: true });

    // --- Foreground ambient motes (atmosphere) --------------------------------------------
    this._motes = [];
    for (let i = 0; i < MOTE_COUNT; i += 1) {
      this._motes.push(this._spawnMote(scene, MOTE_COLORS[i % MOTE_COLORS.length]));
    }
  }

  /**
   * Spawns one looping, fading "mote": a tiny rectangle that drifts up and fades out, then
   * resets and repeats forever with a randomized delay so the motes don't pulse in lockstep.
   * @private
   * @param {Phaser.Scene} scene
   * @param {number} color - hex color (see MOTE_COLORS: alternates black / navy blue)
   * @returns {Phaser.GameObjects.Rectangle}
   */
  _spawnMote(scene, color) {
    const startX = Math.random() * INTERNAL_WIDTH;
    const startY = INTERNAL_HEIGHT * (0.5 + Math.random() * 0.5);
    const mote = scene.add.rectangle(startX, startY, 2, 2, color, 0.8);
    mote.setDepth(DEPTH.WORLD_FOREGROUND);

    scene.tweens.add({
      targets: mote,
      y: startY - (40 + Math.random() * 60),
      alpha: 0,
      duration: 2200 + Math.random() * 1800,
      delay: Math.random() * 2000,
      repeat: -1,
      onRepeat: () => {
        mote.y = INTERNAL_HEIGHT * (0.5 + Math.random() * 0.5);
        mote.x = Math.random() * INTERNAL_WIDTH;
        mote.alpha = 0.8;
      },
    });
    return mote;
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
    for (const mote of this._motes ?? []) {
      this.engine.scene.tweens.killTweensOf(mote);
      mote.destroy();
    }
    this._motes = [];
  }
}