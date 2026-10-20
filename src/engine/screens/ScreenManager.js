import { getTransition } from '../display/TransitionRegistry.js';
import { BackgroundLoader } from '../world/BackgroundLoader.js';
import { resolveController } from './ScreenControllerRegistry.js';

/**
 * Stack-based screen manager. The top screen is the only one that receives input and `onUpdate`.
 *
 * FIELDS READ FROM `engine` (EngineContext, built by module 11, passed to controllers unmodified):
 * - `engine.scene`         Phaser.Scene used for transitions, backgrounds and windows
 * - `engine.assetRegistry` needs getScreenManifest(id)
 * - `engine.inputRouter`   needs setProfile(name) and on('*', handler)
 * - `engine.windowFactory` needs build(scene, windowManifest, {settingsStore, inputRouter}) -> {close()};
 *   only used if a screen lists ui_windows (manifests are resolved via engine.assetRegistry first)
 * - `engine.settingsStore` forwarded into every auto-built window's ctx
 * - `engine.inputRouter`   also forwarded into every auto-built window's ctx (so e.g. a text-input
 *   element inside a ui_window can receive text-char/text-backspace/text-enter)
 *
 * DRIVING IT: this manager creates no Phaser Scene. One scene (module 11) must call
 * `screenManager.topController?.onUpdate(time, delta)` from its update(). Paused screens (everything below the top)
 * deliberately do NOT get onUpdate: only the modal UI on top of them runs game logic.
 *
 * ASSUMPTIONS:
 * - Calls are queued: push/pop/switchTo/replaceTop run one at a time, so calling pop() during a transition is safe.
 * - Order for entering a screen: old top onPause -> old top transition_out -> build background/windows ->
 *   push on stack -> setProfile -> onEnter -> transition_in. (transition_in runs last so a fade-in reveals the NEW screen.)
 * - After transition_in, camera effects are reset so an 'instant' entry after a 'fade' exit isn't left black.
 * - pop() runs no transitions (it is used for closing modals).
 * - A transition that never completes is abandoned after 2 s with a console warning.
 * - Before onEnter, the manager sets `controller.background` (BackgroundHandle|null) and `controller.windows` (WindowHandle[]).
 */

const TRANSITION_TIMEOUT_MS = 2000;

/** Methods every controller (subclass or duck-typed) must have. */
const REQUIRED_METHODS = ['onEnter', 'onExit', 'onUpdate', 'onInput', 'onPause', 'onResume'];

/**
 * Runs a named transition and resolves when it completes (or times out).
 * @param {Phaser.Scene} scene
 * @param {string} name
 * @param {'in'|'out'} direction
 * @returns {Promise<void>}
 */
