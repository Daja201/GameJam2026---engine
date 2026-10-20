import { AssetRegistry } from '../assets/AssetRegistry.js';
import { DEPTH } from '../display/DepthLayers.js';
import { resolveDirection } from './DirectionResolver.js';
import { animKey, getDirections, registerAnimations } from './AnimationFactory.js';

/**
 * Generic entity driven by a SpriteManifest. Gameplay code only calls
 * playState / setDirection / setDirectionFromVector / update — never Phaser's animation API.
 *
 * ASSUMPTIONS:
 * - Constructor takes a `spriteId` (shared contract wins over module 04's prompt, which said
 *   manifest). For convenience a manifest object is also accepted.
 * - `pivot` defaults to (0.5, 0.5) when the manifest omits it.
 * - `hitbox.offset_y` is the distance in pixels from the TOP of the frame to the top of the hitbox
 *   (the hitbox is horizontally centered in the frame).
 * - Initial state is "idle" if the manifest has one, otherwise its first state.
 * - Initial direction is "south" if supported, otherwise the first supported direction.
 * - 'free-rotation' sprites rotate the whole sprite (art should point east at 0 degrees).
 */
export class Actor {
  /**
   * @param {Phaser.Scene} scene
   * @param {string|SpriteManifest} spriteId - id registered in AssetRegistry (a validated manifest object is also accepted)
   * @param {number} x
   * @param {number} y
   */
  constructor(scene, spriteId, x, y) {
    /** @type {Phaser.Scene} */
    this.scene = scene;
    /** @type {SpriteManifest} */
    this.manifest = typeof spriteId === 'string' ? AssetRegistry.getSpriteManifest(spriteId) : spriteId;
    /** Id used as `actorId` in 'actor:anim-event'. @type {string} */
    this.id = this.manifest.id;

    /** @type {string[]} */
    this.directions = getDirections(this.manifest);

    // Make sure animations + event map exist for this scene (cheap flag avoids repeats).
    const flag = `anims-registered:${this.id}`;
    if (!scene.data.get(flag)) {
      registerAnimations(scene, this.manifest);
      scene.data.set(flag, true);
    }

    /** @type {string} */
    this.currentState = this.manifest.states.idle ? 'idle' : Object.keys(this.manifest.states)[0];
    /** @type {string} */
    this.currentDirection = this.directions.includes('south') ? 'south' : this.directions[0];

    // Initial texture: first frame of the starting animation (undefined -> Phaser default texture).
    const startKey = animKey(this.id, this.currentState, this.currentDirection);
    const startAnim = scene.anims.get(startKey);
    const initialTexture = startAnim ? startAnim.frames[0].textureKey : undefined;

    /** @type {Phaser.Physics.Arcade.Sprite} */
    this.sprite = scene.physics.add.sprite(x, y, initialTexture);
    const pivot = this.manifest.pivot ?? { x: 0.5, y: 0.5 };
    this.sprite.setOrigin(pivot.x, pivot.y);
    this.sprite.setScale(this.manifest.scale ?? 1);
    this.sprite.setDepth(DEPTH.WORLD_ENTITIES);

    const hitbox = this.manifest.hitbox;
    if (hitbox) {
      const frameWidth = this.manifest.frame_size.width;
      this.sprite.body
        .setSize(hitbox.width, hitbox.height)
        .setOffset((frameWidth - hitbox.width) / 2, hitbox.offset_y ?? 0);
    }

    // For frame-event detection in update().
    this._lastAnimKey = null;
    this._lastFrameIndex = -1;

    this._refreshAnimation();
  }

  /**
   * Switches to a state (keeping the current direction). Does not restart an animation
   * that is already playing.
   * @param {string} stateName - must exist in manifest.states
   * @throws {Error} if the state does not exist in the manifest
   * @returns {void}
   */
  playState(stateName) {
    if (!this.manifest.states[stateName]) {
      throw new Error(`Actor "${this.id}" has no state "${stateName}"`);
    }
    this.currentState = stateName;
    this._refreshAnimation();
  }

  /**
   * Faces a direction and updates the playing animation. A direction this sprite does not
   * have is ignored with a one-time warning (partial authoring should not crash the game).
   * @param {string} direction
   * @returns {void}
   */
  setDirection(direction) {
    if (!this.directions.includes(direction)) {
      console.warn(`[Actor] "${this.id}" does not support direction "${direction}"; ignored.`);
      return;
    }
    this.currentDirection = direction;
    this._refreshAnimation();
  }

  /**
   * Faces the direction of a vector (via resolveDirection and this sprite's directionality mode)
   * and plays a state. A zero vector means "not moving": nothing changes.
   * @param {number} dx
   * @param {number} dy
   * @param {string} [stateName] - defaults to 'walk' (or the current state if the sprite has no 'walk')
   * @returns {void}
   */
  setDirectionFromVector(dx, dy, stateName) {
    if (dx === 0 && dy === 0) return;

    const state = stateName ?? (this.manifest.states.walk ? 'walk' : this.currentState);
    if (!this.manifest.states[state]) {
      throw new Error(`Actor "${this.id}" has no state "${state}"`);
    }

    const result = resolveDirection(dx, dy, this.manifest.directionality.mode);
    if (typeof result === 'number') {
      // free-rotation: rotate the sprite itself; art uses the single supported direction.
      this.sprite.setAngle(result);
    } else if (this.directions.includes(result)) {
      this.currentDirection = result;
    } else {
      console.warn(`[Actor] "${this.id}" does not support direction "${result}"; keeping "${this.currentDirection}".`);
    }
    this.currentState = state;
    this._refreshAnimation();
  }

  /**
   * Call once per frame from the owning scene's update(). Emits
   * `scene.events.emit('actor:anim-event', { actorId, eventName })` for every authored animation
   * event whose frame was reached since the last call (handles looping and skipped frames).
   * @param {number} time
   * @param {number} delta
   * @returns {void}
   */
  update(time, delta) {
    const anims = this.sprite.anims;
    const anim = anims.currentAnim;
    if (!anim || !anims.currentFrame) return;

    const events = this.scene.data.get(`anim-events:${anim.key}`);
    const frameIndex = anim.frames.indexOf(anims.currentFrame);

    // A different animation started: forget the previous frame so frame 0 events fire.
    if (anim.key !== this._lastAnimKey) {
      this._lastAnimKey = anim.key;
      this._lastFrameIndex = -1;
    }
    if (frameIndex === this._lastFrameIndex) return;

    if (events) {
      const reached = [];
      if (frameIndex > this._lastFrameIndex) {
        for (let f = this._lastFrameIndex + 1; f <= frameIndex; f += 1) reached.push(f);
      } else {
        // Animation looped around.
        for (let f = this._lastFrameIndex + 1; f < anim.frames.length; f += 1) reached.push(f);
        for (let f = 0; f <= frameIndex; f += 1) reached.push(f);
      }
      for (const event of events) {
        if (reached.includes(event.frame)) {
          this.scene.events.emit('actor:anim-event', { actorId: this.id, eventName: event.emit });
        }
      }
    }
    this._lastFrameIndex = frameIndex;
  }

  /**
   * Plays the animation for (currentState, currentDirection) without restarting it if already playing.
   * @private
   * @returns {void}
   */
  _refreshAnimation() {
    const key = animKey(this.id, this.currentState, this.currentDirection);
    if (!this.scene.anims.exists(key)) {
      console.warn(`[Actor] No animation "${key}" (missing art and no fallback); keeping current frame.`);
      return;
    }
    this.sprite.anims.play(key, true);
  }
}
