/**
 * AssetRegistry — singleton index of every validated manifest.
 *
 * !! CONSTRAINT FOR MODULE 11 (bootstrap) !!
 * A browser cannot list folders, so `scan()` does NOT discover manifests by itself.
 * The caller must supply a PRE-ENUMERATED list of manifest file paths (hardcoded in the
 * example content, or generated at build time). Example:
 *
 *   await AssetRegistry.scan(scene, {
 *     sprites:     ['graphics/sprites/hero/manifest.json'],
 *     backgrounds: ['graphics/backgrounds/forest/manifest.json'],
 *     screens:     ['screens/title/manifest.json'],
 *     windows:     ['graphics/ui/windows/settings/manifest.json'],
 *   });
 *
 * Usage notes:
 * - Manifests are fetched through the scene's Phaser loader (HTTP), never Node `fs`.
 * - `scan()` calls `scene.load.start()` itself, so it can be called from a scene's `create()`
 *   or from `preload()` (in `preload()` you cannot `await` it; the returned promise
 *   simply resolves when the loader completes, so prefer `create()` of a boot scene).
 * - After scan, queue the actual PNGs with PreloadQueueBuilder, then start the loader again.
 *
 * ASSUMPTIONS:
 * - Signature is `scan(scene, manifestPaths)` as module 03's prompt specifies, because the
 *   shared contract's `scan(rootPath)` cannot work in a browser.
 * - Each manifest's `id` must equal its containing folder name (shared contract rule).
 * - Screen `background` and `ui_windows` references are checked after indexing, against
 *   everything registered so far, so scan backgrounds/windows in the same call as screens
 *   (or earlier).
 *
 * @module assets/AssetRegistry
 */

import { AssetValidationError } from './AssetValidationError.js';
import { validateManifest } from './ManifestValidator.js';
import {
  SPRITE_MANIFEST_SCHEMA,
  BACKGROUND_MANIFEST_SCHEMA,
  SCREEN_MANIFEST_SCHEMA,
  WINDOW_MANIFEST_SCHEMA,
} from './ManifestSchemas.js';

/** Per-kind config: key into manifestPaths, schema, and label for error messages. */
const KINDS = [
  { kind: 'sprites', schema: SPRITE_MANIFEST_SCHEMA, label: 'sprite' },
  { kind: 'backgrounds', schema: BACKGROUND_MANIFEST_SCHEMA, label: 'background' },
  { kind: 'screens', schema: SCREEN_MANIFEST_SCHEMA, label: 'screen' },
  { kind: 'windows', schema: WINDOW_MANIFEST_SCHEMA, label: 'window' },
];

/** @type {Record<string, Map<string, object>>} manifests by kind, keyed by manifest `id`. */
const manifests = { sprites: new Map(), backgrounds: new Map(), screens: new Map(), windows: new Map() };

/** @type {Record<string, Map<string, string>>} id -> file path it was loaded from, by kind. */
const sources = { sprites: new Map(), backgrounds: new Map(), screens: new Map(), windows: new Map() };

/**
 * Queues all manifest JSON files on the scene loader and waits for completion.
 * @param {Phaser.Scene} scene
 * @param {{key: string, path: string}[]} entries
 * @returns {Promise<Set<string>>} keys of files that failed to load
 */
function loadJsonFiles(scene, entries) {
  return new Promise((resolve) => {
    const failedKeys = new Set();
    const onError = (file) => failedKeys.add(file.key);
    scene.load.on('loaderror', onError);
    scene.load.once('complete', () => {
      scene.load.off('loaderror', onError);
      resolve(failedKeys);
    });
    for (const { key, path } of entries) scene.load.json(key, path);
    scene.load.start();
  });
}

/**
 * Throws a plain Error if the id is not registered; otherwise returns the manifest.
 * @param {string} kind
 * @param {string} label
 * @param {string} id
 * @returns {object}
 */
function getOrThrow(kind, label, id) {
  const manifest = manifests[kind].get(id);
  if (!manifest) throw new Error(`Unknown ${label} id: ${id}`);
  return manifest;
}

