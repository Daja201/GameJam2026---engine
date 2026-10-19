/**
 * Queues the raw image/tilemap files described by validated manifests onto a
 * scene's Phaser loader. These functions only call `scene.load.*`; the CALLER
 * (module 11 bootstrap) must call `scene.load.start()` afterwards (or queue
 * them inside `preload()`, where Phaser starts the loader itself).
 *
 * ASSUMPTIONS (the shared contract does not state asset roots):
 * - Paths are project-relative with NO leading slash (works when the game is hosted
 *   in a sub-folder, e.g. on itch.io): sprites live in `graphics/sprites/<id>/`,
 *   backgrounds in `graphics/backgrounds/<id>/`. The folder always equals the manifest id.
 * - Sprite `source` templates and background image paths are relative to that folder
 *   (a path starting with "/" is used as-is).
 * - Frame indices start at 0. `{frame:03d}` means zero-padded to 3 digits.
 * - Every direction of every state is queued; a missing PNG just triggers Phaser's
 *   normal `loaderror` (the `fallback` state field is handled at animation time by module 04).
 *
 * Texture/cache keys produced (modules 04/05 rely on these exactly):
 * - animated sprite frame:  `${spriteId}:${state}:${direction}:${frameIndex}`
 * - static sprite frame:    `${spriteId}:${state}:${direction}`
 * - background layer i:     `${backgroundId}:layer:${i}`
 * - background tilemap JSON:`${backgroundId}:tilemap`
 * - background tileset img: `${backgroundId}:tileset`
 *
 * @module assets/PreloadQueueBuilder
 */

const SPRITE_ROOT = 'graphics/sprites';
const BACKGROUND_ROOT = 'graphics/backgrounds';

const ALL_DIRECTIONS = [
  'south', 'south-east', 'east', 'north-east',
  'north', 'north-west', 'west', 'south-west',
];

/** Directions used when a manifest's `directionality.directions` is omitted. */
const DEFAULT_DIRECTIONS = {
  '1-dir': ['south'],
  '4-dir': ['south', 'east', 'north', 'west'],
  '8-dir': ALL_DIRECTIONS,
  'free-rotation': ['south'],
};

/**
 * Resolves a manifest-relative path against the asset's own folder.
 * @param {string} folder - e.g. "graphics/sprites/hero"
 * @param {string} relative
 * @returns {string}
 */
function resolvePath(folder, relative) {
  return relative.startsWith('/') ? relative : `${folder}/${relative}`;
}

/**
 * Fills the `{direction}` and `{frame:03d}` placeholders of a source template.
 * @param {string} template
 * @param {string} direction
 * @param {number} frame
 * @returns {string}
 */
function fillTemplate(template, direction, frame) {
  return template
    .replace(/\{direction\}/g, direction)
    .replace(/\{frame(?::0?(\d+)d)?\}/g, (_, width) => String(frame).padStart(Number(width) || 0, '0'));
}

/**
 * Queues every frame PNG a validated SpriteManifest references onto the scene's
 * loader using scene.load.image(key, path). Keys follow the shared contract:
 * `${spriteId}:${state}:${direction}:${frameIndex}` for animated states and
 * `${spriteId}:${state}:${direction}` for static-per-direction states.
 * Frames already in the texture cache are skipped.
 *
 * @param {Phaser.Scene} scene
 * @param {SpriteManifest} manifest
 * @returns {void}
 */
export function queueSpriteFrames(scene, manifest) {
  const folder = `${SPRITE_ROOT}/${manifest.id}`;
  const { mode, directions } = manifest.directionality;
  const dirs = directions && directions.length > 0 ? directions : DEFAULT_DIRECTIONS[mode];

  for (const [state, def] of Object.entries(manifest.states)) {
    const animated = def.type === 'animated-per-direction';
    const frameCount = animated ? def.frame_count : 1;

    for (const dir of dirs) {
      for (let frame = 0; frame < frameCount; frame += 1) {
        const key = animated
          ? `${manifest.id}:${state}:${dir}:${frame}`
          : `${manifest.id}:${state}:${dir}`;
        if (scene.textures.exists(key)) continue;
        scene.load.image(key, resolvePath(folder, fillTemplate(def.source, dir, frame)));
      }
    }
  }
}

/**
 * Queues every layer image of a validated BackgroundManifest with scene.load.image,
 * and, if `manifest.tilemap` is present, scene.load.tilemapTiledJSON plus the
 * tileset image. Assets already in the cache are skipped.
 *
 * @param {Phaser.Scene} scene
 * @param {BackgroundManifest} manifest
 * @returns {void}
 */
export function queueBackgroundAssets(scene, manifest) {
  const folder = `${BACKGROUND_ROOT}/${manifest.id}`;

  manifest.layers.forEach((layer, i) => {
    const key = `${manifest.id}:layer:${i}`;
    if (!scene.textures.exists(key)) scene.load.image(key, resolvePath(folder, layer.image));
  });

  if (manifest.tilemap) {
    const mapKey = `${manifest.id}:tilemap`;
    const tilesetKey = `${manifest.id}:tileset`;
    if (!scene.cache.tilemap.exists(mapKey)) {
      scene.load.tilemapTiledJSON(mapKey, resolvePath(folder, manifest.tilemap.tiled_json));
    }
    if (!scene.textures.exists(tilesetKey)) {
      scene.load.image(tilesetKey, resolvePath(folder, manifest.tilemap.tileset_image));
    }
  }
}
