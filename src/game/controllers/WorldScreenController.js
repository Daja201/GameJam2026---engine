import { ScreenController } from '../../engine/screens/ScreenController.js';
import { Actor } from '../../engine/sprites/Actor.js';
import { Companion } from '../companions/Companion.js';
import { InteractiveObject } from '../../engine/world/InteractiveObject.js';
import { isWithinRadius } from '../../engine/world/ProximityDetector.js';
import { INTERNAL_HEIGHT } from '../../engine/display/constants.js';
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

/** Toast accent colors by quest-event category — kept here (content), not in ToastNotifier (generic). */
const TOAST_ACCENT_STARTED = 0x8aa8ff;
const TOAST_ACCENT_PROGRESS = 0xffd27f;
const TOAST_ACCENT_COMPLETE = 0x6fe39a;

/** Walking speed, pixels per second. */
const WALK_SPEED = 60;
/** How close the player must be to the "PC" prop to interact with it. */
const INTERACT_RADIUS = 28;

/** How close the player must be to a scrap pickup to interact with it. */
const PICKUP_RADIUS = 20;

/** How close the cat must be to the player's punching hand for a fight-mode hit to land on it. */
const CAT_HIT_RADIUS = 20;
const WORLD_Y_SORT_DEPTH_RANGE = DEPTH.WORLD_FOREGROUND - DEPTH.WORLD_ENTITIES - 1;

/**
 * Quest content for this room (THIS controller's own example content — the quest engine,
 * `engine/quest/QuestManager.js`, knows nothing about any of these ids; see its module docstring
 * for the "no content coupling" reasoning). `world_pc`/`scrap_metal`/the `world` screen id here
 * must exactly match what `/config/quests.default.json` references for those quests to progress.
 */
const WORLD_PC_INTERACT_ID = 'world_pc';
const SCRAP_ITEM_ID = 'scrap_metal';

// FIX (city map): the `world` screen's background is now `graphics/backgrounds/city` (a large
// generated tilemap, see that folder's manifest.json), not the old single-room static image, so
// spawning at INTERNAL_WIDTH/2 x INTERNAL_HEIGHT/2 (the room's center) no longer makes sense — on
// a 3904x2304px map that point is wherever a random building or street happens to fall, not
// guaranteed walkable. SPAWN_X/SPAWN_Y below is the pixel-center of that map's one "plaza" block
// (graphics/backgrounds/city/gen_map.py's PLAZA_BLOCK), the single spot deliberately generated
// as open grass with no `collides` tiles, so the player, cat, PC prop, and scrap pickups all land
// somewhere guaranteed walkable regardless of how the surrounding city blocks were laid out.
const SPAWN_X = 2160;
const SPAWN_Y = 1168;

