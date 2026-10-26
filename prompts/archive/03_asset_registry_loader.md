# Module 03 — Asset Registry & Loader

Read `01_SHARED_CONTRACTS.md` first. This module discovers, validates, and
indexes every manifest-described asset (sprites, backgrounds, screens,
windows) before gameplay starts, and drives Phaser's preload queue from that
index.

## Files you own
```
/src/engine/assets/AssetRegistry.js
/src/engine/assets/ManifestSchemas.js
/src/engine/assets/ManifestValidator.js
/src/engine/assets/AssetValidationError.js
/src/engine/assets/PreloadQueueBuilder.js
```

## Requirements

### `AssetValidationError.js`
```js
export class AssetValidationError extends Error {
  /**
   * @param {string} filePath - absolute or project-relative path of the offending manifest
   * @param {string} fieldPath - dotted path to the invalid field, e.g. "states.walk.frame_count"
   * @param {string} message - human-readable reason
   */
  constructor(filePath, fieldPath, message) { /* set this.filePath, this.fieldPath, build message */ }
}
```
The constructed `.message` must read exactly:
`` `Invalid manifest at ${filePath} (field: ${fieldPath}): ${message}` ``
so any console.error of this object is immediately actionable.

### `ManifestSchemas.js`
Export four plain-object JSON-Schema-like definitions (hand-rolled, no
external schema library dependency): `SPRITE_MANIFEST_SCHEMA`,
`BACKGROUND_MANIFEST_SCHEMA`, `SCREEN_MANIFEST_SCHEMA`,
`WINDOW_MANIFEST_SCHEMA`. Each must match the exact shapes given in
`01_SHARED_CONTRACTS.md` under "Core shared interfaces" (sprite manifest)
and the `ScreenManifest`/window element fields described there. Required
fields must be marked explicitly; this file is read by `ManifestValidator.js`.

### `ManifestValidator.js`
```js
/**
 * @param {object} manifestJson - parsed JSON content
 * @param {object} schema - one of the exports from ManifestSchemas.js
 * @param {string} filePath - for error reporting
 * @throws {AssetValidationError} on first violation found (field name required/type mismatch/enum violation)
 * @returns {void} - does not return a value, only throws or passes silently
 */
export function validateManifest(manifestJson, schema, filePath) {}
```
Validation must check: required fields present, `type`/enum fields match
allowed values listed in the schema, nested object shapes for `frame_size`,
`pivot`, `directionality`, `states`, `hitbox` (sprite manifests). Do not use
any external validation library — hand-write the checks with plain
`typeof`/`Array.isArray`/property checks, so this module has zero npm
dependencies beyond Phaser.

### `AssetRegistry.js`
Implement the singleton exactly matching the `AssetRegistry` interface in
the shared contract:
```js
export const AssetRegistry = {
  async scan(rootPath) {},
  getSpriteManifest(id) {},
  getBackgroundManifest(id) {},
  getScreenManifest(id) {},
  getWindowManifest(id) {},
  listSpriteIds() {},
  listBackgroundIds() {},
  listScreenIds() {},
};
```
Implementation notes:
- `scan()` must be callable from a Phaser `Scene.preload()` using
  `scene.load.json(key, path)` for each manifest file it needs to fetch
  (browser environment has no filesystem access — manifests must be loaded
  as HTTP requests via Phaser's loader, not Node `fs`). Because the set of
  manifest file paths isn't known ahead of time in a pure browser context,
  `scan(rootPath)` must accept a **pre-enumerated list of manifest paths**
  passed in by the caller (module 11's bootstrap will supply this list,
  generated at build time or hardcoded in the example content — document
  this constraint clearly in a top-of-file comment so module 11 knows it
  must supply the path list).
- Exact signature to actually use, reconciling the above:
  ```js
  /**
   * @param {Phaser.Scene} scene - scene whose loader will fetch the manifests
   * @param {{ sprites: string[], backgrounds: string[], screens: string[], windows: string[] }} manifestPaths
   * @returns {Promise<void>} resolves after scene.load completes and every manifest is validated and indexed
   */
  async scan(scene, manifestPaths) {}
  ```
- Internally: call `scene.load.json(uniqueKey, path)` for every path, then
  `scene.load.once('complete', resolve)` and `scene.load.start()` (exact
  Phaser syscalls), then for each loaded JSON call `validateManifest(...)`
  with the matching schema, then store in an internal `Map` keyed by the
  manifest's own `id` field (not the file path).
- Getter methods throw a plain `Error` (not `AssetValidationError`) with
  message `` `Unknown sprite id: ${id}` `` (etc.) if the id was never
  registered — fail loud, never return `undefined` silently.

### `PreloadQueueBuilder.js`
```js
/**
 * Given a validated SpriteManifest, queues every frame PNG it references
 * onto the scene's loader using scene.load.image(key, path), with keys
 * following the exact convention from the shared contract:
 * `${spriteId}:${state}:${direction}:${frameIndex}` for animated states,
 * `${spriteId}:idle:${direction}` style for static-per-direction states.
 * @param {Phaser.Scene} scene
 * @param {SpriteManifest} manifest
 * @returns {void}
 */
export function queueSpriteFrames(scene, manifest) {}

/**
 * Same idea for a BackgroundManifest: queues scene.load.image for every
 * layer, and if manifest.tilemap is present, scene.load.tilemapTiledJSON(...)
 * plus scene.load.image for the tileset image.
 * @param {Phaser.Scene} scene
 * @param {BackgroundManifest} manifest
 */
export function queueBackgroundAssets(scene, manifest) {}
```

## Non-goals
- Do not build Phaser animations here (that's module 04's `AnimationFactory`)
  — this module only loads raw texture frames into the Phaser texture cache.
- Do not hardcode any specific sprite/background/screen id.

## Deliverable
All 5 files, fully JSDoc'd, zero external dependencies beyond Phaser itself.
