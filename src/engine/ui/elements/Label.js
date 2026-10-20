/**
 * A plain text label element. Renders `elementManifest.text` verbatim — no binding, no interaction.
 * @module ui/elements/Label
 */

/**
 * @param {Phaser.Scene} scene
 * @param {object} elementManifest - `{ id, type: 'label', text }`
 * @param {{ settingsStore: import('../../settings/SettingsStore.js').SettingsStore, windowHandle: object }} ctx
 * @returns {Phaser.GameObjects.Container} container at (0,0); WindowFactory positions it
 */
export function buildLabel(scene, elementManifest, ctx) {
  const text = scene.add.text(0, 0, elementManifest.text ?? '', {
    fontFamily: 'monospace',
    fontSize: '10px',
    color: '#ffffff',
  });
  const container = scene.add.container(0, 0, [text]);
  return container;
}
