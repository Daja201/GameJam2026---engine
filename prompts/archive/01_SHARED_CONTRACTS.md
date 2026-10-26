# SHARED CONTRACTS — Read This Before Any Module Prompt

This document is the single source of truth for every file path, function
signature, manifest schema, and event name used across the whole engine.
Every module prompt in this set (`02` through `11`) was written against this
contract. **Implement your own module's prompt exactly, and only call into
other modules using the signatures defined here** — never guess another
module's internals.

Target stack: **Phaser 3.80+, vanilla JavaScript (ES modules), Vite build
tool.** No TypeScript, no frameworks on top of Phaser.

---

## Global folder structure (every module must respect this)

```
/src
  /engine
    /display      <- module 02
    /assets       <- module 03
    /sprites      <- module 04
    /world        <- module 05
    /screens      <- module 06
    /ui           <- module 07
    /terminal     <- module 08
    /loop         <- module 09
    /audio        <- module 10
    /settings     <- module 10
  /game            <- module 11 (bootstrap + example content wiring only)
  main.js          <- module 11
/graphics
  /sprites/<sprite_id>/manifest.json + frame PNGs
  /backgrounds/<background_id>/manifest.json + layer/tile PNGs
  /ui/windows/<skin_id>/manifest.json + panel PNGs
/screens/<screen_id>/manifest.json
/config
  settings.default.json
  controls.default.json
  engine.config.json
/audio
  /music
  /sfx
```

No module may write files outside its own named subfolder above, except
module 11 which owns `/src/game` and `/src/main.js`.

---

## Internal resolution & global constants

Defined in `/src/engine/display/constants.js` (owned by module 02, imported
by everyone):

```js
export const INTERNAL_WIDTH = 480;
export const INTERNAL_HEIGHT = 270;
export const TILE_SIZE = 32;
```

Every module must import these constants rather than hardcoding numbers.

---

## Core shared interfaces

### `AssetRegistry` (module 03 implements, everyone else calls)

```js
/**
 * @typedef {Object} AssetRegistry
 * @property {(rootPath: string) => Promise<void>} scan
 *   Recursively discovers and validates all manifests under rootPath.
 * @property {(id: string) => SpriteManifest} getSpriteManifest
 * @property {(id: string) => BackgroundManifest} getBackgroundManifest
 * @property {(id: string) => ScreenManifest} getScreenManifest
 * @property {(id: string) => WindowManifest} getWindowManifest
 * @property {() => string[]} listSpriteIds
 * @property {() => string[]} listBackgroundIds
 * @property {() => string[]} listScreenIds
 */
```
Exported as a singleton: `import { AssetRegistry } from '../engine/assets/AssetRegistry.js'`.
Throws `AssetValidationError(filePath, fieldPath, message)` on any invalid manifest.

### `SpriteManifest` (JSON shape, validated by module 03, consumed by module 04)

```jsonc
{
  "id": "string, required, unique",
  "display_name": "string",
  "type": "character | npc | prop | effect",
  "frame_size": { "width": "number", "height": "number" },
  "pivot": { "x": "number 0-1", "y": "number 0-1" },
  "directionality": {
    "mode": "1-dir | 4-dir | 8-dir | free-rotation",
    "directions": ["south", "south-east", "east", "north-east", "north", "north-west", "west", "south-west"]
  },
  "states": {
    "<state_name>": {
      "type": "static-per-direction | animated-per-direction",
      "frame_rate": "number",
      "loop": "boolean",
      "frame_count": "number, only for animated-per-direction",
      "source": "string path template with {direction} and {frame:03d} placeholders",
      "fallback": "string, name of another state to use for missing directions",
      "events": [{ "frame": "number", "emit": "string event name" }]
    }
  },
  "hitbox": { "width": "number", "height": "number", "offset_y": "number" },
  "scale": "number, default 1"
}
```

### `Actor` (module 04 implements, modules 05/06/09/11 use)

```js
/**
 * @class Actor
 * @param {Phaser.Scene} scene
 * @param {string} spriteId  - must exist in AssetRegistry
 * @param {number} x
 * @param {number} y
 * @property {Phaser.Physics.Arcade.Sprite} sprite
 * @method playState(stateName: string): void
 * @method setDirection(direction: string): void
 * @method setDirectionFromVector(dx: number, dy: number): void
 * @property {string} currentState
 * @property {string} currentDirection
 */
```

### `DirectionResolver` (module 04, pure function, no Phaser dependency)

```js
/**
 * @param {number} dx
 * @param {number} dy
 * @param {'1-dir'|'4-dir'|'8-dir'|'free-rotation'} mode
 * @returns {string|number} direction name (or degrees for free-rotation)
 */
export function resolveDirection(dx, dy, mode) {}
```

### `BackgroundLoader` (module 05 implements, module 06/11 call)

```js
/**
 * @property {(scene: Phaser.Scene, backgroundId: string) => BackgroundHandle} build
 * @typedef {Object} BackgroundHandle
 * @property {() => void} destroy
 * @property {() => Phaser.Tilemaps.TilemapLayer|null} getCollisionLayer
 * @property {(hexColor: string) => void} setAmbientTint
 */
```

### `ScreenManager` (module 06 implements, module 11 drives, everyone's controllers plug into it)

