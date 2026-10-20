const ROW_HEIGHT = 12;

/**
 * Renders `elementManifest.items` (an array of strings) as stacked text rows, with optional
 * per-row click handling via `ctx.onItemClick(index)`.
 * @module ui/elements/ListElement
 */

/**
 * @param {Phaser.Scene} scene
 * @param {object} elementManifest - `{ id, type: 'list', items: string[] }`
 * @param {{ settingsStore: object, windowHandle: object, onItemClick?: (index: number) => void }} ctx
 * @returns {Phaser.GameObjects.Container}
 */
export function buildListElement(scene, elementManifest, ctx) {
  const items = elementManifest.items ?? [];
  const rows = items.map((itemText, index) => {
    const row = scene.add.text(0, index * ROW_HEIGHT, itemText, {
      fontFamily: 'monospace',
      fontSize: '10px',
      color: '#ffffff',
    });
    if (ctx.onItemClick) {
      row.setInteractive({ useHandCursor: true });
      row.on('pointerdown', () => ctx.onItemClick(index));
    }
    return row;
  });

  return scene.add.container(0, 0, rows);
}
