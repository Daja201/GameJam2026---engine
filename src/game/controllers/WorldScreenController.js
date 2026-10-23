import { ScreenController } from '../../engine/screens/ScreenController.js';
import { Actor } from '../../engine/sprites/Actor.js';
import { Companion } from '../companions/Companion.js';
import { InteractiveObject } from '../../engine/world/InteractiveObject.js';
import { isWithinRadius } from '../../engine/world/ProximityDetector.js';
import { INTERNAL_WIDTH, INTERNAL_HEIGHT, TILE_SIZE } from '../../engine/display/constants.js';
import { DEPTH } from '../../engine/display/DepthLayers.js';
import { LoopManager } from '../../engine/loop/LoopManager.js';
import { FxManager } from '../../engine/loop/FxManager.js';
import { animKey } from '../../engine/sprites/AnimationFactory.js';

/** Walking speed, pixels per second. */
const WALK_SPEED = 60;
/** How close the player must be to the "PC" prop to interact with it. */
const INTERACT_RADIUS = 28;
const MAP_HEIGHT = TILE_SIZE * 9;

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

    this.actor = new Actor(scene, 'main_char', INTERNAL_WIDTH / 2, 144);
    scene.cameras.main.setBounds(0, 0, INTERNAL_WIDTH, MAP_HEIGHT);
    scene.cameras.main.startFollow(this.actor.sprite, true);
    this.actor.sprite.body.setCollideWorldBounds(true);
    const collisionLayer = this.background?.getCollisionLayer();
    this.worldCollider = collisionLayer
      ? scene.physics.add.collider(this.actor.sprite, collisionLayer)
      : null;

    // Companion cat: trails the player with a short lag (see Companion.js). Reused unmodified
    // from here on by `onUpdate`/`onExit` — nothing else in this controller needs to know how
    // the follow behavior works internally.
    this.cat = new Companion(scene, 'cat_companion', this.actor.sprite);

    const pcX = INTERNAL_WIDTH / 2 + 32;
    const pcY = 144;

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

    // Dedicated E key, polled directly in FIGHT mode so we can see both press AND release
    // (the abstract `interact` action only fires on press — see class-level INPUT DESIGN NOTE).
    this.attackKey = scene.input.keyboard.addKey('E');
    this.showHitboxes = this.engine.settingsStore.get('video.showHitboxes');
    this.hitboxDebug = scene.add.graphics().setDepth(DEPTH.WORLD_FOREGROUND + 1);
    this.hitboxDebug.setVisible(this.showHitboxes);
    this._unsubscribeHitboxSetting = this.engine.settingsStore.subscribe('video.showHitboxes', (value) => {
      this.showHitboxes = Boolean(value);
      this.hitboxDebug.setVisible(this.showHitboxes);
    });
    this._onHitboxDebugKey = () => {
      if (this.engine.screenManager.topController === this) this.toggleHitboxDebug();
    };
    scene.input.keyboard.on('keydown-H', this._onHitboxDebugKey);

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

    // Settings button: clickable gear-icon HUD button, top-right corner (replaces the old Enter
    // keybind; opens `settings_modal`, whose window manifest is now sized fullscreen by default).
    this.settingsButton = createSettingsButton(scene, INTERNAL_WIDTH - 4, 4, {
      size: 20,
      originX: 1,
      onClick: () => this.engine.screenManager.push('settings_modal'),
    });

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
      this._updateFightMode();
    } else {
      this._updateNormalMode();
    }

    this._syncActorOrigin();
    this.actor.update(time, delta);
    const { velocity } = this.actor.sprite.body;
    const leaderDirection = velocity.x !== 0 || velocity.y !== 0
      ? this.actor.currentDirection
      : null;
    this.cat.update(time, delta, leaderDirection);
    if (this.showHitboxes) this._drawHitboxDebug();

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
   * Keeps taller animation frames aligned with the manifest-sized static sprites.
   * @private
   * @returns {void}
   */
  _syncActorOrigin() {
    const pivot = this.actor.manifest.pivot ?? { x: 0.5, y: 0.5 };
    const baseWidth = this.actor.manifest.frame_size.width;
    const baseHeight = this.actor.manifest.frame_size.height;
    const frameWidth = this.actor.sprite.frame.width || baseWidth;
    const frameHeight = this.actor.sprite.frame.height || this.actor.manifest.frame_size.height;
    const centeredPaddingX = (frameWidth - baseWidth) / 2;
    const centeredPaddingY = (frameHeight - baseHeight) / 2;
    const originX = (pivot.x * baseWidth + centeredPaddingX) / frameWidth;
    const originY = (pivot.y * baseHeight + centeredPaddingY) / frameHeight;

    if (this.actor.sprite.originY !== originY || this.actor.sprite.originX !== originX) {
      this.actor.sprite.setOrigin(originX, originY);
    }

    const hitbox = this.actor.manifest.hitbox;
    if (hitbox) {
      this.actor.sprite.body.setOffset(
        (baseWidth - hitbox.width) / 2 + centeredPaddingX,
        (hitbox.offset_y ?? 0) + centeredPaddingY,
      );
    }
  }

  /**
   * Ordinary WASD movement + idle/walk, used in NORMAL mode.
   * @private
   * @returns {void}
   */
  _updateNormalMode() {
    const keys = this.moveKeys;
    const dx = (keys.right.isDown ? 1 : 0) - (keys.left.isDown ? 1 : 0);
    const dy = (keys.down.isDown ? 1 : 0) - (keys.up.isDown ? 1 : 0);

    if (dx !== 0 || dy !== 0) {
      this._setMovementVelocity(dx, dy);
      this.actor.setDirectionFromVector(dx, dy, 'walk');
    } else {
      this.actor.sprite.body.setVelocity(0, 0);
      this.actor.playState('idle');
    }
  }

  /**
   * FIGHT-mode movement + hold-to-punch. See class-level ATTACK doc for the full behavior.
   * @private
   * @returns {void}
   */
  _updateFightMode() {
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
      this.actor.sprite.body.setVelocity(0, 0);
      return; // feet planted — see class-level ATTACK doc for why
    }

    const keys = this.moveKeys;
    const dx = (keys.right.isDown ? 1 : 0) - (keys.left.isDown ? 1 : 0);
    const dy = (keys.down.isDown ? 1 : 0) - (keys.up.isDown ? 1 : 0);

    if (dx !== 0 || dy !== 0) {
      this._setMovementVelocity(dx, dy);
      this.actor.setDirectionFromVector(dx, dy, 'walk');
      this._fightStanceDirection = null; // walking overrides the stance pose until it stops
    } else {
      this.actor.sprite.body.setVelocity(0, 0);
      this._showFightStance();
    }
  }

  /**
   * @private
   * @param {number} dx
   * @param {number} dy
   * @returns {void}
   */
  _setMovementVelocity(dx, dy) {
    const velocity = this.actor.sprite.body.velocity;
    velocity.set(dx, dy).normalize().scale(WALK_SPEED);
  }

  /**
   * Toggles red collision and interaction hitbox overlays. Press H in the world to toggle.
   * @returns {void}
   */
  toggleHitboxDebug() {
    this.engine.settingsStore.set('video.showHitboxes', !this.showHitboxes);
    if (this.showHitboxes) this._drawHitboxDebug();
  }

  /**
   * Redraws world collider tiles and entity/interaction bounds.
   * @private
   * @returns {void}
   */
  _drawHitboxDebug() {
    const graphics = this.hitboxDebug;
    graphics.clear();
    graphics.lineStyle(1, 0xff3030, 0.95);
    graphics.fillStyle(0xff3030, 0.18);

    const collisionLayer = this.background?.getCollisionLayer();
    if (collisionLayer) {
      collisionLayer.forEachTile((tile) => {
        if (!tile.collides) return;
        const x = collisionLayer.tileToWorldX(tile.x);
        const y = collisionLayer.tileToWorldY(tile.y);
        graphics.fillRect(x, y, tile.width, tile.height);
        graphics.strokeRect(x, y, tile.width, tile.height);
      });
    }

    for (const sprite of [this.actor.sprite, this.cat.sprite]) {
      const { body } = sprite;
      graphics.strokeRect(body.x, body.y, body.width, body.height);
    }

    const zone = this.pc.zone;
    graphics.strokeRect(
      zone.x - zone.width / 2,
      zone.y - zone.height / 2,
      zone.width,
      zone.height,
    );
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
    this.engine.scene.input.keyboard.off('keydown-H', this._onHitboxDebugKey);
    this._unsubscribeHitboxSetting();
    if (this.worldCollider) this.engine.scene.physics.world.removeCollider(this.worldCollider);
    this.engine.scene.cameras.main.stopFollow();
    this.engine.scene.cameras.main.setBounds(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);
    this.hitboxDebug.destroy();
    this.actor.sprite.off('animationcomplete', this._onAttackAnimationComplete);
    for (const particle of this._attackParticles) {
      this.engine.scene.tweens.killTweensOf(particle);
      particle.destroy();
    }
    this._attackParticles.clear();
    this.actor.sprite.destroy();
    this.cat.destroy();
    this.pc.destroy();
    this.modeLabel.destroy();
    this.settingsButton.destroy();
  }

  /** @returns {void} */
  onPause() {}

  /** @returns {void} */
  onResume() {}
}
