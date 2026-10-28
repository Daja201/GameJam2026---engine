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
  const label = scene.add.text(0, 0, text, {
    fontFamily: 'monospace',
    fontSize: '8px',
    color: TEXT_COLOR,
    align: 'center',
    wordWrap: { width: MAX_TEXT_WIDTH - PADDING_X * 2, useAdvancedWrap: true },
  }).setOrigin(0.5, 0.5);

  const boxWidth = label.width + PADDING_X * 2;
  const boxHeight = label.height + PADDING_Y * 2;
  // Local coords: tail tip is the container's (0, 0); everything else sits above it.
  const boxTop = -boxHeight - TAIL_HEIGHT;

  const graphics = scene.add.graphics();
  graphics.fillStyle(FILL_COLOR, 1);
  graphics.fillRoundedRect(-boxWidth / 2, boxTop, boxWidth, boxHeight, CORNER_RADIUS);
  // Tail drawn as a filled triangle from the box's bottom edge down to the tip, then the box
  // outline on top so the tail reads as part of the same shape (no seam at the box edge).
  graphics.fillTriangle(-TAIL_HALF_WIDTH, boxTop + boxHeight, TAIL_HALF_WIDTH, boxTop + boxHeight, 0, 0);
  graphics.lineStyle(1.5, BORDER_COLOR, 1);
  graphics.strokeRoundedRect(-boxWidth / 2, boxTop, boxWidth, boxHeight, CORNER_RADIUS);
  graphics.lineBetween(-TAIL_HALF_WIDTH, boxTop + boxHeight, 0, 0);
  graphics.lineBetween(TAIL_HALF_WIDTH, boxTop + boxHeight, 0, 0);

  label.setPosition(0, boxTop + boxHeight / 2);

  let containerX = tipX;
  let containerY = tipY;
  if (opts.keepInView) {
    const view = scene.cameras.main.worldView;
    containerX = Phaser.Math.Clamp(
      containerX,
      view.left + boxWidth / 2 + 2,
      view.right - boxWidth / 2 - 2,
    );
    containerY = Phaser.Math.Clamp(
      containerY,
      view.top + boxHeight + TAIL_HEIGHT + 2,
      view.bottom - 2,
    );
  }

  const container = scene.add.container(containerX, containerY, [graphics, label]);
  container.setScrollFactor(opts.scrollFactor ?? 0);
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