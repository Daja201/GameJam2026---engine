const ROW_HEIGHT = 16;
const REBIND_LABEL = '...press a key...';

/**
 * Renders one row per key binding of a given input profile, read from
 * `ctx.settingsStore.get('controls')` (an object of `profileName -> keyMap`, per module 06's
 * InputProfiles contract). Clicking a row's button enters a "listening for next keypress" state
 * and rebinds it on the next raw keydown.
 *
 * EXCEPTION: this is the one element allowed to listen to a raw keydown event directly — rebinding
 * is inherently about capturing a literal key, not an abstract action, so it cannot go through
 * InputRouter's abstract action layer. It listens on `scene.input.keyboard` directly and does not
 * touch InputRouter's own listener.
 * @module ui/elements/KeybindList
 */

/**
 * @param {Phaser.Scene} scene
 * @param {object} elementManifest - `{ id, type: 'keybind_list', profile }` - `profile` names which
 *   profile's keyMap (inside the `controls` settings object) to list and edit
 * @param {{ settingsStore: import('../../settings/SettingsStore.js').SettingsStore, windowHandle: object }} ctx
 * @returns {Phaser.GameObjects.Container} also carries `.unsubscribe`
 */
export function buildKeybindList(scene, elementManifest, ctx) {
  const { profile: profileName } = elementManifest;

  const rows = [];
  /** Action currently waiting for a keypress to rebind, or null. @type {string|null} */
  let listeningForAction = null;

  const container = scene.add.container(0, 0);

  const render = () => {
    rows.forEach((row) => row.destroy());
    rows.length = 0;
    container.removeAll(); // destroy() above already freed the GameObjects; just clear the container's list

    const controls = ctx.settingsStore.get('controls') ?? {};
    const keyMap = controls[profileName] ?? {};

    Object.entries(keyMap).forEach(([keyName, action], i) => {
      const y = i * ROW_HEIGHT;
      const label = scene.add.text(0, y, action, { fontFamily: 'monospace', fontSize: '10px', color: '#ffffff' });
      const isListening = listeningForAction === action;
      const buttonText = isListening ? REBIND_LABEL : keyName;
      const button = scene.add.text(100, y, buttonText, {
        fontFamily: 'monospace', fontSize: '10px', color: isListening ? '#ffcc66' : '#8affaa',
      }).setInteractive({ useHandCursor: true });
      button.on('pointerdown', () => {
        listeningForAction = action;
        render();
      });

      rows.push(label, button);
      container.add([label, button]);
    });
  };

  /** @param {KeyboardEvent} event */
  const onRawKeyDown = (event) => {
    if (!listeningForAction) return;
    const newKeyName = event.code.replace(/^Key|^Digit/, ''); // e.g. "KeyE" -> "E", "Digit1" -> "1"

    const controls = ctx.settingsStore.get('controls') ?? {};
    const keyMap = { ...(controls[profileName] ?? {}) };
    // Remove this action from whatever key previously held it, then bind it to the new key.
    for (const existingKey of Object.keys(keyMap)) {
      if (keyMap[existingKey] === listeningForAction) delete keyMap[existingKey];
    }
    keyMap[newKeyName] = listeningForAction;
    ctx.settingsStore.set('controls', { ...controls, [profileName]: keyMap });

    listeningForAction = null;
    render();
  };

  scene.input.keyboard.on('keydown', onRawKeyDown);
  const unsubscribeStore = ctx.settingsStore.subscribe('controls', render);
  render();

  container.unsubscribe = () => {
    scene.input.keyboard.off('keydown', onRawKeyDown);
    unsubscribeStore();
  };
  return container;
}