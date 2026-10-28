import { ScreenController } from '../../engine/screens/ScreenController.js';
import { Actor } from '../../engine/sprites/Actor.js';
import { Companion } from '../companions/Companion.js';
import { buildCityNavigationGrid, CityWanderer } from '../companions/CityWanderer.js';
import { InteractiveObject } from '../../engine/world/InteractiveObject.js';
import { isWithinRadius } from '../../engine/world/ProximityDetector.js';
import { INTERNAL_HEIGHT, INTERNAL_WIDTH } from '../../engine/display/constants.js';
import { DEPTH } from '../../engine/display/DepthLayers.js';
import { LoopManager } from '../../engine/loop/LoopManager.js';
import { FxManager } from '../../engine/loop/FxManager.js';
import { QuestManager } from '../../engine/quest/QuestManager.js';
import { InventoryManager } from '../../engine/inventory/InventoryManager.js';
import { AudioManager } from '../../engine/audio/AudioManager.js';
import { SettingsStore } from '../../engine/settings/SettingsStore.js';
import { createToastNotifier } from '../../engine/ui/ToastNotifier.js';
import { animKey } from '../../engine/sprites/AnimationFactory.js';
import { createHudPanel } from '../ui/HudPanel.js';
import { createMapOverlay } from '../../engine/world/MapOverlay.js';
import { BackgroundLoader } from '../../engine/world/BackgroundLoader.js';

/** Toast accent colors by quest-event category — kept here (content), not in ToastNotifier (generic). */
const TOAST_ACCENT_STARTED = 0x8aa8ff;
const TOAST_ACCENT_PROGRESS = 0xffd27f;
const TOAST_ACCENT_COMPLETE = 0x6fe39a;

/** Walking speed, pixels per second. */
const WALK_SPEED = 60;
/** How close the player must be to a dropped inventory item to pick it up. */
const PICKUP_RADIUS = 20;
/** How close the player must be to the "PC" prop to interact with it. */
const INTERACT_RADIUS = 28;

/** How close the cat must be to the player's punching hand for a fight-mode hit to land on it. */
const CAT_HIT_RADIUS = 20;
const WORLD_Y_SORT_DEPTH_RANGE = DEPTH.WORLD_FOREGROUND - DEPTH.WORLD_ENTITIES - 1;

// Elevator (city) <-> underworld teleport system. Restored after going missing from this
// controller — see the city/under tilemaps for the tile coordinates these refer to.
const CITY_PORTAL_TILE = { x: 3, y: 0 };
const UNDER_ARRIVAL_TILE = { x: 0, y: 7 };
const PORTAL_FADE_MS = 500;
const CITY_SHORTCUT_FADE_MS = 900;
const CITY_SHORTCUTS = {
  lower: [{ x: 11, y: 26 }, { x: 12, y: 26 }],
  upper: [{ x: 12, y: 4 }, { x: 13, y: 4 }],
};
const ELEVATOR_QUEST_ID = 'arrive_at_elevator';
const ELEVATOR_OBJECTIVE_IDS = ['reach_elevator', 'reach_upper_elevator'];
const WORK_QUEST_ID = 'get_to_work';

/**
 * Quest content for this room (THIS controller's own example content — the quest engine,
 * `engine/quest/QuestManager.js`, knows nothing about any of these ids; see its module docstring
 * for the "no content coupling" reasoning). `world_pc`/the `world` screen id here
 * must exactly match what `/config/quests.default.json` references for those quests to progress.
 */
const WORLD_PC_INTERACT_ID = 'world_pc';

/** Mode names. In 'normal' mode E interacts with the world; in 'fight' mode E punches. */
const MODE_NORMAL = 'normal';
const MODE_FIGHT = 'fight';

const PUNCH_HAND_OFFSETS = {
  south: { x: 7, y: -13 },
  'south-east': { x: 9, y: -14 },
  east: { x: 10, y: -16 },
  'north-east': { x: 8, y: -19 },
  north: { x: 5, y: -19 },
  'north-west': { x: -8, y: -19 },
  west: { x: -10, y: -16 },
  'south-west': { x: -9, y: -14 },
};

/**
 * Example "World" screen: one Actor the player walks around with WASD, a mode-switchable "E"
 * action (interact / fight), and one InteractiveObject ("the PC") that opens the Terminal screen.
 *
 * INPUT DESIGN NOTE (reconciles this module's own draft with how ScreenManager actually works):
 * `ScreenManager` already forwards every abstract InputRouter action to the active screen's
 * `onInput(action, event)` via one wildcard subscription (see `ScreenManager.js`'s constructor).
 * That wildcard only ever fires on keyDOWN (per `InputRouter`'s own docs), so it's fine for
 * `toggle-mode` and for `interact`-as-PC-interact, but it's no good for the punch, which needs to
 * know the moment `E` is physically *released*. So in FIGHT mode this controller polls a
 * dedicated Phaser Key for `E` directly every frame (`this.attackKey`, see `onUpdate`) instead of
 * relying on the `interact` action for that half of the behavior; in NORMAL mode `E` still goes
 * through the ordinary `onInput('interact', ...)` path. Movement is the other continuous case,
 * polled every frame via `scene.input.keyboard.addKeys` (WASD, rewired from arrow keys).
 *
 * MODE SWITCH: `Q` (abstract action `toggle-mode`) toggles between NORMAL and FIGHT. The current
 * mode is shown as a small label in the top-left corner (just "NORMAL" / "FIGHT", no key hints).
 *
 * ATTACK (hold-to-punch): in FIGHT mode, holding `E` plays the `main_char` manifest's `attack`
 * animation forward; when it finishes, a small red pixel burst comes from the punching hand and
 * the animation starts again if `E` is still held. Releasing `E` immediately snaps back to the
 * FIRST frame of the punch animation, which doubles as the "ready to fight" idle pose for the rest
 * of FIGHT mode: whenever the player is in FIGHT mode and not currently punching —
 * standing still, or just switched into FIGHT mode — that frame 0 pose is shown instead of the
 * normal idle animation (`_showFightStance`/`_fightStanceDirection` track this so it's only
 * re-applied when something actually changes, not every single frame). Movement is frozen for the
 * duration of a hold (feet planted) — tried letting movement continue while punching in an earlier
 * round and it looked wrong: `Actor` only shows ONE animation at a time, there's no authored
 * "walking while punching" frame set, so the body glided across the screen stuck on static
 * punch-pose frames with the legs not animating to match. Walking in FIGHT mode (E not held) still
 * uses the ordinary walk animation, same as NORMAL mode, for the same reason.
 *
 * SETTINGS: opened by clicking "Quit" in the HudPanel's top-right button column (see
 * `game/ui/HudPanel.js`; no longer bound to Enter — `config/controls.default.json`'s movement
 * profile no longer maps ENTER). The window itself (`graphics/ui/windows/default_panel/
 * manifest.json`) is now sized to the full internal resolution (480x270) so it opens fullscreen
 * by default.
 * @module game/controllers/WorldScreenController
 */
