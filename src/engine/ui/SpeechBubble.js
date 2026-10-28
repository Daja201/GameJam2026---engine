import { DEPTH } from '../display/DepthLayers.js';

/**
 * Small comic-style speech bubble: a white rounded rectangle with a dark outline, a short
 * downward tail, and a line of text — positioned above a character's head (e.g. during a
 * cutscene). Self-contained and scene-scoped; screen-fixed by default, or world-anchored with
 * `scrollFactor: 1`. The caller is responsible for calling `destroy()` when done, or pass
 * `holdMs` to auto-destroy.
 *
 * Sibling to `ToastNotifier.js` (same "small factory, caller owns the handle" shape), styled to
 * read as a comic bubble rather than a HUD panel: white fill instead of a dark panel, a tail
 * instead of a slide-in banner.
 * @module ui/SpeechBubble
 */

const PADDING_X = 8;
const PADDING_Y = 6;
const MAX_TEXT_WIDTH = 170;
const TAIL_HALF_WIDTH = 7;
const TAIL_HEIGHT = 8;
const CORNER_RADIUS = 6;
const FILL_COLOR = 0xffffff;
const BORDER_COLOR = 0x1a1a2a;
const TEXT_COLOR = '#1a1a2a';

/**
 * @param {Phaser.Scene} scene
 * @param {number} tipX - x of the tail's tip in the coordinate space selected by `scrollFactor`
 * @param {number} tipY - y of the tail's tip in the coordinate space selected by `scrollFactor`
 * @param {string} text
 * @param {{depth?: number, holdMs?: number, onDestroy?: () => void, scrollFactor?: number, keepInView?: boolean}} [opts]
 *   `depth` defaults to `DEPTH.FX_OVERLAY + 2` (above a full-screen cutscene backdrop/actors at `FX_OVERLAY`/`+1`);
 *   `scrollFactor` defaults to 0 for screen-fixed cutscene dialogue;
 *   `keepInView` clamps the bubble inside the main camera viewport;
 *   `holdMs`, if given, auto-destroys the bubble after that many ms and then calls `onDestroy`.
 * @returns {{ container: Phaser.GameObjects.Container, destroy: () => void }}
 */
export function createSpeechBubble(scene, tipX, tipY, text, opts = {}) {
  const scrollFactor = opts.scrollFactor ?? 0;
  const camera = scene.cameras.main;
  const view = scrollFactor === 0
    ? {
      left: camera.x,
      top: camera.y,
      right: camera.x + camera.width,
      bottom: camera.y + camera.height,
    }
    : camera.worldView;
  const viewWidth = view.right - view.left;
  const maxBoxWidth = Math.max(1, viewWidth - 4);

  const label = scene.add.text(0, 0, text, {
    fontFamily: 'monospace',
    fontSize: '8px',
    color: TEXT_COLOR,
    align: 'center',
    wordWrap: {
      width: Math.min(MAX_TEXT_WIDTH - PADDING_X * 2, maxBoxWidth - PADDING_X * 2),
      useAdvancedWrap: true,
    },
  }).setOrigin(0.5, 0.5);

  const boxWidth = Math.min(label.width + PADDING_X * 2, maxBoxWidth);
  const boxHeight = label.height + PADDING_Y * 2;
  const boxTop = -boxHeight - TAIL_HEIGHT;
  const containerX = opts.keepInView
    ? Phaser.Math.Clamp(tipX, view.left + TAIL_HALF_WIDTH + 2, view.right - TAIL_HALF_WIDTH - 2)
    : tipX;
  const boxCenterX = opts.keepInView
    ? Phaser.Math.Clamp(containerX, view.left + boxWidth / 2 + 2, view.right - boxWidth / 2 - 2)
    : containerX;
  const boxLeft = boxCenterX - containerX - boxWidth / 2;
  const boxRight = boxLeft + boxWidth;
  const tailBaseX = Phaser.Math.Clamp(
    0,
    boxLeft + CORNER_RADIUS + TAIL_HALF_WIDTH,
    boxRight - CORNER_RADIUS - TAIL_HALF_WIDTH,
  );

  const graphics = scene.add.graphics();
  graphics.fillStyle(FILL_COLOR, 1);
  graphics.fillRoundedRect(boxLeft, boxTop, boxWidth, boxHeight, CORNER_RADIUS);
  graphics.fillTriangle(
    tailBaseX - TAIL_HALF_WIDTH,
    boxTop + boxHeight,
    tailBaseX + TAIL_HALF_WIDTH,
    boxTop + boxHeight,
    0,
    0,
  );
  graphics.lineStyle(1.5, BORDER_COLOR, 1);
  graphics.strokeRoundedRect(boxLeft, boxTop, boxWidth, boxHeight, CORNER_RADIUS);
  graphics.lineBetween(tailBaseX - TAIL_HALF_WIDTH, boxTop + boxHeight, 0, 0);
  graphics.lineBetween(tailBaseX + TAIL_HALF_WIDTH, boxTop + boxHeight, 0, 0);

  label.setPosition(boxCenterX - containerX, boxTop + boxHeight / 2);

  let containerY = tipY;
  if (opts.keepInView) {
    containerY = Phaser.Math.Clamp(
      containerY,
      view.top + boxHeight + TAIL_HEIGHT + 2,
      view.bottom - 2,
    );
  }

  const container = scene.add.container(containerX, containerY, [graphics, label]);
  container.setScrollFactor(scrollFactor);
  container.setDepth(opts.depth ?? DEPTH.FX_OVERLAY + 2);

  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    container.destroy();
  };

  if (opts.holdMs) {
    scene.time.delayedCall(opts.holdMs, () => {
      destroy();
      opts.onDestroy?.();
    });
  }

  return { container, destroy };
}