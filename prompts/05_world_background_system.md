# Module 05 — World / Level & Background System

Read `01_SHARED_CONTRACTS.md` first. This module renders the "stage" a
screen plays out on: parallax layers, tilemaps with collision, static
images, and interactive world objects (the kind of thing the player walks
up to and presses "interact" on).

## Files you own
```
/src/engine/world/BackgroundLoader.js
/src/engine/world/InteractiveObject.js
/src/engine/world/ProximityDetector.js
```

## Requirements

### `BackgroundLoader.js`
Implement exactly the `BackgroundLoader` interface from the shared contract:
```js
export const BackgroundLoader = {
  /**
   * @param {Phaser.Scene} scene
   * @param {BackgroundManifest} manifest - already validated via AssetRegistry
   * @returns {BackgroundHandle}
   */
  build(scene, manifest) {},

  /**
   * Convenience: destroys the old handle (if any) and builds a new one.
   * @param {Phaser.Scene} scene
   * @param {BackgroundHandle|null} oldHandle
   * @param {BackgroundManifest} newManifest
   * @returns {BackgroundHandle}
   */
  swap(scene, oldHandle, newManifest) {},
};
```
`build()` branches on `manifest.type`:
- `'parallax-layered'`: for each entry in `manifest.layers`, call
  `scene.add.tileSprite(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT, textureKey)`
  (exact syscall — use `tileSprite` specifically so layers can scroll
  independently), set `.setScrollFactor(layer.scroll_factor)` and
  `.setDepth(...)` using the `DEPTH` constants from module 02's
  `DepthLayers.js` (map `layer.depth` from the manifest to the nearest
  named constant, or use it directly as a raw number — document your
  choice in a comment), set `.setOrigin(0,0)`.
- `'tilemap'`: call `scene.make.tilemap({ key: manifest.tilemap.source })`,
  then `tilemap.addTilesetImage(...)`, then
  `tilemap.createLayer(layerName, tileset, 0, 0)` for each layer in the
  Tiled JSON, and if `manifest.tilemap.collision_layer` is set, call
  `layer.setCollisionByProperty({ collides: true })` (standard Tiled
  collision convention) on that specific layer and store a reference for
  `getCollisionLayer()`.
- `'static'`: a single `scene.add.image(0, 0, textureKey).setOrigin(0,0)`.

Return a `BackgroundHandle`:
```js
{
  destroy() { /* destroy every GameObject/tilemap created above */ },
  getCollisionLayer() { /* return the Tilemaps.TilemapLayer or null if type !== 'tilemap' */ },
  setAmbientTint(hexColor) { /* call .setTint(Phaser.Display.Color.HexStringToColor(hexColor).color) on every layer/image created, exact syscall */ },
}
```
If `manifest.ambient_tint` is present, call `setAmbientTint` automatically
at the end of `build()`.

### `InteractiveObject.js`
A lightweight wrapper for things like the "PC" the player interacts with:
```js
export class InteractiveObject {
  /**
   * @param {Phaser.Scene} scene
   * @param {number} x
   * @param {number} y
   * @param {{ width: number, height: number, label?: string, onInteract: () => void }} opts
   */
  constructor(scene, x, y, opts) {}

  /** @type {Phaser.GameObjects.Zone} */
  zone;

  /** Call this when the Interact input action fires AND the player is in range (see ProximityDetector). */
  trigger() {}

  destroy() {}
}
```
Implementation: use `scene.add.zone(x, y, opts.width, opts.height)` with
`scene.physics.add.existing(zone, true)` (static body, exact syscalls) as
the detection area — do NOT use a visible sprite for the trigger zone
itself; visuals are a separate GameObject the caller adds independently.
If `opts.label` is given, create a small floating `Phaser.GameObjects.Text`
above the object that is hidden by default (this is the "[E] interact"
prompt) and exposed via a method `showPrompt(visible: boolean)`.

### `ProximityDetector.js`
```js
/**
 * @param {Phaser.GameObjects.Sprite} subject - e.g. the player's Actor.sprite
 * @param {{x:number, y:number}} target
 * @param {number} radius
 * @returns {boolean}
 */
export function isWithinRadius(subject, target, radius) {}
```
Pure distance check using `Phaser.Math.Distance.Between` (exact syscall) —
no side effects, callable every frame cheaply from a scene's `update()`.

## Non-goals
- Do not implement the player's movement controller — that combines
  module 04's `Actor` with input, and belongs to whichever screen
  controller owns the World mode (built in module 11's example content,
  following module 06's contract).
- Do not hardcode any specific background/object id or name.

## Deliverable
All 3 files, fully JSDoc'd.
