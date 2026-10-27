/**
 * Assembles the plain `EngineContext` object that is handed, unmodified, to every
 * `ScreenController` (see `01_SHARED_CONTRACTS.md` and module 06's `ScreenController.js`).
 * This file only assembles the object — it contains no behavior of its own.
 *
 * Field sources (import paths relative to this file):
 * - `scene`          — the booting Phaser.Scene itself (main.js's `BootScene`)
 * - `assetRegistry`  — `./engine/assets/AssetRegistry.js` (singleton object)
 * - `inputRouter`    — an `InputRouter` instance, `./engine/input/InputRouter.js`
 * - `windowFactory`  — `./engine/ui/WindowFactory.js` (singleton object)
 * - `settingsStore`  — `./engine/settings/SettingsStore.js` (singleton object)
 * - `audioManager`   — `./engine/audio/AudioManager.js` (singleton object)
 * - `screenManager`  — a `ScreenManager` instance, `./engine/screens/ScreenManager.js`
 *
 * ASSUMPTION: `ScreenManager`'s constructor itself reads `engine.inputRouter` synchronously
 * (it subscribes to it immediately), so the usual construction order in main.js is:
 *   1. build this context with `screenManager: null` (every other field already real)
 *   2. `const screenManager = new ScreenManager(engine)`
 *   3. `engine.screenManager = screenManager`
 * Controllers only ever read `this.engine.screenManager` later, at call time (never at their
 * own construction time), so mutating the same object in place after step 1 is safe — every
 * controller holds a reference to this exact object, not a copy.
 *
 * @module game/EngineContext
 */

/**
 * @typedef {Object} EngineContext
 * @property {Phaser.Scene} scene
 * @property {typeof import('../engine/assets/AssetRegistry.js').AssetRegistry} assetRegistry
 * @property {import('../engine/input/InputRouter.js').InputRouter} inputRouter
 * @property {typeof import('../engine/ui/WindowFactory.js').WindowFactory} windowFactory
 * @property {typeof import('../engine/settings/SettingsStore.js').SettingsStore} settingsStore
 * @property {typeof import('../engine/audio/AudioManager.js').AudioManager} audioManager
 * @property {import('../engine/screens/ScreenManager.js').ScreenManager} screenManager
 * @property {(text: string) => Promise<void>} showPhaseWindow
 */

/**
 * @param {Phaser.Scene} scene
 * @param {{
 *   assetRegistry: object, inputRouter: object, windowFactory: object,
 *   settingsStore: object, audioManager: object, screenManager: object|null,
 * }} systems - already-constructed instances/singletons of the fields above
 * @returns {EngineContext}
 */
export function buildEngineContext(scene, systems) {
  const engine = {
    scene,
    assetRegistry: systems.assetRegistry,
    inputRouter: systems.inputRouter,
    windowFactory: systems.windowFactory,
    settingsStore: systems.settingsStore,
    audioManager: systems.audioManager,
    screenManager: systems.screenManager,
    showPhaseWindow: (text) => {
      if (typeof text !== 'string' || text.trim().length === 0) {
        throw new TypeError('showPhaseWindow requires non-empty story text');
      }
      return engine.screenManager.push('phase_story', { text });
    },
  };
  return engine;
}
