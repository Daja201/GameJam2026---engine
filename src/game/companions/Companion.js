import { Actor } from '../../engine/sprites/Actor.js';

/**
 * Companion
 * ---------
 * A generic "follows another Actor's sprite around with a short lag" entity — the classic
 * Zelda/Pokémon-follower pattern. Records the leader's position on a fixed interval into a
 * small history queue, and always walks toward the OLDEST recorded point still in the queue
 * (not straight at the leader), which is what produces the natural trailing-behind feel instead
 * of the companion snapping directly onto the leader's heels.
 *
 * Built on top of module 04's `Actor` — reuses it unmodified for rendering/animation, this class
 * only adds the follow-movement behavior on top.
 *
 * FUTURE HOOK: `playAction(name)` is a thin pass-through to `Actor.playState` so that later,
 * once the sprite manifest grows combat-style states (e.g. "attack"), calling
 * `companion.playAction('attack')` already works without touching this file again — it is a
 * no-op today only in the sense that no such state exists yet in `cat_companion`'s manifest.
 *
 * @module game/companions/Companion
 */

/** How often (ms) the leader's position is sampled into the trail history. */
const SAMPLE_INTERVAL_MS = 120;
/** How many samples back the companion aims for — higher = bigger visible gap from the leader. */
const TRAIL_LENGTH = 9;
/** Companion movement speed, px/s. Deliberately a bit SLOWER than the player's own walk speed
 * (60 px/s in WorldScreenController) so the gap grows naturally while the player is moving, and
 * only closes again once the player stops — this reads as "keeping a respectful distance"
 * rather than hugging the player's heels. */
const FOLLOW_SPEED = 48;
/** Once within this distance (px) of its target trail point, the companion stops and idles.
 * Raised well above a "just don't jitter" value so the cat visibly keeps its distance even once
 * caught up, instead of standing shoulder-to-shoulder with the player. */
const ARRIVE_THRESHOLD = 22;

export class Companion {
  /**
   * @param {Phaser.Scene} scene
   * @param {string} spriteId - id registered in AssetRegistry (e.g. 'cat_companion')
   * @param {Phaser.Physics.Arcade.Sprite} leaderSprite - whose position this companion trails
   * @param {{ offsetX?: number, offsetY?: number }} [opts] - initial spawn offset from the leader
   */
  constructor(scene, spriteId, leaderSprite, opts = {}) {
    this.scene = scene;
    this.leaderSprite = leaderSprite;

    const startX = leaderSprite.x + (opts.offsetX ?? -18);
    const startY = leaderSprite.y + (opts.offsetY ?? 10);
    this.actor = new Actor(scene, spriteId, startX, startY);

    /** @type {{x:number,y:number}[]} oldest first */
    this._trail = [];
    this._sinceLastSample = 0;
  }

  /** @returns {Phaser.Physics.Arcade.Sprite} convenience passthrough, matches Actor's own field name */
  get sprite() {
    return this.actor.sprite;
  }

  /**
   * Call once per frame from the owning screen controller's onUpdate — same contract as `Actor.update`.
   * @param {number} time
   * @param {number} delta
   * @param {string|null} [leaderDirection] - facing direction while the leader is moving
   * @returns {void}
   */
  update(time, delta, leaderDirection = null) {
    this._sinceLastSample += delta;
    if (this._sinceLastSample >= SAMPLE_INTERVAL_MS) {
      this._sinceLastSample = 0;
      this._trail.push({ x: this.leaderSprite.x, y: this.leaderSprite.y });
      if (this._trail.length > TRAIL_LENGTH) this._trail.shift();
    }

    const target = this._trail[0];
    if (target) {
      const dx = target.x - this.sprite.x;
      const dy = target.y - this.sprite.y;
      const dist = Math.hypot(dx, dy);

      if (dist > ARRIVE_THRESHOLD) {
        const step = Math.min(dist, (FOLLOW_SPEED * delta) / 1000);
        const nx = dx / dist;
        const ny = dy / dist;
        this.sprite.x += nx * step;
        this.sprite.y += ny * step;
        const leaderDx = this.leaderSprite.x - this.sprite.x;
        const leaderDy = this.leaderSprite.y - this.sprite.y;
        this.actor.setDirectionFromVector(leaderDx, leaderDy, 'walk');
      } else {
        if (leaderDirection) this.actor.setDirection(leaderDirection);
        this.actor.playState('idle');
      }
    }

    this.actor.update(time, delta);
  }

  /**
   * Pass-through to `Actor.playState`, reserved for future non-movement behaviors (e.g. a
   * combat "attack" state once one exists in the sprite manifest). See module docstring.
   * @param {string} stateName
   * @returns {void}
   */
  playAction(stateName) {
    this.actor.playState(stateName);
  }

  /** @returns {void} */
  destroy() {
    this.sprite.destroy();
  }
}