const SCRAP_SPAWN_POINTS = [
  { x: SPAWN_X - 60, y: SPAWN_Y - 40 },
  { x: SPAWN_X + 90, y: SPAWN_Y + 50 },
];

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

    // Lets a pushed-on-top screen (e.g. the pause menu) reach this controller while it's mounted
    // underneath (see main.js's 'menu-start'/'pause-open-map' action registrations). Cleared in onExit.
    this.engine.worldController = this;

    this.actor = new Actor(scene, 'main_char', SPAWN_X, SPAWN_Y);
    scene.cameras.main.startFollow(this.actor.sprite, true);

    // FIX (city map): world/camera bounds and building collision. Previously neither was set at
    // all (see prompts/12-INSTRUCTIONS_GAME.md: "No collision tilemap yet — player currently
    // walks through everything") because the old background was a single borderless static room
    // image with no real edges and nothing to collide with. `getMapSize()`/`getCollisionLayer()`
    // are no-ops (return null) for non-tilemap backgrounds, so this stays harmless if a future
    // screen swaps back to a static/parallax background.
    const mapSize = this.background?.getMapSize?.();
    this.mapSize = mapSize ?? null;
    if (mapSize) {
      scene.physics.world.setBounds(0, 0, mapSize.width, mapSize.height);
      scene.cameras.main.setBounds(0, 0, mapSize.width, mapSize.height);
    }
    const collisionLayer = this.background?.getCollisionLayer?.();
    if (collisionLayer) {
      scene.physics.add.collider(this.actor.sprite, collisionLayer);
      // NOTE: the cat companion is deliberately NOT given a collider here — it moves by directly
      // setting sprite.x/y each frame (Companion.js), not via arcade velocity/acceleration, so a
      // collider would only ever stop it dead against a wall rather than let it path around one.
      // It can clip through buildings as a result; acceptable for a jam-scope follower.
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
    this.cat = new Companion(scene, 'cat_companion', this.actor.sprite);
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

    const pcX = SPAWN_X + 40;
    const pcY = SPAWN_Y;
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

    // Scrap-metal pickups (this room's "getting some item" quest content — see SCRAP_SPAWN_POINTS'
    // docstring above). Only as many are spawned as are still needed: if a previous session
    // already collected some (QuestManager persists collected-item counts across reloads — see
    // QuestManager.save()/load()), re-entering the World shouldn't let the player "re-collect"
    // past what the quest actually still requires.
    const alreadyCollected = QuestManager.getItemCount(SCRAP_ITEM_ID);
    this.scrapPickups = SCRAP_SPAWN_POINTS.slice(alreadyCollected).map((point) => this._createScrapPickup(point.x, point.y));

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

    // FIX (quest box): the mode/quest/hint labels below used to each draw their own small
    // individual `backgroundColor` patch — three disconnected black rectangles stacked on top of
    // each other, not a real box, and (before the minimap-ring fix above) also sitting directly
    // underneath HudPanel's ring graphic, which is the "graphics thrown over text" overlap that
    // fix removed. This is their actual shared background now: one cohesive panel, drawn once,
    // sized generously (wider than the longest tracked-quest line, QUEST_HUD_MAX_CHARS=64 chars
    // at 8px monospace) rather than three cramped per-line patches — "make it bigger" per the
    // request this fixes. Plain Graphics, not the `panel.png` 9-slice windows (those currently
    // carry a baked-in magenta guide-line artifact — see WindowFactory/ScrollableText history —
    // and fixing that asset is a separate, not-yet-requested task).
    const questBoxWidth = 330;
    const questBoxHeight = 50;
    this.questBox = scene.add.graphics();
    this.questBox.fillStyle(0x05070c, 0.78);
    this.questBox.fillRect(0, 0, questBoxWidth, questBoxHeight);
    this.questBox.lineStyle(1, 0x35e0a8, 0.9);
    this.questBox.strokeRect(0, 0, questBoxWidth, questBoxHeight);
    this.questBox.setPosition(2, 2);
    this.questBox.setScrollFactor(0);
    this.questBox.setDepth(DEPTH.UI_HUD);

    const QUEST_BOX_PAD = 8;

    // Mode: NORMAL (E interacts) <-> FIGHT (E punches), toggled with Q.
    this.mode = MODE_NORMAL;
    this.modeLabel = scene.add.text(2 + QUEST_BOX_PAD, 2 + 22, '', {
      fontFamily: 'monospace',
      fontSize: '10px',
      color: '#ffffff',
    });
    this.modeLabel.setScrollFactor(0);
    this.modeLabel.setDepth(DEPTH.UI_HUD);
    this._refreshModeLabel();

    // HUD panel (status bar bottom-left; keyboard-shortcut hint text top-right).
    // FIX (menu/pause screen): the old Quit and Inventory BUTTONS are gone — Quit's job (opening
    // Settings) is now reached via Backspace -> the pause menu -> Settings (see
    // PauseMenuScreenController.js and this controller's 'cancel' handling in onInput), and Inventory
    // is already reachable via its own keyboard shortcut (I, see config/controls.default.json's
    // "movement" profile). Both are now just listed as hint text instead of clickable buttons —
    // see HudPanel.js's own doc for the exact keys shown. Map is ALSO just hint text now, same
    // shape as the others (M still works; see onInput's 'toggle-map') — it was the last clickable
    // button left in this column and is now gone too, so the whole column is key-hints only.
    this.hudPanel = createHudPanel(scene);

    // Tracked-quest HUD line, top-left corner (ABOVE the mode label, see class docstring) —
    // always shows whichever quest QuestManager considers "tracked" (auto-picked, or chosen by
    // the player from the Quest Log screen's Active tab). [L] opens the Quest Log (see onInput).
    this.questHudLabel = scene.add.text(2 + QUEST_BOX_PAD, 2 + 8, '', {
      fontFamily: 'monospace',
      fontSize: '8px',
      color: '#aaffaa',
      wordWrap: { width: questBoxWidth - QUEST_BOX_PAD * 2 },
    });
    this.questHudLabel.setScrollFactor(0);
    this.questHudLabel.setDepth(DEPTH.UI_HUD);
    this._refreshQuestHud();
    this._onQuestsUpdated = () => this._refreshQuestHud();
    QuestManager.events.on('quest:updated', this._onQuestsUpdated);

    // Quest notifications: small top-right toasts for "started" / "progress" / "complete" — see
    // ToastNotifier.js's module docstring for the design (familiar from most RPGs/quest-driven
    // games). This controller owns the mapping from a quest event to a message + accent color;
    // ToastNotifier itself has no idea what a "quest" is.
    this.toasts = createToastNotifier(scene);
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
    this.mapOverlay = this.mapSize
      ? createMapOverlay(scene, {
        follow: this.actor.sprite,
        mapSize: this.mapSize,
        ignore: [
          ...this.hudPanel.getDisplayObjects(),
          this.questBox,
          this.modeLabel,
          this.questHudLabel,
          this.toasts.root,
        ],
      })
      : null;

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
    this._keepCatOffPlayer();
    this._sortWorldEntities();
    this.hudPanel.setBarFraction(LoopManager.glitchLevel());

    // In fight mode E punches rather than interacts, so the "[E] interact" prompt would be
    // misleading there — only show it in normal mode.
    this.pc.showPrompt(this.mode === MODE_NORMAL && isWithinRadius(this.actor.sprite, this.pc.zone, INTERACT_RADIUS));

    for (const pickup of this.scrapPickups) {
      pickup.object.showPrompt(this.mode === MODE_NORMAL && isWithinRadius(this.actor.sprite, pickup.object.zone, PICKUP_RADIUS));
    }
    for (const droppedItem of this.droppedItems) {
      droppedItem.object.showPrompt(
        this.mode === MODE_NORMAL && isWithinRadius(this.actor.sprite, droppedItem.object.zone, PICKUP_RADIUS),
      );
    }

    // "Getting somewhere" quest progress: fed every frame, same way LoopManager/FxManager usage
    // below is — QuestManager itself does the cheap no-op check when nothing's listening.
    QuestManager.reportLocation('world', this.actor.sprite.x, this.actor.sprite.y);

    // Usage pattern documented at the top of module 09's FxManager.js.
    const level = LoopManager.glitchLevel();
    if (level > 0 && Math.random() < 0.002 * level) {
      FxManager.shake(scene, 0.002 + 0.006 * level, 120);
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
      this.cat.sprite,
      this.pcVisual,
      ...this.scrapPickups.map(({ visual }) => visual),
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
   * Builds one scrap-metal pickup: a small visible prop plus the InteractiveObject trigger zone,
   * same construction shape as the PC above. On interact it credits `QuestManager.collectItem`
   * once, then removes itself (both the visual and the trigger zone) so it can't be "collected"
   * twice — `QuestManager.collectItem` itself has no notion of a single-use world pickup, that
   * bookkeeping belongs entirely to this piece of example content.
   * @private
   * @param {number} x
   * @param {number} y
   * @returns {{ object: InteractiveObject, visual: Phaser.GameObjects.Rectangle }}
   */
  _createScrapPickup(x, y) {
    const { scene } = this.engine;
    const visual = scene.add.rectangle(x, y, 8, 8, 0xd4a23a).setDepth(DEPTH.WORLD_ENTITIES);
    visual.setStrokeStyle(1, 0xffe8a0);

    const entry = { object: null, visual };
    entry.object = new InteractiveObject(scene, x, y, {
      width: 16,
      height: 16,
      label: '[E] pick up',
      onInteract: () => {
        QuestManager.collectItem(SCRAP_ITEM_ID, 1);
        entry.object.destroy();
        entry.visual.destroy();
        const index = this.scrapPickups.indexOf(entry);
        if (index !== -1) this.scrapPickups.splice(index, 1);
      },
    });
    return entry;
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

  /** Longest the tracked-quest HUD line is allowed to get before truncating with "…". */
  static QUEST_HUD_MAX_CHARS = 64;

  /**
   * Updates the top-left tracked-quest HUD line from `QuestManager.getTrackedQuest()`. Subscribed
   * to `QuestManager`'s `'quest:updated'` event (see onEnter) so it stays correct even while this
   * screen is the one earning the progress (e.g. picking up scrap updates it immediately, with no
   * need to poll every frame). `QuestManager` auto-picks a tracked quest whenever one is assigned
   * and none is tracked yet (see `setTrackedQuest`'s docstring) — the player can pick a different
   * one to track from the Quest Log screen's Active tab (up/down + confirm there).
   * @private
   * @returns {void}
   */
  _refreshQuestHud() {
    const quest = QuestManager.getTrackedQuest();
    if (!quest) {
      this.questHudLabel.setText('[L] Quest Log');
      return;
    }
    const nextObjective = quest.objectives.find((o) => !o.done) ?? quest.objectives[quest.objectives.length - 1];
    let line = `Quest: ${quest.title} \u2014 ${nextObjective.description} (${nextObjective.current}/${nextObjective.count})`;
    if (line.length > WorldScreenController.QUEST_HUD_MAX_CHARS) {
      line = `${line.slice(0, WorldScreenController.QUEST_HUD_MAX_CHARS - 1)}\u2026`;
    }
    this.questHudLabel.setText(line);
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
      for (const pickup of this.scrapPickups) {
        if (isWithinRadius(this.actor.sprite, pickup.object.zone, PICKUP_RADIUS)) pickup.object.trigger();
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
      // DEV-ONLY, moved off of Backspace/'cancel' (see above) now that Backspace is the
      // pause-menu key — this used to be exactly the 'cancel' branch's body. Bound to R in
      // config/controls.default.json's "movement" profile. Kept as a dev/testing affordance
      // (not deleted) per the original ASSUMPTION this replaces: module 09 explicitly leaves
      // the "what resets a loop" decision to this example content (its own non-goal); this is
      // simply a different, clearly-separate trigger for the same existing behavior.
      LoopManager.startNewLoop();
      LoopManager.reset();
      FxManager.flash(this.engine.scene, '#ffffff', 150);
    }
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
    this.actor.sprite.destroy();
    this.cat.destroy();
    this.pc.destroy();
    this.pcVisual.destroy();
    for (const pickup of this.scrapPickups) {
      pickup.object.destroy();
      pickup.visual.destroy();
    }
    for (const droppedItem of this.droppedItems) {
      droppedItem.object.destroy();
      droppedItem.visual.destroy();
      droppedItem.icon.destroy();
      droppedItem.countLabel.destroy();
    }
    this.questBox.destroy();
    this.modeLabel.destroy();
    this.questHudLabel.destroy();
    this.hudPanel.destroy();
  }
}