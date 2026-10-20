const DEFAULT_WIDTH = 96;
const HEIGHT = 14;

/**
 * A text entry box rendered entirely in canvas (no HTML `<input>` overlay, to keep pixel-art/
 * canvas consistency). Click to focus; while focused, listens for the abstract `text-char` /
 * `text-backspace` / `text-enter` actions from module 06's InputRouter (passed in as
 * `ctx.inputRouter`) and edits a local buffer, committing it to the SettingsStore on `text-enter`.
 *
 * ASSUMPTION: focusing this element does not itself switch the active input profile — module 11's
 * screen/window wiring is expected to set the InputRouter to the `text-entry` profile while a
 * TextInput is focused (otherwise `text-char` never fires). Losing focus (clicking elsewhere) just
 * stops listening; it does not restore the previous profile, since this element has no way to know it.
 * @module ui/elements/TextInput
 */

/**
 * @param {Phaser.Scene} scene
 * @param {object} elementManifest - `{ id, type: 'text-input', bind, width? }`
 * @param {{ settingsStore: import('../../settings/SettingsStore.js').SettingsStore, windowHandle: object, inputRouter?: import('../../input/InputRouter.js').InputRouter }} ctx
 * @returns {Phaser.GameObjects.Container} also carries `.unsubscribe` (detaches InputRouter listeners)
 */
export function buildTextInput(scene, elementManifest, ctx) {
  const { bind } = elementManifest;
  const width = elementManifest.width ?? DEFAULT_WIDTH;

  let buffer = String(ctx.settingsStore.get(bind) ?? '');
  let isFocused = false;

  const box = scene.add.rectangle(0, 0, width, HEIGHT, 0x1a1a2a).setOrigin(0, 0);
  box.setStrokeStyle(1, 0x6a6a8a);
  const text = scene.add.text(2, 2, buffer, { fontFamily: 'monospace', fontSize: '10px', color: '#ffffff' });

  const redraw = () => text.setText(buffer);

  const onChar = (event) => {
    if (!isFocused) return;
    buffer += event.char;
    redraw();
  };
  const onBackspace = () => {
    if (!isFocused) return;
    buffer = buffer.slice(0, -1);
    redraw();
  };
  const onEnter = () => {
    if (!isFocused) return;
    ctx.settingsStore.set(bind, buffer);
  };

  if (ctx.inputRouter) {
    ctx.inputRouter.on('text-char', onChar);
    ctx.inputRouter.on('text-backspace', onBackspace);
    ctx.inputRouter.on('text-enter', onEnter);
  }

  box.setInteractive({ useHandCursor: true });
  box.on('pointerdown', () => {
    isFocused = true;
    box.setStrokeStyle(1, 0xffffff);
  });

  const container = scene.add.container(0, 0, [box, text]);
  container.unsubscribe = () => {
    if (!ctx.inputRouter) return;
    ctx.inputRouter.off('text-char', onChar);
    ctx.inputRouter.off('text-backspace', onBackspace);
    ctx.inputRouter.off('text-enter', onEnter);
  };
  return container;
}
