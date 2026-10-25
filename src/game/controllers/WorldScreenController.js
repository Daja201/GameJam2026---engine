import { ScreenController } from '../../engine/screens/ScreenController.js';
import { Actor } from '../../engine/sprites/Actor.js';
import { Companion } from '../companions/Companion.js';
import { InteractiveObject } from '../../engine/world/InteractiveObject.js';
import { isWithinRadius } from '../../engine/world/ProximityDetector.js';
import { INTERNAL_WIDTH, INTERNAL_HEIGHT } from '../../engine/display/constants.js';
import { DEPTH } from '../../engine/display/DepthLayers.js';
import { LoopManager } from '../../engine/loop/LoopManager.js';
import { FxManager } from '../../engine/loop/FxManager.js';
import { QuestManager } from '../../engine/quest/QuestManager.js';
import { createToastNotifier } from '../../engine/ui/ToastNotifier.js';
import { animKey } from '../../engine/sprites/AnimationFactory.js';

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

/**
 * Quest content for this room (THIS controller's own example content — the quest engine,
 * `engine/quest/QuestManager.js`, knows nothing about any of these ids; see its module docstring
 * for the "no content coupling" reasoning). `world_pc`/`scrap_metal`/the `world` screen id here
 * must exactly match what `/config/quests.default.json` references for those quests to progress.
 */
