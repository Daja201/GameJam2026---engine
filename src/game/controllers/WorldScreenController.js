import { ScreenController } from '../../engine/screens/ScreenController.js';
import { Actor } from '../../engine/sprites/Actor.js';
import { resolveDirection } from '../../engine/sprites/DirectionResolver.js';
import { Companion } from '../companions/Companion.js';
import { buildCityNavigationGrid, CityWanderer } from '../companions/CityWanderer.js';
import { CitySoldierGroup } from '../companions/CitySoldierGroup.js';
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
import { createSpeechBubble } from '../../engine/ui/SpeechBubble.js';

/** Toast accent colors by quest-event category — kept here (content), not in ToastNotifier (generic). */
const TOAST_ACCENT_STARTED = 0x8aa8ff;
const TOAST_ACCENT_PROGRESS = 0xffd27f;
const TOAST_ACCENT_COMPLETE = 0x6fe39a;

/** Walking speed, pixels per second. */
const WALK_SPEED = 60;
/** How close the player must be to a dropped inventory item to pick it up. */
const PICKUP_RADIUS = 20;

/** How close the cat must be to the player's punching hand for a fight-mode hit to land on it. */
const CAT_HIT_RADIUS = 20;
const WORLD_Y_SORT_DEPTH_RANGE = DEPTH.WORLD_FOREGROUND - DEPTH.WORLD_ENTITIES - 1;
const MAX_ACTIVE_CITY_WANDERERS = 5;
/** Total wanderer pool the spawn queue draws from — bigger than MAX_ACTIVE so there's enough
 *  slack for random gaps between walkers instead of them bunching into one train. */
const CITY_NPC_POOL_SIZE = 9;
/** Minimum/extra-random delay (ms) between one wanderer spawning and the next being allowed to. */
const CITY_NPC_SPAWN_GAP_MIN_MS = 3500;
const CITY_NPC_SPAWN_GAP_RANDOM_MS = 5500;

