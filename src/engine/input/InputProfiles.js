/**
 * Parsing of the controls config into named input profiles.
 *
 * Expected shape of `/config/controls.default.json` (profile name -> { Phaser key name -> abstract action }).
 * Key names are Phaser `KeyCodes` names (e.g. "UP", "A", "E", "ENTER", "ESC", "BACKSPACE"):
 *
 * ```jsonc
 * {
 *   "movement":   { "UP": "move-up", "DOWN": "move-down", "LEFT": "move-left", "RIGHT": "move-right", "E": "interact", "ENTER": "confirm", "BACKSPACE": "cancel" },
 *   "text-entry": { "ENTER": "text-enter", "BACKSPACE": "text-backspace", "ESC": "cancel" },
 *   "menu-nav":   { "UP": "menu-up", "DOWN": "menu-down", "ENTER": "confirm", "BACKSPACE": "cancel" }
 * }
 * ```
 *
 * FIX (ESC -> Backspace): every profile's "cancel" key is now BACKSPACE instead of ESC, EXCEPT
 * "text-entry" — that profile already binds BACKSPACE to "text-backspace" (deleting a typed
 * character, see TextInput.js/TerminalScreenController.js), and one key can only map to one
 * action per profile, so rebinding it to "cancel" there too would silently break backspacing text.
 * "text-entry" (used only by the Terminal screen) therefore keeps ESC as its one remaining
 * "cancel" key, as a deliberate, narrow exception to the rest of this rebind.
 * Key names are checked against Phaser's KeyCodes by InputRouter.setProfile (this file has no Phaser import).
 *
 * @module input/InputProfiles
 */

/**
 * @typedef {Object} InputProfile
 * @property {Record<string, string>} keyMap - raw Phaser key code name (e.g. "LEFT", "A") -> abstract action name
 */

/**
 * Converts the already-fetched controls config JSON into a Map of profiles.
 *
 * @param {object} controlsConfigJson - parsed content of controls.default.json
 * @returns {Map<string, InputProfile>} profile name -> profile
 * @throws {Error} if the config is not an object of objects whose values are non-empty action-name strings
 */
export function parseInputProfiles(controlsConfigJson) {
  const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!isPlainObject(controlsConfigJson)) {
    throw new Error('controls config must be an object of profiles');
  }

  /** @type {Map<string, InputProfile>} */
  const profiles = new Map();
  for (const [profileName, keyMap] of Object.entries(controlsConfigJson)) {
    if (!isPlainObject(keyMap)) {
      throw new Error(`controls config: profile "${profileName}" must be an object of key -> action`);
    }
    for (const [keyName, action] of Object.entries(keyMap)) {
      if (typeof action !== 'string' || action.length === 0) {
        throw new Error(`controls config: profile "${profileName}" key "${keyName}" must map to a non-empty action name`);
      }
    }
    profiles.set(profileName, { keyMap: { ...keyMap } });
  }
  return profiles;
}