export class WorldScreenController extends ScreenController {
  /** @param {object} [params] @returns {void} */
  onEnter(params) {
    const { scene } = this.engine;
    AudioManager.playMusic('music:gameplay', { loop: true });

    // Lets a pushed-on-top screen (e.g. the pause menu) reach this controller while it's mounted
    // underneath (see main.js's 'menu-start'/'pause-open-map' action registrations). Cleared in onExit.
    this.engine.worldController = this;

    // FIX (city map): world/camera bounds and building collision. Previously neither was set at
    // all (see prompts/12-INSTRUCTIONS_GAME.md: "No collision tilemap yet — player currently
    // walks through everything") because the old background was a single borderless static room
    // image with no real edges and nothing to collide with. `getMapSize()`/`getCollisionLayer()`
    // are no-ops (return null) for non-tilemap backgrounds, so this stays harmless if a future
    // screen swaps back to a static/parallax background.
    this._originalBackground = this.background;
    this._backgroundChanged = false;
    this._mapColliders = [];
    this._cityPortalLocked = false;
    this._underExitArmed = false;
    this.isTransitioning = false;
    this._currentArea = 'city';
    const mapSize = this.background?.getMapSize?.();
    const tileSize = this.background?.getTileSize?.();
    this.mapSize = mapSize ?? null;
    const spawnX = tileSize ? 25 * tileSize.width : 25;
    const spawnY = tileSize ? 25 * tileSize.height : 25;
    if (mapSize) {
      scene.physics.world.setBounds(0, 0, mapSize.width, mapSize.height);
      scene.cameras.main.setBounds(0, 0, mapSize.width, mapSize.height);
    }

    this.actor = new Actor(scene, 'main_char', spawnX, spawnY);
    this.actor.sprite.setCollideWorldBounds(Boolean(mapSize));
    scene.cameras.main.startFollow(this.actor.sprite, true);

    const collisionLayer = this.background?.getCollisionLayer?.();
    const partialHitboxGroup = this.background?.getPartialHitboxGroup?.();
    if (collisionLayer) {
      this._mapColliders.push(scene.physics.add.collider(this.actor.sprite, collisionLayer));
      // Partial (smaller-than-a-full-tile) hitboxes: rectangles drawn per-tile in Tiled's own
      // "Tile Collision Editor" — see BackgroundLoader.js's PARTIAL HITBOXES comment for how
      // these get built. Independent of the full-tile `collides` collider just above; a tile can
      // use either, both, or neither mechanic. Null (nothing collided against) when no placed
      // tile has a drawn collision shape, so this stays a no-op until you actually use one.
      if (partialHitboxGroup) this._mapColliders.push(scene.physics.add.collider(this.actor.sprite, partialHitboxGroup));
    }

    // Hitbox debug overlay (Settings > "Show Hitboxes (debug)"): draws a red rectangle around
    // every Arcade Physics body in the scene — the player, the companion cat, and every
    // InteractiveObject's trigger zone (the PC, scrap pickups, quest markers) — plus the tilemap's
    // colliding tiles. See `_applyHitboxDebug`'s own doc for how the two halves work.
    this._physicsDebugGraphic = scene.physics.world.createDebugGraphic();
    scene.physics.world.drawDebug = false; // createDebugGraphic() turns this on; we drive it ourselves
    this._tileDebugGraphic = collisionLayer ? scene.add.graphics().setDepth(DEPTH.WORLD_FOREGROUND) : null;
    if (collisionLayer) {
      // Tiles have no per-tile Arcade Body, so they're not part of `world`'s debug pass above —
      // drawn once into a separate Graphics instead (tiles don't move, so no per-frame redraw
      // needed). `tileColor`/`faceColor: null` skip non-colliding tiles and face-direction lines,
      // leaving just a red rectangle over every `collides` tile, matching the player/zone color.
      collisionLayer.renderDebug(this._tileDebugGraphic, {
        tileColor: null,
        collidingTileColor: { color: 0xff0000, alpha: 120 },
        faceColor: null,
      });
    }
    /**
     * @param {boolean} visible
     * @returns {void}
     */
    this._applyHitboxDebug = (visible) => {
      scene.physics.world.drawDebug = visible;
      if (!visible) this._physicsDebugGraphic.clear(); // drawDebug=false stops redrawing it, but
      // leaves whatever was drawn last frame on screen until something else clears it
      this._tileDebugGraphic?.setVisible(visible);
    };
    this._applyHitboxDebug(SettingsStore.get('video.hitboxDebug'));
    this._unsubscribeHitboxDebug = SettingsStore.subscribe('video.hitboxDebug', this._applyHitboxDebug);

    // Companion cat: trails the player with a short lag (see Companion.js). Reused unmodified
    // from here on by `onUpdate`/`onExit` — nothing else in this controller needs to know how
    // the follow behavior works internally.
    this.cat = new Companion(scene, 'cat_companion', this.actor.sprite, {
      collisionLayer,
      obstacleGroup: partialHitboxGroup,
    });
    this.cat.sprite.setCollideWorldBounds(Boolean(mapSize));
    if (collisionLayer) this._mapColliders.push(scene.physics.add.collider(this.cat.sprite, collisionLayer));
    if (partialHitboxGroup) this._mapColliders.push(scene.physics.add.collider(this.cat.sprite, partialHitboxGroup));
    this.cityNpcs = [];
    this.cityNpcColliders = [];
    if (collisionLayer && mapSize) {
      const navigationGrid = buildCityNavigationGrid(collisionLayer);
      this.cityNpcs = Array.from({ length: 5 }, () => {
        const npc = new CityWanderer(scene, navigationGrid);
        this.cityNpcColliders.push(scene.physics.add.collider(npc.sprite, collisionLayer));
        if (partialHitboxGroup) {
          this.cityNpcColliders.push(scene.physics.add.collider(npc.sprite, partialHitboxGroup));
        }
        return npc;
      });
    }
    this.soldier = new Actor(scene, 'soldier', spawnX + 200, spawnY + 40);
    // NPC Louisa removed per request — this used to be an `Actor(scene, 'louisa', ...)` spawned
    // here. Left out entirely rather than just hidden, since she's no longer wanted in the scene.
    this.teacher = new Actor(scene, 'teach', spawnX - 120, spawnY + 40);
    // "teach" is cutscene-only: present in the scene (keeps colliding/updating normally) but
    // invisible until a cutscene explicitly shows it with `this.teacher.sprite.setVisible(true)`.
    this.teacher.sprite.setVisible(false);
    // NOTE: blocking the player from walking THROUGH the cat is handled by `_keepCatOffPlayer`
    // (called from onUpdate, after both actor/cat `update()`), NOT by `physics.add.collider`.
    // An Arcade collider was tried here first and caused the camera to visibly shake while
    // moving: Companion moves the cat by writing `sprite.x/y` directly every frame (same as the
    // "cat has no collider against walls" note below explains), so whenever its chase logic
    // tried to close the distance to the player, a collider would shove it back out, Companion
    // would immediately re-overlap it next frame, and — because colliding two DYNAMIC bodies
    // pushes both sides apart by default — that tug-of-war also kept nudging the player, which
    // the camera follows. `_keepCatOffPlayer` resolves the same overlap but only ever moves the
    // cat, so the player (and the camera) stay untouched by it.

    const pcX = spawnX + 40;
    const pcY = spawnY;
    // Visual for the trigger zone — InteractiveObject itself only builds the invisible zone.
    this.pcVisual = scene.add.rectangle(pcX, pcY, 14, 14, 0x334455).setDepth(DEPTH.WORLD_ENTITIES);
    this.pcVisual.setStrokeStyle(1, 0x8aa8ff);

    this.pc = new InteractiveObject(scene, pcX, pcY, {
      width: 20,
      height: 20,
      label: '[E] interact',
      onInteract: () => {
        // Quest progress and the actual gameplay effect (opening the Terminal screen) are
        // independent of each other on purpose: QuestManager doesn't know or care WHY this
        // target was interacted with, and the Terminal would open the same way with zero
        // quests assigned to it.
        QuestManager.triggerInteract(WORLD_PC_INTERACT_ID);
        this.engine.screenManager.push('terminal');
      },
    });
    // Blocks the player from walking through the PC prop. Separate from interact detection:
    // `onUpdate` still decides whether `[E]` is usable via `isWithinRadius(INTERACT_RADIUS)`
    // against `this.pc.zone`'s x/y (a distance check, not a physics overlap), so making the
    // zone solid here doesn't change when the prompt shows or when interact fires.
    scene.physics.add.collider(this.actor.sprite, this.pc.zone);

    this.droppedItems = [];
    this._onInventoryItemDropped = ({ itemId, amount }) => this._createDroppedItem(itemId, amount);
    InventoryManager.events.on('inventory:item-dropped', this._onInventoryItemDropped);

    // WASD for movement (rewired from arrow keys; see class-level INPUT DESIGN NOTE).
    this.moveKeys = scene.input.keyboard.addKeys({
      up: 'W',
      down: 'S',
      left: 'A',
      right: 'D',
    });

    // Dedicated E key, polled directly in FIGHT mode so we can see both press AND release
    // (the abstract `interact` action only fires on press — see class-level INPUT DESIGN NOTE).
    this.attackKey = scene.input.keyboard.addKey('E');

    // Mode: NORMAL (E interacts) <-> FIGHT (E punches), toggled with Q.
    this.mode = MODE_NORMAL;
    this.modeLabel = scene.add.text(8, 8, '', {
      fontFamily: 'monospace',
      fontSize: '10px',
      color: '#ffffff',
    });
    this.modeLabel.setScrollFactor(0);
    this.modeLabel.setDepth(DEPTH.UI_HUD);
    this._refreshModeLabel();

    // HUD panel (keyboard-shortcut hint text top-right).
    // FIX (menu/pause screen): the old Quit and Inventory BUTTONS are gone — Quit's job (opening
    // Settings) is now reached via Backspace -> the pause menu -> Settings (see
    // PauseMenuScreenController.js and this controller's 'cancel' handling in onInput), and Inventory
    // is already reachable via its own keyboard shortcut (I, see config/controls.default.json's
    // "movement" profile). Both are now just listed as hint text instead of clickable buttons —
    // see HudPanel.js's own doc for the exact keys shown. Map is ALSO just hint text now, same
    // shape as the others (M still works; see onInput's 'toggle-map') — it was the last clickable
    // button left in this column and is now gone too, so the whole column is key-hints only.
    this.hudPanel = createHudPanel(scene);

    // Quest notifications: small top-right toasts for "started" / "progress" / "complete" — see
    // ToastNotifier.js's module docstring for the design (familiar from most RPGs/quest-driven
    // games). This controller owns the mapping from a quest event to a message + accent color;
    // ToastNotifier itself has no idea what a "quest" is.
    this.toasts = createToastNotifier(scene);
    this._onQuestsUpdated = () => this._refreshQuestHud();
    QuestManager.events.on('quest:updated', this._onQuestsUpdated);
    this._refreshQuestHud();
    this._onQuestAssigned = ({ id }) => {
      const quest = QuestManager.getQuest(id);
      if (quest) this.toasts.show(`Quest Started: ${quest.title}`, { accentColor: TOAST_ACCENT_STARTED });
    };
    this._onQuestProgress = ({ questId, objectiveId, current, count }) => {
      const quest = QuestManager.getQuest(questId);
      const objective = quest?.objectives.find((o) => o.id === objectiveId);
      // Only for an objective that's still short of its target — once an objective finishes,
      // either the whole quest just completed (the 'quest:completed' toast below covers that) or
      // this quest has more objectives left (no extra toast needed; the quest log always has the
      // full picture). Keeps this to one toast per meaningful step, not two for the same moment.
      if (quest && objective && !objective.done) {
        this.toasts.show(`${quest.title}: ${objective.description} (${current}/${count})`, { accentColor: TOAST_ACCENT_PROGRESS });
      }
    };
    this._onQuestCompleted = ({ id, rewardItems }) => {
      const quest = QuestManager.getQuest(id);
      if (quest) this.toasts.show(`Quest Complete: ${quest.title}`, { accentColor: TOAST_ACCENT_COMPLETE });
      if (id === ELEVATOR_QUEST_ID) QuestManager.assignQuest(WORK_QUEST_ID);

      // Reward granting is this content's job, not QuestManager's (see its module docstring's
      // REWARD ITEMS note) — QuestManager only hands the list off on the event payload.
      for (const reward of rewardItems ?? []) {
        const leftover = InventoryManager.addItem(reward.itemId, reward.count ?? 1);
        const definition = InventoryManager.getItemDefinition(reward.itemId);
        const name = definition?.name ?? reward.itemId;
        const gained = (reward.count ?? 1) - leftover;
        if (gained > 0) this.toasts.show(`+${gained} ${name}`, { accentColor: TOAST_ACCENT_COMPLETE });
        if (leftover > 0) this.toasts.show(`Inventory full: ${leftover} ${name} lost`, { accentColor: TOAST_ACCENT_PROGRESS });
      }
    };
    QuestManager.events.on('quest:assigned', this._onQuestAssigned);
    QuestManager.events.on('quest:objective-progress', this._onQuestProgress);
    QuestManager.events.on('quest:completed', this._onQuestCompleted);

    // Minimap + full map (see engine/world/MapOverlay.js). Only possible for a tilemap
    // background (getMapSize() is null otherwise) — a static/parallax room has no real map to
    // show. Every screen-fixed HUD element built above must be passed in `ignore`, or it would
    // also render tiny inside the map cameras.
    this.mapOverlay = this._createMapOverlay();

    // Punching: true only while E is physically held down in FIGHT mode.
    this.isPunching = false;
    // Tracks which direction's "fight ready" frame-0 pose is currently shown, so it's only
    // re-applied when something actually changes (mode toggle, stop/start moving, direction
    // change) rather than every frame.
    this._fightStanceDirection = null;
    this._attackParticles = new Set();
    this._onAttackAnimationComplete = (animation) => {
      if (
        !this.isPunching
        || animation.key !== animKey(this.actor.id, 'attack', this.actor.currentDirection)
        || animation.frames.length < 2
      ) return;

      this._spawnPunchParticles(this.actor.currentDirection);
      // Cat hit check: the punch "lands" at the same moment the hit particles spawn (one check
      // per completed swing, not every frame the hand overlaps the cat, so holding E doesn't
      // spam the sound faster than the punch animation itself actually repeats).
      if (isWithinRadius(this.actor.sprite, this.cat.sprite, CAT_HIT_RADIUS)) {
        AudioManager.playSfx('sfx:cat-meow');
      }
      if (this.mode === MODE_FIGHT && this.attackKey.isDown) {
        this.actor.playState('attack');
      }
    };
    this.actor.sprite.on('animationcomplete', this._onAttackAnimationComplete);
    this._sortWorldEntities();
  }

