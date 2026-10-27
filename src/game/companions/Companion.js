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
const PATH_REFRESH_MS = 300;
const PATH_NODE_RADIUS = 5;
/** How long (ms) the companion must stay stopped (not walking) before it sits down. Long enough
 * that a brief pause (player stops for a beat, trail catches up) doesn't flip the sprite in and
 * out of `sit` constantly — it only settles in once it's genuinely been doing nothing for a
 * while. Uses `cat_companion`'s existing `sit` state (graphics/sprites/cat_companion/manifest.json),
 * which was already authored into the sprite manifest but never played anywhere. */
const SIT_AFTER_IDLE_MS = 2500;

const PATH_NEIGHBORS = [
  { x: 1, y: 0, cost: 1 },
  { x: -1, y: 0, cost: 1 },
  { x: 0, y: 1, cost: 1 },
  { x: 0, y: -1, cost: 1 },
  { x: 1, y: 1, cost: Math.SQRT2 },
  { x: 1, y: -1, cost: Math.SQRT2 },
  { x: -1, y: 1, cost: Math.SQRT2 },
  { x: -1, y: -1, cost: Math.SQRT2 },
];

function nodeKey(x, y, width) {
  return y * width + x;
}

function heuristic(x, y, targetX, targetY) {
  const dx = Math.abs(targetX - x);
  const dy = Math.abs(targetY - y);
  return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
}

function pushOpenNode(open, node) {
  let index = open.length;
  open.push(node);
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (open[parent].score <= node.score) break;
    open[index] = open[parent];
    index = parent;
  }
  open[index] = node;
}

function popOpenNode(open) {
  const first = open[0];
  const last = open.pop();
  if (open.length) {
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= open.length) break;
      const child = right < open.length && open[right].score < open[left].score ? right : left;
      if (open[child].score >= last.score) break;
      open[index] = open[child];
      index = child;
    }
    open[index] = last;
  }
  return first;
}

function findPath(grid, start, target) {
  const { width, height, blocked } = grid;
  if (
    !Number.isInteger(width) || !Number.isInteger(height)
    || !Number.isFinite(start.x) || !Number.isFinite(start.y)
    || !Number.isFinite(target.x) || !Number.isFinite(target.y)
  ) return [];
  const startKey = nodeKey(start.x, start.y, width);
  const targetKey = nodeKey(target.x, target.y, width);
  if (startKey === targetKey) return [];

  const open = [];
  pushOpenNode(open, { x: start.x, y: start.y, key: startKey, score: heuristic(start.x, start.y, target.x, target.y) });
  const bestCost = new Map([[startKey, 0]]);
  const parents = new Map();
  const closed = new Set();

  while (open.length) {
    const current = popOpenNode(open);
    if (closed.has(current.key)) continue;
    if (current.key === targetKey) {
      const path = [];
      let key = targetKey;
      for (let steps = 0; key !== startKey && steps < width * height; steps += 1) {
        const parentKey = parents.get(key);
        if (!Number.isInteger(parentKey)) return [];
        path.push({ x: parentKey % width, y: Math.floor(parentKey / width) });
        key = parentKey;
      }
      if (key !== startKey) return [];
      return path.reverse();
    }
    closed.add(current.key);

    for (const neighbor of PATH_NEIGHBORS) {
      const x = current.x + neighbor.x;
      const y = current.y + neighbor.y;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const key = nodeKey(x, y, width);
      if (blocked.has(key) || closed.has(key)) continue;
      if (neighbor.x && neighbor.y) {
        if (
          blocked.has(nodeKey(current.x + neighbor.x, current.y, width))
          || blocked.has(nodeKey(current.x, current.y + neighbor.y, width))
        ) continue;
      }

      const cost = bestCost.get(current.key) + neighbor.cost;
      if (cost >= (bestCost.get(key) ?? Infinity)) continue;
      bestCost.set(key, cost);
      parents.set(key, current.key);
      pushOpenNode(open, { x, y, key, score: cost + heuristic(x, y, target.x, target.y) });
    }
  }

  return [];
}

