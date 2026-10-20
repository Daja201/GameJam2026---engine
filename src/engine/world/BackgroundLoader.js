import Phaser from 'phaser';
import { INTERNAL_WIDTH, INTERNAL_HEIGHT } from '../display/constants.js';
import { DEPTH } from '../display/DepthLayers.js';
import { AssetRegistry } from '../assets/AssetRegistry.js';

/**
 * Builds the visual "stage" a screen plays out on: parallax layers, a collidable tilemap,
 * or a single static image, as described by a BackgroundManifest (01_SHARED_CONTRACTS.md).
 *
 * ASSUMPTION: the manifest's `type` field selects exactly one branch below (parallax-layered,
 * tilemap, or static) — a background is one of these, not a mix. `build()` also accepts a
 * background id string for convenience and resolves it via AssetRegistry.
 *
 * ASSUMPTION: texture keys are whatever module 03's PreloadQueueBuilder registered them as.
 * Following that module's `${id}:...` key convention: layer i -> `${id}:layer:${i}` (a 'static'
 * background is authored as a single-entry `layers` array and reuses layer 0's key),
 * tilemap JSON -> `${id}:tilemap`, tileset image -> `${id}:tileset`.
 *
 * ASSUMPTION: `layer.depth` (parallax-layered) may be a named string ('far'|'mid'|'near') mapped to
 * DEPTH.BACKGROUND_FAR/_MID/_NEAR, or a raw number used as-is — see DEPTH_BY_NAME below.
 *
 * @module world/BackgroundLoader
 */

/** Named `layer.depth` values -> the DEPTH constant they resolve to. */
const DEPTH_BY_NAME = {
  far: DEPTH.BACKGROUND_FAR,
  mid: DEPTH.BACKGROUND_MID,
  near: DEPTH.BACKGROUND_NEAR,
};

/**
 * Resolves a layer's `depth` field (named string or raw number) to the depth value to use.
 * @param {string|number|undefined} depth
 * @returns {number}
 */
function resolveLayerDepth(depth) {
  if (typeof depth === 'number') return depth;
  if (typeof depth === 'string' && depth in DEPTH_BY_NAME) return DEPTH_BY_NAME[depth];
  return DEPTH.BACKGROUND_FAR; // default when unspecified
}

/**
 * @typedef {Object} BackgroundHandle
 * @property {() => void} destroy - destroys every GameObject/tilemap created by build()
 * @property {() => Phaser.Tilemaps.TilemapLayer|null} getCollisionLayer - null unless type === 'tilemap'
 *   with a `collision_layer` configured
 * @property {(hexColor: string) => void} setAmbientTint - tints every layer/image created, e.g. "#88aaff"
 */

