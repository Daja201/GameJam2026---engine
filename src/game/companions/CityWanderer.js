import { Actor } from '../../engine/sprites/Actor.js';

/** Walking speed, pixels per second — same ballpark as the old pathfinding wanderer. */
const WALK_SPEED = 24;
/** +/- random fraction applied to each wanderer's own speed so a cluster spreads out over time
 *  into visible gaps instead of walking in lockstep like a single train. */
const WALK_SPEED_JITTER = 0.25;
/** How close (pixels) counts as "arrived" at the current waypoint. */
const ARRIVE_DISTANCE = 3;
/** How many pixels past the right edge of the map before the NPC is considered "offscreen". */
const OFFSCREEN_MARGIN_PX = 24;

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function randomChoice(options) {
  return options[Math.floor(Math.random() * options.length)];
}

/**
 * Reads just the tile-grid metrics (tile size + world origin + pixel map width) a wanderer needs
 * to convert its tile-coordinate route into world positions. Named `buildCityNavigationGrid` for
 * backward compatibility with callers — it no longer does any pathfinding/blocked-tile scanning,
 * since routes are now fixed waypoints rather than a random reachable destination.
 * @param {Phaser.Tilemaps.TilemapLayer} collisionLayer
 * @returns {{tileWidth:number,tileHeight:number,origin:{x:number,y:number},mapWidthPx:number}}
 */
export function buildCityNavigationGrid(collisionLayer) {
  if (!collisionLayer) throw new Error('CityWanderer requires a city collision layer');
  const layerData = collisionLayer.layer;
  const width = layerData.data[0]?.length;
  const tileWidth = layerData.tileWidth || collisionLayer.tilemap.tileWidth;
  const tileHeight = layerData.tileHeight || collisionLayer.tilemap.tileHeight;
  const origin = collisionLayer.tileToWorldXY(0, 0);
  if (!width || !tileWidth || !tileHeight || !origin) {
    throw new Error('CityWanderer could not read city collision-layer dimensions');
  }
  return { tileWidth, tileHeight, origin, mapWidthPx: origin.x + width * tileWidth };
}

/**
 * Kept for backward compatibility with callers that used to ask for randomized spawn tiles.
 * Routes are now fixed (see CityWanderer's own route, below), so this just returns `count` copies
 * of the fixed spawn tile — every wanderer starts at the same edge, each with its own randomized
 * Y band and later waypoint jitter (picked independently per-instance in `CityWanderer`).
 * @param {ReturnType<typeof buildCityNavigationGrid>} grid
 * @param {number} count
 * @returns {{x:number,y:number}[]}
 */
export function chooseCityNpcSpawns(grid, count) {
  return Array.from({ length: count }, () => ({ x: 0, y: randomChoice([24, 25]) }));
}

/**
 * City resident that walks a fixed waypoint route (left edge -> block corner -> upper street ->
 * back down -> off the right edge of the map) instead of wandering a random reachable tile.
 * Route, in tile coordinates (X, Y):
 *   spawn [0, 24 or 25] -> [3, same Y] -> [3, 3] -> [rand 7-9, 3] -> [rand 7-9, rand 26-27]
 *   -> keeps walking right past the map's right edge, then hides and restarts the route.
 * World-bounds collision is deliberately left OFF so the NPC can actually walk off the visible
 * map to "hide" at the end of its route, per the spawn/hide design above.
 */
export class CityWanderer {
  /**
   * @param {Phaser.Scene} scene
   * @param {ReturnType<typeof buildCityNavigationGrid>} grid
   * @param {string} [spriteId]
   */
  constructor(scene, grid, spriteId = 'npc1') {
    this.scene = scene;
    this.grid = grid;
    this.spriteId = spriteId;
    const start = this._worldPos({ x: 0, y: 24 });
    this.actor = new Actor(scene, this.spriteId, start.x, start.y);
    this.sprite = this.actor.sprite;
    this.sprite.body.setCollideWorldBounds(false);
    this.sprite.body.enable = false;
    this.sprite.setVisible(false);
    this.hidden = true;
    /** This instance's own walk speed, randomized once per spawn (see WALK_SPEED_JITTER). */
    this.walkSpeed = WALK_SPEED;
  }

