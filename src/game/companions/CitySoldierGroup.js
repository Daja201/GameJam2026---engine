import { Actor } from '../../engine/sprites/Actor.js';

const SOLDIERS_PER_GROUP = 2;
/** Pixel gap between the two soldiers in a pair, who stand facing each other. */
const FACE_GAP_PX = 18;

/**
 * Two soldiers posted on the same road the city wanderers (`CityWanderer`) walk along — standing
 * still, facing each other ("watching" one another / the road) rather than patrolling their own
 * separate loop. Replaces the old 3-soldier walking-formation patrol.
 */
export class CitySoldierGroup {
  /**
   * @param {Phaser.Scene} scene
   * @param {{tileWidth:number,tileHeight:number,origin:{x:number,y:number}}} grid
   * @param {{x:number,y:number}} postTile - road tile (tile coords) this pair is posted on; pick
   *   a tile on the same row the wanderers use (y 24/25) so they read as watching that road.
   */
  constructor(scene, grid, postTile) {
    this.grid = grid;
    const centerX = grid.origin.x + (postTile.x + 0.5) * grid.tileWidth;
    const centerY = grid.origin.y + (postTile.y + 0.5) * grid.tileHeight;

    this.actors = [
      new Actor(scene, 'soldier', centerX - FACE_GAP_PX / 2, centerY),
      new Actor(scene, 'soldier', centerX + FACE_GAP_PX / 2, centerY),
    ];
    for (const actor of this.actors) actor.sprite.body.setCollideWorldBounds(false);
    // Face each other across the gap rather than both facing the same way.
    this.actors[0].setDirectionFromVector(1, 0, 'idle');
    this.actors[1].setDirectionFromVector(-1, 0, 'idle');
  }

  /**
   * Stationary — just keeps each soldier's idle animation ticking.
   * @param {number} time
   * @param {number} delta
   * @returns {void}
   */
  update(time, delta) {
    for (const actor of this.actors) actor.update(time, delta);
  }

  /**
   * Shows/hides this pair — used to pull them off the road while the underworld is active, since
   * they're city-only dressing posted on the city road.
   * @param {boolean} visible
   * @returns {void}
   */
  setVisible(visible) {
    for (const actor of this.actors) actor.sprite.setVisible(visible);
  }

  /** @returns {void} */
  destroy() {
    for (const actor of this.actors) actor.sprite.destroy();
  }
}