  /**
   * @param {number} time
   * @param {number} delta
   * @returns {void}
   */
  onUpdate(time, delta) {
    const { scene } = this.engine;
    if (this.isTransitioning) return;

    // Full map open: feet planted (same reasoning as mid-punch) so the player doesn't wander
    // off-screen while looking at the map; everything else (HUD, quest tracking, fx) keeps going.
    if (this.mapOverlay?.isOpen) {
      this.actor.sprite.body.setVelocity(0, 0); // feet planted — see movement note on MODE_FIGHT below
      this.actor.playState('idle');
    } else if (this.mode === MODE_FIGHT) {
      this._updateFightMode(delta);
    } else {
      this._updateNormalMode(delta);
    }

    this._syncActorOrigin();
    this.actor.update(time, delta);
    this.cat.update(time, delta);
    for (const npc of this.cityNpcs) npc.update(time, delta);
    this.soldier.update(time, delta);
    this.teacher.update(time, delta);
    this._keepCatOffPlayer();
    this._sortWorldEntities();
    this._checkPortalTransition();
    if (this.isTransitioning) return;

    // In fight mode E punches rather than interacts, so the "[E] interact" prompt would be
    // misleading there — only show it in normal mode.
    this.pc.showPrompt(this.mode === MODE_NORMAL && isWithinRadius(this.actor.sprite, this.pc.zone, INTERACT_RADIUS));

    for (const droppedItem of this.droppedItems) {
      droppedItem.object.showPrompt(
        this.mode === MODE_NORMAL && isWithinRadius(this.actor.sprite, droppedItem.object.zone, PICKUP_RADIUS),
      );
    }

    // "Getting somewhere" quest progress: fed every frame, same way LoopManager/FxManager usage
    // below is — QuestManager itself does the cheap no-op check when nothing's listening.
    QuestManager.reportLocation('world', this.actor.sprite.x, this.actor.sprite.y);
    const trackedLocation = QuestManager.getTrackedQuest()?.objectives.find((objective) => (
      objective.type === 'reach_location'
      && objective.screenId === 'world'
      && !objective.done
      && Number.isFinite(objective.x)
      && Number.isFinite(objective.y)
    ));
    this.mapOverlay?.setTarget(trackedLocation ? { x: trackedLocation.x, y: trackedLocation.y } : null);

    // Usage pattern documented at the top of module 09's FxManager.js.
    const level = LoopManager.glitchLevel();
    if (level > 0 && Math.random() < 0.002 * level) {
      FxManager.shake(scene, 0.002 + 0.006 * level, 120);
    }
  }