```js
/**
 * @method push(screenId: string, params?: object): Promise<void>
 * @method pop(): Promise<void>
 * @method switchTo(screenId: string, params?: object): Promise<void>
 * @method replaceTop(screenId: string, params?: object): Promise<void>
 * @property {ScreenController|null} topController
 */

/** Interface every screen controller class must implement (module 06 contract, implemented by 05/08/09/11 code) */
class ScreenController {
  /** @param {EngineContext} engine @param {ScreenManifest} manifest */
  constructor(engine, manifest) {}
  onEnter(params) {}
  onExit() {}
  onUpdate(time, delta) {}
  onInput(action, event) {}
  onPause() {}
  onResume() {}
}
```

`ScreenManifest` JSON shape:
```jsonc
{
  "id": "string",
  "display_name": "string",
  "controller": "string, registered name in ScreenControllerRegistry",
  "input_profile": "string, key into controls config",
  "background": "string|null, background id",
  "ui_windows": ["string, window ids auto-opened on enter"],
  "transition_in": "fade | crt-flicker | instant | wipe-left",
  "transition_out": "fade | crt-flicker | instant | wipe-left"
}
```

### `InputRouter` (module 06 implements)

```js
/**
 * @method setProfile(profileName: string): void
 * @method on(actionName: string, handler: (event) => void): void
 * @method off(actionName: string, handler: (event) => void): void
 */
```
Emits abstract action names only: `move-up`, `move-down`, `move-left`,
`move-right`, `interact`, `confirm`, `cancel`, `text-char` (payload:
`{char}`), `text-backspace`, `text-enter`, `menu-up`, `menu-down`.
No module other than `InputRouter` may read raw `event.key` directly.

### `WindowFactory` (module 07 implements, modules 08/09/11 use)

```js
/**
 * @method build(scene: Phaser.Scene, windowId: string, opts?: object): WindowHandle
 * @typedef {Object} WindowHandle
 * @property {Phaser.GameObjects.Container} container
 * @property {() => void} close
 * @property {(elementId: string, value: any) => void} setElementValue
 */
```
`WindowManifest` elements support types: `label`, `button`, `slider`,
`toggle`, `text-input`, `keybind_list`, `scrollable-text`, `list`. Each
element with a `bind` field reads/writes through `SettingsStore` (module 10)
at that dotted path. Each element with an `action` field calls
`ActionRegistry.invoke(actionName, context)`.

### `SettingsStore` (module 10 implements, everyone reads from it)

```js
/**
 * @method get(path: string): any   - e.g. get('audio.music')
 * @method set(path: string, value: any): void
 * @method subscribe(path: string, callback: (newValue) => void): () => void  (returns unsubscribe fn)
 * @method save(): void   - persists to localStorage
 * @method load(): void   - loads from localStorage over defaults
 */
```

### `AudioManager` (module 10 implements)

```js
/**
 * @method playMusic(key: string, opts?: {loop?: boolean, fadeMs?: number}): void
 * @method stopMusic(fadeMs?: number): void
 * @method playSfx(key: string, opts?: {volume?: number}): void
 * @method setCategoryVolume(category: 'music'|'sfx'|'ambient', value: number): void
 */
```

### `LoopManager` (module 09 implements — singleton, survives scene restarts)

```js
/**
 * @method reset(): void
 * @method startNewLoop(): void
 * @method addFragment(id: string): void
 * @method hasFragment(id: string): boolean
 * @method fragmentCount(): number
 * @method glitchLevel(): number   - 0..1
 * @property {number} totalFragmentsNeeded
 * @property {boolean} unlockedTerminalAccess
 */
```

### `FxManager` (module 09 implements)

```js
/**
 * @method shake(scene: Phaser.Scene, intensity: number, durationMs: number): void
 * @method flash(scene: Phaser.Scene, hexColor: string, durationMs: number): void
 * @method crtOverlay(scene: Phaser.Scene, enabled: boolean): void
 * @method scanlines(scene: Phaser.Scene, enabled: boolean): void
 */
```
Must read `SettingsStore.get('video.reducedMotion')` and scale/disable
intensity accordingly.

### `CLIParser` (module 08 implements)

```js
/**
 * @param {Phaser.Events.EventEmitter} eventEmitter
 * @method run(rawInput: string, ui?: {clear(): void}): string[]
 * @property {{cwd: string}} state
 */
```
Emits `'terminal:crack-success'` and `'terminal:crack-fail'` (payload:
`{guess: string}`) on the passed `eventEmitter`.

---

## Shared event names (any module may emit/listen, via the active Scene's event emitter unless noted)

| event | payload | emitted by |
|---|---|---|
| `terminal:crack-success` | none | module 08 |
| `terminal:crack-fail` | `{guess}` | module 08 |
| `actor:anim-event` | `{actorId, eventName}` | module 04 |
| `loop:fragment-added` | `{id, total}` | module 09 |
| `loop:reset` | none | module 09 |
| `settings:changed` | `{path, value}` | module 10 |

---

## File naming & key conventions (must match exactly, everywhere)

- Phaser animation keys: `${spriteId}:${state}:${direction}`
- Phaser texture keys for sprite frames: `${spriteId}:${state}:${direction}:${frameIndex}`
- Manifest file name: always exactly `manifest.json`, lowercase.
- Screen/window/sprite/background `id` fields: lowercase, snake_case, must
  match their containing folder name.
