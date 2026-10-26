# Module 11 — Bootstrap & Integration Layer

Read `01_SHARED_CONTRACTS.md` first. This is the final module: it wires
every other module together into one running game, and provides a minimal
**example content pack** (one character, one background, two screen modes —
World and Terminal — one settings window) that exercises every system
end-to-end. This is the only module that is allowed to reference specific
content ids, because it IS the content layer, clearly separated from
`/src/engine`.

**Precondition**: this prompt assumes modules 02 through 10 already exist at
the exact file paths given in `01_SHARED_CONTRACTS.md`. If you (the AI
implementing this prompt) do not have their actual source, implement this
module strictly against the **documented public interfaces** in the shared
contract — do not guess internals, only call the documented exports.

## Files you own
```
/src/main.js
/src/game/EngineContext.js
/src/game/controllers/WorldScreenController.js
/src/game/controllers/TerminalScreenController.js
/src/game/controllers/SettingsModalController.js
/src/game/bootstrap/registerControllers.js
/src/game/bootstrap/manifestPaths.js
/graphics/sprites/example_character/manifest.json
/graphics/backgrounds/example_room/manifest.json
/graphics/ui/windows/default_panel/manifest.json
/screens/world/manifest.json
/screens/terminal/manifest.json
/screens/settings_modal/manifest.json
/config/settings.default.json
/config/controls.default.json
```
(Placeholder PNG assets are out of scope for this prompt — reference
filenames consistent with the manifests above; note in your deliverable
that solid-color placeholder PNGs must be dropped in by hand or generated
separately before the game will actually run visually.)

## Requirements

### `EngineContext.js`
```js
/**
 * @typedef {Object} EngineContext
 * @property {Phaser.Scene} scene
 * @property {typeof AssetRegistry} assetRegistry
 * @property {InputRouter} inputRouter
 * @property {typeof WindowFactory} windowFactory
 * @property {typeof SettingsStore} settingsStore
 * @property {typeof AudioManager} audioManager
 * @property {ScreenManager} screenManager
 */

/**
 * @param {Phaser.Scene} scene
 * @param {object} systems - already-constructed instances of the above
 * @returns {EngineContext}
 */
export function buildEngineContext(scene, systems) {}
```
A thin factory — just assembles the object, no logic. Document each field's
source module next to its JSDoc line (import paths from the shared contract).

### `manifestPaths.js`
```js
/** The pre-enumerated manifest path list AssetRegistry.scan() requires
 * (browsers can't list directories) — see module 03's documented constraint.
 * @type {{ sprites: string[], backgrounds: string[], screens: string[], windows: string[] }}
 */
export const MANIFEST_PATHS = {
  sprites: ['/graphics/sprites/example_character/manifest.json'],
  backgrounds: ['/graphics/backgrounds/example_room/manifest.json'],
  screens: [
    '/screens/world/manifest.json',
    '/screens/terminal/manifest.json',
    '/screens/settings_modal/manifest.json',
  ],
  windows: ['/graphics/ui/windows/default_panel/manifest.json'],
};
```
Document in a comment: "When adding new content, append its manifest path
here — this file is the one deliberately-manual registry the whole
otherwise-automatic AssetRegistry depends on."

### `registerControllers.js`
```js
import { registerController } from '../../engine/screens/ScreenControllerRegistry.js';
import { WorldScreenController } from '../controllers/WorldScreenController.js';
import { TerminalScreenController } from '../controllers/TerminalScreenController.js';
import { SettingsModalController } from '../controllers/SettingsModalController.js';

/** Call once at boot, before any ScreenManager.push(). */
export function registerAllControllers() {
  registerController('WorldScreenController', WorldScreenController);
  registerController('TerminalScreenController', TerminalScreenController);
  registerController('SettingsModalController', SettingsModalController);
}
```