function runTransition(scene, name, direction) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.warn(`[ScreenManager] transition "${name}" (${direction}) did not complete; continuing.`);
      resolve();
    }, TRANSITION_TIMEOUT_MS);
    getTransition(name)(scene, direction, () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Stack entry: a controller plus everything that must be cleaned up with it. */
class ScreenEntry {
  /**
   * @param {string} screenId
   * @param {ScreenManifest} manifest
   * @param {ScreenController} controller
   */
  constructor(screenId, manifest, controller) {
    this.screenId = screenId;
    this.manifest = manifest;
    this.controller = controller;
    /** @type {BackgroundHandle|null} */
    this.background = null;
    /** @type {WindowHandle[]} */
    this.windows = [];
  }
}

export class ScreenManager {
  /**
   * @param {EngineContext} engine
   */
  constructor(engine) {
    /** @type {EngineContext} */
    this.engine = engine;
    /** @type {ScreenEntry[]} last element = top of the stack */
    this._stack = [];
    /** @type {Promise<void>} tail of the call queue */
    this._queue = Promise.resolve();

    // Forward every abstract input action to the top screen only.
    engine.inputRouter.on('*', (event) => {
      const top = this.topController;
      if (top) top.onInput(event.action, event);
    });
  }

  /**
   * The controller on top of the stack, or null if the stack is empty.
   * @returns {ScreenController|null}
   */
  get topController() {
    const top = this._stack[this._stack.length - 1];
    return top ? top.controller : null;
  }

  /**
   * Pushes a screen on top of the current one (which is paused).
   * @param {string} screenId
   * @param {object} [params] - passed to the new controller's onEnter
   * @returns {Promise<void>}
   */
  push(screenId, params) {
    return this._enqueue(async () => {
      const entry = this._createEntry(screenId);
      const old = this._top();
      if (old) {
        old.controller.onPause();
        await runTransition(this.engine.scene, old.manifest.transition_out, 'out');
      }
      await this._mount(entry, params);
    });
  }

  /**
   * Removes the top screen and resumes the one below it.
   * @returns {Promise<void>}
   * @throws {Error} if the stack is empty
   */
  pop() {
    return this._enqueue(async () => {
      if (this._stack.length === 0) throw new Error('ScreenManager.pop(): the screen stack is empty');
      this._exitEntry(this._stack.pop());
      const below = this._top();
      if (below) {
        below.controller.onResume();
        this.engine.inputRouter.setProfile(below.manifest.input_profile);
      }
    });
  }

  /**
   * Clears the whole stack (onExit on every entry, top first, deepest last) and enters a new screen.
   * @param {string} screenId
   * @param {object} [params]
   * @returns {Promise<void>}
   */
  switchTo(screenId, params) {
    return this._enqueue(async () => {
      const entry = this._createEntry(screenId);
      const old = this._top();
      if (old) await runTransition(this.engine.scene, old.manifest.transition_out, 'out');
      while (this._stack.length > 0) this._exitEntry(this._stack.pop());
      await this._mount(entry, params);
    });
  }

  /**
   * Replaces the top screen with a new one.
   * Exact ordering: like pop() followed by push(), EXCEPT the entry below is neither resumed nor
   * paused in between. It stays paused the whole time, which avoids a resume/pause flicker.
   * If the stack is empty this behaves like push().
   * @param {string} screenId
   * @param {object} [params]
   * @returns {Promise<void>}
   */
  replaceTop(screenId, params) {
    return this._enqueue(async () => {
      const entry = this._createEntry(screenId);
      const old = this._top();
      if (old) {
        await runTransition(this.engine.scene, old.manifest.transition_out, 'out');
        this._exitEntry(this._stack.pop());
      }
      await this._mount(entry, params);
    });
  }

  /**
   * Runs tasks strictly one after another; a failed task doesn't block later ones.
   * @param {() => Promise<void>} task
   * @returns {Promise<void>}
   * @private
   */
  _enqueue(task) {
    const result = this._queue.then(task);
    this._queue = result.catch(() => {});
    return result;
  }

  /** @returns {ScreenEntry|undefined} @private */
  _top() {
    return this._stack[this._stack.length - 1];
  }

  /**
   * Looks up the manifest and instantiates the controller (no side effects on the stack yet,
   * so a bad id or controller name fails before anything is paused or exited).
   * @param {string} screenId
   * @returns {ScreenEntry}
   * @private
   */
  _createEntry(screenId) {
    const manifest = this.engine.assetRegistry.getScreenManifest(screenId);
    const ControllerClass = resolveController(manifest.controller);
    const controller = new ControllerClass(this.engine, manifest);
    for (const method of REQUIRED_METHODS) {
      if (typeof controller[method] !== 'function') {
        throw new Error(`Screen controller "${manifest.controller}" is missing method ${method}()`);
      }
    }
    return new ScreenEntry(screenId, manifest, controller);
  }

  /**
   * Builds background/windows, puts the entry on the stack, sets input, calls onEnter, then plays transition_in.
   * @param {ScreenEntry} entry
   * @param {object} [params]
   * @returns {Promise<void>}
   * @private
   */
  async _mount(entry, params) {
    const { engine } = this;
    const { manifest, controller } = entry;

    try {
      if (manifest.background) {
        entry.background = BackgroundLoader.build(engine.scene, manifest.background);
      }
      for (const windowId of manifest.ui_windows) {
        const windowManifest = engine.assetRegistry.getWindowManifest(windowId);
        entry.windows.push(engine.windowFactory.build(engine.scene, windowManifest, {
          settingsStore: engine.settingsStore,
          inputRouter: engine.inputRouter,
        }));
      }
    } catch (error) {
      this._destroyHandles(entry); // don't leak half-built visuals
      throw error;
    }
    controller.background = entry.background;
    controller.windows = entry.windows;

    this._stack.push(entry);
    engine.inputRouter.setProfile(manifest.input_profile);
    controller.onEnter(params);

    await runTransition(engine.scene, manifest.transition_in, 'in');
    engine.scene.cameras.main.resetFX(); // e.g. a finished fade-out must not stay black after an 'instant' entry
  }

  /**
   * Calls onExit, then destroys the entry's background and closes its windows.
   * @param {ScreenEntry} entry
   * @private
   * @returns {void}
   */
  _exitEntry(entry) {
    entry.controller.onExit();
    this._destroyHandles(entry);
  }

  /**
   * @param {ScreenEntry} entry
   * @private
   * @returns {void}
   */
  _destroyHandles(entry) {
    entry.windows.forEach((w) => w.close());
    entry.windows = [];
    if (entry.background) entry.background.destroy();
    entry.background = null;
  }
}
