/**
 * Default settings shape and schema version for the engine's single reactive settings store
 * (`SettingsStore.js`). This is the single source of truth: `/config/settings.default.json` is
 * meant to mirror this object's content manually at project setup time (a browser can't import a
 * `.js` file as its fetched config), so if you change a default here, update that JSON file too.
 *
 * `controls` starts empty and is populated at runtime by module 11's bootstrap from
 * `/config/controls.default.json` (module 06's `InputProfiles.js` shape), not from this file.
 *
 * @module settings/SettingsSchema
 */

/** @type {object} */
export const DEFAULT_SETTINGS = {
  audio: { music: 0.7, sfx: 0.8, ambient: 0.5, muted: false },
  video: { pixelScale: 'auto', crtEnabled: true, glitchEnabled: true, reducedMotion: false },
  controls: {}, // populated at runtime from /config/controls.default.json by module 11's bootstrap
  accessibility: { textSize: 'normal' },
};

/**
 * Bump this when `DEFAULT_SETTINGS`'s shape changes in a way that makes old localStorage saves
 * worth starting over from (SettingsStore keys localStorage by this version, so bumping it
 * effectively discards old saves rather than trying to migrate them).
 * @type {number}
 */
export const SETTINGS_SCHEMA_VERSION = 1;
