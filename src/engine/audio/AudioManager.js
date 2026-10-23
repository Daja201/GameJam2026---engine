import { SettingsStore } from '../settings/SettingsStore.js';

/**
 * Owns all sound playback: one background music track at a time, fire-and-forget SFX, and
 * category volumes synced live from `SettingsStore` (so module 07's sliders take effect
 * immediately, with no second code path needed here).
 *
 * MUTING: `audio.muted` is folded into the effective volume calculation inside `playMusic`/
 * `playSfx`/the volume subscriptions, never as an early return that skips playback. An early
 * return would desync state — e.g. a music track's loop position — from what the game thinks is
 * playing, so if the player unmutes mid-track, playback would jump or restart unexpectedly
 * instead of simply becoming audible again from wherever it already was.
 *
 * `init(scene)` only needs to be called ONCE from the bootstrap, not per-scene: Phaser's
 * `scene.sound` is backed by a single global `SoundManager` shared across all scenes by default,
 * so the scene passed in is just this manager's one-time access point to it.
 *
 * @module audio/AudioManager
 */

/** @type {Phaser.Scene|null} the scene `init()` was called with, kept only for `scene.sound`/`scene.tweens` access */
let initScene = null;
/** @type {Phaser.Sound.BaseSound|null} currently playing music track, if any */
let currentMusic = null;

/**
 * @param {'music'|'sfx'|'ambient'} category
 * @returns {number} effective 0..1 volume for that category, folding in `audio.muted`
 */
function effectiveCategoryVolume(category) {
  if (SettingsStore.get('audio.muted')) return 0;
  return SettingsStore.get('audio.master') * SettingsStore.get(`audio.${category}`);
}

export const AudioManager = {
  /**
   * One-time setup: stores access to `scene.sound` and subscribes to live volume changes.
   * Call exactly once from the bootstrap (module 11) — Phaser's SoundManager is shared across
   * scenes, so calling this again per-scene is unnecessary and would just re-subscribe.
   * @param {Phaser.Scene} scene
   * @returns {void}
   */
  init(scene) {
    initScene = scene;

    // Apply live slider changes to the currently playing music immediately. SFX don't need a
    // subscription since each one reads the current volume fresh at play time.
    SettingsStore.subscribe('audio.music', () => {
      if (currentMusic) currentMusic.setVolume(effectiveCategoryVolume('music'));
    });
    SettingsStore.subscribe('audio.master', () => {
      if (currentMusic) currentMusic.setVolume(effectiveCategoryVolume('music'));
    });
    SettingsStore.subscribe('audio.muted', () => {
      if (currentMusic) currentMusic.setVolume(effectiveCategoryVolume('music'));
    });
  },

  /**
   * Plays a music track, replacing any currently playing one. Without `opts.fadeMs`, the old
   * track is stopped immediately; with it, the old track's volume is tweened to 0 and then
   * stopped, so the new track starts under a crossfade-style fade-out.
   * @param {string} key - preloaded audio key
   * @param {{loop?: boolean, fadeMs?: number}} [opts]
   * @returns {void}
   */
  playMusic(key, opts = {}) {
    const scene = initScene;
    const previous = currentMusic;

    if (previous) {
      if (opts.fadeMs) {
        scene.tweens.add({
          targets: previous,
          volume: 0,
          duration: opts.fadeMs,
          onComplete: () => previous.stop(),
        });
      } else {
        previous.stop();
      }
    }

    currentMusic = scene.sound.add(key, {
      loop: opts.loop ?? true,
      volume: effectiveCategoryVolume('music'),
    });
    currentMusic.play();
  },

  /**
   * Stops the currently playing music track, if any.
   * @param {number} [fadeMs] - if given, tweens volume to 0 before stopping instead of stopping immediately
   * @returns {void}
   */
  stopMusic(fadeMs) {
    const track = currentMusic;
    if (!track) return;
    currentMusic = null;

    if (fadeMs) {
      initScene.tweens.add({
        targets: track,
        volume: 0,
        duration: fadeMs,
        onComplete: () => track.stop(),
      });
    } else {
      track.stop();
    }
  },

  /**
   * Fire-and-forget sound effect playback — no handle is kept, since SFX don't need one the way
   * music does.
   * @param {string} key - preloaded audio key
   * @param {{volume?: number}} [opts]
   * @returns {void}
   */
  playSfx(key, opts) {
    const relativeVolume = opts?.volume ?? 1;
    initScene.sound.play(key, { volume: relativeVolume * effectiveCategoryVolume('sfx') });
  },

  /**
   * Updates a category's volume setting. The actual volume application happens through the
   * subscriptions set up in `init`, so this is the only place that writes the setting — no
   * second code path also applies volume directly.
   * @param {'music'|'sfx'|'ambient'} category
   * @param {number} value - 0..1
   * @returns {void}
   */
  setCategoryVolume(category, value) {
    SettingsStore.set(`audio.${category}`, value);
  },
};
