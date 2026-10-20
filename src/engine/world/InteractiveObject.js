import { DEPTH } from '../display/DepthLayers.js';

/**
 * Invisible trigger area (e.g. a computer the player walks up to and presses "interact" on).
 * The zone is only a detection area; any visuals are separate GameObjects the caller adds.
 * Use `zone` (it has x/y) as the target for ProximityDetector.isWithinRadius, and call `trigger()`
 * when the interact action fires while the player is in range.
 *
 * ASSUMPTIONS: the optional prompt text is drawn centered just above the zone at
 * DEPTH.WORLD_FOREGROUND, in an 8px monospace font; `label` is shown as written (e.g. "[E] use").
 */
export class InteractiveObject {
  /**
   * @param {Phaser.Scene} scene
   * @param {number} x - zone center x
   * @param {number} y - zone center y
   * @param {{ width: number, height: number, label?: string, onInteract: () => void }} opts
   */
  constructor(scene, x, y, opts) {
    /** @type {Phaser.Scene} */
    this.scene = scene;
    this._onInteract = opts.onInteract;

    /** Invisible static physics zone used for detection. @type {Phaser.GameObjects.Zone} */
    this.zone = scene.add.zone(x, y, opts.width, opts.height);
    scene.physics.add.existing(this.zone, true); // true = static body

    /** Floating prompt text, or null when no label was given. @type {Phaser.GameObjects.Text|null} */
    this.prompt = null;
    if (opts.label) {
      this.prompt = scene.add.text(x, y - opts.height / 2 - 2, opts.label, {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: '#ffffff',
      });
      this.prompt.setOrigin(0.5, 1);
      this.prompt.setDepth(DEPTH.WORLD_FOREGROUND);
      this.prompt.setVisible(false);
    }
  }

  /**
   * Shows or hides the floating prompt. Does nothing if the object has no label.
   * @param {boolean} visible
   * @returns {void}
   */
  showPrompt(visible) {
    if (this.prompt) this.prompt.setVisible(visible);
  }

  /**
   * Runs the object's onInteract callback. Call when the Interact action fires AND
   * the player is in range (see ProximityDetector).
   * @returns {void}
   */
  trigger() {
    this._onInteract();
  }

  /**
   * Destroys the zone (and its body) and the prompt text.
   * @returns {void}
   */
  destroy() {
    this.zone.destroy();
    if (this.prompt) this.prompt.destroy();
    this.prompt = null;
  }
}
