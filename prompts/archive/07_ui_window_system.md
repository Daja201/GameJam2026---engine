# Module 07 — UI Window System

Read `01_SHARED_CONTRACTS.md` first. This module builds every on-screen UI
panel in the game — settings menu, dialogue boxes, terminal CRT frame, HUD
widgets — from one generic, manifest-driven system. Implement every element
type exactly once; nothing elsewhere in the engine should build ad-hoc UI.

## Files you own
```
/src/engine/ui/WindowFactory.js
/src/engine/ui/ActionRegistry.js
/src/engine/ui/elements/Label.js
/src/engine/ui/elements/Button.js
/src/engine/ui/elements/Slider.js
/src/engine/ui/elements/Toggle.js
/src/engine/ui/elements/TextInput.js
/src/engine/ui/elements/KeybindList.js
/src/engine/ui/elements/ScrollableText.js
/src/engine/ui/elements/ListElement.js
```

## Requirements

### `ActionRegistry.js`
```js
/** @param {string} actionName @param {(context: object) => void} handler */
export function registerAction(actionName, handler) {}

/** @param {string} actionName @param {object} context
 * @throws {Error} `Unknown UI action: ${actionName}` if not registered */
export function invokeAction(actionName, context) {}
```
Pre-register exactly two built-in actions in this file so basic windows work
out of the box without module 11 wiring anything: `'close-window'` (expects
`context.windowHandle.close()` to exist, calls it) and `'noop'` (does
nothing — useful placeholder during content authoring). Document that
`'open-window:<id>'`-style parameterized actions (seen in the earlier spec
examples) should be handled by splitting on `:` inside `invokeAction` itself:
if `actionName` contains a colon, split into `[verb, arg]` and look up a
handler registered under just the `verb` part, calling it with
`{ ...context, arg }`.

### Each element file — shared element contract
Every file under `/elements/` exports a single factory function:
```js
/**
 * @param {Phaser.Scene} scene
 * @param {object} elementManifest - one entry from WindowManifest.elements
 * @param {{ settingsStore: SettingsStore, windowHandle: object }} ctx
 * @returns {Phaser.GameObjects.Container} a container positioned at (0,0)
 *   relative to its parent window container; WindowFactory handles layout
 *   positioning by moving/repositioning this container, elements must not
 *   position themselves absolutely on screen.
 */
export function build<ElementName>(scene, elementManifest, ctx) {}
```
(e.g. `buildLabel`, `buildButton`, `buildSlider`, etc. — name each export
to match its file.)

Specific behavior per element:
- **Label**: `scene.add.text(0, 0, elementManifest.text, { fontFamily: 'monospace', fontSize: '10px', color: '#ffffff' })` wrapped in a Container.
- **Button**: a `Phaser.GameObjects.Rectangle` background + centered `Text`,
  made interactive via `.setInteractive({ useHandCursor: true })` (exact
  syscall) with `'pointerdown'` calling
  `invokeAction(elementManifest.action, ctx)` if `elementManifest.action` is set.
- **Slider**: a horizontal track `Rectangle` + draggable handle `Rectangle`
  made interactive with `scene.input.setDraggable(handle)` and a
  `'drag'` listener (exact Phaser syscalls) that computes a 0..1 value from
  handle x-position clamped to the track bounds, maps to
  `[elementManifest.min, elementManifest.max]`, and calls
  `ctx.settingsStore.set(elementManifest.bind, value)` on every drag update.
  Must also read the current value from `ctx.settingsStore.get(bind)` at
  build time to position the handle correctly, and subscribe via
  `ctx.settingsStore.subscribe(bind, cb)` to stay in sync if changed
  elsewhere (store the unsubscribe function on the returned container as
  `container.unsubscribe` so `WindowFactory` can call it on window close).
- **Toggle**: a small `Rectangle` checkbox that flips
  `ctx.settingsStore.set(bind, !ctx.settingsStore.get(bind))` on
  `'pointerdown'`, with a filled/unfilled visual state driven by a
  `settingsStore.subscribe`.
