const BOX_SIZE = 12;

/**
 * A checkbox-style toggle. On `'pointerdown'`, flips the boolean at `elementManifest.bind` in
 * the SettingsStore. Visual fill state is driven entirely by `settingsStore.subscribe`, so it
 * also updates when the value changes elsewhere (e.g. a keybind reset elsewhere in the UI).
 * @module ui/elements/Toggle
 */

/**
 * @param {Phaser.Scene} scene
 * @param {object} elementManifest - `{ id, type: 'toggle', bind }`
 * @param {{ settingsStore: import('../../settings/SettingsStore.js').SettingsStore, windowHandle: object }} ctx
 * @returns {Phaser.GameObjects.Container} also carries `.unsubscribe`
 */
export function buildToggle(scene, elementManifest, ctx) {
  const { bind } = elementManifest;

  const box = scene.add.rectangle(0, 0, BOX_SIZE, BOX_SIZE, 0x1a1a2a).setOrigin(0, 0);
  box.setStrokeStyle(1, 0x8a8aaa);
  const fill = scene.add.rectangle(2, 2, BOX_SIZE - 4, BOX_SIZE - 4, 0x8affaa).setOrigin(0, 0);

  const applyVisual = (value) => fill.setVisible(Boolean(value));
  applyVisual(ctx.settingsStore.get(bind));

  box.setInteractive({ useHandCursor: true });
  box.on('pointerdown', () => {
    ctx.settingsStore.set(bind, !ctx.settingsStore.get(bind));
  });

  const unsubscribe = ctx.settingsStore.subscribe(bind, applyVisual);

  const container = scene.add.container(0, 0, [box, fill]);
  container.unsubscribe = unsubscribe;
  return container;
}
