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
 * - `scale.mode: Phaser.Scale.FIT` -> ScaleManager: fit canvas inside parent, keeping aspect ratio.
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
    width: INTERNAL_WIDTH,
    height: INTERNAL_HEIGHT,
    pixelArt: true,
    antialias: false,
    roundPixels: true,
    physics: { default: 'arcade', arcade: { debug: false } },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: sceneList,
  };
}
