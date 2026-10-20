/**
 * Turns a validated SpriteManifest into Phaser animations.
 *
 * Texture keys it expects (produced by module 03's PreloadQueueBuilder):
 * - animated state frame: `${spriteId}:${state}:${direction}:${frameIndex}`
 * - static state frame:   `${spriteId}:${state}:${direction}`
 *
 * USAGE NOTES:
 * - Call after the sprite's textures are loaded. Animations live in Phaser's global
 *   AnimationManager, but the animation-event map is stored on `scene.data`, so call
 *   `registerAnimations` in every scene that uses the sprite (it is safe to call repeatedly).
 *   `Actor` does this automatically.
 * - Missing authored content never throws: the state's `fallback` state texture is used for that
 *   direction and a `console.warn` is printed once per missing animation.
 *
 * @module sprites/AnimationFactory
 */

const ALL_DIRECTIONS = [
  'south', 'south-east', 'east', 'north-east',
  'north', 'north-west', 'west', 'south-west',
];

/** Same defaults as module 03's PreloadQueueBuilder (must stay in sync). */
const DEFAULT_DIRECTIONS = {
  '1-dir': ['south'],
  '4-dir': ['south', 'east', 'north', 'west'],
  '8-dir': ALL_DIRECTIONS,
  'free-rotation': ['south'],
};

/** Warning keys already printed, so each missing combination warns only once. */
const warned = new Set();

/**
 * @param {string} key
 * @param {string} message
 * @returns {void}
 */
function warnOnce(key, message) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

/**
 * Pure helper, no Phaser dependency — builds the canonical animation key.
 * @param {string} spriteId
 * @param {string} state
 * @param {string} direction
 * @returns {string} `${spriteId}:${state}:${direction}`
 */
export function animKey(spriteId, state, direction) {
  return `${spriteId}:${state}:${direction}`;
}

/**
 * Directions a sprite supports: `directionality.directions` if given, otherwise the
 * default set for its mode (1-dir/free-rotation: south; 4-dir: S,E,N,W; 8-dir: all eight).
 * @param {SpriteManifest} manifest
 * @returns {string[]}
 */
export function getDirections(manifest) {
  const { mode, directions } = manifest.directionality;
  return directions && directions.length > 0 ? directions : DEFAULT_DIRECTIONS[mode];
}

/**
 * Pure helper — texture key of one frame of a state, matching module 03's loader keys.
 * @param {string} spriteId
 * @param {string} state
 * @param {object} stateDef - one entry of manifest.states
 * @param {string} direction
 * @param {number} [frameIndex=0] - only used for animated states
 * @returns {string}
 */
export function textureKeyFor(spriteId, state, stateDef, direction, frameIndex = 0) {
  return stateDef.type === 'animated-per-direction'
    ? `${spriteId}:${state}:${direction}:${frameIndex}`
    : `${spriteId}:${state}:${direction}`;
}

/**
 * Registers every Phaser animation key described in a SpriteManifest's
 * `states` object onto the given scene's AnimationManager (one per state per direction).
 * Safe to call more than once: animations that already exist are not recreated.
 *
 * @param {Phaser.Scene} scene
 * @param {SpriteManifest} manifest
 * @returns {void}
 */
export function registerAnimations(scene, manifest) {
  const id = manifest.id;

  for (const [state, def] of Object.entries(manifest.states)) {
    const animated = def.type === 'animated-per-direction';

    for (const direction of getDirections(manifest)) {
      const key = animKey(id, state, direction);

      // Authored frames for this direction (null if any texture is missing).
      const frameKeys = [];
      const count = animated ? def.frame_count : 1;
      for (let i = 0; i < count; i += 1) frameKeys.push(textureKeyFor(id, state, def, direction, i));
      const authored = frameKeys.every((k) => scene.textures.exists(k));

      if (authored) {
        if (!scene.anims.exists(key)) {
          scene.anims.create({
            key,
            frames: frameKeys.map((k) => ({ key: k })),
            frameRate: animated ? def.frame_rate : 1,
            repeat: animated ? (def.loop ? -1 : 0) : -1,
          });
        }
        // Per-frame events are checked cheaply by Actor.update(), not via animationupdate listeners.
        if (def.events) scene.data.set(`anim-events:${key}`, def.events);
        continue;
      }

      // Missing authored content: expected during partial authoring, never an error.
      const fallbackState = def.fallback ? manifest.states[def.fallback] : undefined;
      const fallbackKey = fallbackState
        ? textureKeyFor(id, def.fallback, fallbackState, direction, 0)
        : null;

      if (fallbackKey && scene.textures.exists(fallbackKey)) {
        warnOnce(key, `[AnimationFactory] "${key}" has no authored frames; using fallback state "${def.fallback}".`);
        if (!scene.anims.exists(key)) {
          scene.anims.create({
            key,
            frames: [{ key: fallbackKey }],
            frameRate: animated ? def.frame_rate : 1,
            repeat: animated ? (def.loop ? -1 : 0) : -1,
          });
        }
      } else {
        warnOnce(key, `[AnimationFactory] "${key}" has no authored frames and no usable fallback; animation not created.`);
      }
    }
  }
}
