import { ScreenController } from '../../engine/screens/ScreenController.js';
import { Actor } from '../../engine/sprites/Actor.js';
import { Companion } from '../companions/Companion.js';
import { InteractiveObject } from '../../engine/world/InteractiveObject.js';
import { isWithinRadius } from '../../engine/world/ProximityDetector.js';
import { INTERNAL_WIDTH, INTERNAL_HEIGHT } from '../../engine/display/constants.js';
import { DEPTH } from '../../engine/display/DepthLayers.js';
import { LoopManager } from '../../engine/loop/LoopManager.js';
import { FxManager } from '../../engine/loop/FxManager.js';

/** Walking speed, pixels per second. */
const WALK_SPEED = 60;
/** How close the player must be to the "PC" prop to interact with it. */
const INTERACT_RADIUS = 28;

/** Mode names. In 'normal' mode E interacts with the world; in 'fight' mode E punches. */
const MODE_NORMAL = 'normal';
const MODE_FIGHT = 'fight';

/**
 * Builds a small clickable HUD button (rectangle + centered label), styled to match
 * `engine/ui/elements/Button.js` but standalone — this is a fixed-to-screen World-screen HUD
 * element, not a window-manifest element, so it doesn't go through WindowFactory/ActionRegistry.
 *
 * BUGFIX: the first version of this wrapped the rectangle+label in a Container and set
 * `scrollFactor(0)` on the *container*. That's exactly the pattern `WindowFactory.js` uses for
 * its own root container — but there, the interactive rectangle is nested two levels deep (root
 * container -> Button's own container -> rectangle), and only the outermost container actually
 * gets `scrollFactor(0)`. Phaser renders nested-container children correctly either way (they're
 * positioned purely relative to their parent, so they visually stay screen-fixed), but pointer
 * HIT-TESTING of an interactive child inside a Container is computed using that child's own
 * `scrollFactorX/Y` against the camera's current scroll — not the ancestor container's. Once the
 * camera scrolls away from the origin (it follows the player here), the drawn position and the
 * hit-tested position drift apart and clicks silently miss. The fix is to never nest the
 * interactive object inside a Container at all: add the rectangle and label directly to the
 * scene and set `scrollFactor(0)` on the interactive rectangle itself, so render position and
 * hit-test position use the exact same object/property.
 * @param {Phaser.Scene} scene
 * @param {number} x
 * @param {number} y
 * @param {{ text: string, width?: number, height?: number, originX?: number, onClick: () => void }} opts
 * @returns {{ destroy(): void }}
 */