- **TextInput**: a `Rectangle` background + `Text` showing current buffer;
  do NOT use an HTML `<input>` overlay (breaks pixel-art/canvas consistency)
  — instead, when focused (click to focus, track via a local `isFocused`
  flag), listen for the abstract `text-char`/`text-backspace`/`text-enter`
  actions from module 06's `InputRouter` (passed in via `ctx.inputRouter`,
  document that `ctx` may optionally include this) and update the buffer,
  calling `ctx.settingsStore.set(bind, buffer)` on `text-enter`.
- **KeybindList**: reads `ctx.settingsStore.get('controls')` (an object of
  profileName -> keyMap, see module 06) and renders one row per binding
  with a button that, when clicked, enters a "listening for next keypress"
  state and rebinds on the next raw keydown (this is the one element
  allowed to listen to a raw DOM/Phaser keydown event directly, since
  rebinding is inherently about capturing a literal key, not an abstract
  action — document this exception clearly in a comment).
- **ScrollableText**: a `Text` object with `wordWrap` inside a masked
  `Container` (use `Phaser.GameObjects.Graphics` + `.createGeometryMask()`,
  exact syscall, to clip overflow) with scroll position adjustable via a
  method `scrollToBottom()` and `appendLine(text)` — this exact pair of
  methods is what module 08 (Terminal) will call, so their names must match
  precisely.
- **ListElement**: renders `elementManifest.items` (array of strings) as
  stacked `Text` rows with optional click handling per row via an
  `onItemClick(index)` callback passed through `ctx`.

### `WindowFactory.js`
```js
export const WindowFactory = {
  /**
   * @param {Phaser.Scene} scene
   * @param {WindowManifest} manifest - from AssetRegistry.getWindowManifest(id)
   * @param {{ settingsStore: SettingsStore, inputRouter?: InputRouter }} ctx
   * @returns {WindowHandle}
   */
  build(scene, manifest, ctx) {},
};
```
Implementation:
- Create a root `Phaser.GameObjects.Container` at the position implied by
  `manifest.anchor` (support at minimum `'center'`; compute using
  `INTERNAL_WIDTH/HEIGHT` from module 02's constants) with depth
  `DEPTH.UI_WINDOW` (import from module 02's `DepthLayers.js`).
  If `manifest.modal`, also add a semi-transparent full-screen `Rectangle`
  at `DEPTH.UI_MODAL_OVERLAY` behind it that blocks input to anything below
  (`.setInteractive()` with no handler, exact trick to swallow clicks).
- Build the panel background using 9-slice-style scaling: use Phaser's
  `scene.add.nineslice(...)` (exact built-in Phaser 3 GameObject — use this,
  do not hand-roll 9-slice manually) sized to `manifest.size`, textured from
  the skin referenced in `manifest.skin` (resolve path via
  `/graphics/ui/windows/${manifest.skin}/panel.png`, document the expected
  file name convention here since module 03 doesn't special-case UI skins).
- Lay out `manifest.elements` top-to-bottom with fixed row height (document
  the exact spacing constant you choose, e.g. 24px) if `layout ===
  'vertical-list'`; for `'grid'`, lay out in a fixed column count (document
  your chosen column count); for `'free'`, read an `x`/`y` from each
  element's manifest entry directly (no auto-layout).
- Return:
  ```js
  {
    container: rootContainer,
    close() { /* call unsubscribe on every element container that has one, then rootContainer.destroy(), then overlay.destroy() if modal */ },
    setElementValue(elementId, value) { /* find element by id, update its visual + call settingsStore.set if bound */ },
  }
  ```

## Non-goals
- Do not implement `SettingsStore` here — only call its documented
  interface from the shared contract (module 10 implements it).
- Do not hardcode any specific window id, skin name, or element content.

## Deliverable
All 9 files, fully JSDoc'd.
