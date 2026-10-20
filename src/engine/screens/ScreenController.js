/**
 * Base class for screen controllers (World, Terminal, Settings modal...).
 * Subclassing is OPTIONAL: duck-typing works as long as the object has all 6 methods
 * (onEnter, onExit, onUpdate, onInput, onPause, onResume) — ScreenManager checks this.
 *
 * ScreenManager sets two extra fields before calling `onEnter`:
 * - `background`: the BackgroundHandle built from `manifest.background` (or null)
 * - `windows`: array of WindowHandles built from `manifest.ui_windows`
 * Both are destroyed/closed by ScreenManager after `onExit`.
 */
export class ScreenController {
  /**
   * @param {EngineContext} engine - plain object built by module 11 and passed through unmodified
   * @param {ScreenManifest} manifest
   */
  constructor(engine, manifest) {
    /** @type {EngineContext} */
    this.engine = engine;
    /** @type {ScreenManifest} */
    this.manifest = manifest;
    /** @type {BackgroundHandle|null} */
    this.background = null;
    /** @type {WindowHandle[]} */
    this.windows = [];
  }

  /**
   * Called when the screen becomes the top of the stack.
   * @param {object} [params] - whatever was passed to push/switchTo/replaceTop
   * @returns {void}
   */
  onEnter(params) {}

  /**
   * Called when the screen is removed (pop, switchTo, replaceTop).
   * @returns {void}
   */
  onExit() {}

  /**
   * Called every frame, ONLY while this screen is the top of the stack.
   * @param {number} time
   * @param {number} delta
   * @returns {void}
   */
  onUpdate(time, delta) {}

  /**
   * Called for each abstract input action while this screen is on top.
   * @param {string} action - e.g. 'move-up', 'confirm', 'text-char'
   * @param {{action: string, originalEvent: object, char?: string}} event
   * @returns {void}
   */
  onInput(action, event) {}

  /**
   * Called when another screen is pushed on top of this one.
   * @returns {void}
   */
  onPause() {}

  /**
   * Called when the screen above is popped and this one is on top again.
   * @returns {void}
   */
  onResume() {}
}
