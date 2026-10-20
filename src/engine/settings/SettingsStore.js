import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from './SettingsSchema.js';

/**
 * The engine's single reactive settings store: every other module (module 07's slider/toggle
 * elements, module 09's FxManager, module 06's controls, this file's own AudioManager) reads and
 * writes through this. Implemented as a module-level singleton (`SettingsStore` below) for the
 * same reason as `LoopManager` — it must be importable and used from anywhere without
 * instantiation, and must survive Phaser scene restarts untouched.
 *
 * @module settings/SettingsStore
 */

const STORAGE_KEY = `hackjam:settings:v${SETTINGS_SCHEMA_VERSION}`;

/**
 * Reads a dotted path out of a plain object, e.g. `getAtPath(obj, 'audio.music')` reads
 * `obj.audio.music`. Pure, exported standalone for unit testing.
 * @param {object} obj
 * @param {string} path - dot-separated, e.g. `'audio.music'`
 * @returns {*} the value at that path, or `undefined` if any segment along the way is missing
 */
export function getAtPath(obj, path) {
  return path.split('.').reduce((node, segment) => (node == null ? undefined : node[segment]), obj);
}

/**
 * Writes a dotted path into a plain object, creating intermediate objects as needed, e.g.
 * `setAtPath(obj, 'audio.music', 0.5)` ensures `obj.audio` exists and sets `obj.audio.music = 0.5`.
 * Mutates `obj` in place. Pure aside from that mutation, exported standalone for unit testing.
 * @param {object} obj
 * @param {string} path - dot-separated, e.g. `'audio.music'`
 * @param {*} value
 * @returns {void}
 */
export function setAtPath(obj, path, value) {
  const segments = path.split('.');
  const lastSegment = segments.pop();
  const parent = segments.reduce((node, segment) => {
    if (typeof node[segment] !== 'object' || node[segment] === null) node[segment] = {};
    return node[segment];
  }, obj);
  parent[lastSegment] = value;
}

/**
 * Deep-merges `overrides` onto a clone of `base`, so fields present only in `base` (e.g. a new
 * default field added after a player's save was written) survive, while any field present in
 * `overrides` wins. Arrays and non-plain-object values in `overrides` replace the base value
 * outright (no element-wise array merging) — simplest behavior, sufficient for a settings object.
 * @param {object} base
 * @param {object} overrides
 * @returns {object} a new object; neither argument is mutated
 */
function deepMergeOnto(base, overrides) {
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(overrides ?? {})) {
    const isPlainObject = value !== null && typeof value === 'object' && !Array.isArray(value);
    const baseIsPlainObject = result[key] !== null && typeof result[key] === 'object' && !Array.isArray(result[key]);
    result[key] = isPlainObject && baseIsPlainObject ? deepMergeOnto(result[key], value) : value;
  }
  return result;
}

class SettingsStoreImpl {
  constructor() {
    /** @type {object} */
    this._values = structuredClone(DEFAULT_SETTINGS); // structuredClone, not JSON.parse(JSON.stringify(...))
    /** @type {Map<string, Set<(newValue:*)=>void>>} path -> subscribed callbacks */
    this._subscribers = new Map();
    /** @type {Set<(event:{path:string,value:*})=>void>} listeners for every write, any path */
    this._anyChangeListeners = new Set();
  }

  /**
   * @param {string} path - dotted path, e.g. `'audio.music'`
   * @returns {*} the current value at that path
   */
  get(path) {
    return getAtPath(this._values, path);
  }

  /**
   * Writes a value, notifies subscribers of that exact path, notifies `onAnyChange` listeners,
   * then persists via `save()`. Every write saves immediately — a simple, non-debounced
   * implementation, acceptable at jam scale; a production version might debounce this to avoid
   * hammering localStorage on every slider-drag frame.
   * @param {string} path
   * @param {*} value
   * @returns {void}
   */
  set(path, value) {
    setAtPath(this._values, path, value);

    const subscribers = this._subscribers.get(path);
    if (subscribers) subscribers.forEach((callback) => callback(value));

    this._anyChangeListeners.forEach((listener) => listener({ path, value }));

    this.save();
  }

  /**
   * Subscribes to changes at one exact dotted path.
   * @param {string} path
   * @param {(newValue:*) => void} callback
   * @returns {() => void} unsubscribe function
   */
  subscribe(path, callback) {
    if (!this._subscribers.has(path)) this._subscribers.set(path, new Set());
    this._subscribers.get(path).add(callback);
    return () => {
      const subscribers = this._subscribers.get(path);
      if (subscribers) subscribers.delete(callback);
    };
  }

  /**
   * Subscribes to every `set()` call, any path — matches the shared contract's `'settings:changed'`
   * event shape `{ path, value }`, without requiring a full Phaser EventEmitter.
   * @param {(event:{path:string,value:*}) => void} callback
   * @returns {void}
   */
  onAnyChange(callback) {
    this._anyChangeListeners.add(callback);
  }

  /**
   * Removes a listener added with `onAnyChange`.
   * @param {(event:{path:string,value:*}) => void} callback
   * @returns {void}
   */
  offAnyChange(callback) {
    this._anyChangeListeners.delete(callback);
  }

  /**
   * Persists the current settings to localStorage.
   * @returns {void}
   */
  save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this._values));
  }

  /**
   * Loads settings from localStorage, deep-merged over `DEFAULT_SETTINGS` (so new default fields
   * added after a save was written still appear). If nothing is stored, or the stored JSON is
   * malformed, falls back to defaults — a malformed save logs a `console.warn` rather than
   * crashing the game.
   * @returns {void}
   */
  load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      this._values = structuredClone(DEFAULT_SETTINGS);
      return;
    }
    try {
      const stored = JSON.parse(raw);
      this._values = deepMergeOnto(DEFAULT_SETTINGS, stored);
    } catch (error) {
      console.warn(`[SettingsStore] stored settings at "${STORAGE_KEY}" are malformed; falling back to defaults.`, error);
      this._values = structuredClone(DEFAULT_SETTINGS);
    }
  }
}

/** Module-level singleton. Import this directly — never construct `SettingsStoreImpl` yourself. */
export const SettingsStore = new SettingsStoreImpl();