// Elevator (city) <-> underworld teleport system. Restored after going missing from this
// controller — see the city/under tilemaps for the tile coordinates these refer to.
const CITY_PORTAL_TILE = { x: 3, y: 0 };
const TURRET_DOOR_TILES = [{ x: 0, y: 14 }, { x: 1, y: 14 }];
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
const LOCAL_HELP_QUEST_IDS = ['ask_local_1', 'ask_local_2', 'ask_local_3'];
const FIND_SUB_QUEST_ID = 'find_sub';
const UNDERGROUND_HACKER_QUEST_ID = 'find_underground_hacker_community';
const LEARN_HACKING_QUEST_ID = 'learn_hacking';
const HACKER_MISSION_QUEST_ID = 'hacker_final_mission';
const FIND_PRISON_QUEST_ID = 'find_provisional_prison';
const UNDER_TRAINING_COMPUTER_TARGET_ID = 'under_training_computer';
const UNDER_NPC3_SPIN_DIRECTIONS = [
  'south',
  'south-west',
  'west',
  'north-west',
  'north',
  'north-east',
  'east',
  'south-east',
];
const UNDER_NPC3_DIRECTION_DURATION_MS = 225;

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
    this._turretDoorLocked = false;
    this._underExitArmed = false;
    this.underCar = null;
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
    this.cityNpcSpawnQueue = [];
    this.cityNpcScheduled = new Set();
    this.cityNpcSpawnTimer = 0;
    this.citySoldierGroups = [];
    this.cityNpc3 = null;
    this.cityNpc4 = null;
    this.hacker = null;
    this.underComputers = [];
    this.underHackers = [];
    this.underNpc3s = [];
    this._underNpc3DirectionIndex = 0;
    this._underNpc3DirectionSteps = [];
    this._underNpc3DirectionElapsed = 0;
    this.underDjNpc3 = null;
    this.underCommunityHacker = null;
    this._underCommunityHackerConversationActive = false;
    this._underCommunityHackerConversationComplete = false;
    this.underDjPult = null;
    this.underDjLights = null;
    this._underDjLightElapsed = 0;
    this.underComputerAccess = null;
    this._npc3ConversationActive = false;
    this._npc3ConversationComplete = false;
    this._npc4ConversationActive = false;
    this._npc4ConversationComplete = false;
    this._prisonConversationActive = false;
    this._prisonConversationComplete = false;
    this._hackerConversationActive = false;
    this._hackerConversationComplete = false;
    this._localConversationBubble = null;
    this._localConversationTimer = null;
    if (collisionLayer && mapSize) {
      const navigationGrid = buildCityNavigationGrid(collisionLayer);
      this.cityNavigationGrid = navigationGrid;
      this.cityNpcs = Array.from({ length: CITY_NPC_POOL_SIZE }, (_, index) => {
        const spriteId = index % 2 === 0 ? 'npc1' : 'npc2';
        const npc = new CityWanderer(scene, navigationGrid, spriteId);
        this.cityNpcColliders.push(scene.physics.add.collider(npc.sprite, collisionLayer));
        if (partialHitboxGroup) {
          this.cityNpcColliders.push(scene.physics.add.collider(npc.sprite, partialHitboxGroup));
        }
        return npc;
      });
      this.cityNpcSpawnQueue = [...this.cityNpcs];
      this.cityNpcScheduled = new Set(this.cityNpcSpawnQueue);
      this.cityNpcSpawnTimer = Math.random() * 6000;
      // Two stationary pairs, posted on the same road row the wanderers walk (y 24/25), spread
      // out along it so they read as watching the street rather than patrolling it themselves.
      this.citySoldierGroups = [
        new CitySoldierGroup(scene, navigationGrid, { x: 2, y: 24 }),
        new CitySoldierGroup(scene, navigationGrid, { x: 8, y: 25 }),
      ];
      const npc3Tile = { x: 11, y: 11 };
      this.cityNpc3 = new Actor(
        scene,
        'npc3',
        navigationGrid.origin.x + (npc3Tile.x + 0.5) * navigationGrid.tileWidth,
        navigationGrid.origin.y + (npc3Tile.y + 0.5) * navigationGrid.tileHeight,
      );
      this.cityNpc3.setDirection('south-west');
      const npc4Tile = { x: 0, y: 16 };
      this.cityNpc4 = new Actor(
        scene,
        'npc4',
        navigationGrid.origin.x + (npc4Tile.x + 0.5) * navigationGrid.tileWidth,
        navigationGrid.origin.y + (npc4Tile.y + 0.5) * navigationGrid.tileHeight,
      );
      this.cityNpc4.setDirection('east');
      const hackerTile = { x: 27, y: 20 };
      this.hacker = new Actor(
        scene,
        'hacker',
        navigationGrid.origin.x + (hackerTile.x + 0.5) * navigationGrid.tileWidth,
        navigationGrid.origin.y + (hackerTile.y + 0.5) * navigationGrid.tileHeight,
      );
    }
    if (collisionLayer && tileSize) {
      const origin = collisionLayer.tileToWorldXY(0, 0);
      const computerTiles = [20, 21, 23, 24];
      this.underComputers = computerTiles.map((tileX) => {
        const computer = new Actor(
          scene,
          'computer',
          origin.x + (tileX + 0.5) * tileSize.width,
          origin.y + (2 + 0.5) * tileSize.height,
        );
        computer.setDirection('south');
        computer.sprite.setVisible(false);
        return computer;
      });
      this.underHackers = [20, 21, 24].map((tileX) => {
        const npc = new Actor(
          scene,
          'hacker',
          origin.x + (tileX + 0.5) * tileSize.width,
          origin.y + (3 + 0.5) * tileSize.height,
        );
        npc.setDirection('north');
        npc.sprite.setVisible(false);
        return npc;
      });
      this.underNpc3s = [
        { x: 6, y: 3 },
        { x: 10, y: 3 },
        { x: 8, y: 4 },
        { x: 5, y: 3 },
        { x: 7, y: 3 },
        { x: 9, y: 3 },
        { x: 11, y: 3 },
        { x: 5, y: 4 },
        { x: 6, y: 4 },
        { x: 7, y: 4 },
        { x: 9, y: 4 },
        { x: 10, y: 4 },
        { x: 11, y: 4 },
        { x: 6.2, y: 4.7, loose: true },
        { x: 6.7, y: 5.1, loose: true },
        { x: 7.4, y: 4.8, loose: true },
        { x: 8.1, y: 5.2, loose: true },
        { x: 8.9, y: 4.7, loose: true },
        { x: 9.4, y: 5.1, loose: true },
        { x: 9.8, y: 4.8, loose: true },
        { x: 7, y: 5.4, loose: true },
        { x: 8.4, y: 5.6, loose: true },
        { x: 9.2, y: 5.4, loose: true },
        { x: 5.8, y: 5.3, loose: true },
        { x: 6.5, y: 5.8, loose: true },
        { x: 7.3, y: 5.6, loose: true },
        { x: 8.1, y: 5.9, loose: true },
        { x: 9, y: 5.7, loose: true },
        { x: 9.8, y: 5.9, loose: true },
        { x: 6.2, y: 6.4, loose: true },
        { x: 7.5, y: 6.5, loose: true },
        { x: 8.8, y: 6.3, loose: true },
        { x: 10, y: 6.4, loose: true },
        { x: 6.1, y: 6.8, loose: true },
        { x: 7.2, y: 6.9, loose: true },
        { x: 8.3, y: 6.8, loose: true },
        { x: 9.4, y: 6.9, loose: true },
        { x: 10.1, y: 6.7, loose: true },
        { x: 5.8, y: 7.3, loose: true },
        { x: 6.9, y: 7.4, loose: true },
        { x: 8.1, y: 7.2, loose: true },
        { x: 9.2, y: 7.4, loose: true },
        { x: 10.2, y: 7.3, loose: true },
      ].map(({ x, y, loose = false }) => {
        const offsetX = loose ? (Math.random() - 0.5) * tileSize.width * 0.7 : 0;
        const offsetY = loose ? (Math.random() - 0.5) * tileSize.height * 0.7 : 0;
        const npc = new Actor(
          scene,
          'npc3',
          origin.x + (x + 0.5) * tileSize.width + offsetX,
          origin.y + (y + 0.5) * tileSize.height + offsetY,
        );
        npc.setDirection(UNDER_NPC3_SPIN_DIRECTIONS[0]);
        npc.sprite.setVisible(false);
        return npc;
      });
      this._underNpc3DirectionSteps = this.underNpc3s.map((_, index) => (
        index >= 3 && index % 2 === 1 ? -1 : 1
      ));
      this.underDjNpc3 = new Actor(
        scene,
        'npc3',
        origin.x + (8 + 0.5) * tileSize.width,
        origin.y + (2 + 0.5) * tileSize.height,
      );
      this.underDjNpc3.setDirection('south');
      this.underDjNpc3.sprite.setVisible(false);
      this.underCommunityHacker = new Actor(
        scene,
        'hacker',
        origin.x + (22 + 0.5) * tileSize.width,
        origin.y + (4 + 0.5) * tileSize.height,
      );
      this.underCommunityHacker.sprite.setVisible(false);
      const interactiveComputerX = origin.x + (23 + 0.5) * tileSize.width;
      const interactionY = origin.y + (3 + 0.2) * tileSize.height;
      this.underComputerAccess = new InteractiveObject(scene, interactiveComputerX, interactionY, {
        width: tileSize.width * 1.5,
        height: tileSize.height,
        label: '[E] use computer',
        onInteract: () => {
          if (QuestManager.isQuestActive(LEARN_HACKING_QUEST_ID)) {
            const quest = QuestManager.getQuest(LEARN_HACKING_QUEST_ID);
            const reachObjective = quest?.objectives.find(
              (objective) => objective.id === 'reach_training_computer',
            );
            if (reachObjective && !reachObjective.done) {
              QuestManager.completeObjective(
                LEARN_HACKING_QUEST_ID,
                'reach_training_computer',
              );
            }
          }
          QuestManager.triggerInteract(UNDER_TRAINING_COMPUTER_TARGET_ID);
          this.engine.screenManager.push('terminal');
        },
      });
      this.underComputerAccess.showPrompt(false);
    }
    // NPC Louisa removed per request — this used to be an `Actor(scene, 'louisa', ...)` spawned
    // here. Left out entirely rather than just hidden, since she's no longer wanted in the scene.
    this.teacher = new Actor(scene, 'teach', spawnX - 120, spawnY + 40);
    // "teach" is cutscene-only: present in the scene (keeps colliding/updating normally) but
    // invisible until a cutscene explicitly shows it with `this.teacher.sprite.setVisible(true)`.
    this.teacher.sprite.setVisible(false);

    // "Get to work" cutscene state (see `_playWorkCutscene`). `_cutsceneActive` is checked at the
    // top of `onUpdate`/`onInput` to fully freeze normal gameplay (movement, prompts, the pause
    // menu, etc.) while a cutscene is playing; `_cutsceneActors` are the cutscene's own stand-in
    // Actors (not `this.actor`/`this.cat`), updated every frame so their animations advance even
    // though normal `onUpdate` is short-circuited.
    this._cutsceneActive = false;
    this._cutsceneActors = [];
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
      else if (id === WORK_QUEST_ID) this._playWorkCutscene();
      else if (id === LOCAL_HELP_QUEST_IDS[0]) QuestManager.assignQuest(LOCAL_HELP_QUEST_IDS[1]);
      else if (id === LOCAL_HELP_QUEST_IDS[1]) QuestManager.assignQuest(LOCAL_HELP_QUEST_IDS[2]);
      else if (id === LOCAL_HELP_QUEST_IDS[2]) QuestManager.assignQuest(FIND_SUB_QUEST_ID);
      else if (id === FIND_SUB_QUEST_ID) QuestManager.assignQuest(UNDERGROUND_HACKER_QUEST_ID);
      else if (id === UNDERGROUND_HACKER_QUEST_ID) QuestManager.assignQuest(LEARN_HACKING_QUEST_ID);
      else if (id === LEARN_HACKING_QUEST_ID) QuestManager.assignQuest(HACKER_MISSION_QUEST_ID);
      // hacker_final_mission's own completion (inside the terminal) assigns FIND_PRISON_QUEST_ID
      // directly — see TerminalScreenController's `_onMissionQuestCompleted` — so it's not
      // chained here too.

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
    if (this._cutsceneActive) {
      // Everything about the cutscene's blocking/pacing (positions, turns, dialogue timing) is
      // driven by the tween/delayedCall chain `_playWorkCutscene` sets up, not by per-frame logic
      // here — the only thing that still needs a frame tick is each stand-in Actor's own
      // animation advance (walk-cycle frames etc.), same as `this.actor.update(...)` below.
      for (const cutsceneActor of this._cutsceneActors) cutsceneActor.update(time, delta);
      return;
    }

    // Full map open: feet planted (same reasoning as mid-punch) so the player doesn't wander
    // off-screen while looking at the map; everything else (HUD, quest tracking, fx) keeps going.
    if (this.mapOverlay?.isOpen) {
      this.actor.sprite.body.setVelocity(0, 0); // feet planted — see movement note on MODE_FIGHT below
      this.actor.playState('idle');
    } else if (
      this._npc3ConversationActive
      || this._npc4ConversationActive
      || this._prisonConversationActive
      || this._hackerConversationActive
      || this._underCommunityHackerConversationActive
    ) {
      this.actor.sprite.body.setVelocity(0, 0);
      this.actor.playState('idle');
    } else if (this.mode === MODE_FIGHT) {
      this._updateFightMode(delta);
    } else {
      this._updateNormalMode(delta);
    }

    this._syncActorOrigin();
    this.actor.update(time, delta);
    this.cat.update(time, delta);
    if (this._currentArea === 'city') {
      for (const npc of this.cityNpcs) npc.update(time, delta);
      this._updateCityNpcSpawns(delta);
      for (const group of this.citySoldierGroups) group.update(time, delta);
      this.cityNpc3?.update(time, delta);
      this.cityNpc4?.update(time, delta);
      if (this.hacker) {
        this._trackPlayerWithHacker();
        this.hacker.update(time, delta);
      }
    }
    if (this._currentArea === 'under') {
      for (const computer of this.underComputers) computer.update(time, delta);
      for (const npc of this.underHackers) npc.update(time, delta);
      this._updateUnderNpc3s(time, delta);
      this.underDjNpc3?.update(time, delta);
      this._trackPlayerWithUnderCommunityHacker();
      this.underCommunityHacker?.update(time, delta);
      this._updateUnderDjLights(delta);
    }
    this.teacher.update(time, delta);
    this._keepCatOffPlayer();
    this._sortWorldEntities();
    this._checkPortalTransition();
    if (this.isTransitioning) return;

    for (const droppedItem of this.droppedItems) {
      droppedItem.object.showPrompt(
        this.mode === MODE_NORMAL && isWithinRadius(this.actor.sprite, droppedItem.object.zone, PICKUP_RADIUS),
      );
    }
    this.underComputerAccess?.showPrompt(
      this._currentArea === 'under'
      && this.mode === MODE_NORMAL
      && isWithinRadius(this.actor.sprite, this.underComputerAccess.zone, PICKUP_RADIUS),
    );

    // "Getting somewhere" quest progress: fed every frame, same way LoopManager/FxManager usage
    // below is — QuestManager itself does the cheap no-op check when nothing's listening.
    this._tryStartNpc3Conversation();
    this._tryStartNpc4Conversation();
    this._tryStartPrisonConversation();
    this._tryStartHackerConversation();
    this._tryStartUnderCommunityHackerConversation();
    QuestManager.reportLocation('world', this.actor.sprite.x, this.actor.sprite.y);
    const trackedQuest = QuestManager.getTrackedQuest();
    const trackedLocation = trackedQuest?.objectives.find((objective) => (
      objective.type === 'reach_location'
      && objective.screenId === 'world'
      && !objective.done
      && Number.isFinite(objective.x)
      && Number.isFinite(objective.y)
    ));
    if (trackedQuest?.id === FIND_PRISON_QUEST_ID && this._currentArea === 'under') {
      this.mapOverlay?.setTarget(null, { questionMark: true });
    } else if (trackedQuest?.id === FIND_PRISON_QUEST_ID && this._currentArea === 'city' && this.cityNpc4) {
      this.mapOverlay?.setTarget({ x: this.cityNpc4.sprite.x, y: this.cityNpc4.sprite.y });
    } else if (trackedQuest?.id === FIND_SUB_QUEST_ID && this.mapSize) {
      const tileSize = this.background?.getTileSize?.();
      this.mapOverlay?.setTarget(tileSize ? {
        x: (CITY_PORTAL_TILE.x + 0.5) * tileSize.width,
        y: (CITY_PORTAL_TILE.y + 0.5) * tileSize.height,
      } : null);
    } else if (trackedQuest?.id === UNDERGROUND_HACKER_QUEST_ID) {
      this.mapOverlay?.setTarget(null, { questionMark: true });
    } else {
      this.mapOverlay?.setTarget(trackedLocation ? { x: trackedLocation.x, y: trackedLocation.y } : null);
    }

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
    const tileX = Math.floor(body.center.x / tileSize.width);
    const tileY = Math.floor(body.center.y / tileSize.height);

    if (this._currentArea === 'city') {
      const atTurretDoor = TURRET_DOOR_TILES.some((tile) => (
        Phaser.Math.Distance.Between(
          body.center.x,
          body.center.y,
          (tile.x + 0.5) * tileSize.width,
          (tile.y + 0.5) * tileSize.height,
        ) <= tileSize.width * 0.75
      ));
      if (!atTurretDoor) this._turretDoorLocked = false;
      else if (!this._turretDoorLocked) {
        this._turretDoorLocked = true;
        if (QuestManager.isQuestActive(FIND_PRISON_QUEST_ID)) {
          this._transitionToArea('prison');
        } else {
          QuestManager.resetAll();
          this._showRespawnMessage('you were shot by automatic turret', 2200);
        }
        return;
      }

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
    if (this._underExitArmed && body.right >= this.mapSize.width) {
      QuestManager.resetAll();
      this._showRespawnMessage('a massive rat has eaten you', 2200);
      return;
    }
    if (
      QuestManager.isQuestActive(UNDERGROUND_HACKER_QUEST_ID)
      && tileY === 5
      && tileX >= 21
      && tileX <= 23
    ) {
      this._tryStartUnderCommunityHackerConversation();
    }
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
    ).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.FX_OVERLAY + 8).setAlpha(0);
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
   * @param {'city'|'under'|'prison'} area
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
    ).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.FX_OVERLAY + 8).setAlpha(0);
    this._portalTransitionOverlay = overlay;
    scene.tweens.add({
      targets: overlay,
      alpha: 1,
      duration: PORTAL_FADE_MS,
      onComplete: () => {
        try {
          this._replaceBackground(area);
          const tileSize = this.background.getTileSize();
          const x = area === 'prison'
            ? INTERNAL_WIDTH / 2
            : (area === 'under' ? UNDER_ARRIVAL_TILE : CITY_PORTAL_TILE).x * tileSize.width
              + tileSize.width / 2;
          const y = area === 'prison'
            ? INTERNAL_HEIGHT
            : (area === 'under' ? UNDER_ARRIVAL_TILE : CITY_PORTAL_TILE).y * tileSize.height
              + tileSize.height / 2;
          this.actor.sprite.setPosition(x, y);
          this.actor.sprite.body.reset(x, y);
          this.actor.sprite.body.setVelocity(0, 0);

          if (area !== 'prison') {
            const catX = Math.min(this.mapSize.width - 1, x + 24);
            const catY = Math.min(this.mapSize.height - 1, y + 10);
            this.cat.teleport(catX, catY);
          }
          this._cityPortalLocked = area === 'city';
          this._underExitArmed = false;
          if (area === 'under' && QuestManager.isQuestActive(FIND_SUB_QUEST_ID)) {
            QuestManager.completeObjective(FIND_SUB_QUEST_ID, 'enter_sub');
          } else if (area === 'prison' && QuestManager.isQuestActive(FIND_PRISON_QUEST_ID)) {
            QuestManager.completeObjective(FIND_PRISON_QUEST_ID, 'locate_provisional_prison');
          }
          this._sortWorldEntities();
          if (area === 'prison') this._playPrisonCutscene();
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
   * Dev-panel shortcut into the underworld, using the normal area transition.
   * @returns {void}
   */
  teleportToUnderworld() {
    if (this._currentArea !== 'city' || this.isTransitioning) return;
    this._transitionToArea('under');
  }

  /**
   * Dev-panel shortcut into the prison encounter, bypassing its story/quest gates.
   * @returns {void}
   */
  teleportToPrison() {
    if (this.isTransitioning || this._currentArea === 'prison') return;
    this._transitionToArea('prison');
  }

  /**
   * Plays the prison arrival as a locked, screen-space cutscene over the prison image.
   * @private
   * @returns {void}
   */
  _playPrisonCutscene() {
    if (this._cutsceneActive) return;
    const { scene } = this.engine;
    const centerX = INTERNAL_WIDTH / 2;
    this._cutsceneActive = true;

    this.actor.sprite.body.setVelocity(0, 0);
    this.actor.playState('idle');
    this.actor.sprite.setVisible(false);
    this.actor.sprite.body.enable = false;
    this.cat.sprite.body.setVelocity(0, 0);
    this.cat.sprite.setVisible(false);
    this.cat.sprite.body.enable = false;
    this.modeLabel.setText('CUTSCENE').setColor('#8aa8ff');

    scene.cameras.main.stopFollow();
    scene.cameras.main.setScroll(0, 0);
    scene.cameras.main.setBounds(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);

    const bg = scene.add.image(centerX, INTERNAL_HEIGHT / 2, 'prison:layer:0')
      .setScrollFactor(0)
      .setDepth(DEPTH.FX_OVERLAY);
    bg.setScale(Math.max(INTERNAL_WIDTH / bg.width, INTERNAL_HEIGHT / bg.height));

    const fade = scene.add.rectangle(
      centerX,
      INTERNAL_HEIGHT / 2,
      INTERNAL_WIDTH + 2,
      INTERNAL_HEIGHT + 2,
      0x000000,
    ).setScrollFactor(0).setDepth(DEPTH.FX_OVERLAY + 3).setAlpha(1);

    const makeStandIn = (spriteId, x, y, scale, direction) => {
      const actor = new Actor(scene, spriteId, x, y);
      actor.sprite.body.enable = false;
      actor.sprite.setCollideWorldBounds(false);
      actor.sprite.setScrollFactor(0);
      actor.sprite.setDepth(DEPTH.FX_OVERLAY + 1);
      actor.sprite.setScale(scale);
      actor.setDirection(direction);
      return actor;
    };

    const soldierLeft = makeStandIn('soldier', centerX - 68, 78, 1.4, 'east');
    const louisa = makeStandIn('louisa', centerX, 78, 1.4, 'north');
    const soldierRight = makeStandIn('soldier', centerX + 68, 78, 1.4, 'west');
    const mainChar = makeStandIn('main_char', centerX - 120, INTERNAL_HEIGHT + 40, 3, 'north-east');
    this._cutsceneActors = [mainChar, louisa, soldierLeft, soldierRight];

    const delayedCalls = [];
    this._cutsceneHandles = { bg, fade, delayedCalls };
    const delay = (duration, callback) => {
      delayedCalls.push(scene.time.delayedCall(duration, callback));
    };
    const moveDuration = 1500;

    scene.tweens.add({
      targets: fade,
      alpha: 0,
      duration: PORTAL_FADE_MS,
      onComplete: () => {
        mainChar.setDirectionFromVector(120, -150, 'walk');
        scene.tweens.add({
          targets: mainChar.sprite,
          x: centerX,
          y: INTERNAL_HEIGHT * 0.58,
          scaleX: 2,
          scaleY: 2,
          duration: moveDuration,
          onComplete: () => {
            mainChar.setDirection('north');
            mainChar.playState('idle');
            delay(350, () => {
              soldierLeft.setDirection('south-east');
              soldierRight.setDirection('south-west');
            });
          },
        });
      },
    });
  }

  /**
   * Plays the first cutscene from the dev panel without completing its quest.
   * @returns {void}
   */
  playCutscene1() {
    this._playWorkCutscene();
  }

  /**
   * Replaces the active background and refreshes all map-bound world systems.
   * @private
   * @param {'city'|'under'|'prison'} area
   * @returns {void}
   */
  _replaceBackground(area) {
    const { scene } = this.engine;
    const nextBackground = BackgroundLoader.build(scene, area);
    this.underCar?.destroy();
    this.underCar = null;
    this.underDjPult?.destroy();
    this.underDjPult = null;
    this.underDjLights?.destroy();
    this.underDjLights = null;
    for (const collider of this._mapColliders) scene.physics.world.removeCollider(collider);
    this._mapColliders.length = 0;

    // City-only NPC wanderers/soldiers collide against the CITY tilemap layer specifically, not
    // whatever `this._mapColliders` above points at. That layer is about to be destroyed below
    // (`previousBackground?.destroy()`), so any collider still referencing it would try to read
    // tile metrics off a dead layer next physics step and throw ("Cannot read properties of
    // undefined (reading 'tileWidth')"). Tear them down unconditionally here; they're rebuilt
    // further down only if we're (re-)entering the city.
    for (const collider of this.cityNpcColliders) scene.physics.world.removeCollider(collider);
    this.cityNpcColliders.length = 0;
    if (area !== 'city') {
      // No NPCs/soldiers in the underworld: hide and fully stop every wanderer (and reset it
      // back to its pre-spawn state so it re-enters the normal spawn queue, rather than popping
      // back in mid-route) so they come back naturally once the player returns to the city.
      for (const npc of this.cityNpcs) npc.reset();
      this.cityNpcSpawnQueue = [...this.cityNpcs];
      this.cityNpcScheduled = new Set(this.cityNpcSpawnQueue);
      for (const group of this.citySoldierGroups) group.setVisible(false);
      this.cityNpc3?.sprite.setVisible(false);
      this.cityNpc4?.sprite.setVisible(false);
      this.hacker?.sprite.setVisible(false);
      for (const computer of this.underComputers) computer.sprite.setVisible(area === 'under');
      for (const npc of this.underHackers) npc.sprite.setVisible(area === 'under');
      for (const npc of this.underNpc3s) npc.sprite.setVisible(area === 'under');
      this.underDjNpc3?.sprite.setVisible(area === 'under');
      this.underCommunityHacker?.sprite.setVisible(area === 'under');
    } else {
      for (const group of this.citySoldierGroups) group.setVisible(true);
      this.cityNpc3?.sprite.setVisible(true);
      this.cityNpc4?.sprite.setVisible(true);
      this.hacker?.sprite.setVisible(true);
      for (const computer of this.underComputers) computer.sprite.setVisible(false);
      for (const npc of this.underHackers) npc.sprite.setVisible(false);
      for (const npc of this.underNpc3s) npc.sprite.setVisible(false);
      this.underDjNpc3?.sprite.setVisible(false);
      this.underCommunityHacker?.sprite.setVisible(false);
    }
    this.underComputerAccess?.showPrompt(false);

    this.mapOverlay?.destroy();
    this.mapOverlay = null;
    const previousBackground = this.background;
    this.background = nextBackground;
    previousBackground?.destroy();
    this._backgroundChanged = this.background !== this._originalBackground;
    this._currentArea = area;
    AudioManager.playMusic(area === 'under' ? 'music:underworld' : 'music:gameplay', { loop: true });

    this.mapSize = this.background.getMapSize();
    const collisionLayer = this.background.getCollisionLayer();
    const partialHitboxGroup = this.background.getPartialHitboxGroup();
    if (area === 'under' && collisionLayer) {
      const tileSize = this.background.getTileSize();
      const djTileOrigin = collisionLayer.tileToWorldXY(8, 2);
      const djX = djTileOrigin.x + tileSize.width / 2;
      const djY = djTileOrigin.y + tileSize.height / 2;

      this.underDjPult = scene.add.graphics();
      this.underDjPult.fillStyle(0x17142c, 1);
      this.underDjPult.fillRoundedRect(
        djX - tileSize.width * 0.8,
        djY - tileSize.height * 0.28,
        tileSize.width * 1.6,
        tileSize.height * 0.58,
        5,
      );
      this.underDjPult.lineStyle(2, 0x55eaff, 0.95);
      this.underDjPult.strokeRoundedRect(
        djX - tileSize.width * 0.8,
        djY - tileSize.height * 0.28,
        tileSize.width * 1.6,
        tileSize.height * 0.58,
        5,
      );
      for (const ringX of [djX - tileSize.width * 0.42, djX + tileSize.width * 0.42]) {
        this.underDjPult.lineStyle(2, 0xff4dd2, 1);
        this.underDjPult.strokeCircle(ringX, djY, tileSize.width * 0.24);
        this.underDjPult.lineStyle(2, 0x55eaff, 0.9);
        this.underDjPult.strokeCircle(ringX, djY, tileSize.width * 0.1);
      }
      this.underDjPult.fillStyle(0xffe45e, 1);
      this.underDjPult.fillRect(djX - 5, djY + tileSize.height * 0.14, 10, 3);
      this.underDjLights = scene.add.graphics();
      this.underDjLights.setDepth(DEPTH.WORLD_FOREGROUND - 1);
      this._underDjLightElapsed = 0;
      this._updateUnderDjLights(120);

      const tileOrigin = collisionLayer.tileToWorldXY(15, 3);
      const animationKey = 'under:spinning-cat';
      if (!scene.anims.exists(animationKey)) {
        scene.anims.create({
          key: animationKey,
          frames: scene.anims.generateFrameNumbers('under:spinning-cat-sheet', { start: 0, end: 8 }),
          frameRate: 8,
          repeat: -1,
        });
      }
      this.underCar = scene.add.sprite(
        tileOrigin.x + tileSize.width / 2,
        tileOrigin.y + tileSize.height / 2,
        'under:spinning-cat-sheet',
      );
      this.underCar.setDisplaySize(tileSize.width * 3, tileSize.height * 3);
      this.underCar.play(animationKey);
    }
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
    if (area === 'city' && collisionLayer) {
      for (const npc of this.cityNpcs) {
        this.cityNpcColliders.push(scene.physics.add.collider(npc.sprite, collisionLayer));
        if (partialHitboxGroup) {
          this.cityNpcColliders.push(scene.physics.add.collider(npc.sprite, partialHitboxGroup));
        }
      }
    }
    this.actor.sprite.setCollideWorldBounds(Boolean(this.mapSize));
    this.cat.sprite.setCollideWorldBounds(Boolean(this.mapSize) && area !== 'prison');
    this.cat.sprite.body.enable = area !== 'prison';
    this.cat.sprite.setVisible(area !== 'prison');
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
    // Note: the teacher actor is NOT rebuilt here — it's cutscene-only and stays wherever it was,
    // invisible, regardless of area. City-only NPC wanderers/soldiers ARE handled above/below:
    // hidden + reset while not in the city, and their colliders rebuilt when (re-)entering it.
  }

  /**
   * "Get to work" story beat, played once `WORK_QUEST_ID` completes (see `_onQuestCompleted`).
   * Fullscreen, letterboxed-sidescroller-style cutscene over a static `work.png` backdrop: the
   * player meets Louisa, soldiers arrive and take her away, the player is left behind. Entirely
   * screen-space (every GameObject here is `setScrollFactor(0)`, positioned in INTERNAL_WIDTH/
   * HEIGHT pixel coordinates) — it does not touch the camera or the real world background at all,
   * it just draws on top of everything at `DEPTH.FX_OVERLAY` and above.
   *
   * Uses dedicated throwaway stand-in Actors (`_cutsceneActors`), not `this.actor`/`this.cat` —
   * the real player/cat sprites are hidden + physics-disabled for the duration and restored
   * untouched at the end, at the exact spot the player was standing when the quest completed
   * ("spawn back on location where he appeared").
   * @private
   * @returns {void}
   */
  _playWorkCutscene() {
    if (this._cutsceneActive) return;
    const { scene } = this.engine;
    this._cutsceneActive = true;

    // Freeze + hide the real player/cat. Remembered position is exactly where the cutscene hands
    // control back afterward.
    const returnX = this.actor.sprite.x;
    const returnY = this.actor.sprite.y;
    this.actor.sprite.body.setVelocity(0, 0);
    this.actor.playState('idle');
    this.actor.sprite.setVisible(false);
    this.actor.sprite.body.enable = false;
    this.cat.sprite.body.setVelocity(0, 0);
    this.cat.sprite.setVisible(false);
    this.cat.sprite.body.enable = false;

    const CENTER_X = INTERNAL_WIDTH / 2;
    const GROUND_Y = INTERNAL_HEIGHT;
    const WALK_SPEED_PX_S = 70;
    const FADE_MS = PORTAL_FADE_MS;

    // Visible-art metrics measured directly off each sprite's PNGs — NOT `manifest.frame_size`,
    // which is only a nominal authoring size. main_char/louisa's idle art sits on a tightly
    // cropped 32x32 canvas, but their walk art (and the soldier's only state, idle) is drawn on a
    // roomier 48x48 canvas with a lot of transparent padding baked in above/below the character.
    // Scaling/anchoring off the raw canvas size (what this code used to do) broke two ways:
    //  - the soldier's art only fills ~2/3 of its 48px canvas (vs ~94% for main_char/louisa's
    //    32px canvas), so it rendered visibly smaller than everyone else.
    //  - main_char/louisa ballooned to ~1.5x size and walked with their feet floating above the
    //    ground line while in 'walk' (bigger canvas, same fixed origin), then visibly snapped
    //    down to the correct size/position the instant they went back to 'idle' and the 32px
    //    canvas took over — i.e. exactly the "upper Y then teleport down" symptom.
    // `contentHeight` is how tall the actual (non-transparent) art is; `bottomPad` is how much
    // transparent canvas sits below the feet on that canvas size. Keyed by real frame height (px).
    const CUTSCENE_ART_METRICS = {
      main_char: { 32: { contentHeight: 30, bottomPad: 1 }, 48: { contentHeight: 30, bottomPad: 9 } },
      louisa: { 32: { contentHeight: 30, bottomPad: 1 }, 48: { contentHeight: 30, bottomPad: 9 } },
      soldier: { 48: { contentHeight: 32, bottomPad: 6 } },
    };
    const TARGET_CONTENT_HEIGHT_PX = INTERNAL_HEIGHT / 3;

    /**
     * Rescales `standIn` so its actual art (not its canvas) is `TARGET_CONTENT_HEIGHT_PX` tall,
     * and repositions its origin so its feet land exactly on `groundY` — using the REAL pixel
     * size of whichever frame it's currently showing. Must be re-run any time a stand-in's state
     * (idle vs walk) might have changed its underlying canvas size; see `CUTSCENE_ART_METRICS`.
     */
    const syncGroundAnchor = (standIn, groundY) => {
      const frameHeight = standIn.sprite.frame.height;
      const metrics = CUTSCENE_ART_METRICS[standIn.id]?.[frameHeight];
      if (!metrics) return; // unrecognized canvas size for this sprite — leave as-is rather than guess
      standIn.sprite.setScale(TARGET_CONTENT_HEIGHT_PX / metrics.contentHeight);
      standIn.sprite.setOrigin(0.5, (frameHeight - metrics.bottomPad) / frameHeight);
      standIn.sprite.y = groundY;
    };

    /** Faces `standIn` a direction/state, then re-syncs its scale/ground-anchor for that frame. */
    const turn = (standIn, dx, dy, state) => {
      standIn.setDirectionFromVector(dx, dy, state);
      syncGroundAnchor(standIn, GROUND_Y);
    };

    /** Builds one screen-space, physics-off stand-in Actor for this cutscene. */
    const makeStandIn = (spriteId, x, y) => {
      const standIn = new Actor(scene, spriteId, x, y);
      standIn.sprite.body.enable = false;
      standIn.sprite.setCollideWorldBounds(false);
      standIn.sprite.setScrollFactor(0);
      standIn.sprite.setDepth(DEPTH.FX_OVERLAY + 1);
      syncGroundAnchor(standIn, y);
      return standIn;
    };

    const mainChar = makeStandIn('main_char', -60, GROUND_Y);
    const louisa = makeStandIn('louisa', CENTER_X, GROUND_Y);
    const soldierLeft = makeStandIn('soldier', INTERNAL_WIDTH + 60, GROUND_Y);
    const soldierRight = makeStandIn('soldier', INTERNAL_WIDTH + 130, GROUND_Y);
    turn(louisa, -1, 0, 'idle'); // watching west, toward where the player enters
    this._cutsceneActors = [mainChar, louisa, soldierLeft, soldierRight];

    const mainCharStopX = CENTER_X - 155; // leave a wide visible gap before Louisa at double scale
    const soldierLeftStopX = CENTER_X + 145; // nearer pair member — ends up "the soldier on the left"
    const soldierRightStopX = CENTER_X + 260;
    const betweenStopX = (mainCharStopX + CENTER_X) / 2; // where soldierLeft steps in to separate them
    const exitX = INTERNAL_WIDTH + 90;

    // `moveState` defaults to 'walk' but falls back to 'idle' for any actor whose manifest has no
    // walk animation at all (none left in this cutscene — "soldier" now has one too — but this
    // keeps `walkTween` safe for a future stand-in that's idle-only; `Actor.playState`/
    // `setDirectionFromVector` throw for a state the manifest doesn't have).
    const walkTween = (standIn, toX, onComplete, moveState = standIn.manifest.states.walk ? 'walk' : 'idle') => {
      const distance = Math.abs(toX - standIn.sprite.x);
      const direction = toX >= standIn.sprite.x ? 1 : -1;
      turn(standIn, direction, 0, moveState);
      scene.tweens.add({
        targets: standIn.sprite,
        x: toX,
        duration: Math.max(1, (distance / WALK_SPEED_PX_S) * 1000),
        onComplete: () => {
          turn(standIn, direction, 0, 'idle');
          onComplete?.();
        },
      });
    };

    /** Speech bubble anchored above a stand-in's current head position. */
    const say = (standIn, text, holdMs, onDone) => {
      createSpeechBubble(
        scene,
        standIn.sprite.x,
        standIn.sprite.y - TARGET_CONTENT_HEIGHT_PX - 4,
        text,
        { holdMs, onDestroy: onDone, keepInView: true },
      );
    };

    // Fullscreen backdrop, drawn to COVER the whole screen (crop any overflow) rather than the
    // letterboxed "contain" fit `BackgroundLoader`'s own 'static' branch uses — this has to fully
    // blot out the GUI/world underneath with no gaps, not just sit inside the frame.
    const bg = scene.add.image(CENTER_X, INTERNAL_HEIGHT / 2, 'work:layer:0')
      .setScrollFactor(0).setDepth(DEPTH.FX_OVERLAY);
    bg.setScale(Math.max(INTERNAL_WIDTH / bg.width, INTERNAL_HEIGHT / bg.height));

    const fade = scene.add.rectangle(CENTER_X, INTERNAL_HEIGHT / 2, INTERNAL_WIDTH + 2, INTERNAL_HEIGHT + 2, 0x000000)
      .setScrollFactor(0).setDepth(DEPTH.FX_OVERLAY + 3).setAlpha(1);

    this._cutsceneHandles = { bg, fade, mainChar, louisa, soldierLeft, soldierRight };

    // --- Timeline -----------------------------------------------------------------------------
    scene.tweens.add({
      targets: fade,
      alpha: 0,
      duration: FADE_MS,
      onComplete: () => {
        // Step 1: player walks in from the left border, eye-to-eye with Louisa.
        walkTween(mainChar, mainCharStopX, () => {
          scene.time.delayedCall(250, () => {
            // Step 2: both say "Hi".
            say(mainChar, 'Hi!', 1200);
            say(louisa, 'Hi!', 1200, () => {
              scene.time.delayedCall(250, () => {
                // Step 3: two soldiers arrive from the right border, looking west.
                let arrived = 0;
                const onSoldierArrived = () => {
                  arrived += 1;
                  if (arrived < 2) return;
                  scene.time.delayedCall(300, () => {
                    // Step 4: Louisa turns (in place) to face the soldiers.
                    turn(louisa, 1, 0, 'idle');
                    scene.time.delayedCall(400, () => {
                      // Step 5: soldier delivers the line.
                      say(soldierLeft, "You have to come with us.\nYou're not good for the system.", 2600, () => {
                        scene.time.delayedCall(200, () => {
                          // Step 6: the nearer soldier steps between Louisa and the player.
                          walkTween(soldierLeft, betweenStopX, () => {
                            scene.time.delayedCall(250, () => {
                              // Step 7: Louisa + both soldiers turn east and walk out the right border.
                              turn(louisa, 1, 0, 'idle');
                              turn(soldierRight, 1, 0, 'idle');
                              let exited = 0;
                              const onExited = () => {
                                exited += 1;
                                if (exited < 3) return;
                                louisa.sprite.setVisible(false);
                                soldierLeft.sprite.setVisible(false);
                                soldierRight.sprite.setVisible(false);
                                scene.time.delayedCall(300, () => {
                                  // Step 8: the player's final line, then end the cutscene.
                                  say(
                                    mainChar,
                                    'No, this shouldn\u2019t have happened.\nShe is my friend.\nI hate this system.\nI must save her somehow.',
                                    3400,
                                    () => this._endWorkCutscene(fade, returnX, returnY),
                                  );
                                });
                              };
                              walkTween(louisa, exitX, onExited);
                              walkTween(soldierLeft, exitX, onExited);
                              walkTween(soldierRight, exitX, onExited);
                            });
                          });
                        });
                      });
                    });
                  });
                };
                walkTween(soldierLeft, soldierLeftStopX, onSoldierArrived);
                walkTween(soldierRight, soldierRightStopX, onSoldierArrived);
              });
            });
          });
        });
      },
    });
  }

  /**
   * Fades the "get to work" cutscene out, tears down every cutscene-only GameObject, and hands
   * control back to the player at the exact spot they were at when the cutscene started.
   * @private
   * @param {Phaser.GameObjects.Rectangle} fade - the cutscene's own fade overlay, reused for the
   *   fade-out (so there's one continuous black hold instead of a visible flash between overlays)
   * @param {number} returnX
   * @param {number} returnY
   * @returns {void}
   */
  _endWorkCutscene(fade, returnX, returnY) {
    const { scene } = this.engine;
    scene.tweens.add({
      targets: fade,
      alpha: 1,
      duration: PORTAL_FADE_MS,
      onComplete: () => {
        this._destroyCutscene();
        this.actor.sprite.setPosition(returnX, returnY);
        this.actor.sprite.body.reset(returnX, returnY);
        this.actor.sprite.body.enable = true;
        this.actor.sprite.setVisible(true);
        this.actor.playState('idle');

        const catX = Math.min(this.mapSize?.width ?? INTERNAL_WIDTH, returnX + 24);
        const catY = Math.min(this.mapSize?.height ?? INTERNAL_HEIGHT, returnY + 10);
        this.cat.sprite.body.enable = true;
        this.cat.sprite.setVisible(true);
        this.cat.teleport(catX, catY);

        this._cutsceneActive = false;
        QuestManager.assignQuest(LOCAL_HELP_QUEST_IDS[0]);

        const revealFade = scene.add.rectangle(
          INTERNAL_WIDTH / 2, INTERNAL_HEIGHT / 2, INTERNAL_WIDTH + 2, INTERNAL_HEIGHT + 2, 0x000000,
        ).setScrollFactor(0).setDepth(DEPTH.FX_OVERLAY + 3).setAlpha(1);
        scene.tweens.add({
          targets: revealFade,
          alpha: 0,
          duration: PORTAL_FADE_MS,
          onComplete: () => revealFade.destroy(),
        });
      },
    });
  }

  /**
   * Tears down every GameObject/tween/timer the work cutscene created, if any. Idempotent — safe
   * to call whether or not a cutscene is currently active (used both at the cutscene's own normal
   * end and from `onExit`, in case the screen is torn down mid-cutscene).
   * @private
   * @returns {void}
   */
  _destroyCutscene() {
    for (const cutsceneActor of this._cutsceneActors) {
      this.engine.scene.tweens.killTweensOf(cutsceneActor.sprite);
      cutsceneActor.sprite.destroy();
    }
    this._cutsceneActors = [];
    if (this._cutsceneHandles) {
      this.engine.scene.tweens.killTweensOf(this._cutsceneHandles.fade);
      for (const delayedCall of this._cutsceneHandles.delayedCalls ?? []) {
        delayedCall.remove(false);
      }
      this._cutsceneHandles.bg.destroy();
      this._cutsceneHandles.fade?.destroy();
      this._cutsceneHandles = null;
    }
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
      ...this.citySoldierGroups.flatMap((group) => group.actors.map((actor) => actor.sprite)),
      ...(this.cityNpc3 ? [this.cityNpc3.sprite] : []),
      ...(this.cityNpc4 ? [this.cityNpc4.sprite] : []),
      ...(this.hacker ? [this.hacker.sprite] : []),
      ...this.underComputers.map((computer) => computer.sprite),
      ...this.underHackers.map((npc) => npc.sprite),
      ...this.underNpc3s.map((npc) => npc.sprite),
      ...(this.underDjNpc3 ? [this.underDjNpc3.sprite] : []),
      ...(this.underCommunityHacker ? [this.underCommunityHacker.sprite] : []),
      ...(this.underCar ? [this.underCar] : []),
      this.teacher.sprite,
      ...this.droppedItems.flatMap(({ visual, icon, countLabel }) => [visual, icon, countLabel]),
    ];

    for (const object of sortables) {
      const groundY = object.body?.bottom ?? object.getBounds().bottom;
      const normalizedY = Math.max(0, Math.min(1, groundY / mapHeight));
      const depth = DEPTH.WORLD_ENTITIES + normalizedY * WORLD_Y_SORT_DEPTH_RANGE;
      if (object.depth !== depth) object.setDepth(depth);
    }
    if (this.underDjPult && this.underDjNpc3) {
      this.underDjPult.setDepth(this.underDjNpc3.sprite.depth - 0.01);
    }

  }

  /**
   * Turns each underworld NPC3 through all eight directions once every 1.8 seconds.
   * @param {number} time
   * @param {number} delta
   * @returns {void}
   */
  _updateUnderNpc3s(time, delta) {
    this._underNpc3DirectionElapsed += delta;
    while (this._underNpc3DirectionElapsed >= UNDER_NPC3_DIRECTION_DURATION_MS) {
      this._underNpc3DirectionElapsed -= UNDER_NPC3_DIRECTION_DURATION_MS;
      this._underNpc3DirectionIndex = (
        this._underNpc3DirectionIndex + 1
      ) % UNDER_NPC3_SPIN_DIRECTIONS.length;
      this.underNpc3s.forEach((npc, index) => {
        const directionIndex = (
          this._underNpc3DirectionIndex * this._underNpc3DirectionSteps[index]
          + UNDER_NPC3_SPIN_DIRECTIONS.length
        ) % UNDER_NPC3_SPIN_DIRECTIONS.length;
        npc.setDirection(UNDER_NPC3_SPIN_DIRECTIONS[directionIndex]);
      });
    }
    for (const npc of this.underNpc3s) npc.update(time, delta);
  }

  /**
   * Draws a shifting set of bright RGB rings around the underworld DJ console.
   * @param {number} delta
   * @returns {void}
   */
  _updateUnderDjLights(delta) {
    if (!this.underDjLights || !this.underDjPult) return;
    this._underDjLightElapsed += delta;
    if (this._underDjLightElapsed < 120) return;
    this._underDjLightElapsed %= 120;

    const tileSize = this.background.getTileSize();
    const origin = this.background.getCollisionLayer().tileToWorldXY(8, 2);
    const centerX = origin.x + tileSize.width / 2;
    const centerY = origin.y + tileSize.height * 2.5;
    const colors = [0xff1744, 0x00f5ff, 0xffea00, 0xff00e5, 0x44ff00, 0xffffff];
    this.underDjLights.clear();
    for (let i = 0; i < 6; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.random() * tileSize.width * 2;
      const radius = tileSize.width * (0.18 + Math.random() * 0.45);
      const x = centerX + Math.cos(angle) * distance;
      const y = centerY + Math.sin(angle) * distance;
      this.underDjLights.lineStyle(3, colors[Math.floor(Math.random() * colors.length)], 0.95);
      this.underDjLights.strokeCircle(x, y, radius);
    }
  }

  /**
   * Randomizes walker entries and respawns while limiting the number visible at once.
   * @private
   * @param {number} delta
   * @returns {void}
   */
  _updateCityNpcSpawns(delta) {
    for (const npc of this.cityNpcs) {
      if (npc.hidden && !this.cityNpcScheduled.has(npc)) {
        this.cityNpcSpawnQueue.push(npc);
        this.cityNpcScheduled.add(npc);
      }
    }

    const activeCount = this.cityNpcs.filter((npc) => !npc.hidden).length;
    if (activeCount >= MAX_ACTIVE_CITY_WANDERERS || this.cityNpcSpawnQueue.length === 0) return;

    this.cityNpcSpawnTimer -= delta;
    if (this.cityNpcSpawnTimer > 0) return;

    const index = Math.floor(Math.random() * this.cityNpcSpawnQueue.length);
    const [npc] = this.cityNpcSpawnQueue.splice(index, 1);
    this.cityNpcScheduled.delete(npc);
    npc.spawn();
    this.cityNpcSpawnTimer = CITY_NPC_SPAWN_GAP_MIN_MS + Math.random() * CITY_NPC_SPAWN_GAP_RANDOM_MS;
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
   * every frame. That's why walls and the cat never actually stopped the player even once their
   * colliders were registered: Arcade's collision separation runs as part of
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
    const scale = this._currentArea === 'prison' ? this.actor.sprite.scaleX : 1;
    const originX = this.actor.sprite.x + hand.x * scale;
    const originY = this.actor.sprite.y + hand.y * scale;
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
   * Starts the one-time exchange with NPC3 when the first local-help quest is active.
   * @private
   * @returns {void}
   */
  _tryStartNpc3Conversation() {
    if (
      this._currentArea !== 'city'
      || !this.cityNpc3
      || this._npc3ConversationActive
      || this._npc3ConversationComplete
      || !QuestManager.isQuestActive(LOCAL_HELP_QUEST_IDS[0])
      || !isWithinRadius(this.actor.sprite, this.cityNpc3.sprite, 18)
    ) return;

    this._npc3ConversationActive = true;
    this.actor.sprite.body.setVelocity(0, 0);
    this.actor.playState('idle');

    const dx = this.actor.sprite.x - this.cityNpc3.sprite.x;
    const dy = this.actor.sprite.y - this.cityNpc3.sprite.y;
    if (dx === 0 && dy === 0) {
      this.cityNpc3.setDirection('south');
      this.actor.setDirection('north');
    } else {
      this.cityNpc3.setDirectionFromVector(dx, dy, 'idle');
      this.actor.setDirectionFromVector(-dx, -dy, 'idle');
    }

    this._showLocalConversationLine(this.cityNpc3, 'What do you want?', 1400, () => {
      this._showLocalConversationLine(
        this.actor,
        'Do you know where the soldiers took Louisa?',
        2100,
        () => {
          this.cityNpc3.setDirection('south-west');
          this._showLocalConversationLine(this.cityNpc3, '[...]', 1800, () => {
            this._npc3ConversationComplete = true;
            this._npc3ConversationActive = false;
          });
        },
      );
    });
  }

  /**
   * Shows one world-anchored NPC conversation line and advances after it is dismissed.
   * @private
   * @param {Actor} speaker
   * @param {string} text
   * @param {number} duration
   * @param {() => void} onDone
   * @returns {void}
   */
  _showLocalConversationLine(speaker, text, duration, onDone) {
    const { scene } = this.engine;
    this._localConversationBubble?.destroy();
    this._localConversationBubble = createSpeechBubble(
      scene,
      speaker.sprite.x,
      speaker.sprite.y - speaker.sprite.displayHeight * 0.95,
      text,
      { scrollFactor: 1, keepInView: true },
    );
    this._localConversationTimer?.remove(false);
    this._localConversationTimer = scene.time.delayedCall(duration, () => {
      this._localConversationBubble?.destroy();
      this._localConversationBubble = null;
      this._localConversationTimer = null;
      onDone();
    });
  }

  /**
   * Starts NPC4's one-time exchange during the second local-help quest.
   * @private
   * @returns {void}
   */
  _tryStartNpc4Conversation() {
    if (
      this._currentArea !== 'city'
      || !this.cityNpc4
      || this._npc3ConversationActive
      || this._npc4ConversationActive
      || this._npc4ConversationComplete
      || !QuestManager.isQuestActive(LOCAL_HELP_QUEST_IDS[1])
      || !isWithinRadius(this.actor.sprite, this.cityNpc4.sprite, 18)
    ) return;

    this._npc4ConversationActive = true;
    this.actor.sprite.body.setVelocity(0, 0);
    this.actor.playState('idle');

    const dx = this.actor.sprite.x - this.cityNpc4.sprite.x;
    const dy = this.actor.sprite.y - this.cityNpc4.sprite.y;
    if (dx === 0 && dy === 0) {
      this.actor.setDirection('north');
    } else {
      this.actor.setDirectionFromVector(-dx, -dy, 'idle');
    }

    this._showLocalConversationLine(
      this.actor,
      'Do you know where the soldiers took Louisa?',
      2100,
      () => {
        this._showLocalConversationLine(
          this.cityNpc4,
          "They took her to the door on my left, but they were armed. Don't go there. Ask my friend at [27, 20] for help.",
          4200,
          () => {
            this._npc4ConversationComplete = true;
            this._npc4ConversationActive = false;
          },
        );
      },
    );
  }

  /**
   * Starts the follow-up exchange with the second local from the provisional-prison quest.
   * @private
   * @returns {void}
   */
  _tryStartPrisonConversation() {
    if (
      this._currentArea !== 'city'
      || !this.cityNpc4
      || this._npc4ConversationActive
      || this._prisonConversationActive
      || this._prisonConversationComplete
      || !QuestManager.isQuestActive(FIND_PRISON_QUEST_ID)
      || !isWithinRadius(this.actor.sprite, this.cityNpc4.sprite, 18)
    ) return;

    this._prisonConversationActive = true;
    this.actor.sprite.body.setVelocity(0, 0);
    this.actor.playState('idle');

    const dx = this.actor.sprite.x - this.cityNpc4.sprite.x;
    const dy = this.actor.sprite.y - this.cityNpc4.sprite.y;
    if (dx !== 0 || dy !== 0) {
      this.cityNpc4.setDirectionFromVector(dx, dy, 'idle');
      this.actor.setDirectionFromVector(-dx, -dy, 'idle');
    }

    this._showLocalConversationLine(this.cityNpc4, 'Did you manage to do something?', 2200, () => {
      this._showLocalConversationLine(this.actor, "Yeah, I'm gonna save her.", 2200, () => {
        this._showLocalConversationLine(this.cityNpc4, 'Good luck then, kid.', 2000, () => {
          this._prisonConversationComplete = true;
          this._prisonConversationActive = false;
        });
      });
    });
  }

  /**
   * Turns the hacker toward the player while the third local-help quest is active.
   * @private
   * @returns {void}
   */
  _trackPlayerWithHacker() {
    if (
      !this.hacker
      || !QuestManager.isQuestActive(LOCAL_HELP_QUEST_IDS[2])
      || this._hackerConversationComplete
      || this._hackerConversationActive
    ) return;

    const dx = this.actor.sprite.x - this.hacker.sprite.x;
    const dy = this.actor.sprite.y - this.hacker.sprite.y;
    if (dx === 0 && dy === 0) return;

    const targetDirection = resolveDirection(dx, dy, this.hacker.manifest.directionality.mode);
    if (targetDirection !== this.hacker.currentDirection) this.hacker.setDirection(targetDirection);
  }

  /**
   * Starts the hacker conversation when the third local-help quest brings the player to him.
   * @private
   * @returns {void}
   */
  _tryStartHackerConversation() {
    if (
      this._currentArea !== 'city'
      || !this.hacker
      || this._hackerConversationActive
      || this._hackerConversationComplete
      || !QuestManager.isQuestActive(LOCAL_HELP_QUEST_IDS[2])
      || !isWithinRadius(this.actor.sprite, this.hacker.sprite, 18)
    ) return;

    this._hackerConversationActive = true;
    this.actor.sprite.body.setVelocity(0, 0);
    this.actor.playState('idle');

    const dx = this.actor.sprite.x - this.hacker.sprite.x;
    const dy = this.actor.sprite.y - this.hacker.sprite.y;
    if (dx !== 0 || dy !== 0) {
      this.hacker.setDirectionFromVector(dx, dy, 'idle');
      this.actor.setDirectionFromVector(-dx, -dy, 'idle');
    }

    this._showLocalConversationLine(
      this.actor,
      'Some guy pointed me to you. He says you can help me get my friend back.',
      3000,
      () => {
        this._showLocalConversationLine(
          this.hacker,
          "Yeah. We traced the facility holding her down to its network — this is it, no more scouting. Meet us in SUB and we'll run the breach for real. Be careful and make sure nobody follows you. An enemy of our enemy is a friend of ours.",
          7000,
          () => {
            this._hackerConversationComplete = true;
            this._hackerConversationActive = false;
          },
        );
      },
    );
  }

  /**
   * Turns the underground community hacker toward the player.
   * @returns {void}
   */
  _trackPlayerWithUnderCommunityHacker() {
    if (!this.underCommunityHacker || this._underCommunityHackerConversationActive) return;
    const dx = this.actor.sprite.x - this.underCommunityHacker.sprite.x;
    const dy = this.actor.sprite.y - this.underCommunityHacker.sprite.y;
    if (dx === 0 && dy === 0) return;

    const direction = resolveDirection(dx, dy, this.underCommunityHacker.manifest.directionality.mode);
    if (direction !== this.underCommunityHacker.currentDirection) {
      this.underCommunityHacker.setDirection(direction);
    }
  }

  /**
   * Plays the community hacker's welcome conversation once the player reaches the community.
   * @returns {void}
   */
  _tryStartUnderCommunityHackerConversation() {
    if (
      this._currentArea !== 'under'
      || !this.underCommunityHacker
      || this._underCommunityHackerConversationActive
      || this._underCommunityHackerConversationComplete
      || !QuestManager.isQuestActive(UNDERGROUND_HACKER_QUEST_ID)
    ) return;

    const tileSize = this.background.getTileSize();
    const body = this.actor.sprite.body;
    const tileX = Math.floor(body.center.x / tileSize.width);
    const tileY = Math.floor(body.center.y / tileSize.height);
    if (tileY !== 5 || tileX < 21 || tileX > 23) return;

    this._underCommunityHackerConversationActive = true;
    this.actor.sprite.body.setVelocity(0, 0);
    this.actor.playState('idle');
    const dx = this.actor.sprite.x - this.underCommunityHacker.sprite.x;
    const dy = this.actor.sprite.y - this.underCommunityHacker.sprite.y;
    if (dx !== 0 || dy !== 0) {
      this.actor.setDirectionFromVector(-dx, -dy, 'idle');
      this.underCommunityHacker.setDirectionFromVector(dx, dy, 'idle');
    }

    this._showLocalConversationLine(
      this.underCommunityHacker,
      'Glad you are here, it took you a while to get here.',
      2800,
      () => {
        this._showLocalConversationLine(
          this.actor,
          'Heard you can help me get my friend back, is it true? I really miss her.',
          3400,
          () => {
            this._showLocalConversationLine(
              this.underCommunityHacker,
              "We can teach you to learn hacking, but we can't really risk going out to the city. They know us and they'd immediately capture us. But sit at the computer, we can teach you how to hack.",
              6200,
              () => {
                this._underCommunityHackerConversationActive = false;
                this._underCommunityHackerConversationComplete = true;
                QuestManager.completeObjective(
                  UNDERGROUND_HACKER_QUEST_ID,
                  'reach_hacker_community',
                );
              },
            );
          },
        );
      },
    );
  }

  /**
   * @param {string} action
   * @param {{action: string, originalEvent: object}} event
   * @returns {void}
   */
  onInput(action, event) {
    // Game must be fully unresponsive to keypresses while a cutscene plays (map toggle, pause
    // menu, interact, inventory — all of it).
    if (this._cutsceneActive) return;
    if (
      this._npc3ConversationActive
      || this._npc4ConversationActive
      || this._prisonConversationActive
      || this._hackerConversationActive
      || this._underCommunityHackerConversationActive
    ) return;
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
      if (
        this._currentArea === 'under'
        && this.underComputerAccess
        && isWithinRadius(this.actor.sprite, this.underComputerAccess.zone, PICKUP_RADIUS)
      ) {
        this.underComputerAccess.trigger();
        return;
      }
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
  _showRespawnMessage(subtitle = '', restartDelay = 700) {
    const { scene } = this.engine;
    this.actor.sprite.body.setVelocity(0, 0);
    this.actor.sprite.body.enable = false;
    this.isTransitioning = true;

    const overlay = scene.add.rectangle(0, 0, INTERNAL_WIDTH * 3, INTERNAL_HEIGHT * 3, 0x000000, 1)
      .setScrollFactor(0)
      .setDepth(DEPTH.UI_HUD + 10)
      .setAlpha(0);
    const text = scene.add.text(INTERNAL_WIDTH / 2, INTERNAL_HEIGHT / 2, 'you just died..', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#ffffff',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.UI_HUD + 11).setAlpha(0);

    const subtitleText = subtitle
      ? scene.add.text(INTERNAL_WIDTH / 2, INTERNAL_HEIGHT / 2 + 16, subtitle, {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: '#ffffff',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.UI_HUD + 11).setAlpha(0)
      : null;
    const fadeTargets = subtitleText ? [overlay, text, subtitleText] : [overlay, text];

    scene.tweens.add({
      targets: fadeTargets,
      alpha: 1,
      duration: 400,
      onComplete: () => {
        scene.time.delayedCall(restartDelay, () => window.location.reload());
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
    this.underCar?.destroy();
    this.underCar = null;
    this.underDjPult?.destroy();
    this.underDjLights?.destroy();
    this.underDjNpc3?.sprite.destroy();
    this.underCommunityHacker?.sprite.destroy();
    this._destroyCutscene();
    this._localConversationTimer?.remove(false);
    this._localConversationTimer = null;
    this._localConversationBubble?.destroy();
    this._localConversationBubble = null;
    this.actor.sprite.destroy();
    this.cat.destroy();
    for (const npc of this.cityNpcs) npc.destroy();
    for (const group of this.citySoldierGroups) group.destroy();
    this.cityNpc3?.sprite.destroy();
    this.cityNpc4?.sprite.destroy();
    this.hacker?.sprite.destroy();
    for (const computer of this.underComputers) computer.sprite.destroy();
    for (const npc of this.underHackers) npc.sprite.destroy();
    for (const npc of this.underNpc3s) npc.sprite.destroy();
    this.underComputerAccess?.destroy();
    this.teacher.sprite.destroy();
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