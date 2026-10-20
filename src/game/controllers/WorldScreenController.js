import { ScreenController } from '../../engine/screens/ScreenController.js';
import { Actor } from '../../engine/sprites/Actor.js';
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

/**
 * Example "World" screen: one Actor the player walks around with arrow keys, and one
 * InteractiveObject ("the PC") that opens the Terminal screen when interacted with nearby.
 *
 * INPUT DESIGN NOTE (reconciles this module's own draft with how ScreenManager actually works):
 * `ScreenManager` already forwards every abstract InputRouter action to the active screen's
 * `onInput(action, event)` via one wildcard subscription (see `ScreenManager.js`'s constructor).
 * So this controller does NOT subscribe to `InputRouter` directly for discrete actions like
 * `interact`/`cancel`/`confirm` — it just implements `onInput`. Continuous movement is the one
 * exception: `InputRouter` only documents `keydown` (no `keyup`), so, per this module's own
 * prompt text, continuous movement is read every frame via Phaser's own
 * `scene.input.keyboard.createCursorKeys()` polling instead.
 * @module game/controllers/WorldScreenController
 */
export class WorldScreenController extends ScreenController {
  /** @param {object} [params] @returns {void} */
  onEnter(params) {
    const { scene } = this.engine;

    this.actor = new Actor(scene, 'example_character', INTERNAL_WIDTH / 2, INTERNAL_HEIGHT / 2);
    scene.cameras.main.startFollow(this.actor.sprite, true);

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

    this.cursors = scene.input.keyboard.createCursorKeys();
  }

  /**
   * @param {number} time
   * @param {number} delta
   * @returns {void}
   */
  onUpdate(time, delta) {
    const { scene } = this.engine;
    const cursors = this.cursors;
    const dx = (cursors.right.isDown ? 1 : 0) - (cursors.left.isDown ? 1 : 0);
    const dy = (cursors.down.isDown ? 1 : 0) - (cursors.up.isDown ? 1 : 0);

    if (dx !== 0 || dy !== 0) {
      const step = (WALK_SPEED * delta) / 1000;
      this.actor.sprite.x += dx * step;
      this.actor.sprite.y += dy * step;
      this.actor.setDirectionFromVector(dx, dy, 'walk');
    } else {
      this.actor.playState('idle');
    }
    this.actor.update(time, delta);

    this.pc.showPrompt(isWithinRadius(this.actor.sprite, this.pc.zone, INTERACT_RADIUS));

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
    if (action === 'interact') {
      if (isWithinRadius(this.actor.sprite, this.pc.zone, INTERACT_RADIUS)) this.pc.trigger();
    } else if (action === 'confirm') {
      this.engine.screenManager.push('settings_modal');
    } else if (action === 'cancel') {
      // ASSUMPTION: module 09 explicitly leaves the "what resets a loop" decision to this
      // example content (its own non-goal). Simplest standard choice for a jam demo: ESC in the
      // World starts a fresh loop and gives a flash as feedback.
      LoopManager.startNewLoop();
      LoopManager.reset();
      FxManager.flash(this.engine.scene, '#ffffff', 150);
    }
  }

  /** @returns {void} */
  onExit() {
    this.actor.sprite.destroy();
    this.pc.destroy();
    this.pcVisual.destroy();
  }

  /** @returns {void} */
  onPause() {}

  /** @returns {void} */
  onResume() {}
}
