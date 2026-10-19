# Module 06 — Screen/Mode Manager & Input Router

Read `01_SHARED_CONTRACTS.md` first. This is the architectural backbone:
a stack-based manager that activates "screen controllers" (World, Terminal,
Settings modal, etc.) and an input router that translates raw keyboard
events into abstract named actions, scoped to whichever screen is on top of
the stack.

## Files you own
```
/src/engine/screens/ScreenManager.js
/src/engine/screens/ScreenControllerRegistry.js
/src/engine/screens/ScreenController.js
/src/engine/input/InputRouter.js
/src/engine/input/InputProfiles.js
```

## Requirements

### `ScreenController.js`
Export an abstract base class (document that subclassing is optional —
duck-typing is acceptable as long as all 6 methods exist):
```js
export class ScreenController {
  /** @param {EngineContext} engine @param {ScreenManifest} manifest */
  constructor(engine, manifest) { this.engine = engine; this.manifest = manifest; }
  onEnter(params) {}
  onExit() {}
  onUpdate(time, delta) {}
  onInput(action, event) {}
  onPause() {}
  onResume() {}
}
```
`EngineContext` is a plain object the bootstrap (module 11) constructs,
containing references to the Phaser `Scene`, `AssetRegistry`,
`InputRouter`, `WindowFactory`, `SettingsStore`, etc. — this module does not
define `EngineContext`'s exact shape (that's module 11's job), it only
needs to pass whatever object it's given straight through to controllers
unmodified.

### `ScreenControllerRegistry.js`
```js
/**
 * @param {string} controllerName - matches ScreenManifest.controller field
 * @param {typeof ScreenController} controllerClass
 */
export function registerController(controllerName, controllerClass) {}

/**
 * @param {string} controllerName
 * @returns {typeof ScreenController}
 * @throws {Error} with message `Unknown screen controller: ${controllerName}` if not registered
 */
export function resolveController(controllerName) {}
```
Internal storage: a plain `Map`. This registry must be populated by module
11's bootstrap before any screen is pushed — this module does not
pre-register anything itself (no hardcoded controller names).

### `ScreenManager.js`
Implement exactly the `ScreenManager` interface from the shared contract,
backed by an internal array acting as a stack:
```js
export class ScreenManager {
  /** @param {EngineContext} engine */
  constructor(engine) {}

  /** @returns {ScreenController|null} */
  get topController() {}

  /** @param {string} screenId @param {object} [params] @returns {Promise<void>} */
  async push(screenId, params) {}

  /** @returns {Promise<void>} */
  async pop() {}

  /** @param {string} screenId @param {object} [params] @returns {Promise<void>} */
  async switchTo(screenId, params) {}

  /** @param {string} screenId @param {object} [params] @returns {Promise<void>} */
  async replaceTop(screenId, params) {}
}
```
Behavior:
- `push`: look up the `ScreenManifest` via `engine.assetRegistry.getScreenManifest(screenId)`,
  resolve its controller class via `resolveController(manifest.controller)`,
  instantiate it, call the **current top controller's** `onPause()` (if any
  exists on the stack), run the `transition_out` of the OLD top (if any)
  then `transition_in` of the new one via module 02's `TransitionRegistry`
  (import `getTransition(name)` from `../display/TransitionRegistry.js`),
  call `inputRouter.setProfile(manifest.input_profile)`, push the new
  controller onto the internal stack, call its `onEnter(params)`. If
  `manifest.background` is set, call `BackgroundLoader.build(...)` and store
  the handle for cleanup on `onExit`. If `manifest.ui_windows` is non-empty,
  call `windowFactory.build(...)` for each and store handles for cleanup.
- `pop`: call current top's `onExit()`, destroy its background/window
  handles, remove from stack, call the new top's `onResume()`, restore its
  `input_profile` on the InputRouter.
- `switchTo`: clears the entire stack (calling `onExit()` on every entry,
  deepest-last) then behaves like `push`.
- `replaceTop`: like `pop()` immediately followed by `push()`, but without
  calling the entry below's `onResume()` in between (avoid a resume/pause
  flicker) — document this exact ordering in a code comment.
- Every screen in the stack except the top must have `onUpdate` **not**
  called (only the top controller ticks) — document this as intentional:
  paused screens don't run game logic, only modal UI on top of them does.
- The `ScreenManager` instance must itself be driven from a single Phaser
  Scene's `update(time, delta)` loop (supplied by module 11) by calling
  `screenManager.topController?.onUpdate(time, delta)` — this module does
  not create its own Phaser Scene; it is scene-agnostic glue.

### `InputProfiles.js`
```js
/**
 * @typedef {Object} InputProfile
 * @property {Record<string, string>} keyMap - raw Phaser key code name (e.g. "LEFT", "A") -> abstract action name
 */

/**
 * Loads /config/controls.default.json (already fetched by caller) and returns
 * a Map<profileName, InputProfile>.
 * @param {object} controlsConfigJson
 * @returns {Map<string, InputProfile>}
 */
export function parseInputProfiles(controlsConfigJson) {}
```
Document the expected shape of `controls.default.json`:
```jsonc
{
  "movement": { "UP": "move-up", "DOWN": "move-down", "LEFT": "move-left", "RIGHT": "move-right", "E": "interact", "ENTER": "confirm", "ESC": "cancel" },
  "text-entry": { "ENTER": "text-enter", "BACKSPACE": "text-backspace", "ESC": "cancel" },
  "menu-nav": { "UP": "menu-up", "DOWN": "menu-down", "ENTER": "confirm", "ESC": "cancel" }
}
```

### `InputRouter.js`
```js
export class InputRouter {
  /** @param {Phaser.Input.Keyboard.KeyboardPlugin} keyboardPlugin - e.g. scene.input.keyboard */
  constructor(keyboardPlugin) {}

  /** @param {Map<string, InputProfile>} profiles */
  setProfiles(profiles) {}

  /** @param {string} profileName */
  setProfile(profileName) {}

  /** @param {string} actionName @param {(event: object) => void} handler */
  on(actionName, handler) {}

  /** @param {string} actionName @param {(event: object) => void} handler */
  off(actionName, handler) {}
}
```
Implementation: attach exactly one listener via
`keyboardPlugin.on('keydown', this._handleKeyDown, this)` (exact syscall,
single global listener, not per-key) in the constructor. On each keydown,
look up `event.key` and `event.code`'s Phaser-normalized key name (use
`Phaser.Input.Keyboard.KeyCodes` reverse-lookup or `event.code` directly —
document your exact approach) against the **currently active profile's**
`keyMap`; if found, call every handler registered for that action name with
a small event object `{ action, originalEvent: event }`. For `text-entry`
profile specifically, also handle raw printable characters: if `event.key`
is a single printable character, emit the abstract action `text-char` with
payload `{ char: event.key }` even though it's not explicitly in the
keyMap (document this special case clearly).

## Non-goals
- Do not implement any specific screen's gameplay logic (World/Terminal) —
  that's module 11's example content, built using the controller contract
  defined here.
- Do not implement the UI window system itself — only call into module 07's
  `WindowFactory` by its documented interface.

## Deliverable
All 5 files, fully JSDoc'd, zero hardcoded screen/controller names.
