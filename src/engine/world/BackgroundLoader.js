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

const EXTERNAL_TILESET_SOURCES = import.meta.glob('/graphics/tileset/**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
});

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
 * @property {() => {width:number, height:number}|null} getMapSize
 *   FIX: added so callers (WorldScreenController) can set `physics.world.setBounds(...)` and
 *   `cameras.main.setBounds(...)` to the ACTUAL map size for any tilemap background, instead of
 *   every screen controller having to know/hardcode a specific map's dimensions. Null for
 *   non-tilemap backgrounds (parallax/static have no inherent "world size" to bound movement to).
 */

/**
 * Converts Tiled's external TSX tileset data into the embedded JSON form Phaser supports.
 * This project uses external TSX files as metadata for a duplicate of the map's embedded image
 * tileset, so the duplicate GIDs can be collapsed while retaining its collision definitions.
 * @param {Phaser.Scene} scene
 * @param {string} backgroundId
 * @returns {void}
 * @throws {Error} if an external TSX cannot safely be merged into the embedded image tileset
 */
function mergeExternalTilesets(scene, manifest) {
  const { id: backgroundId, tilemap: config } = manifest;
  const cachedMap = scene.cache.tilemap.get(`${backgroundId}:tilemap`);
  const mapJson = cachedMap?.data;
  if (!mapJson?.tilesets?.some((tileset) => tileset.source)) return;

  const resolveSourcePath = (source) => {
    const parts = `graphics/backgrounds/${backgroundId}/${config.source}`.split('/');
    parts.pop();
    for (const part of source.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') parts.pop();
      else parts.push(part);
    }
    return `/${parts.join('/')}`;
  };
  const embedded = mapJson.tilesets.find((tileset) => tileset.image && !tileset.source);
  if (!embedded) {
    throw new Error(`Background "${backgroundId}": external TSX requires an embedded image tileset`);
  }

  const externalSets = mapJson.tilesets.filter((tileset) => tileset.source);
  const metadataById = new Map((embedded.tiles || []).map((tile) => [tile.id, tile]));
  for (const external of externalSets) {
    const sourcePath = resolveSourcePath(external.source);
    const source = EXTERNAL_TILESET_SOURCES[sourcePath];
    if (typeof source !== 'string') {
      throw new Error(`Background "${backgroundId}": external tileset "${sourcePath}" is not bundled`);
    }
    const xml = new DOMParser().parseFromString(source, 'application/xml');
    const root = xml.documentElement;
    if (!root || root.nodeName !== 'tileset') {
      throw new Error(`Background "${backgroundId}": could not load external tileset "${external.source}"`);
    }

    const readNumber = (element, name, fallback = 0) => {
      const value = Number(element.getAttribute(name));
      return Number.isFinite(value) ? value : fallback;
    };
    const tileWidth = readNumber(root, 'tilewidth');
    const tileHeight = readNumber(root, 'tileheight');
    const tileCount = readNumber(root, 'tilecount');
    const columns = readNumber(root, 'columns');
    if (
      root.getAttribute('name') !== embedded.name
      || tileWidth !== embedded.tilewidth
      || tileHeight !== embedded.tileheight
      || tileCount !== embedded.tilecount
      || columns !== embedded.columns
    ) {
      throw new Error(
        `Background "${backgroundId}": external TSX "${external.source}" does not match `
        + `embedded tileset "${embedded.name}"`
      );
    }

    const tiles = Array.from(root.children)
      .filter((element) => element.nodeName === 'tile')
      .map((element) => {
        const tile = { id: readNumber(element, 'id') };
        const properties = Array.from(element.children).find((child) => child.nodeName === 'properties');
        if (properties) {
          tile.properties = Array.from(properties.children).map((property) => {
            const type = property.getAttribute('type') || 'string';
            const rawValue = property.getAttribute('value') ?? property.textContent ?? '';
            let value = rawValue;
            if (type === 'bool') value = rawValue === 'true';
            else if (type === 'int' || type === 'float') value = Number(rawValue);
            return { name: property.getAttribute('name'), type, value };
          });
        }

        const objectGroup = Array.from(element.children).find((child) => child.nodeName === 'objectgroup');
        if (objectGroup) {
          const objects = Array.from(objectGroup.children)
            .filter((child) => child.nodeName === 'object')
            .map((object) => {
              const parsed = {
                id: readNumber(object, 'id'),
                name: object.getAttribute('name') || '',
                type: object.getAttribute('type') || '',
                x: readNumber(object, 'x'),
                y: readNumber(object, 'y'),
                width: readNumber(object, 'width'),
                height: readNumber(object, 'height'),
                rotation: readNumber(object, 'rotation'),
                visible: object.getAttribute('visible') !== '0',
              };
              for (const shapeName of ['polygon', 'polyline']) {
                const shape = Array.from(object.children).find((child) => child.nodeName === shapeName);
                if (shape) {
                  parsed[shapeName] = (shape.getAttribute('points') || '').split(' ')
                    .filter(Boolean)
                    .map((point) => {
                      const [x, y] = point.split(',').map(Number);
                      return { x, y };
                    });
                }
              }
              if (Array.from(object.children).some((child) => child.nodeName === 'ellipse')) {
                parsed.ellipse = true;
              }
              if (Array.from(object.children).some((child) => child.nodeName === 'point')) {
                parsed.point = true;
              }
              return parsed;
            });
          tile.objectgroup = {
            draworder: objectGroup.getAttribute('draworder') || 'index',
            objects,
          };
        }
        return tile;
      });

    for (const tile of tiles) {
      const existing = metadataById.get(tile.id) || { id: tile.id };
      metadataById.set(tile.id, {
        ...existing,
        ...tile,
        properties: [...(existing.properties || []), ...(tile.properties || [])],
      });
    }

    const firstGid = external.firstgid;
    const endGid = firstGid + tileCount;
    for (const layer of mapJson.layers) {
      if (layer.type !== 'tilelayer' || !Array.isArray(layer.data)) continue;
      layer.data = layer.data.map((rawGid) => {
        const gid = rawGid >>> 0;
        const flags = gid & 0xe0000000;
        const baseGid = gid & 0x1fffffff;
        if (baseGid < firstGid || baseGid >= endGid) return rawGid;
        return (flags | (baseGid - tileCount)) >>> 0;
      });
    }
  }

  embedded.tiles = [...metadataById.values()];
  mapJson.tilesets = mapJson.tilesets.filter((tileset) => !tileset.source);
}

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
    /** @type {Phaser.Physics.Arcade.StaticGroup|null} see 'tilemap' case's PARTIAL HITBOXES note below */
    let partialHitboxGroup = null;
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
        mergeExternalTilesets(scene, manifest);
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
            // This is a FULL-TILE, on/off solid — the whole 32x32 square or nothing. See the
            // PARTIAL HITBOXES block right below for anything smaller/offset (a fence post, a
            // half-wall, a corner you can cut).
            tileLayer.setCollisionByProperty({ collides: true });
            collisionLayer = tileLayer;

            // PARTIAL HITBOXES: Arcade Physics (what this whole engine uses — see
            // `scene.physics.add.sprite` in Actor.js) only ever collides a tile as ONE rectangle
            // the size of the full tile; it has no notion of a smaller/offset shape within a
            // tile. To still get that (a thin fence, a wall you can cut the corner of, etc.),
            // this reads whatever rectangle(s) were drawn in TILED'S OWN "Tile Collision Editor"
            // for each tile actually placed on this layer (right-click a tile in the Tilesets
            // panel -> "Edit Collision Shapes" / the hammer-and-tools icon; draw one or more
            // rectangles anywhere within the tile, any size/position, then save) — Phaser already
            // parses these into `tileset.getTileData(tile.index).objectgroup.objects` for free
            // (see Tileset.js), this just turns each one into its own small static Arcade body at
            // the tile's exact map position. This is INDEPENDENT of the `collides` property above:
            // a tile can have one, the other, both, or neither. A tile with only a drawn rectangle
            // and no `collides` property is NOT marked solid by `setCollisionByProperty` above, so
            // the two mechanics never fight over the same tile.
            partialHitboxGroup = scene.physics.add.staticGroup();
            tileLayer.forEachTile((tile) => {
              if (tile.index < 0) return; // empty cell
              const shapes = tileset.getTileData(tile.index)?.objectgroup?.objects;
              if (!shapes || !shapes.length) return;
              for (const shape of shapes) {
                let { x, y, width, height } = shape;
                if (shape.polygon?.length) {
                  const xs = shape.polygon.map((point) => point.x);
                  const ys = shape.polygon.map((point) => point.y);
                  const minX = Math.min(...xs);
                  const minY = Math.min(...ys);
                  const maxX = Math.max(...xs);
                  const maxY = Math.max(...ys);
                  x += minX;
                  y += minY;
                  width = maxX - minX;
                  height = maxY - minY;
                }
                if (width == null || height == null || width <= 0 || height <= 0) continue;
                // Arcade Physics only supports axis-aligned rectangles here. Tiled rectangles
                // remain exact; polygon boundaries use their bounding rectangle as the solid.
                const body = scene.add.rectangle(
                  tile.pixelX + x + width / 2,
                  tile.pixelY + y + height / 2,
                  width,
                  height,
                ).setVisible(false);
                scene.physics.add.existing(body, /* isStatic */ true);
                partialHitboxGroup.add(body);
              }
            });
            if (partialHitboxGroup.countActive(true) === 0) {
              partialHitboxGroup.destroy();
              partialHitboxGroup = null; // nothing drawn in Tiled's collision editor — fine, optional
            }
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
        const image = scene.add.image(INTERNAL_WIDTH / 2, INTERNAL_HEIGHT / 2, `${manifest.id}:layer:0`).setOrigin(0.5, 0.5);
        // FIX (full-screen static backgrounds): this used to be drawn at the source image's own
        // native pixel size, anchored top-left — fine only when the art happens to exactly
        // match INTERNAL_WIDTH x INTERNAL_HEIGHT (480x270). Any other size (e.g. a 256x118
        // photo) left most of the canvas empty and the image sitting in the corner instead of
        // filling/centering it. 'static' backgrounds are meant to be a full-screen slot (see
        // this file's own BackgroundHandle doc and ScreenManifest's `background` field), so this
        // now scales the image uniformly to COVER the internal canvas (like CSS
        // `background-size: cover`): scale by whichever axis needs more enlargement, so the
        // other axis overflows and gets centered/cropped rather than leaving bars. The source
        // image's aspect ratio is preserved (no stretch/distortion).
        const coverScale = Math.max(INTERNAL_WIDTH / image.width, INTERNAL_HEIGHT / image.height);
        image.setScale(coverScale);
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
        if (partialHitboxGroup) partialHitboxGroup.destroy(true); // true = also destroy its child rectangles
        tintables.length = 0;
        collisionLayer = null;
        partialHitboxGroup = null;
      },
      getCollisionLayer() {
        return manifest.type === 'tilemap' ? collisionLayer : null;
      },
      /**
       * @returns {Phaser.Physics.Arcade.StaticGroup|null} the per-tile custom-rectangle hitboxes
       *   described in the 'tilemap' case's PARTIAL HITBOXES comment above, or null for a
       *   non-tilemap background or a tilemap whose tiles have no Tiled-drawn collision shapes.
       *   Collide the player against this THE SAME WAY as `getCollisionLayer()` — e.g.
       *   `scene.physics.add.collider(this.actor.sprite, background.getPartialHitboxGroup())` —
       *   it's just a second, independent thing to collide against, not a replacement.
       */
      getPartialHitboxGroup() {
        return manifest.type === 'tilemap' ? partialHitboxGroup : null;
      },
      getMapSize() {
        if (manifest.type !== 'tilemap' || !tilemap) return null;
        return { width: tilemap.widthInPixels, height: tilemap.heightInPixels };
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