import Phaser from 'phaser';

/** Name of the profile that also emits raw typed characters (see class comment). */
const TEXT_ENTRY_PROFILE = 'text-entry';

/** Handlers registered under this name receive EVERY action (used by ScreenManager). */
const WILDCARD = '*';

/**
 * Translates raw keyboard events into abstract action names for the active input profile.
 * This is the only place in the engine that looks at raw keyboard events.
 *
 * HOW KEYS ARE MATCHED: each profile's keyMap uses Phaser `KeyCodes` names ("UP", "E", "ENTER"...).
 * When a profile is activated, every name is converted via `Phaser.Input.Keyboard.KeyCodes[name]` into a numeric
 * code, and a keydown is matched on `event.keyCode`. (An unknown key name throws, so typos fail loudly.)
 * One single 'keydown' listener is attached to the keyboard plugin.
 *
 * Handlers receive `{ action, originalEvent }`; for 'text-char' the event also has `char`.
 *
 * SPECIAL CASE (text-entry): while the active profile is named "text-entry", a keydown that is NOT in
 * the keyMap and whose `event.key` is a single printable character (no Ctrl/Meta/Alt held) emits the action
 * 'text-char' with payload `{ char: event.key }`, even though it is not listed in the keyMap.
 *
 * EXTENSION: `on('*', handler)` receives every action; ScreenManager uses it to forward input to the top screen.
 *
 * ASSUMPTION: keys that were handled call `event.preventDefault()` so arrows/space/backspace don't scroll or
 * navigate the page.
 */
export class InputRouter {
  /**
   * @param {Phaser.Input.Keyboard.KeyboardPlugin} keyboardPlugin - e.g. scene.input.keyboard
   */
  constructor(keyboardPlugin) {
    /** @type {Phaser.Input.Keyboard.KeyboardPlugin} */
    this.keyboardPlugin = keyboardPlugin;
    /** @type {Map<string, import('./InputProfiles.js').InputProfile>} */
    this._profiles = new Map();
    this._activeProfileName = null;
    /** keyCode -> action for the active profile. @type {Map<number, string>} */
    this._codeToAction = new Map();
    /** action -> handlers. @type {Map<string, Set<Function>>} */
    this._handlers = new Map();

    keyboardPlugin.on('keydown', this._handleKeyDown, this);
  }

  /**
   * Supplies the available profiles (from parseInputProfiles). If a profile is already active it is re-applied.
   * @param {Map<string, import('./InputProfiles.js').InputProfile>} profiles
   * @returns {void}
   */
  setProfiles(profiles) {
    this._profiles = profiles;
    if (this._activeProfileName !== null) this.setProfile(this._activeProfileName);
  }

  /**
   * Activates a profile: from now on only its keyMap is used.
   * @param {string} profileName
   * @throws {Error} if the profile is unknown or contains a key name Phaser does not know
   * @returns {void}
   */
  setProfile(profileName) {
    const profile = this._profiles.get(profileName);
    if (!profile) throw new Error(`Unknown input profile: ${profileName}`);

    const codeToAction = new Map();
    for (const [keyName, action] of Object.entries(profile.keyMap)) {
      const code = Phaser.Input.Keyboard.KeyCodes[keyName];
      if (code === undefined) {
        throw new Error(`Input profile "${profileName}": unknown key name "${keyName}" (use Phaser KeyCodes names)`);
      }
      codeToAction.set(code, action);
    }
    this._activeProfileName = profileName;
    this._codeToAction = codeToAction;
  }

  /**
   * Registers a handler for an abstract action (or '*' for all actions).
   * @param {string} actionName
   * @param {(event: object) => void} handler
   * @returns {void}
   */
  on(actionName, handler) {
    if (!this._handlers.has(actionName)) this._handlers.set(actionName, new Set());
    this._handlers.get(actionName).add(handler);
  }

  /**
   * Removes a handler registered with `on`.
   * @param {string} actionName
   * @param {(event: object) => void} handler
   * @returns {void}
   */
  off(actionName, handler) {
    const set = this._handlers.get(actionName);
    if (set) set.delete(handler);
  }

  /**
   * Single global keydown listener.
   * @param {KeyboardEvent} event
   * @private
   * @returns {void}
   */
  _handleKeyDown(event) {
    const action = this._codeToAction.get(event.keyCode);
    if (action !== undefined) {
      event.preventDefault();
      this._emit({ action, originalEvent: event });
      return;
    }

    const isPrintable = typeof event.key === 'string' && event.key.length === 1
      && !event.ctrlKey && !event.metaKey && !event.altKey;
    if (this._activeProfileName === TEXT_ENTRY_PROFILE && isPrintable) {
      event.preventDefault();
      this._emit({ action: 'text-char', char: event.key, originalEvent: event });
    }
  }

  /**
   * Calls handlers for the event's action, then wildcard handlers.
   * @param {{action: string}} inputEvent
   * @private
   * @returns {void}
   */
  _emit(inputEvent) {
    for (const name of [inputEvent.action, WILDCARD]) {
      const set = this._handlers.get(name);
      if (set) [...set].forEach((handler) => handler(inputEvent)); // copy: handlers may call off()
    }
  }
}
