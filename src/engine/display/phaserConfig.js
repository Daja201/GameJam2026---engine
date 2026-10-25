import Phaser from 'phaser';
import { INTERNAL_WIDTH, INTERNAL_HEIGHT } from './constants.js';

/**
 * Builds the Phaser game config for the engine.
 *
 * Config key -> Phaser mapping (for review without running):
 * - `type: Phaser.AUTO`            -> Phaser.Game renderer selection: WebGL if available, else Canvas.
 * - `width` / `height`             -> GameConfig width/height: internal canvas resolution (480x270).
 * - `pixelArt: true`               -> GameConfig render.pixelArt: nearest-neighbour texture filtering + CSS image-rendering: pixelated.
 * - `antialias: false`             -> GameConfig render.antialias: disables WebGL/Canvas smoothing.
 * - `roundPixels: true`            -> GameConfig render.roundPixels: snaps sprite/camera positions to whole pixels.
 * - `physics.default: 'arcade'`    -> Enables the Arcade Physics plugin as the default world.
 * - `physics.arcade.debug: false`  -> Arcade world debug drawing off.
 * - `scale.mode: Phaser.Scale.NONE` -> ScaleManager does NOT auto-fit/auto-scale the canvas on its
 *   own; `DisplayManager` (module 02) is the single thing that resizes it, via `game.scale.setZoom()`.
 *   FIX (click hit-boxes offset from what's drawn, worse the longer the window had been resized):
 *   this used to be `Phaser.Scale.FIT`, WITH `DisplayManager.watchResize()` also calling
 *   `game.scale.setZoom()` on top of it. `FIT` keeps recomputing its own fit-to-parent scale on
 *   every resize; `setZoom()` sets a second, independent scale. Phaser's own docs call out that
 *   `setZoom()` is meant to pair with `Scale.NONE`, not `FIT`/`ENVELOP` (which already do their
 *   own scaling) — running both let the two drift out of sync, and Phaser's pointer-to-game
 *   coordinate math (used for EVERY button's hit-test) only honors one of them, so clicks landed
 *   wherever that one scale said, not where the other one had actually drawn things. `NONE` removes
 *   the competing calculation entirely: `DisplayManager`'s zoom is the only scale factor in play,
 *   so what's drawn and what's clickable always agree.
 * - `scale.autoCenter`             -> ScaleManager: center canvas horizontally and vertically in parent.
 * - `scene: sceneList`             -> SceneManager: scenes registered at boot (first is auto-started).
 *
 * Note: Phaser 3.80 accepts pixelArt/antialias/roundPixels at top level of the config
 * (they are shorthand for the `render` block), so they are set there as the module spec says.
 *
 * @param {Phaser.Scene[]} sceneList - Scene classes/instances to register.
 * @returns {Phaser.Types.Core.GameConfig} The game config object.
 */
export function buildPhaserConfig(sceneList) {
  return {
    type: Phaser.AUTO,
    // FIX (fullscreen click hitboxes): explicit parent so Phaser injects its canvas into
    // #game-root (see index.html's own comment) instead of directly into <body>. Fullscreen is
    // then requested on #game-root, not this canvas, so the browser's UA fullscreen stylesheet
    // (which forces width/height: 100% !important on the fullscreened element) stretches the
    // wrapper, never the canvas — Phaser's own explicit pixel sizing on the canvas (and its
    // pointer-to-game coordinate math, which depends on that size being exactly what Phaser set)
    // stays intact and in sync with what's actually drawn.
    parent: 'game-root',
    width: INTERNAL_WIDTH,
    height: INTERNAL_HEIGHT,
    pixelArt: true,
    antialias: false,
    roundPixels: true,
    physics: { default: 'arcade', arcade: { debug: false } },
    scale: { mode: Phaser.Scale.NONE, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: sceneList,
  };
}