function createHudButton(scene, x, y, opts) {
  const width = opts.width ?? 72;
  const height = opts.height ?? 16;
  const originX = opts.originX ?? 0;
  const left = x - originX * width;

  const bg = scene.add.rectangle(left, y, width, height, 0x2a2a3a).setOrigin(0, 0);
  bg.setStrokeStyle(1, 0x6a6a8a);
  bg.setScrollFactor(0);
  bg.setDepth(DEPTH.UI_HUD);

  const label = scene.add.text(left + width / 2, y + height / 2, opts.text, {
    fontFamily: 'monospace',
    fontSize: '10px',
    color: '#ffffff',
  }).setOrigin(0.5, 0.5);
  label.setScrollFactor(0);
  label.setDepth(DEPTH.UI_HUD);

  bg.setInteractive({ useHandCursor: true });
  bg.on('pointerover', () => bg.setFillStyle(0x3a3a52));
  bg.on('pointerout', () => bg.setFillStyle(0x2a2a3a));
  bg.on('pointerdown', () => opts.onClick());

  return {
    destroy() {
      bg.destroy();
      label.destroy();
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
 * So this controller does NOT subscribe to `InputRouter` directly for discrete actions like
 * `interact`/`cancel`/`toggle-mode` — it just implements `onInput`. Continuous movement is the
 * one exception: `InputRouter` only documents `keydown` (no `keyup`), so, per this module's own
 * prompt text, continuous movement is read every frame via Phaser's own keyboard polling instead
 * (WASD, via `scene.input.keyboard.addKeys`, rather than `createCursorKeys()`'s arrows).
 *
 * MODE SWITCH: `Q` (abstract action `toggle-mode`, see `config/controls.default.json`) toggles
 * between NORMAL and FIGHT mode. `E` (abstract action `interact`, unchanged keybind — only its
 * meaning here depends on mode) either interacts with the nearby PC (normal mode) or throws a
 * punch (fight mode). The current mode is shown as a small label in the top-left corner.
 *
 * ATTACK: plays the `main_char` manifest's `attack` state once, facing the player's current
 * direction — no damage/hitbox/cooldown logic yet, per the current ask ("just does the animation
 * at this moment"). Movement IS frozen for the duration of the punch (feet planted). This was
 * tried the other way (position kept moving while the punch animation played) and it looked
 * wrong: `Actor` only ever shows ONE animation at a time per manifest.json's state machine — there
 * is no authored "walking while punching" frame set, and no blending between two animations. So
 * letting the body glide across the screen while stuck on static punch-pose frames (legs not
 * animating to match the movement) reads as broken rather than as "fighting on the move". Actually
 * combining the two for real would need either (a) a new authored animation for moving+punching,
 * or (b) splitting the character into independently-animated upper/lower body layers — both are
 * real art/engine work, out of scope for "just does the animation". Freezing movement is the
 * correct simple behavior for the art that exists today.
 *
 * SETTINGS: opened by clicking the "[ Settings ]" HUD button in the top-right corner (no longer
 * bound to Enter — `config/controls.default.json`'s movement profile no longer maps ENTER).
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
      onInteract: () => this.engine.screenManager.push('terminal'),
    });

    // WASD for movement (rewired from arrow keys; see class-level INPUT DESIGN NOTE).
    this.moveKeys = scene.input.keyboard.addKeys({
      up: 'W',
      down: 'S',
      left: 'A',
      right: 'D',
    });

    // Mode: NORMAL (E interacts) <-> FIGHT (E punches), toggled with Q.
    this.mode = MODE_NORMAL;
    this.modeLabel = scene.add.text(4, 4, '', {
      fontFamily: 'monospace',
      fontSize: '10px',
      color: '#ffffff',
      backgroundColor: '#000000aa',
      padding: { x: 4, y: 2 },
    });
    this.modeLabel.setScrollFactor(0);
    this.modeLabel.setDepth(DEPTH.UI_HUD);
    this._refreshModeLabel();

    // Settings button: clickable HUD button, top-right corner (replaces the old Enter keybind).
    this.settingsButton = createHudButton(scene, INTERNAL_WIDTH - 4, 4, {
      text: '[ Settings ]',
      width: 72,
      height: 16,
      originX: 1,
      onClick: () => this.engine.screenManager.push('settings_modal'),
    });

    // Attack: play the punch animation once. Movement is frozen while it plays (see class doc).
    this.isAttacking = false;
    this._onAttackAnimComplete = (anim) => {
      if (anim.key.includes(':attack:')) {
        this.isAttacking = false;
        this.actor.playState('idle');
      }
    };
    this.actor.sprite.on('animationcomplete', this._onAttackAnimComplete);
  }

  /**
   * @param {number} time
   * @param {number} delta
   * @returns {void}
   */
  onUpdate(time, delta) {
    const { scene } = this.engine;

    // Feet planted while punching — see class-level ATTACK doc for why.
    if (!this.isAttacking) {
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
    this.actor.update(time, delta);
    this.cat.update(time, delta);

    // In fight mode E punches rather than interacts, so the "[E] interact" prompt would be
    // misleading there — only show it in normal mode.
    this.pc.showPrompt(this.mode === MODE_NORMAL && isWithinRadius(this.actor.sprite, this.pc.zone, INTERACT_RADIUS));

    // Usage pattern documented at the top of module 09's FxManager.js.
    const level = LoopManager.glitchLevel();
    if (level > 0 && Math.random() < 0.002 * level) {
      FxManager.shake(scene, 0.002 + 0.006 * level, 120);
    }
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
    } else if (action === 'interact') {
      if (this.mode === MODE_FIGHT) {
        if (!this.isAttacking) {
          this.isAttacking = true;
          this.actor.playState('attack');
        }
      } else if (isWithinRadius(this.actor.sprite, this.pc.zone, INTERACT_RADIUS)) {
        this.pc.trigger();
      }
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
    this.actor.sprite.off('animationcomplete', this._onAttackAnimComplete);
    this.actor.sprite.destroy();
    this.cat.destroy();
    this.pc.destroy();
    this.pcVisual.destroy();
    this.modeLabel.destroy();
    this.settingsButton.destroy();
  }

  /** @returns {void} */
  onPause() {}

  /** @returns {void} */
  onResume() {}
}