  /**
   * Builds the map cameras for the currently active background.
   * @private
   * @returns {ReturnType<typeof createMapOverlay>|null}
   */
  _createMapOverlay() {
    if (!this.mapSize) return null;
    return createMapOverlay(this.engine.scene, {
      follow: this.actor.sprite,
      mapSize: this.mapSize,
      tileSize: this.background?.getTileSize?.(),
      ignore: [
        ...this.hudPanel.getDisplayObjects(),
        this.modeLabel,
        this.toasts.root,
      ],
    });
  }

  /**
   * Starts the two-way city/underground transition when the player reaches a portal edge.
   * @private
   * @returns {void}
   */
  _checkPortalTransition() {
    const tileSize = this.background?.getTileSize?.();
    const body = this.actor.sprite.body;
    if (!tileSize || !body) return;

    if (this._currentArea === 'city') {
      const tileX = Math.floor(body.center.x / tileSize.width);
      const tileY = Math.floor(body.center.y / tileSize.height);
      if (this.moveKeys.up.isDown && body.blocked.up) {
        const lowerIndex = CITY_SHORTCUTS.lower.findIndex(
          (tile) => tile.x === tileX && tileY >= tile.y - 1 && tileY <= tile.y,
        );
        if (lowerIndex !== -1) {
          this._transitionWithinCity(CITY_SHORTCUTS.upper[lowerIndex]);
          return;
        }

        const upperIndex = CITY_SHORTCUTS.upper.findIndex(
          (tile) => tile.x === tileX && tileY >= tile.y - 1 && tileY <= tile.y,
        );
        if (upperIndex !== -1) {
          this._transitionWithinCity(CITY_SHORTCUTS.lower[upperIndex]);
          return;
        }
      }

      const atCityPortal = tileX === CITY_PORTAL_TILE.x && tileY === CITY_PORTAL_TILE.y;
      if (!atCityPortal) this._cityPortalLocked = false;
      else if (!this._cityPortalLocked) this._transitionToArea('under');
      return;
    }

    if (this._currentArea !== 'under') return;
    if (body.center.x >= tileSize.width * 1.5) this._underExitArmed = true;
    if (this._underExitArmed && body.left <= 2) this._transitionToArea('city');
  }