  /** @returns {void} */
  spawn() {
    if (!this.hidden) return;
    this._spawn();
  }

  /**
   * Builds a fresh randomized route and (re)spawns the actor at its first waypoint.
   * @private
   * @returns {void}
   */
  _spawn() {
    const startY = randomChoice([24, 25]);
    this.route = [
      { x: 0, y: startY },
      { x: 3, y: startY },
      { x: 3, y: 3 },
      { x: randomInt(7, 9), y: 3 },
      { x: randomInt(7, 9), y: randomChoice([26, 27]) },
    ];
    this.routeIndex = 0;
    this.leavingScreen = false;
    this.walkSpeed = WALK_SPEED * (1 + (Math.random() * 2 - 1) * WALK_SPEED_JITTER);

    const start = this._worldPos(this.route[0]);
    this.sprite.body.enable = true;
    if (!this.actor) {
      this.actor = new Actor(this.scene, this.spriteId, start.x, start.y);
      this.sprite = this.actor.sprite;
      // Hitbox for the character, same as the player/cat — but world-bounds collision stays off
      // (see class doc) so it can actually walk out past the screen border to hide.
      this.sprite.body.setCollideWorldBounds(false);
    } else {
      this.sprite.setPosition(start.x, start.y);
      this.sprite.body.reset(start.x, start.y);
    }
    this.sprite.setVisible(true);
    this.hidden = false;
  }

  /**
   * @private
   * @param {{x:number,y:number}} tile
   * @returns {{x:number,y:number}}
   */
  _worldPos(tile) {
    return {
      x: this.grid.origin.x + (tile.x + 0.5) * this.grid.tileWidth,
      y: this.grid.origin.y + (tile.y + 0.5) * this.grid.tileHeight,
    };
  }

  /** @param {number} time @param {number} delta @returns {void} */
  update(time, delta) {
    if (this.hidden) {
      this.sprite.body.setVelocity(0, 0);
      return;
    }

    const body = this.sprite.body;

    if (this.leavingScreen) {
      // Past the last waypoint: keep walking right until off the map, then hide.
      body.setVelocity(this.walkSpeed, 0);
      this.actor.setDirectionFromVector(1, 0, 'walk');
      this.actor.update(time, delta);
      if (this.sprite.x >= this.grid.mapWidthPx + OFFSCREEN_MARGIN_PX) {
        body.setVelocity(0, 0);
        body.enable = false;
        this.sprite.setVisible(false);
        this.hidden = true;
      }
      return;
    }

    const target = this._worldPos(this.route[this.routeIndex]);
    const dx = target.x - this.sprite.x;
    const dy = target.y - this.sprite.y;
    const distance = Math.hypot(dx, dy);

    if (distance <= ARRIVE_DISTANCE) {
      body.setVelocity(0, 0);
      this.routeIndex += 1;
      if (this.routeIndex >= this.route.length) this.leavingScreen = true;
    } else {
      body.setVelocity((dx / distance) * this.walkSpeed, (dy / distance) * this.walkSpeed);
      this.actor.setDirectionFromVector(dx, dy, 'walk');
    }
    this.actor.update(time, delta);
  }

  /**
   * Immediately hides this wanderer and stops it wherever it is (mid-route or not), clearing its
   * movement state. Used when leaving the city so nobody is left walking against a tilemap layer
   * that's about to be destroyed. Safe to call on an already-hidden wanderer.
   * @returns {void}
   */
  reset() {
    this.sprite.body.setVelocity(0, 0);
    this.sprite.body.enable = false;
    this.sprite.setVisible(false);
    this.hidden = true;
    this.leavingScreen = false;
  }

  /** @returns {void} */
  destroy() {
    this.sprite.destroy();
  }
}