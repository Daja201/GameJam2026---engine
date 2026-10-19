import Phaser from 'phaser';
import { INTERNAL_WIDTH, INTERNAL_HEIGHT } from './constants.js';
import { DEPTH } from './DepthLayers.js';

/**
 * @callback TransitionFn
 * @param {Phaser.Scene} scene
 * @param {'in'|'out'} direction
 * @param {() => void} onComplete
 * @returns {void}
 */

const FADE_MS = 300;
const WIPE_MS = 300;
const FLICKER_MS = 40;
const FLICKER_COUNT = 3;

/** @type {Map<string, TransitionFn>} */
const registry = new Map();

/**
 * Registers (or replaces) a transition. Lets other modules add styles
 * without editing this file.
 * @param {string} name - Name used in ScreenManifest.transition_in/out.
 * @param {TransitionFn} fn
 * @returns {void}
 */
export function registerTransition(name, fn) {
  registry.set(name, fn);
}

/**
 * Looks up a transition by name.
 * @param {string} name
 * @returns {TransitionFn}
 * @throws {Error} If no transition with that name is registered.
 */
export function getTransition(name) {
  const fn = registry.get(name);
  if (!fn) throw new Error(`Unknown transition: "${name}"`);
  return fn;
}

/**
 * Runs a named transition.
 * @param {string} name
 * @param {Phaser.Scene} scene
 * @param {'in'|'out'} direction
 * @param {() => void} onComplete
 * @returns {void}
 */
export function runTransition(name, scene, direction, onComplete) {
  getTransition(name)(scene, direction, onComplete);
}

/** Camera fade to/from black, completion via Phaser camera events. @type {TransitionFn} */
function fade(scene, direction, onComplete) {
  const cam = scene.cameras.main;
  if (direction === 'in') {
    cam.once('camerafadeincomplete', () => onComplete());
    cam.fadeIn(FADE_MS, 0, 0, 0);
  } else {
    cam.once('camerafadeoutcomplete', () => onComplete());
    cam.fadeOut(FADE_MS, 0, 0, 0);
  }
}

/** No visual effect; completes synchronously. @type {TransitionFn} */
function instant(scene, direction, onComplete) {
  onComplete();
}

/**
 * Black rectangle sliding across the screen.
 * 'out': covers the screen from the right edge to fully covering.
 * 'in': starts covering and slides off to the left.
 * @type {TransitionFn}
 */
function wipeLeft(scene, direction, onComplete) {
  const w = INTERNAL_WIDTH;
  const h = INTERNAL_HEIGHT;
  // Rectangle origin is its center (0.5), so x is the center point.
  const startX = direction === 'out' ? w + w / 2 : w / 2;
  const endX = direction === 'out' ? w / 2 : -w / 2;
  const rect = scene.add.rectangle(startX, h / 2, w, h, 0x000000);
  rect.setScrollFactor(0);
  rect.setDepth(DEPTH.FX_OVERLAY);
  scene.tweens.add({
    targets: rect,
    x: endX,
    duration: WIPE_MS,
    onComplete: () => {
      rect.destroy();
      onComplete();
    },
  });
}

/** Short series of camera flashes with decreasing duration. @type {TransitionFn} */
function crtFlicker(scene, direction, onComplete) {
  const cam = scene.cameras.main;
  let i = 0;
  const step = () => {
    if (i >= FLICKER_COUNT) {
      onComplete();
      return;
    }
    // Alternate white and green; duration decreases each flash (40, ~27, ~13 ms).
    const dur = Math.max(1, Math.round(FLICKER_MS * (FLICKER_COUNT - i) / FLICKER_COUNT));
    if (i % 2 === 0) cam.flash(dur, 255, 255, 255);
    else cam.flash(dur, 0, 255, 70);
    i += 1;
    scene.time.delayedCall(dur, step);
  };
  step();
}

registerTransition('fade', fade);
registerTransition('instant', instant);
registerTransition('wipe-left', wipeLeft);
registerTransition('crt-flicker', crtFlicker);
