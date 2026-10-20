/**
 * Pure direction math. This file intentionally has ZERO imports (no Phaser)
 * so it can be unit-tested in isolation.
 * @module sprites/DirectionResolver
 */

/** 4-dir names, sector 0 = east, going clockwise in screen space (+Y is down). */
const NAMES_4 = ['east', 'south', 'west', 'north'];

/** 8-dir names, sector 0 = east, going clockwise in screen space (+Y is down). */
const NAMES_8 = [
  'east', 'south-east', 'south', 'south-west',
  'west', 'north-west', 'north', 'north-east',
];

/**
 * Converts a movement/aim vector into a sprite direction.
 *
 * IMPORTANT: the caller must NOT pass a zero vector (dx === 0 && dy === 0);
 * a zero vector has no direction, so this function throws. Check for "not moving"
 * before calling.
 *
 * @param {number} dx - horizontal component (positive = right)
 * @param {number} dy - vertical component (positive = down, screen space)
 * @param {'1-dir'|'4-dir'|'8-dir'|'free-rotation'} mode
 * @returns {string|number}
 *   '1-dir': always "south".
 *   '4-dir': one of "north","south","east","west".
 *   '8-dir': one of "south","south-east","east","north-east","north","north-west","west","south-west".
 *   'free-rotation': degrees as a number, 0 = east, clockwise positive, range [0,360).
 * @throws {Error} if dx === 0 && dy === 0, if dx/dy are not finite numbers, or if mode is unknown.
 */
export function resolveDirection(dx, dy, mode) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
    throw new Error(`resolveDirection: dx and dy must be finite numbers (got ${dx}, ${dy})`);
  }
  if (dx === 0 && dy === 0) {
    throw new Error('resolveDirection: zero vector has no direction (caller must check before calling)');
  }

  if (mode === '1-dir') return 'south';

  const angle = Math.atan2(dy, dx);
  const degrees = (angle * 180 / Math.PI + 360) % 360;

  if (mode === 'free-rotation') return degrees;

  let names;
  if (mode === '4-dir') names = NAMES_4;
  else if (mode === '8-dir') names = NAMES_8;
  else throw new Error(`resolveDirection: unknown mode "${mode}"`);

  const sectorSize = 360 / names.length;
  const index = Math.round(degrees / sectorSize) % names.length;
  return names[index];
}
