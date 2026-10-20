import Phaser from 'phaser';

/**
 * Cheap, side-effect-free distance check; safe to call every frame from a scene's update().
 * Compares the subject's position (its x/y, i.e. its origin) with the target's x/y.
 *
 * @param {Phaser.GameObjects.Sprite} subject - e.g. the player's Actor.sprite
 * @param {{x:number, y:number}} target - anything with x/y, e.g. InteractiveObject.zone
 * @param {number} radius - in pixels; a distance exactly equal to radius counts as within
 * @returns {boolean}
 */
export function isWithinRadius(subject, target, radius) {
  return Phaser.Math.Distance.Between(subject.x, subject.y, target.x, target.y) <= radius;
}