### `WorldScreenController.js`
Extends/implements module 06's `ScreenController` contract. Must:
- In `onEnter`: create a module-04 `Actor` for `example_character` at the
  screen center (using `INTERNAL_WIDTH/2`, `INTERNAL_HEIGHT/2` from module
  02's constants), call `this.engine.scene.cameras.main.startFollow(actor.sprite, true)`
  (exact syscall), create one `InteractiveObject` (module 05) near the
  player representing the "PC", subscribe to the `interact` action via
  `this.engine.inputRouter.on('interact', ...)` to call
  `this.engine.screenManager.push('terminal')` when the player is within
  range (`ProximityDetector.isWithinRadius`, module 05) of the PC.
- In `onUpdate`: read movement actions' current state (track via
  `move-up`/`move-down`/`move-left`/`move-right` handlers that set/clear
  boolean flags on keydown/keyup — note `InputRouter` as specified only
  documents `'keydown'`; add a parallel `'keyup'` listener inside THIS
  controller directly on `this.engine.scene.input.keyboard` as a pragmatic
  exception, OR raise this as a gap against module 06 and implement
  continuous movement via Phaser's `cursors.left.isDown`-style polling
  instead, which is simpler — prefer the polling approach: use
  `this.engine.scene.input.keyboard.createCursorKeys()` directly for
  continuous movement, and reserve the abstract InputRouter actions for
  discrete events like `interact`/`confirm`. Document this split clearly.),
  call `actor.setDirectionFromVector(dx, dy, 'walk')` or `actor.playState('idle')`
  when not moving, call `actor.update(time, delta)` for anim events, and
  call `FxManager.shake(...)`-style glitch ticks scaled by
  `LoopManager.glitchLevel()` per module 09's documented usage pattern.
- In `onExit`: destroy the Actor's sprite, the InteractiveObject, unsubscribe
  all listeners.

### `TerminalScreenController.js`
Must, in `onEnter`: instantiate module 08's `CLIParser` with
`exampleFileSystem`/`EXAMPLE_TARGET_PASSWORD` and `this.engine.scene.events`,
build a `scrollable-text` + `text-input` pairing via `WindowFactory` using
the window manifest approach OR directly compose module 07's
`buildScrollableText`/`buildTextInput` element functions manually (prefer
reusing `WindowFactory.build` with a dedicated `terminal_output` window
manifest for consistency with the rest of the engine — add that manifest
file too, under `/graphics/ui/windows/terminal_output/manifest.json`, and
list it in `manifestPaths.js`), wire `this.engine.inputRouter.on('text-enter', ...)`
to call `parser.run(buffer)` and append the result lines via the
`ScrollableText` element's `appendLine`, and subscribe to
`'terminal:crack-success'` on `this.engine.scene.events` to call
`LoopManager.addFragment('terminal-root')` (module 09) then
`this.engine.screenManager.pop()` after a short `scene.time.delayedCall` beat.
Must call `createCRTOverlay(this.engine.scene)` (module 08) in `onEnter` and
destroy it in `onExit`.

### `SettingsModalController.js`
Simplest controller: `onEnter` calls
`this.engine.windowFactory.build(this.engine.scene, settingsManifest, {
settingsStore: this.engine.settingsStore })` and stores the handle;
`onExit` calls `handle.close()`. No `onUpdate` logic needed beyond the
default no-op.

### `main.js`
The actual entry point. Must, in order:
1. Import `buildPhaserConfig` (module 02) with a single bootstrap Phaser
   Scene class defined inline or in this file (document your choice) whose
   `preload()` calls `AssetRegistry.scan(this, MANIFEST_PATHS)` (module 03)
   and whose `create()`:
   - constructs `SettingsStore.load()` (module 10),
   - constructs `AudioManager.init(this)` (module 10),
   - constructs an `InputRouter` (module 06) wired to
     `this.input.keyboard`, loads `/config/controls.default.json` via
     `this.load.json` in preload and `parseInputProfiles` in create,
   - constructs a `ScreenManager` (module 06),
   - calls `registerAllControllers()`,
   - builds an `EngineContext` and stores it,
   - sets `LoopManager.totalFragmentsNeeded` to a concrete number for this
     example (document the number chosen, e.g. `3`),
   - calls `screenManager.switchTo('world')` to start the game,
   - registers `this.events.on('update', (time, delta) =>
     screenManager.topController?.onUpdate(time, delta))` (or call this
     directly from the Scene's own `update(time, delta)` method — prefer
     the latter, it's the standard Phaser pattern, document why).
2. Calls `new Phaser.Game(buildPhaserConfig([BootScene]))`.

### Manifest content files
Write plausible, minimal, valid JSON for all 8 manifest/config files listed
under "Files you own" above, each conforming exactly to the schemas in
`01_SHARED_CONTRACTS.md`. Keep content intentionally generic/placeholder
(e.g. character id `example_character`, background id `example_room`) since
this is example content meant to be replaced, not the final game.

## Non-goals
- Do not reimplement anything from modules 02–10 — only import and call
  their documented interfaces.
- Do not add real art assets — reference placeholder filenames only.

## Deliverable
All 15 files. This is the integration test: if every other module followed
the shared contract precisely, this module should require zero
modifications to any file outside `/src/game` and the listed manifest/config
files to produce a running `npm run dev` game.
