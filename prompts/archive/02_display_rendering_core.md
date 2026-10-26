# Module 02 — Display & Rendering Core

Read `01_SHARED_CONTRACTS.md` first. This module owns pixel-perfect
rendering setup, camera control, scaling, depth/layer conventions, and
screen transition effects (the visual effect itself — not the mode-switching
logic, which is module 06).

## Files you own
```
/src/engine/display/constants.js
/src/engine/display/DisplayManager.js
/src/engine/display/DepthLayers.js
/src/engine/display/TransitionRegistry.js
/src/engine/display/phaserConfig.js
```

## Requirements

### `constants.js`
Export exactly: `INTERNAL_WIDTH = 480`, `INTERNAL_HEIGHT = 270`,
`TILE_SIZE = 32`. These are the canonical values every other module imports.

### `phaserConfig.js`
Export a function `buildPhaserConfig(sceneList: Phaser.Scene[]):
Phaser.Types.Core.GameConfig` that returns a config object with:
- `type: Phaser.AUTO`
- `width/height` from `constants.js`
- `pixelArt: true`, `antialias: false`, `roundPixels: true`
- `physics: { default: 'arcade', arcade: { debug: false } }`
- `scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }`
- `scene: sceneList`
Document in a JSDoc comment exactly which Phaser syscall each config key
maps to, so a reviewer can verify correctness without running it.

### `DisplayManager.js`
A class/singleton with:
```js
/**
 * @method getBestIntegerScale(windowWidth: number, windowHeight: number): number
 *   Computes the largest integer >= 1 such that INTERNAL_WIDTH*n <= windowWidth
 *   and INTERNAL_HEIGHT*n <= windowHeight. Minimum return value is 1.
 * @method applyScale(game: Phaser.Game, scale: number): void
 *   Calls game.scale.setZoom(scale) — this is the exact Phaser syscall to use,
 *   do not manually resize the canvas element.
 * @method watchResize(game: Phaser.Game): void
 *   Listens to window 'resize' via game.scale.on('resize', ...) (Phaser's own
 *   resize event, NOT a raw window.addEventListener) and re-applies scale.
 */
```

### `DepthLayers.js`
Export a frozen constant object defining canonical Phaser depth values so no
other module invents its own depth numbers:
```js
export const DEPTH = Object.freeze({
  BACKGROUND_FAR: -30,
  BACKGROUND_MID: -20,
  BACKGROUND_NEAR: -10,
  WORLD_GROUND: 0,
  WORLD_ENTITIES: 10,
  WORLD_FOREGROUND: 20,
  UI_HUD: 100,
  UI_WINDOW: 200,
  UI_MODAL_OVERLAY: 190,
  FX_OVERLAY: 300,
});
```
Any `setDepth()` call anywhere in the codebase (by any module) must use one
of these named values — document this rule in a comment at the top of the
file for other developers to see.

### `TransitionRegistry.js`
A registry mapping transition names (strings used in `ScreenManifest.transition_in/out`,
see shared contract) to functions. Implement at minimum:
```js
/**
 * Each transition function signature:
 * @param {Phaser.Scene} scene
 * @param {'in'|'out'} direction
 * @param {() => void} onComplete
 */
```
Implement these four using **exact Phaser Camera syscalls**:
- `'fade'`: `scene.cameras.main.fadeIn(300, 0,0,0)` / `.fadeOut(300, 0,0,0)`,
  listen for `'camerafadeincomplete'`/`'camerafadeoutcomplete'` to call `onComplete`.
- `'instant'`: calls `onComplete` synchronously, no visual effect.
- `'wipe-left'`: implement via a full-screen black `Phaser.GameObjects.Rectangle`
  tweened with `scene.tweens.add({ x: ..., duration: 300 })` sliding across,
  then destroyed; call `onComplete` in the tween's `onComplete` callback.
- `'crt-flicker'`: a short sequence of `scene.cameras.main.flash()` calls with
  decreasing duration (e.g. 3 flashes of white/green at 40ms each) via
  chained `scene.time.delayedCall`, then `onComplete`.

Export `registerTransition(name, fn)` so module 09 (Loop/Glitch) can add more
transition styles later without editing this file's existing code.

## Explicit non-goals (do NOT implement here)
- Do not implement screen/mode switching logic — that's module 06, this
  module only provides the visual transition primitives it calls.
- Do not implement camera-follow-player logic — that belongs in whichever
  screen controller uses a camera (modules 05/06), this module only exposes
  `DisplayManager` for scale, not follow behavior.

## Deliverable
All 5 files, each with full JSDoc, zero references to any specific sprite,
background, or screen id (pure mechanism, no content).
