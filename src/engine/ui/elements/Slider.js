import Phaser from 'phaser';

/** Default geometry when the manifest doesn't specify one. */
const DEFAULT_TRACK_WIDTH = 96;
const TRACK_HEIGHT = 4;
const HANDLE_SIZE = 10;

/**
 * A horizontal slider: a track rectangle + a draggable handle rectangle. Dragging computes a
 * 0..1 ratio from the handle's clamped x-position, maps it to `[min, max]`, and writes it to
 * `ctx.settingsStore` at `elementManifest.bind` on every drag update. Reads the starting value
 * from the store at build time, and stays in sync with external changes via `subscribe`.
 * @module ui/elements/Slider
 */

/**
 * @param {Phaser.Scene} scene
 * @param {object} elementManifest - `{ id, type: 'slider', bind, min, max, width? }`
 * @param {{ settingsStore: import('../../settings/SettingsStore.js').SettingsStore, windowHandle: object }} ctx
 * @returns {Phaser.GameObjects.Container} also carries `.unsubscribe` so WindowFactory can clean it up
 */
export function buildSlider(scene, elementManifest, ctx) {
  const { bind, min, max } = elementManifest;
  const width = elementManifest.width ?? DEFAULT_TRACK_WIDTH;

  const track = scene.add.rectangle(0, HANDLE_SIZE / 2, width, TRACK_HEIGHT, 0x444455).setOrigin(0, 0.5);
  const handle = scene.add.rectangle(0, HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE, 0xdddddd).setOrigin(0.5, 0.5);

  /** @param {number} value @returns {number} handle x for this value */
  const valueToX = (value) => {
    const ratio = (value - min) / (max - min);
    return Phaser.Math.Clamp(ratio, 0, 1) * width;
  };

  handle.x = valueToX(ctx.settingsStore.get(bind));

  handle.setInteractive({ useHandCursor: true });
  scene.input.setDraggable(handle);
  handle.on('drag', (pointer, dragX) => {
    const clampedX = Phaser.Math.Clamp(dragX, 0, width);
    handle.x = clampedX;
    const ratio = clampedX / width;
    const value = min + ratio * (max - min);
    ctx.settingsStore.set(bind, value);
  });

  const unsubscribe = ctx.settingsStore.subscribe(bind, (newValue) => {
    handle.x = valueToX(newValue);
  });

  const container = scene.add.container(0, 0, [track, handle]);
  container.unsubscribe = unsubscribe;
  return container;
}
