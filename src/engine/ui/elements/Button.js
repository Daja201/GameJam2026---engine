import { invokeAction } from '../ActionRegistry.js';

/** Default pixel size for a button when `elementManifest.width`/`height` are not given. */
const DEFAULT_WIDTH = 96;
const DEFAULT_HEIGHT = 16;

/**
 * A clickable button: a rectangle background with centered label text. On `'pointerdown'`,
 * calls `invokeAction(elementManifest.action, ctx)` if `action` is set.
 * @module ui/elements/Button
 */

/**
 * @param {Phaser.Scene} scene
 * @param {object} elementManifest - `{ id, type: 'button', text, action?, width?, height? }`
 * @param {{ settingsStore: object, windowHandle: object }} ctx - forwarded as-is to the invoked action
 * @returns {Phaser.GameObjects.Container}
 */
export function buildButton(scene, elementManifest, ctx) {
  const width = elementManifest.width ?? DEFAULT_WIDTH;
  const height = elementManifest.height ?? DEFAULT_HEIGHT;

  const backgroundColor = elementManifest.backgroundColor ?? 0x2a2a3a;
  const textColor = elementManifest.textColor ?? '#35e0a8';
  const borderColor = elementManifest.borderColor ?? 0x6a6a8a;
  const bg = scene.add.rectangle(0, 0, width, height, backgroundColor).setOrigin(0, 0);
  bg.setStrokeStyle(1, borderColor);
  const label = scene.add.text(width / 2, height / 2, elementManifest.text ?? '', {
    fontFamily: 'monospace',
    fontSize: '10px',
    color: textColor,
  }).setOrigin(0.5, 0.5);

  bg.setInteractive({ useHandCursor: true });
  bg.on('pointerdown', () => {
    if (elementManifest.action) invokeAction(elementManifest.action, ctx);
  });

  const container = scene.add.container(0, 0, [bg, label]);
  return container;
}
