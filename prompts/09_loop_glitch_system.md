# Module 09 — Loop / Glitch Mechanic System

Read `01_SHARED_CONTRACTS.md` first. This module implements the two
mechanics unique to this game's lore: a persistent-across-resets progress
tracker (`LoopManager`) and a set of generic, mode-agnostic visual effect
primitives (`FxManager`) that scale with that progress.

## Files you own
```
/src/engine/loop/LoopManager.js
/src/engine/loop/FxManager.js
```

## Requirements

### `LoopManager.js`
Implement exactly the `LoopManager` interface from the shared contract, as a
**module-level singleton** (plain exported object, not a class requiring
instantiation — it must survive Phaser scene restarts untouched, so it must
NOT be stored on any Scene or GameObject):
```js
class LoopManagerImpl {
  constructor() {
    this.totalFragmentsNeeded = 5; // overridable by game content at boot, see note below
    this.reset();
  }
  reset() { this.fragments = new Set(); this.loopCount = 0; this.unlockedTerminalAccess = false; }
  startNewLoop() { this.loopCount += 1; }
  addFragment(id) {
    this.fragments.add(id);
    if (this.fragmentCount() >= this.totalFragmentsNeeded) this.unlockedTerminalAccess = true;
    // emit on a module-level EventEmitter instance (see below), exact event name from shared contract:
    // 'loop:fragment-added' with payload { id, total: this.fragmentCount() }
  }
  hasFragment(id) { return this.fragments.has(id); }
  fragmentCount() { return this.fragments.size; }
  glitchLevel() { return Math.min(1, this.fragmentCount() / this.totalFragmentsNeeded); }
}
export const LoopManager = new LoopManagerImpl();
```
Additional requirement not shown above: `LoopManager` must own its own
`Phaser.Events.EventEmitter` instance (import `Phaser` just for this class,
it's lightweight and framework-independent enough to justify) so that
`'loop:fragment-added'` and `'loop:reset'` (exact names from shared
contract) can be emitted and subscribed to by ANY scene without needing a
reference to a specific scene's own event emitter — expose it as
`LoopManager.events`. `reset()` must emit `'loop:reset'` on this emitter
after clearing state. Document clearly that `totalFragmentsNeeded` is meant
to be overwritten once by the game bootstrap (module 11) immediately after
import, before any gameplay starts — do not make it a constructor
parameter, since this is a true singleton with no constructor call site
available to callers.

### `FxManager.js`
Implement exactly the `FxManager` interface from the shared contract:
```js
export const FxManager = {
  /** @param {Phaser.Scene} scene @param {number} intensity @param {number} durationMs */
  shake(scene, intensity, durationMs) {},
  /** @param {Phaser.Scene} scene @param {string} hexColor @param {number} durationMs */
  flash(scene, hexColor, durationMs) {},
  /** @param {Phaser.Scene} scene @param {boolean} enabled */
  crtOverlay(scene, enabled) {},
  /** @param {Phaser.Scene} scene @param {boolean} enabled */
  scanlines(scene, enabled) {},
};
```
Implementation notes:
- `shake`: call `scene.cameras.main.shake(durationMs, intensity)` (exact
  Phaser syscall — note Phaser's own signature order is
  `shake(duration, intensity)`, be careful not to transpose the params).
  Before calling, read `SettingsStore.get('video.reducedMotion')` (import
  the singleton from module 10's `SettingsStore.js`) — if `true`, multiply
  `intensity` by `0.15` (near-zero but not literally disabled, so the
  player still gets *some* feedback) rather than skipping the call entirely.
- `flash`: call `scene.cameras.main.flash(durationMs, r, g, b, false)`
  (exact syscall; convert `hexColor` string to r/g/b via
  `Phaser.Display.Color.HexStringToColor(hexColor)`). Same reducedMotion
  check, scaling `durationMs` down rather than `0`-ing it, so a flash still
  briefly reads as feedback.
- `crtOverlay`/`scanlines`: these specifically delegate to module 08's
  `createCRTOverlay` helper if that module's file is available in the
  project (import it directly: `import { createCRTOverlay } from
  '../terminal/CRTOverlay.js'`) — document in a comment that `FxManager`
  depends on module 08 for this one specific pair of methods, which is an
  intentional, acceptable cross-module dependency since both are "visual FX"
  conceptually; everything else in this module has zero dependencies on
  other engine modules besides module 02's constants and module 10's
  SettingsStore.
- Maintain an internal `WeakMap<Phaser.Scene, OverlayHandle>` so repeated
  calls to `crtOverlay(scene, true)` don't create duplicate overlays, and
  `crtOverlay(scene, false)` correctly destroys the one tied to that scene.

## A note on how `LoopManager` + `FxManager` get used together
Document (as a code comment block at the top of `FxManager.js`) the
intended calling pattern for other modules to follow, e.g.:
```js
// Typical usage from a screen controller's onUpdate:
// const level = LoopManager.glitchLevel();
// if (Math.random() < 0.002 * level) FxManager.shake(scene, 0.002 + 0.006*level, 120);
```
This module does not call itself automatically on a timer — it only
provides primitives; the calling pattern/frequency is a decision for
whichever screen controller uses it (module 11's example content).

## Non-goals
- Do not implement the "reset trigger" (what causes a new loop to start —
  a timer, player death, reaching a map edge, etc.) — that is gameplay
  logic belonging to module 11's example World screen controller, which
  will call `LoopManager.startNewLoop()` and `FxManager`'s transition
  helpers (via module 02's `TransitionRegistry`) itself.
- Do not hardcode `totalFragmentsNeeded`'s final game-specific value beyond
  the documented placeholder default.

## Deliverable
Both files, fully JSDoc'd.
