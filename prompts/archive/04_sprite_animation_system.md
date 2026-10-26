# Module 04 — Sprite & Animation System

Read `01_SHARED_CONTRACTS.md` first. This module turns a validated
`SpriteManifest` (loaded by module 03's `AssetRegistry`) into working Phaser
animations and a generic `Actor` entity class that any gameplay code can
drive without ever touching Phaser's animation API directly.

## Files you own
```
/src/engine/sprites/DirectionResolver.js
/src/engine/sprites/AnimationFactory.js
/src/engine/sprites/Actor.js
```

## Requirements

### `DirectionResolver.js`
Pure function, **zero Phaser imports**, unit-testable in isolation:
```js
/**
 * @param {number} dx
 * @param {number} dy
 * @param {'1-dir'|'4-dir'|'8-dir'|'free-rotation'} mode
 * @returns {string|number}
 *   For '1-dir': always returns "south".
 *   For '4-dir': one of "north","south","east","west".
 *   For '8-dir': one of "south","south-east","east","north-east","north","north-west","west","south-west".
 *   For 'free-rotation': returns degrees as a number, 0 = east, clockwise positive, range [0,360).
 * @throws {Error} if dx===0 && dy===0 (caller must not call this with a zero vector; document this clearly)
 */
export function resolveDirection(dx, dy, mode) {}
```
Implementation for 4/8-dir: compute `angle = Math.atan2(dy, dx)` (exact
syscall — standard JS Math, not Phaser.Math), convert to degrees
`(angle * 180/Math.PI + 360) % 360`, divide into `360/N` degree sectors
(N=4 or 8), round to nearest sector index, map index to the direction name
array in the order given above starting from "east" at sector 0 going
clockwise in screen space (positive Y = down).

### `AnimationFactory.js`
```js
/**
 * Registers every Phaser animation key described in a SpriteManifest's
 * `states` object onto the given scene's AnimationManager.
 * @param {Phaser.Scene} scene
 * @param {SpriteManifest} manifest
 * @returns {void}
 */
export function registerAnimations(scene, manifest) {}

/**
 * Pure helper, no Phaser dependency — builds the canonical animation key.
 * @param {string} spriteId
 * @param {string} state
 * @param {string} direction
 * @returns {string} `${spriteId}:${state}:${direction}`
 */
export function animKey(spriteId, state, direction) {}
```
`registerAnimations` must, for every direction the manifest's
`directionality.directions` lists, and for every state in `states`:
- If `states[state].type === 'static-per-direction'`: call
  `scene.anims.create({ key: animKey(...), frames: [{ key: textureKeyFor(...) }], frameRate: 1, repeat: -1 })`
  where the texture key matches the convention from module 03
  (`${spriteId}:${state}:${direction}` for static states — confirm this
  matches what `PreloadQueueBuilder` actually loaded; if the direction has
  no authored texture, use the manifest's `states[state].fallback` state's
  texture key for that direction instead, and `console.warn` once per
  missing combination — never throw for this case, this is expected partial
  authoring, not a validation error).
- If `type === 'animated-per-direction'`: build a `frames` array of
  `{ key: `${spriteId}:${state}:${direction}:${i}` }` for `i` from 0 to
  `frame_count - 1`, call `scene.anims.create({ key: animKey(...), frames,
  frameRate: states[state].frame_rate, repeat: states[state].loop ? -1 : 0 })`.
  If this direction+state combination has no loaded frames (missing
  authored content), fall back the same way as above, to the `fallback`
  state's **idle-equivalent** for that direction.
- If `states[state].events` is present, do not attach Phaser's own
  `animationupdate` listener here generically for every animation (too
  expensive) — instead store the event-frame map on the scene's registry
  (`scene.data.set(`anim-events:${animKey(...)}`, events)`) so `Actor` can
  check it per-frame cheaply (see below).

### `Actor.js`
```js
export class Actor {
  /**
   * @param {Phaser.Scene} scene
   * @param {SpriteManifest} manifest - already validated, from AssetRegistry
   * @param {number} x
   * @param {number} y
   */
  constructor(scene, manifest, x, y) {}

  /** @type {Phaser.Physics.Arcade.Sprite} */
  sprite;

  /** @type {string} */
  currentState;

  /** @type {string} */
  currentDirection;

  /**
   * @param {string} stateName - must exist in manifest.states
   */
  playState(stateName) {}

  /**
   * @param {string} direction
   */
  setDirection(direction) {}

  /**
   * @param {number} dx
   * @param {number} dy
   * Calls DirectionResolver.resolveDirection internally using this actor's
   * manifest.directionality.mode, then setDirection + playState with the
   * currently-intended state (walk if moving — caller decides which state
   * to combine this with by calling playState separately, or you may accept
   * an optional second param `stateName` defaulting to 'walk').
   */
  setDirectionFromVector(dx, dy, stateName) {}

  /** Call once per frame from the owning scene's update(). Checks the
   * scene.data event map set by AnimationFactory against the sprite's
   * current animation frame index, and emits `scene.events.emit('actor:anim-event', { actorId, eventName })`
   * (exact event name from the shared contract) when a frame boundary is
   * crossed that matches a registered event.
   * @param {number} time
   * @param {number} delta
   */
  update(time, delta) {}
}
```
Constructor implementation notes: call
`scene.physics.add.sprite(x, y, initialTextureKey)` (exact Phaser syscall)
using the manifest's `south` idle texture (or `directions[0]` if `south` is
absent) as the initial texture, then `this.sprite.setOrigin(manifest.pivot.x, manifest.pivot.y)`,
then if `manifest.hitbox` is present, call
`this.sprite.body.setSize(hitbox.width, hitbox.height).setOffset(...)`
computed so the hitbox is centered horizontally and offset vertically by
`hitbox.offset_y`. Set `this.sprite.setScale(manifest.scale ?? 1)`.

## Non-goals
- Do not implement player input or movement logic — `Actor` only exposes
  state/direction control; something in module 05 or 11 decides *when* to
  call `setDirectionFromVector`.
- Do not hardcode any specific sprite id.

## Deliverable
All 3 files, fully JSDoc'd. `DirectionResolver.js` must have zero `import`
statements at all.