  /**
   * Fades to black and teleports between the two city-map shortcuts.
   * @private
   * @param {{x:number,y:number}} destination
   * @returns {void}
   */
  _transitionWithinCity(destination) {
    if (this.isTransitioning) return;
    const { scene } = this.engine;
    this.isTransitioning = true;
    this.actor.sprite.body.setVelocity(0, 0);
    this.cat.sprite.body.setVelocity(0, 0);
    this.actor.playState('idle');

    const overlay = scene.add.rectangle(
      INTERNAL_WIDTH / 2,
      INTERNAL_HEIGHT / 2,
      INTERNAL_WIDTH + 2,
      INTERNAL_HEIGHT + 2,
      0x000000,
    ).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.FX_OVERLAY).setAlpha(0);
    this._portalTransitionOverlay = overlay;
    scene.tweens.add({
      targets: overlay,
      alpha: 1,
      duration: CITY_SHORTCUT_FADE_MS,
      onComplete: () => {
        const tileSize = this.background.getTileSize();
        const x = (destination.x + 0.5) * tileSize.width;
        const y = (destination.y + 0.5) * tileSize.height;
        this.actor.sprite.setPosition(x, y);
        this.actor.sprite.body.reset(x, y);
        this.actor.sprite.body.setVelocity(0, 0);
        this.cat.teleport(
          Math.min(this.mapSize.width - 1, x + 24),
          Math.min(this.mapSize.height - 1, y + 10),
        );
        if (CITY_SHORTCUTS.upper.some((tile) => tile.x === destination.x && tile.y === destination.y)
          && QuestManager.isQuestActive(ELEVATOR_QUEST_ID)) {
          for (const objectiveId of ELEVATOR_OBJECTIVE_IDS) {
            const objective = QuestManager.getQuest(ELEVATOR_QUEST_ID)?.objectives.find(
              (candidate) => candidate.id === objectiveId,
            );
            if (objective && !objective.done) {
              QuestManager.completeObjective(ELEVATOR_QUEST_ID, objectiveId);
            }
          }
        }
        scene.tweens.add({
          targets: overlay,
          alpha: 0,
          duration: CITY_SHORTCUT_FADE_MS,
          onComplete: () => {
            overlay.destroy();
            this._portalTransitionOverlay = null;
            this.isTransitioning = false;
          },
        });
      },
    });
  }

  /**
   * Fades the whole scene to black, replaces the tilemap and collision world, then fades back in.
   * @private
   * @param {'city'|'under'} area
   * @returns {void}
   */
  _transitionToArea(area) {
    if (this.isTransitioning) return;
    const { scene } = this.engine;
    this.isTransitioning = true;
    this.actor.sprite.body.setVelocity(0, 0);
    this.cat.sprite.body.setVelocity(0, 0);
    this.actor.playState('idle');

    const overlay = scene.add.rectangle(
      INTERNAL_WIDTH / 2,
      INTERNAL_HEIGHT / 2,
      INTERNAL_WIDTH + 2,
      INTERNAL_HEIGHT + 2,
      0x000000,
    ).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.FX_OVERLAY).setAlpha(0);
    this._portalTransitionOverlay = overlay;
    scene.tweens.add({
      targets: overlay,
      alpha: 1,
      duration: PORTAL_FADE_MS,
      onComplete: () => {
        try {
          this._replaceBackground(area);
          const tileSize = this.background.getTileSize();
          const destination = area === 'under' ? UNDER_ARRIVAL_TILE : CITY_PORTAL_TILE;
          const x = (destination.x + 0.5) * tileSize.width;
          const y = (destination.y + 0.5) * tileSize.height;
          this.actor.sprite.setPosition(x, y);
          this.actor.sprite.body.reset(x, y);
          this.actor.sprite.body.setVelocity(0, 0);

          const catX = Math.min(this.mapSize.width - 1, x + 24);
          const catY = Math.min(this.mapSize.height - 1, y + 10);
          this.cat.teleport(catX, catY);
          this._cityPortalLocked = area === 'city';
          this._underExitArmed = false;
        } catch (error) {
          overlay.destroy();
          this._portalTransitionOverlay = null;
          this.isTransitioning = false;
          throw error;
        }

        scene.tweens.add({
          targets: overlay,
          alpha: 0,
          duration: PORTAL_FADE_MS,
          onComplete: () => {
            overlay.destroy();
            this._portalTransitionOverlay = null;
            this.isTransitioning = false;
          },
        });
      },
    });
  }

  /**
   * Replaces the active background and refreshes all map-bound world systems.
   * @private
   * @param {'city'|'under'} area
   * @returns {void}
   */
  _replaceBackground(area) {
    const { scene } = this.engine;
    const nextBackground = BackgroundLoader.build(scene, area);
    for (const collider of this._mapColliders) scene.physics.world.removeCollider(collider);
    this._mapColliders.length = 0;

    this.mapOverlay?.destroy();
    this.mapOverlay = null;
    const previousBackground = this.background;
    this.background = nextBackground;
    previousBackground?.destroy();
    this._backgroundChanged = this.background !== this._originalBackground;
    this._currentArea = area;

    this.mapSize = this.background.getMapSize();
    const collisionLayer = this.background.getCollisionLayer();
    const partialHitboxGroup = this.background.getPartialHitboxGroup();
    if (this.mapSize) {
      scene.physics.world.setBounds(0, 0, this.mapSize.width, this.mapSize.height);
      scene.cameras.main.setBounds(0, 0, this.mapSize.width, this.mapSize.height);
    }

    if (collisionLayer) {
      this._mapColliders.push(scene.physics.add.collider(this.actor.sprite, collisionLayer));
      this._mapColliders.push(scene.physics.add.collider(this.cat.sprite, collisionLayer));
    }
    if (partialHitboxGroup) {
      this._mapColliders.push(scene.physics.add.collider(this.actor.sprite, partialHitboxGroup));
      this._mapColliders.push(scene.physics.add.collider(this.cat.sprite, partialHitboxGroup));
    }
    this.actor.sprite.setCollideWorldBounds(Boolean(this.mapSize));
    this.cat.sprite.setCollideWorldBounds(Boolean(this.mapSize));
    this.cat.setNavigationMap(collisionLayer, partialHitboxGroup);

    this._tileDebugGraphic?.destroy();
    this._tileDebugGraphic = collisionLayer
      ? scene.add.graphics().setDepth(DEPTH.WORLD_FOREGROUND)
      : null;
    if (collisionLayer) {
      collisionLayer.renderDebug(this._tileDebugGraphic, {
        tileColor: null,
        collidingTileColor: { color: 0xff0000, alpha: 120 },
        faceColor: null,
      });
    }
    this._tileDebugGraphic?.setVisible(SettingsStore.get('video.hitboxDebug'));
    this.mapOverlay = this._createMapOverlay();
    // Note: city-only NPC wanderers (this.cityNpcs) and the teacher/soldier actors are NOT
    // rebuilt here — they're city-only dressing and simply keep existing (off-camera, harmless)
    // while the underworld background is active, same as before this transition logic existed.
  }

  /**
   * Sorts world characters and props by their ground-contact Y position, keeping the result
   * inside the world-entity depth band so foreground layers and the HUD remain above them.
   * @private
   * @returns {void}
   */
  _sortWorldEntities() {
    const mapHeight = this.mapSize?.height ?? INTERNAL_HEIGHT;
    const sortables = [
      this.actor.sprite,
      // Keep the cat in the exact same ground-Y depth ordering as the player.
      this.cat.sprite,
      ...this.cityNpcs.map((npc) => npc.sprite),
      this.soldier.sprite,
      this.teacher.sprite,
      this.pcVisual,
      ...this.droppedItems.flatMap(({ visual, icon, countLabel }) => [visual, icon, countLabel]),
    ];

    for (const object of sortables) {
      const groundY = object.body?.bottom ?? object.getBounds().bottom;
      const normalizedY = Math.max(0, Math.min(1, groundY / mapHeight));
      const depth = DEPTH.WORLD_ENTITIES + normalizedY * WORLD_Y_SORT_DEPTH_RANGE;
      if (object.depth !== depth) object.setDepth(depth);
    }
  }

  /**
   * Keeps the cat from visually sitting on top of the player, WITHOUT ever moving the player
   * (see the comment where `this.cat` is created for why this isn't a `physics.add.collider`).
   * Standard AABB overlap resolution, but one-sided: only `this.cat.sprite` is ever adjusted.
   * @private
   * @returns {void}
   */
  _keepCatOffPlayer() {
    const playerBody = this.actor.sprite.body;
    const catBody = this.cat.sprite.body;

    const overlapX = Math.min(playerBody.right, catBody.right) - Math.max(playerBody.left, catBody.left);
    const overlapY = Math.min(playerBody.bottom, catBody.bottom) - Math.max(playerBody.top, catBody.top);
    if (overlapX <= 0 || overlapY <= 0) return; // not overlapping

    // Push out along whichever axis has the smaller overlap (the usual AABB resolution choice —
    // it's the shorter way out), away from the player's center.
    if (overlapX < overlapY) {
      const dir = Math.sign(catBody.center.x - playerBody.center.x) || 1;
      this.cat.sprite.x += dir * overlapX;
    } else {
      const dir = Math.sign(catBody.center.y - playerBody.center.y) || 1;
      this.cat.sprite.y += dir * overlapY;
    }
  }

  /**
   * Keeps taller animation frames aligned with the manifest-sized static sprites.
   * @private
   * @returns {void}
   */
  _syncActorOrigin() {
    const pivot = this.actor.manifest.pivot ?? { x: 0.5, y: 0.5 };
    const baseHeight = this.actor.manifest.frame_size.height;
    const frameHeight = this.actor.sprite.frame.height || this.actor.manifest.frame_size.height;
    const centeredPaddingY = (frameHeight - baseHeight) / 2;
    const originY = (pivot.y * baseHeight + centeredPaddingY) / frameHeight;

    if (this.actor.sprite.originY !== originY || this.actor.sprite.originX !== pivot.x) {
      this.actor.sprite.setOrigin(pivot.x, originY);
    }
  }

  /**
   * Ordinary WASD movement + idle/walk, used in NORMAL mode.
   *
   * FIX (collision): this used to move the player by writing `sprite.x`/`sprite.y` directly
   * every frame. That's why walls, the cat and the PC prop never actually stopped the player
   * even once their colliders were registered: Arcade's collision separation runs as part of
   * the physics engine's own step, which happens BEFORE this controller's `onUpdate` runs each
   * frame (see ScreenManager's doc) — so any separation a collider applied was immediately
   * undone the instant this method wrote a fresh raw position straight over it. Moving via
   * `body.setVelocity` instead lets Arcade integrate position AND resolve collisions together
   * in that same physics step, which is what colliders actually require to work.
   * @private
   * @param {number} delta
   * @returns {void}
   */
  _updateNormalMode(delta) {
    const keys = this.moveKeys;
    const dx = (keys.right.isDown ? 1 : 0) - (keys.left.isDown ? 1 : 0);
    const dy = (keys.down.isDown ? 1 : 0) - (keys.up.isDown ? 1 : 0);

    if (dx !== 0 || dy !== 0) {
      // Normalized so diagonal movement isn't faster than cardinal movement (a side effect of
      // moving to velocity-based motion — raw dx/dy would otherwise give diagonals sqrt(2)x speed).
      const length = Math.hypot(dx, dy);
      this.actor.sprite.body.setVelocity((dx / length) * WALK_SPEED, (dy / length) * WALK_SPEED);
      this.actor.setDirectionFromVector(dx, dy, 'walk');
    } else {
      this.actor.sprite.body.setVelocity(0, 0);
      this.actor.playState('idle');
    }
  }

  /**
   * FIGHT-mode movement + hold-to-punch. See class-level ATTACK doc for the full behavior.
   * @private
   * @param {number} delta
   * @returns {void}
   */
  _updateFightMode(delta) {
    const held = this.attackKey.isDown;

    if (held && !this.isPunching) {
      // Just pressed: start the punch playing forward from frame 0. `Actor.playState` won't
      // restart it on later frames while still held (it ignores redundant play calls).
      this.isPunching = true;
      this._fightStanceDirection = null;
      this.actor.playState('attack');
    } else if (!held && this.isPunching) {
      // Just released: snap straight back to frame 0, regardless of how far the punch had
      // played — that's the "default fight mode" ready stance from here on.
      this.isPunching = false;
      this._showFightStance();
    }

    if (this.isPunching) {
      this.actor.sprite.body.setVelocity(0, 0); // feet planted — see class-level ATTACK doc for why
      return;
    }

    const keys = this.moveKeys;
    const dx = (keys.right.isDown ? 1 : 0) - (keys.left.isDown ? 1 : 0);
    const dy = (keys.down.isDown ? 1 : 0) - (keys.up.isDown ? 1 : 0);

    // See `_updateNormalMode`'s doc for why this is velocity-based rather than writing
    // `sprite.x`/`sprite.y` directly (that bypassed wall/cat/PC collision entirely).
    if (dx !== 0 || dy !== 0) {
      const length = Math.hypot(dx, dy);
      this.actor.sprite.body.setVelocity((dx / length) * WALK_SPEED, (dy / length) * WALK_SPEED);
      this.actor.setDirectionFromVector(dx, dy, 'walk');
      this._fightStanceDirection = null; // walking overrides the stance pose until it stops
    } else {
      this.actor.sprite.body.setVelocity(0, 0);
      this._showFightStance();
    }
  }

  /**
   * Shows the `fight` stance for the player's current facing direction. Re-applied only when the
   * facing direction (or whatever last cleared `_fightStanceDirection`) actually changed.
   * @private
   * @returns {void}
   */
  _showFightStance() {
    const direction = this.actor.currentDirection;
    if (this._fightStanceDirection === direction) return;
    this._fightStanceDirection = direction;

    const key = animKey(this.actor.id, 'fight', direction);
    if (this.engine.scene.anims.exists(key)) {
      this.actor.playState('fight');
      this.actor.sprite.anims.stop();
    } else {
      // Shouldn't happen — manifest.json's `attack` state has `fallback: "idle"`, so this key
      // always exists — but fall back to the ordinary idle pose rather than leaving a stale frame.
      this.actor.playState('idle');
    }
  }

  /**
   * Creates a brief pixel-like burst at the punching hand.
   * @private
   * @param {string} direction
   * @returns {void}
   */
  _spawnPunchParticles(direction) {
    const { scene } = this.engine;
    const hand = PUNCH_HAND_OFFSETS[direction] ?? PUNCH_HAND_OFFSETS.south;
    const originX = this.actor.sprite.x + hand.x;
    const originY = this.actor.sprite.y + hand.y;
    const depth = DEPTH.WORLD_ENTITIES + (direction.startsWith('north') ? -1 : 1);

    for (let i = 0; i < 7; i += 1) {
      const particle = scene.add.rectangle(
        originX + (Math.random() - 0.5) * 2,
        originY + (Math.random() - 0.5) * 2,
        i % 3 === 0 ? 3 : 2,
        i % 3 === 0 ? 3 : 2,
        i % 2 === 0 ? 0xff3030 : 0xd41424,
      ).setDepth(depth);
      this._attackParticles.add(particle);

      scene.tweens.add({
        targets: particle,
        x: particle.x + (Math.random() - 0.5) * 12,
        y: particle.y - 3 - Math.random() * 8,
        alpha: 0,
        duration: 140 + Math.random() * 100,
        onComplete: () => {
          this._attackParticles.delete(particle);
          particle.destroy();
        },
      });
    }
  }

  /**
   * Spawns an item stack dropped from the inventory at the player's feet. The world object is
   * retained if inventory capacity prevents the full stack from being picked up again.
   * @private
   * @param {string} itemId
   * @param {number} amount
   * @returns {void}
   */
  _createDroppedItem(itemId, amount) {
    const definition = InventoryManager.getItemDefinition(itemId);
    if (!definition) throw new Error(`WorldScreenController: cannot spawn unknown item "${itemId}"`);

    const { scene } = this.engine;
    const x = this.actor.sprite.x;
    const y = (this.actor.sprite.body?.bottom ?? this.actor.sprite.y) + 6;
    const visual = scene.add.rectangle(x, y, 12, 12, 0x373044).setDepth(DEPTH.WORLD_ENTITIES);
    visual.setStrokeStyle(1, 0xffd27f);
    const icon = scene.add.text(x, y, definition.name.slice(0, 1).toUpperCase(), {
      fontFamily: 'monospace',
      fontSize: '8px',
      color: '#fff0c0',
    }).setOrigin(0.5).setDepth(DEPTH.WORLD_ENTITIES);
    const countLabel = scene.add.text(x, y - 10, String(amount), {
      fontFamily: 'monospace',
      fontSize: '7px',
      color: '#ffffff',
      backgroundColor: '#20202a',
      padding: { x: 2, y: 1 },
    }).setOrigin(0.5, 1).setDepth(DEPTH.WORLD_ENTITIES);

    const entry = { itemId, amount, visual, icon, countLabel, object: null };
    const updatePrompt = () => {
      entry.object.prompt?.setText(`[E] pick up ${definition.name} x${entry.amount}`);
    };
    entry.object = new InteractiveObject(scene, x, y, {
      width: 18,
      height: 18,
      label: `[E] pick up ${definition.name} x${amount}`,
      onInteract: () => {
        const previousCount = InventoryManager.getItemCount(itemId);
        QuestManager.collectItem(itemId, entry.amount);
        const pickedUp = InventoryManager.getItemCount(itemId) - previousCount;
        entry.amount -= pickedUp;

        if (entry.amount <= 0) {
          entry.object.destroy();
          entry.visual.destroy();
          entry.icon.destroy();
          entry.countLabel.destroy();
          this.droppedItems.splice(this.droppedItems.indexOf(entry), 1);
          return;
        }

        entry.countLabel.setText(String(entry.amount));
        updatePrompt();
      },
    });
    this.droppedItems.push(entry);
  }

  /** Longest the pinned tracked-quest notification is allowed to get before truncating. */
  static QUEST_HUD_MAX_CHARS = 64;

  /**
   * Updates the fixed notification-style card from the tracked quest. Subscribed to
   * `QuestManager`'s `'quest:updated'` event so quest selection and progress changes are reflected
   * immediately.
   * @private
   * @returns {void}
   */
  _refreshQuestHud() {
    const quest = QuestManager.getTrackedQuest();
    if (!quest) {
      this.toasts.setPinned(null);
      return;
    }
    const nextObjective = quest.objectives.find((o) => !o.done) ?? quest.objectives[quest.objectives.length - 1];
    let line = `${quest.title}: ${nextObjective.description} (${nextObjective.current}/${nextObjective.count})`;
    if (line.length > WorldScreenController.QUEST_HUD_MAX_CHARS) {
      line = `${line.slice(0, WorldScreenController.QUEST_HUD_MAX_CHARS - 1)}\u2026`;
    }
    this.toasts.setPinned(line, { accentColor: TOAST_ACCENT_STARTED });
  }

  /**
   * @param {string} action
   * @param {{action: string, originalEvent: object}} event
   * @returns {void}
   */
  onInput(action, event) {
    if (action === 'toggle-map') {
      this.mapOverlay?.toggleFull();
    } else if (action === 'toggle-mode') {
      this.mode = this.mode === MODE_NORMAL ? MODE_FIGHT : MODE_NORMAL;
      this._refreshModeLabel();
      this._fightStanceDirection = null;
      if (this.mode === MODE_NORMAL) {
        // Leaving FIGHT mode mid-punch (Q and E both held) shouldn't leave the punch "stuck".
        this.isPunching = false;
        this.actor.playState('idle');
      }
    } else if (action === 'interact' && this.mode === MODE_NORMAL) {
      // FIGHT mode's E (punch) is handled by continuous polling in onUpdate instead — see
      // class-level INPUT DESIGN NOTE for why the discrete action isn't used for it.
      if (isWithinRadius(this.actor.sprite, this.pc.zone, INTERACT_RADIUS)) this.pc.trigger();
      for (const droppedItem of [...this.droppedItems]) {
        if (isWithinRadius(this.actor.sprite, droppedItem.object.zone, PICKUP_RADIUS)) droppedItem.object.trigger();
      }
    } else if (action === 'open-quest-log') {
      this.engine.screenManager.push('quest_log');
    } else if (action === 'open-inventory') {
      this.engine.screenManager.push('inventory');
    } else if (action === 'cancel') {
      if (this.mapOverlay?.isOpen) {
        this.mapOverlay.closeFull();
        return;
      }
      // Backspace now opens the pause menu (see PauseMenuScreenController.js) instead of
      // resetting the loop — it's pushed on top of this screen, which pauses it via the usual
      // ScreenManager push flow (this controller's onPause/onResume already handle that).
      this.engine.screenManager.push('pause_menu');
    } else if (action === 'debug-reset-loop') {
      // DEV-ONLY, bound to R (config/controls.default.json's "movement" profile).
      // Framed as "you died, respawn" rather than an exposed loop-reset mechanic: a short
      // message, then a full reload. QuestManager.resetAll() clears quest progress AND the
      // main inventory grid (it delegates to InventoryManager.resetAll() internally) — the
      // cat's own slots are untouched by that call on purpose, so whatever was stashed there
      // survives, per storycontext.md's "The Cat" section. The reload itself then rebuilds
      // the whole world/scene state from scratch, same spawn point as any fresh boot.
      QuestManager.resetAll();
      this._showRespawnMessage();
    }
  }

  /**
   * Brief "you died" beat before reloading — in-fiction framing for the reset (soldiers catch
   * the player, they're put under, they wake up back home), not a visible game-mechanic prompt.
   * @private
   * @returns {void}
   */
  _showRespawnMessage() {
    const { scene } = this.engine;
    this.actor.sprite.body.setVelocity(0, 0);

    const overlay = scene.add.rectangle(0, 0, INTERNAL_WIDTH * 3, INTERNAL_HEIGHT * 3, 0x000000, 1)
      .setScrollFactor(0)
      .setDepth(DEPTH.UI_HUD + 10)
      .setAlpha(0);
    const text = scene.add.text(INTERNAL_WIDTH / 2, INTERNAL_HEIGHT / 2, 'you just died..', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#ffffff',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.UI_HUD + 11).setAlpha(0);

    scene.tweens.add({
      targets: [overlay, text],
      alpha: 1,
      duration: 400,
      onComplete: () => {
        scene.time.delayedCall(700, () => window.location.reload());
      },
    });
  }

  /**
   * Updates the top-left mode label's text/color to match `this.mode`.
   * @private
   * @returns {void}
   */
  _refreshModeLabel() {
    const isFight = this.mode === MODE_FIGHT;
    this.modeLabel.setText(isFight ? 'FIGHT' : 'NORMAL');
    this.modeLabel.setColor(isFight ? '#ff6b6b' : '#8aa8ff');
  }

  /** @returns {void} */
  onPause() {
    this.mapOverlay?.setVisible(false);
  }

  /** @returns {void} */
  onResume() {
    this.mapOverlay?.setVisible(true);
  }

  /** @returns {void} */
  onExit() {
    AudioManager.stopMusic();
    if (this.engine.worldController === this) this.engine.worldController = null;
    this._unsubscribeHitboxDebug?.();
    this.engine.scene.physics.world.drawDebug = false; // stop postUpdate from touching the graphic we're about to destroy
    this._physicsDebugGraphic.destroy();
    this._tileDebugGraphic?.destroy();
    this.mapOverlay?.destroy();
    this.actor.sprite.off('animationcomplete', this._onAttackAnimationComplete);
    for (const particle of this._attackParticles) {
      this.engine.scene.tweens.killTweensOf(particle);
      particle.destroy();
    }
    this._attackParticles.clear();
    QuestManager.events.off('quest:updated', this._onQuestsUpdated);
    QuestManager.events.off('quest:assigned', this._onQuestAssigned);
    QuestManager.events.off('quest:objective-progress', this._onQuestProgress);
    QuestManager.events.off('quest:completed', this._onQuestCompleted);
    InventoryManager.events.off('inventory:item-dropped', this._onInventoryItemDropped);
    this.toasts.destroy();
    for (const collider of this.cityNpcColliders) {
      this.engine.scene.physics.world.removeCollider(collider);
    }
    for (const collider of this._mapColliders) {
      this.engine.scene.physics.world.removeCollider(collider);
    }
    this._portalTransitionOverlay?.destroy();
    this.actor.sprite.destroy();
    this.cat.destroy();
    for (const npc of this.cityNpcs) npc.destroy();
    this.soldier.sprite.destroy();
    this.teacher.sprite.destroy();
    this.pc.destroy();
    this.pcVisual.destroy();
    for (const droppedItem of this.droppedItems) {
      droppedItem.object.destroy();
      droppedItem.visual.destroy();
      droppedItem.icon.destroy();
      droppedItem.countLabel.destroy();
    }
    this.modeLabel.destroy();
    this.hudPanel.destroy();
  }
}