const WORLD_PC_INTERACT_ID = 'world_pc';
const SCRAP_ITEM_ID = 'scrap_metal';
const SCRAP_SPAWN_POINTS = [
  { x: INTERNAL_WIDTH / 2 - 60, y: INTERNAL_HEIGHT / 2 - 40 },
  { x: INTERNAL_WIDTH / 2 + 90, y: INTERNAL_HEIGHT / 2 + 50 },
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
 * Draws a plain cog/gear icon (the generic "settings" glyph most apps use) as a small Graphics
 * object. Drawn instead of a text/emoji glyph on purpose: canvas font support for a gear
 * character (e.g. U+2699) is inconsistent across platforms/fonts, so a hand-drawn vector icon is
 * the only way to guarantee it actually looks like a gear everywhere.
 * @param {Phaser.Scene} scene
 * @param {number} cx - center x
 * @param {number} cy - center y
 * @param {number} radius - outer radius, teeth included
 * @param {number} color
 * @returns {Phaser.GameObjects.Graphics}
 */
function drawGearIcon(scene, cx, cy, radius, color) {
  const g = scene.add.graphics();
  g.fillStyle(color, 1);

  const teeth = 8;
  const outer = radius;
  const inner = radius * 0.62;
  const toothWidth = (Math.PI * 2) / teeth / 2.4;

  g.beginPath();
  for (let i = 0; i < teeth; i += 1) {
    const mid = (i / teeth) * Math.PI * 2;
    const a0 = mid - toothWidth / 2;
    const a1 = mid + toothWidth / 2;
    const nextMid = ((i + 1) / teeth) * Math.PI * 2;
    const a2 = nextMid - toothWidth / 2;
    if (i === 0) g.moveTo(cx + Math.cos(a0) * outer, cy + Math.sin(a0) * outer);
    else g.lineTo(cx + Math.cos(a0) * outer, cy + Math.sin(a0) * outer);
    g.lineTo(cx + Math.cos(a1) * outer, cy + Math.sin(a1) * outer);
    g.lineTo(cx + Math.cos((a1 + a2) / 2) * inner, cy + Math.sin((a1 + a2) / 2) * inner);
    g.lineTo(cx + Math.cos(a2) * outer, cy + Math.sin(a2) * outer);
  }
  g.closePath();
  g.fillPath();

  // Center hole, punched out with the background color so it reads as a ring (drawn by caller
  // passing its own background color isn't possible here, so instead draw a smaller filled
  // circle in the panel's own bg color).
  g.fillStyle(0x2a2a3a, 1);
  g.fillCircle(cx, cy, inner * 0.55);

  return g;
}

/**
 * Builds a small clickable HUD icon button (square background + centered gear icon), styled to
 * match `engine/ui/elements/Button.js` but standalone — this is a fixed-to-screen World-screen
 * HUD element, not a window-manifest element, so it doesn't go through WindowFactory/ActionRegistry.
 *
 * BUGFIX (kept from the previous round): don't nest the interactive object inside a Container.
 * Phaser renders nested-container children screen-fixed correctly regardless of nesting, but
 * pointer HIT-TESTING of an interactive child inside a Container is computed using that child's
 * own `scrollFactorX/Y` against the camera's current scroll — not the ancestor container's. Once
 * the camera scrolls away from the origin (it follows the player here), the drawn position and
 * the hit-tested position drift apart and clicks silently miss. So the background rectangle and
 * the icon are both added directly to the scene, each with its own `scrollFactor(0)`.
 * @param {Phaser.Scene} scene
 * @param {number} x
 * @param {number} y
 * @param {{ size?: number, originX?: number, onClick: () => void }} opts
 * @returns {{ destroy(): void }}
 */
function createSettingsButton(scene, x, y, opts) {
  const size = opts.size ?? 20;
  const originX = opts.originX ?? 0;
  const left = x - originX * size;

  const bg = scene.add.rectangle(left, y, size, size, 0x2a2a3a).setOrigin(0, 0);
  bg.setStrokeStyle(1, 0x6a6a8a);
  bg.setScrollFactor(0);
  bg.setDepth(DEPTH.UI_HUD);

  const icon = drawGearIcon(scene, left + size / 2, y + size / 2, size * 0.32, 0xd8d8e8);
  icon.setScrollFactor(0);
  icon.setDepth(DEPTH.UI_HUD);

  bg.setInteractive({ useHandCursor: true });
  bg.on('pointerover', () => bg.setFillStyle(0x3a3a52));
  bg.on('pointerout', () => bg.setFillStyle(0x2a2a3a));
  bg.on('pointerdown', () => opts.onClick());

  return {
    destroy() {
      bg.destroy();
      icon.destroy();
    },
  };
}

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
 * SETTINGS: opened by clicking the gear-icon HUD button in the top-right corner (no longer bound
 * to Enter — `config/controls.default.json`'s movement profile no longer maps ENTER). The window
 * itself (`graphics/ui/windows/default_panel/manifest.json`) is now sized to the full internal
 * resolution (480x270) so it opens fullscreen by default.
 * @module game/controllers/WorldScreenController
 */
export class WorldScreenController extends ScreenController {
  /** @param {object} [params] @returns {void} */
  onEnter(params) {
    const { scene } = this.engine;

    this.actor = new Actor(scene, 'main_char', INTERNAL_WIDTH / 2, INTERNAL_HEIGHT / 2);
    scene.cameras.main.startFollow(this.actor.sprite, true);

    // Companion cat: trails the player with a short lag (see Companion.js). Reused unmodified
    // from here on by `onUpdate`/`onExit` — nothing else in this controller needs to know how
    // the follow behavior works internally.
    this.cat = new Companion(scene, 'cat_companion', this.actor.sprite);

    const pcX = INTERNAL_WIDTH / 2 + 40;
    const pcY = INTERNAL_HEIGHT / 2;
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

    // Scrap-metal pickups (this room's "getting some item" quest content — see SCRAP_SPAWN_POINTS'
    // docstring above). Only as many are spawned as are still needed: if a previous session
    // already collected some (QuestManager persists collected-item counts across reloads — see
    // QuestManager.save()/load()), re-entering the World shouldn't let the player "re-collect"
    // past what the quest actually still requires.
    const alreadyCollected = QuestManager.getItemCount(SCRAP_ITEM_ID);
    this.scrapPickups = SCRAP_SPAWN_POINTS.slice(alreadyCollected).map((point) => this._createScrapPickup(point.x, point.y));

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
    this.modeLabel = scene.add.text(4, 18, '', {
      fontFamily: 'monospace',
      fontSize: '10px',
      color: '#ffffff',
      backgroundColor: '#000000aa',
      padding: { x: 4, y: 2 },
    });
    this.modeLabel.setScrollFactor(0);
    this.modeLabel.setDepth(DEPTH.UI_HUD);
    this._refreshModeLabel();

    // Settings button: clickable gear-icon HUD button, top-right corner (replaces the old Enter
    // keybind; opens `settings_modal`, whose window manifest is now sized fullscreen by default).
    this.settingsButton = createSettingsButton(scene, INTERNAL_WIDTH - 4, 4, {
      size: 20,
      originX: 1,
      onClick: () => this.engine.screenManager.push('settings_modal'),
    });

    // Tracked-quest HUD line, top-left corner (ABOVE the mode label, see class docstring) —
    // always shows whichever quest QuestManager considers "tracked" (auto-picked, or chosen by
    // the player from the Quest Log screen's Active tab). [L] opens the Quest Log (see onInput).
    this.questHudLabel = scene.add.text(4, 4, '', {
      fontFamily: 'monospace',
      fontSize: '8px',
      color: '#aaffaa',
      backgroundColor: '#000000aa',
      padding: { x: 4, y: 2 },
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
    this._onQuestCompleted = ({ id }) => {
      const quest = QuestManager.getQuest(id);
      if (quest) this.toasts.show(`Quest Complete: ${quest.title}`, { accentColor: TOAST_ACCENT_COMPLETE });
    };
    QuestManager.events.on('quest:assigned', this._onQuestAssigned);
    QuestManager.events.on('quest:objective-progress', this._onQuestProgress);
    QuestManager.events.on('quest:completed', this._onQuestCompleted);

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
      if (this.mode === MODE_FIGHT && this.attackKey.isDown) {
        this.actor.playState('attack');
      }
    };
    this.actor.sprite.on('animationcomplete', this._onAttackAnimationComplete);
  }

  /**
   * @param {number} time
   * @param {number} delta
   * @returns {void}
   */
  onUpdate(time, delta) {
    const { scene } = this.engine;

    if (this.mode === MODE_FIGHT) {
      this._updateFightMode(delta);
    } else {
      this._updateNormalMode(delta);
    }

    this._syncActorOrigin();
    this.actor.update(time, delta);
    this.cat.update(time, delta);

    // In fight mode E punches rather than interacts, so the "[E] interact" prompt would be
    // misleading there — only show it in normal mode.
    this.pc.showPrompt(this.mode === MODE_NORMAL && isWithinRadius(this.actor.sprite, this.pc.zone, INTERACT_RADIUS));

    for (const pickup of this.scrapPickups) {
      pickup.object.showPrompt(this.mode === MODE_NORMAL && isWithinRadius(this.actor.sprite, pickup.object.zone, PICKUP_RADIUS));
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
   * @private
   * @param {number} delta
   * @returns {void}
   */
  _updateNormalMode(delta) {
    const keys = this.moveKeys;
    const dx = (keys.right.isDown ? 1 : 0) - (keys.left.isDown ? 1 : 0);
    const dy = (keys.down.isDown ? 1 : 0) - (keys.up.isDown ? 1 : 0);

    if (dx !== 0 || dy !== 0) {
      const step = (WALK_SPEED * delta) / 1000;
      this.actor.sprite.x += dx * step;
      this.actor.sprite.y += dy * step;
      this.actor.setDirectionFromVector(dx, dy, 'walk');
    } else {
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

    if (this.isPunching) return; // feet planted — see class-level ATTACK doc for why

    const keys = this.moveKeys;
    const dx = (keys.right.isDown ? 1 : 0) - (keys.left.isDown ? 1 : 0);
    const dy = (keys.down.isDown ? 1 : 0) - (keys.up.isDown ? 1 : 0);

    if (dx !== 0 || dy !== 0) {
      const step = (WALK_SPEED * delta) / 1000;
      this.actor.sprite.x += dx * step;
      this.actor.sprite.y += dy * step;
      this.actor.setDirectionFromVector(dx, dy, 'walk');
      this._fightStanceDirection = null; // walking overrides the stance pose until it stops
    } else {
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
      this.actor.sprite.anims.play(key, false, 0);
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
    if (action === 'toggle-mode') {
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
    } else if (action === 'open-quest-log') {
      this.engine.screenManager.push('quest_log');
    } else if (action === 'cancel') {
      // ASSUMPTION: module 09 explicitly leaves the "what resets a loop" decision to this
      // example content (its own non-goal). Simplest standard choice for a jam demo: ESC in the
      // World starts a fresh loop and gives a flash as feedback.
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
  onExit() {
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
    this.toasts.destroy();
    this.actor.sprite.destroy();
    this.cat.destroy();
    this.pc.destroy();
    this.pcVisual.destroy();
    for (const pickup of this.scrapPickups) {
      pickup.object.destroy();
      pickup.visual.destroy();
    }
    this.modeLabel.destroy();
    this.questHudLabel.destroy();
    this.settingsButton.destroy();
  }

  /** @returns {void} */
  onPause() {}

  /** @returns {void} */
  onResume() {}
}