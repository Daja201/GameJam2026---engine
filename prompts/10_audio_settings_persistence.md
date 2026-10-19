# Module 10 — Audio & Settings / Persistence

Read `01_SHARED_CONTRACTS.md` first. This module owns all sound playback
and the single reactive settings store that every other module (sliders in
module 07's windows, `FxManager` in module 09, controls in module 06) reads
from and writes to.

## Files you own
```
/src/engine/settings/SettingsStore.js
/src/engine/settings/SettingsSchema.js
/src/engine/audio/AudioManager.js
```

## Requirements

### `SettingsSchema.js`
Export the default settings shape as a plain object (this becomes the
content of `/config/settings.default.json`, document that this file's
export must stay in sync with that JSON file's actual content, or better:
have this JS file be the single source of truth and have the JSON file
simply mirror it manually at project setup time):
```js
export const DEFAULT_SETTINGS = {
  audio: { music: 0.7, sfx: 0.8, ambient: 0.5, muted: false },
  video: { pixelScale: 'auto', crtEnabled: true, glitchEnabled: true, reducedMotion: false },
  controls: {}, // populated at runtime from /config/controls.default.json by module 11's bootstrap
  accessibility: { textSize: 'normal' },
};
export const SETTINGS_SCHEMA_VERSION = 1;
```

### `SettingsStore.js`
Implement exactly the `SettingsStore` interface from the shared contract, as
a **singleton** (same reasoning as `LoopManager` — must be importable and
used from anywhere without instantiation):
```js
class SettingsStoreImpl {
  constructor() {
    this._values = structuredClone(DEFAULT_SETTINGS); // exact syscall: use structuredClone, not JSON.parse(JSON.stringify(...))
    this._subscribers = new Map(); // path -> Set<callback>
  }
  get(path) { /* dotted-path lookup, e.g. 'audio.music' -> this._values.audio.music */ }
  set(path, value) { /* dotted-path assignment, then notify subscribers for that exact path, then call this.save() */ }
  subscribe(path, callback) { /* add to this._subscribers.get(path) Set (create if absent), return unsubscribe fn that removes it */ }
  save() { /* localStorage.setItem('hackjam:settings:v' + SETTINGS_SCHEMA_VERSION, JSON.stringify(this._values)) */ }
  load() {
    /* read localStorage key above, JSON.parse, if present deep-merge over
       DEFAULT_SETTINGS (so new default fields added later still appear even
       in an old save) rather than replacing wholesale. If the stored JSON
       is malformed (JSON.parse throws), log a console.warn and fall back to
       defaults silently rather than crashing. */
  }
}
export const SettingsStore = new SettingsStoreImpl();
```
Document exact dotted-path implementation approach (split on `.`, walk/
create nested objects) as a small private helper `_getAtPath`/`_setAtPath`,
pure functions, unit-testable, exported separately for tests:
```js
export function getAtPath(obj, path) {}
export function setAtPath(obj, path, value) {}
```
`set()` must call `this.save()` on every write (document that this is a
simple, non-debounced implementation — acceptable for a jam-scale project;
note in a comment that a production version might debounce this).
Also: every call to `set()` must emit on a shared Phaser-independent event
mechanism (a plain array of global listeners is fine, no need for a full
EventEmitter class here) matching the shared contract's `'settings:changed'`
event shape `{ path, value }` — expose this as `SettingsStore.onAnyChange(callback)`
/ `SettingsStore.offAnyChange(callback)` in addition to the path-scoped
`subscribe`.

### `AudioManager.js`
Implement exactly the `AudioManager` interface from the shared contract:
```js
export const AudioManager = {
  /** @param {Phaser.Scene} scene - needed once to access scene.sound */
  init(scene) {},
  /** @param {string} key @param {{loop?: boolean, fadeMs?: number}} [opts] */
  playMusic(key, opts) {},
  /** @param {number} [fadeMs] */
  stopMusic(fadeMs) {},
  /** @param {string} key @param {{volume?: number}} [opts] */
  playSfx(key, opts) {},
  /** @param {'music'|'sfx'|'ambient'} category @param {number} value */
  setCategoryVolume(category, value) {},
};
```
Implementation notes:
- `init(scene)` stores `scene.sound` (Phaser's global `SoundManager`, exact
  syscall access point — note it's shared across scenes in Phaser by
  default, so `init` only needs to be called once from the bootstrap, not
  per-scene; document this clearly) and immediately reads current volumes
  from `SettingsStore` for `music`/`sfx`/`ambient`, and subscribes to
  `SettingsStore.subscribe('audio.music', ...)` etc. so live slider changes
  (from module 07's Slider element) take effect immediately.
- `playMusic`: if a track is already playing, call `.stop()` on it first
  unless `opts.fadeMs` is given, in which case tween its volume to 0 via
  `scene.tweens.add({ targets: currentTrack, volume: 0, duration: fadeMs,
  onComplete: () => currentTrack.stop() })` (exact Phaser tween syscall on a
  Sound object's `volume` property — this works because Phaser sound
  objects expose a settable `.volume`). Then
  `scene.sound.add(key, { loop: opts.loop ?? true, volume:
  SettingsStore.get('audio.music') }).play()` (exact syscalls:
  `scene.sound.add` + `.play()`).
- `playSfx`: `scene.sound.play(key, { volume: (opts?.volume ?? 1) *
  SettingsStore.get('audio.sfx') })` (exact syscall — note
  `scene.sound.play` is the fire-and-forget shorthand, appropriate for SFX
  since it doesn't need a handle kept around, unlike music).
- `setCategoryVolume`: just calls `SettingsStore.set('audio.' + category,
  value)` — the actual volume application happens via the subscriptions set
  up in `init`, keeping this module from having two separate code paths
  that both apply volume.
- Respect `SettingsStore.get('audio.muted')`: when `true`, all `playSfx`/
  `playMusic` calls should still create the sound objects normally (so
  state/position isn't lost) but with effective volume `0` — check this
  flag inside the volume calculation, not as an early-return that skips
  playback entirely (document why: an early return would desync e.g. music
  loop position from game state if unmuted later).

## Non-goals
- Do not implement the UI slider/toggle elements that control these values
  (module 07 owns those) — only expose the store/manager they bind to.
- Do not hardcode any specific music/sfx asset key.

## Deliverable
All 3 files, fully JSDoc'd.
