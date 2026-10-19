# Module 08 — Terminal / CLI Subsystem

Read `01_SHARED_CONTRACTS.md` first. This module implements the fake-Kali
command-line experience: a pure command parser, an example fake filesystem
data structure (content to be replaced later by game designers), and the
CRT/scanline visual treatment specific to this mode (general-purpose
shake/flash primitives live in module 09's `FxManager` — this module only
adds the terminal-specific scanline overlay).

## Files you own
```
/src/engine/terminal/CLIParser.js
/src/engine/terminal/fakeFileSystem.example.js
/src/engine/terminal/CRTOverlay.js
```

## Requirements

### `CLIParser.js`
Implement exactly the `CLIParser` interface from the shared contract:
```js
export class CLIParser {
  /**
   * @param {Phaser.Events.EventEmitter} eventEmitter - typically scene.events
   * @param {object} fileSystem - shape matching fakeFileSystem.example.js's export
   * @param {string} targetPassword
   */
  constructor(eventEmitter, fileSystem, targetPassword) {}

  /** @type {{ cwd: string }} */
  state;

  /**
   * @param {string} rawInput
   * @param {{ clear(): void }} [ui] - optional, for the 'clear' command
   * @returns {string[]} lines of output to display
   */
  run(rawInput, ui) {}
}
```
Must implement these built-in commands exactly, as a `Map<string, handler>`
internally so adding a new command elsewhere is a one-line
`this.commands.set(name, handlerFn)` call rather than editing a giant
switch statement:
- `help` → lists all registered command names and a one-line description each.
- `pwd` → returns `[state.cwd]`.
- `ls [path]` → resolves path relative to `state.cwd` (support both relative
  and absolute, i.e. paths starting with `/`), looks up the node in
  `fileSystem`, returns its `children` joined by two spaces, or an error
  line `ls: ${path}: not a directory` if missing/wrong type.
- `cd <path>` → same path resolution, mutates `state.cwd` if the target is a
  directory, else returns an error line and does not mutate state.
- `cat <path>` → returns the `content` string split on `\n`, or an error
  line if missing/wrong type.
- `connect` → returns two fixed lines (document them in a comment as
  placeholder content meant to be overridden per-game, since this one is
  mildly content-specific — keep it generic/thematically neutral: e.g.
  `"Connecting to exit-node..."`, `"Access denied. Use 'crack <password>'."`).
- `crack <guess>` → uppercases `guess`, compares to `targetPassword`
  (case-insensitive), on match calls `eventEmitter.emit('terminal:crack-success')`
  (exact event name from shared contract) and returns success lines, on
  mismatch calls `eventEmitter.emit('terminal:crack-fail', { guess })` and
  returns a denial line.
- `clear` → calls `ui.clear()` if provided, returns `[]`.

Path resolution must be a separate pure helper function
`resolvePath(cwd, rawArg)` exported alongside the class for unit testing.

### `fakeFileSystem.example.js`
An **example** fake filesystem object (clearly named `.example.js` so
module 11/game designers know this file is meant to be copied and
customized per game, not imported directly into production content):
```js
export const exampleFileSystem = {
  '/': { type: 'dir', children: ['home', 'var', 'etc'] },
  '/home': { type: 'dir', children: ['user'] },
  // ... a handful of plausible dir/file entries demonstrating nesting,
  // at least 2 levels deep, at least one file with multi-line content,
  // and a passwd-style file hinting at the crack command.
};
export const EXAMPLE_TARGET_PASSWORD = 'EXIT404';
```
Document at the top of the file, in a comment, exactly how a new game
should create its own version: "Copy this file's structure into your
game-specific content folder, keep the `{type, children}` / `{type,
content}` node shape, change the strings."

### `CRTOverlay.js`
```js
/**
 * Adds a CRT scanline + vignette visual overlay to a scene, specific to
 * terminal-style screens. Returns a handle to toggle/destroy it.
 * @param {Phaser.Scene} scene
 * @returns {{ setEnabled(enabled: boolean): void, destroy(): void }}
 */
export function createCRTOverlay(scene) {}
```
Implementation: generate scanlines procedurally with a
`Phaser.GameObjects.Graphics` object — draw horizontal 1px-dark-pixel lines
spaced every 2px across `INTERNAL_WIDTH`x`INTERNAL_HEIGHT` (import
constants from module 02), set low alpha (e.g. 0.15), set depth to
`DEPTH.FX_OVERLAY` (from module 02's `DepthLayers.js`), and
`.setScrollFactor(0)` so it stays fixed regardless of camera movement. Must
check `SettingsStore.get('video.crtEnabled')` (module 10's store) if the
`ctx` passed allows it — document this as an optional enhancement; at
minimum, `setEnabled(false)` must hide/destroy the graphics object cleanly.

## Non-goals
- Do not implement the Terminal `ScreenController` itself (that composes
  `CLIParser` + `WindowFactory`'s `ScrollableText` element + this module's
  `CRTOverlay` — that composition is example game content, built in module
  11, following module 06's `ScreenController` contract).
- Do not hardcode any specific game's real fake-filesystem content outside
  the clearly-marked example file.

## Deliverable
All 3 files, fully JSDoc'd. `CLIParser.js`'s core logic (command handlers,
`resolvePath`) must have zero Phaser imports — only the constructor takes a
Phaser `EventEmitter` instance, which is a generic enough type that the
class itself stays framework-agnostic in its decision logic.