export class Companion {
  /**
   * @param {Phaser.Scene} scene
   * @param {string} spriteId - id registered in AssetRegistry (e.g. 'cat_companion')
   * @param {Phaser.Physics.Arcade.Sprite} leaderSprite - whose position this companion trails
   * @param {{ offsetX?: number, offsetY?: number, collisionLayer?: Phaser.Tilemaps.TilemapLayer|null, obstacleGroup?: Phaser.Physics.Arcade.StaticGroup|null }} [opts]
   *   initial spawn offset and optional Tiled collision data for pathfinding
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
    /** How long (ms), continuously, the companion has been stopped (not walking). Reset to 0 the
     * instant it moves again; see `SIT_AFTER_IDLE_MS`. */
    this._idleMs = 0;
    this._pathGrid = this._buildPathGrid(opts.collisionLayer, opts.obstacleGroup);
    this._path = [];
    this._pathTarget = null;
    this._pathReachable = false;
    this._pathRefreshMs = 0;
  }

  _buildPathGrid(collisionLayer, obstacleGroup) {
    if (!collisionLayer) return null;

    const layerData = collisionLayer.layer;
    const width = layerData.data[0]?.length;
    const height = layerData.data.length;
    const tileWidth = layerData.tileWidth || collisionLayer.tilemap.tileWidth;
    const tileHeight = layerData.tileHeight || collisionLayer.tilemap.tileHeight;
    const origin = collisionLayer.tileToWorldXY(0, 0);
    if (!width || !height || !tileWidth || !tileHeight || !origin) return null;
    const body = this.sprite.body;
    const halfWidth = body.width / 2;
    const halfHeight = body.height / 2;
    const blocked = new Set();

    const blockExpandedRect = (left, top, right, bottom) => {
      const minX = Math.max(0, Math.floor((left - halfWidth - origin.x) / tileWidth));
      const minY = Math.max(0, Math.floor((top - halfHeight - origin.y) / tileHeight));
      const maxX = Math.min(width - 1, Math.floor((right + halfWidth - origin.x) / tileWidth));
      const maxY = Math.min(height - 1, Math.floor((bottom + halfHeight - origin.y) / tileHeight));
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          blocked.add(nodeKey(x, y, width));
        }
      }
    };

    collisionLayer.forEachTile((tile) => {
      if (!tile.collides) return;
      const left = origin.x + tile.x * tileWidth;
      const top = origin.y + tile.y * tileHeight;
      blockExpandedRect(left, top, left + tileWidth, top + tileHeight);
    });

    for (const obstacle of obstacleGroup?.getChildren() ?? []) {
      const obstacleBody = obstacle.body;
      if (obstacleBody) {
        blockExpandedRect(obstacleBody.left, obstacleBody.top, obstacleBody.right, obstacleBody.bottom);
      }
    }

    return { width, height, tileWidth, tileHeight, origin, blocked };
  }

  _tilePositionAt(x, y) {
    const point = this._pathGrid.origin;
    return {
      x: Math.max(0, Math.min(this._pathGrid.width - 1, Math.floor((x - point.x) / this._pathGrid.tileWidth))),
      y: Math.max(0, Math.min(this._pathGrid.height - 1, Math.floor((y - point.y) / this._pathGrid.tileHeight))),
    };
  }

  _nearestWalkable(target) {
    const { width, blocked } = this._pathGrid;
    if (!blocked.has(nodeKey(target.x, target.y, width))) return target;
    for (let radius = 1; radius <= PATH_NODE_RADIUS; radius += 1) {
      for (let y = target.y - radius; y <= target.y + radius; y += 1) {
        for (let x = target.x - radius; x <= target.x + radius; x += 1) {
          if (x < 0 || y < 0 || x >= this._pathGrid.width || y >= this._pathGrid.height) continue;
          if (!blocked.has(nodeKey(x, y, width))) return { x, y };
        }
      }
    }
    return null;
  }

  _refreshPath(target) {
    const start = this._tilePositionAt(this.sprite.body.center.x, this.sprite.body.center.y);
    const destination = this._nearestWalkable(this._tilePositionAt(target.x, target.y));
    if (!destination) {
      this._path = [];
      this._pathTarget = null;
      this._pathReachable = false;
      return;
    }
    this._path = findPath(this._pathGrid, start, destination);
    this._pathTarget = destination;
    this._pathReachable = (start.x === destination.x && start.y === destination.y) || this._path.length > 0;
  }

  /** @returns {Phaser.Physics.Arcade.Sprite} convenience passthrough, matches Actor's own field name */
  get sprite() {
    return this.actor.sprite;
  }

  /**
   * Call once per frame from the owning screen controller's onUpdate — same contract as `Actor.update`.
   * @param {number} time
   * @param {number} delta
   * @returns {void}
   */
  update(time, delta) {
    this._sinceLastSample += delta;
    if (this._sinceLastSample >= SAMPLE_INTERVAL_MS) {
      this._sinceLastSample = 0;
      this._trail.push({ x: this.leaderSprite.x, y: this.leaderSprite.y });
      if (this._trail.length > TRAIL_LENGTH) this._trail.shift();
    }

    const target = this._trail[0];
    if (target) {
      let waypoint = target;
      if (this._pathGrid) {
        this._pathRefreshMs -= delta;
        const targetTile = this._nearestWalkable(this._tilePositionAt(target.x, target.y));
        if (
          targetTile
          && (
            !this._pathTarget
            || targetTile.x !== this._pathTarget.x
            || targetTile.y !== this._pathTarget.y
            || this._pathRefreshMs <= 0
          )
        ) {
          this._refreshPath(target);
          this._pathRefreshMs = PATH_REFRESH_MS;
        }

        while (this._path.length) {
          const next = this._path[0];
          const nextX = this._pathGrid.origin.x + (next.x + 0.5) * this._pathGrid.tileWidth;
          const nextY = this._pathGrid.origin.y + (next.y + 0.5) * this._pathGrid.tileHeight;
          if (Math.hypot(nextX - this.sprite.body.center.x, nextY - this.sprite.body.center.y) > ARRIVE_THRESHOLD) {
            waypoint = { x: nextX, y: nextY };
            break;
          }
          this._path.shift();
        }
        if (!this._pathReachable) {
          waypoint = null;
        } else if (this._path.length === 0) {
          const currentTile = this._tilePositionAt(this.sprite.body.center.x, this.sprite.body.center.y);
          if (currentTile.x !== this._pathTarget.x || currentTile.y !== this._pathTarget.y) {
            waypoint = null;
          }
        }
      }

      const dx = waypoint ? waypoint.x - this.sprite.body.center.x : 0;
      const dy = waypoint ? waypoint.y - this.sprite.body.center.y : 0;
      const dist = waypoint ? Math.hypot(dx, dy) : 0;

      if (dist > ARRIVE_THRESHOLD) {
        const nx = dx / dist;
        const ny = dy / dist;
        this.sprite.body.setVelocity(nx * FOLLOW_SPEED, ny * FOLLOW_SPEED);
        this.actor.setDirectionFromVector(nx, ny, 'walk');
        this._idleMs = 0; // moving again — any sit-down progress is cancelled
      } else {
        this.sprite.body.setVelocity(0, 0);
        // Stopped: stand around for a bit first (reads as "still alert"), then settle into the
        // `sit` state once it's been doing nothing for SIT_AFTER_IDLE_MS straight. The leading
        // standing phase matters — without it the cat would flop down the instant it arrives,
        // then immediately have to stand back up for the next short player pause.
        this._idleMs += delta;
        this.actor.playState(this._idleMs >= SIT_AFTER_IDLE_MS ? 'sit' : 'idle');
      }
    } else {
      this.sprite.body.setVelocity(0, 0);
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