/** Singleton that builds and swaps backgrounds. Implements the shared `BackgroundLoader` interface. */
export const BackgroundLoader = {
  /**
   * @param {Phaser.Scene} scene
   * @param {string|BackgroundManifest} backgroundId - id registered in AssetRegistry, or an
   *   already-validated manifest object (accepted for callers that already have one on hand)
   * @returns {BackgroundHandle}
   * @throws {Error} if `type` is unrecognized, or (tilemap) the tileset/collision layer name is missing
   */
  build(scene, backgroundId) {
    const manifest = typeof backgroundId === 'string'
      ? AssetRegistry.getBackgroundManifest(backgroundId)
      : backgroundId;

    /** @type {Phaser.GameObjects.GameObject[]} everything destroy() must clean up individually */
    const displayObjects = [];
    /** @type {Array<{setTint:(c:number)=>any}>} everything setAmbientTint() must tint */
    const tintables = [];
    let tilemap = null;
    let collisionLayer = null;
    let destroyed = false;

    switch (manifest.type) {
      case 'parallax-layered': {
        for (const layer of manifest.layers) {
          const key = `${manifest.id}:layer:${manifest.layers.indexOf(layer)}`;
          const tileSprite = scene.add.tileSprite(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT, key);
          tileSprite.setOrigin(0, 0);
          tileSprite.setScrollFactor(layer.scroll_factor);
          tileSprite.setDepth(resolveLayerDepth(layer.depth));
          displayObjects.push(tileSprite);
          tintables.push(tileSprite);
        }
        break;
      }

      case 'tilemap': {
        const cfg = manifest.tilemap;
        // ASSUMPTION/FIX: the Tiled JSON was registered on the Phaser cache under the convention
        // key `${id}:tilemap` by module 03's PreloadQueueBuilder — `scene.make.tilemap` needs that
        // cache key, not the manifest's raw `source` file path (which is only used at load time).
        tilemap = scene.make.tilemap({ key: `${manifest.id}:tilemap` });

        // ASSUMPTION: a single tileset image sharing the tilemap's key is registered by module 03
        // as `${id}:tileset`; tileset "name" inside the Tiled JSON must match for addTilesetImage to bind it.
        const tilesetImageKey = `${manifest.id}:tileset`;
        const firstTilesetName = tilemap.tilesets[0] ? tilemap.tilesets[0].name : undefined;
        const tileset = tilemap.addTilesetImage(firstTilesetName, tilesetImageKey);
        if (!tileset) {
          throw new Error(
            `Background "${manifest.id}": could not bind tileset image "${tilesetImageKey}" `
            + `to tileset "${firstTilesetName}" in the Tiled map "${cfg.source}"`
          );
        }

        for (const layerData of tilemap.layers) {
          const tileLayer = tilemap.createLayer(layerData.name, tileset, 0, 0);
          if (!tileLayer) continue;
          tileLayer.setDepth(DEPTH.WORLD_GROUND);
          tintables.push(tileLayer);
          if (cfg.collision_layer && layerData.name === cfg.collision_layer) {
            // Standard Tiled convention: tiles tagged with a boolean custom property `collides`.
            tileLayer.setCollisionByProperty({ collides: true });
            collisionLayer = tileLayer;
          }
        }
        if (cfg.collision_layer && !collisionLayer) {
          throw new Error(
            `Background "${manifest.id}": collision_layer "${cfg.collision_layer}" is not a layer in "${cfg.source}"`
          );
        }
        break;
      }

      case 'static': {
        // ASSUMPTION/FIX: module 03's PreloadQueueBuilder only ever queues images from
        // `manifest.layers` (key `${id}:layer:${i}`) — there is no separate `:image` convention.
        // A 'static' background is therefore authored as a single-entry `layers` array and uses
        // that same layer-0 texture key.
        const image = scene.add.image(0, 0, `${manifest.id}:layer:0`).setOrigin(0, 0);
        displayObjects.push(image);
        tintables.push(image);
        break;
      }

      default:
        throw new Error(`Background "${manifest.id}": unknown type "${manifest.type}"`);
    }

    /** @type {BackgroundHandle} */
    const handle = {
      destroy() {
        if (destroyed) return;
        destroyed = true;
        displayObjects.forEach((obj) => obj.destroy());
        if (tilemap) tilemap.destroy(); // also destroys the tile layers it created
        tintables.length = 0;
        collisionLayer = null;
      },
      getCollisionLayer() {
        return manifest.type === 'tilemap' ? collisionLayer : null;
      },
      setAmbientTint(hexColor) {
        const color = Phaser.Display.Color.HexStringToColor(hexColor).color;
        tintables.forEach((obj) => obj.setTint(color));
      },
    };

    if (manifest.ambient_tint) handle.setAmbientTint(manifest.ambient_tint);
    return handle;
  },

  /**
   * Destroys the old handle (if any) and builds a new one in its place.
   * @param {Phaser.Scene} scene
   * @param {BackgroundHandle|null} oldHandle
   * @param {string|BackgroundManifest} newBackground - background id, or an already-validated manifest
   * @returns {BackgroundHandle}
   */
  swap(scene, oldHandle, newBackground) {
    if (oldHandle) oldHandle.destroy();
    return BackgroundLoader.build(scene, newBackground);
  },
};