/**
 * Singleton registry matching the AssetRegistry interface in the shared contract
 * (with the browser-compatible `scan(scene, manifestPaths)` signature).
 */
export const AssetRegistry = {
  /**
   * Fetches, validates and indexes every listed manifest.
   * Rejects with AssetValidationError on a missing/unparseable file, schema violation,
   * id/folder mismatch, duplicate id, or dangling screen reference.
   *
   * @param {Phaser.Scene} scene - scene whose loader will fetch the manifests
   * @param {{ sprites?: string[], backgrounds?: string[], screens?: string[], windows?: string[] }} manifestPaths
   * @returns {Promise<void>} resolves after scene.load completes and every manifest is validated and indexed
   */
  async scan(scene, manifestPaths) {
    const entries = [];
    for (const { kind } of KINDS) {
      for (const path of manifestPaths[kind] || []) {
        entries.push({ kind, path, key: `manifest:${kind}:${path}` });
      }
    }

    const failedKeys = await loadJsonFiles(scene, entries);

    for (const { kind, schema } of KINDS) {
      for (const entry of entries.filter((e) => e.kind === kind)) {
        const json = scene.cache.json.get(entry.key);
        if (failedKeys.has(entry.key) || json === undefined || json === null) {
          throw new AssetValidationError(entry.path, '(file)', 'file could not be loaded (missing or not valid JSON)');
        }
        validateManifest(json, schema, entry.path);

        // Shared contract: id must match the containing folder name.
        const parts = entry.path.split('/');
        const folder = parts[parts.length - 2];
        if (folder !== undefined && folder !== json.id) {
          throw new AssetValidationError(entry.path, 'id', `id "${json.id}" must match its folder name "${folder}"`);
        }

        // Same id from a different file is a clash; re-scanning the same file just refreshes it.
        const previous = sources[kind].get(json.id);
        if (previous !== undefined && previous !== entry.path) {
          throw new AssetValidationError(entry.path, 'id', `duplicate id "${json.id}" (already defined in ${previous})`);
        }
        manifests[kind].set(json.id, json);
        sources[kind].set(json.id, entry.path);
      }
    }

    // Cross-reference check: screens may only reference registered backgrounds/windows.
    for (const [id, screen] of manifests.screens) {
      const path = sources.screens.get(id);
      if (screen.background !== null && !manifests.backgrounds.has(screen.background)) {
        throw new AssetValidationError(path, 'background', `unknown background id "${screen.background}"`);
      }
      screen.ui_windows.forEach((windowId, i) => {
        if (!manifests.windows.has(windowId)) {
          throw new AssetValidationError(path, `ui_windows[${i}]`, `unknown window id "${windowId}"`);
        }
      });
    }
  },

  /**
   * @param {string} id
   * @returns {SpriteManifest}
   * @throws {Error} `Unknown sprite id: ${id}`
   */
  getSpriteManifest(id) { return getOrThrow('sprites', 'sprite', id); },

  /**
   * @param {string} id
   * @returns {BackgroundManifest}
   * @throws {Error} `Unknown background id: ${id}`
   */
  getBackgroundManifest(id) { return getOrThrow('backgrounds', 'background', id); },

  /**
   * @param {string} id
   * @returns {ScreenManifest}
   * @throws {Error} `Unknown screen id: ${id}`
   */
  getScreenManifest(id) { return getOrThrow('screens', 'screen', id); },

  /**
   * @param {string} id
   * @returns {WindowManifest}
   * @throws {Error} `Unknown window id: ${id}`
   */
  getWindowManifest(id) { return getOrThrow('windows', 'window', id); },

  /** @returns {string[]} ids of all registered sprites. */
  listSpriteIds() { return [...manifests.sprites.keys()]; },

  /** @returns {string[]} ids of all registered backgrounds. */
  listBackgroundIds() { return [...manifests.backgrounds.keys()]; },

  /** @returns {string[]} ids of all registered screens. */
  listScreenIds() { return [...manifests.screens.keys()]; },
};
