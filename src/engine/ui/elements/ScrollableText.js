import Phaser from 'phaser';

const DEFAULT_WIDTH = 200;
const DEFAULT_HEIGHT = 80;
const LINE_HEIGHT = 12;

/**
 * A word-wrapped, vertically scrolling text panel, clipped to a fixed rectangle via a geometry
 * mask. Exposes `scrollToBottom()` and `appendLine(text)` — module 08 (Terminal) calls these two
 * methods by name, so they must match precisely. Also exposes `clear()`: module 08's CLIParser
 * documents a built-in `clear` command that calls `ui.clear()` (shared contract), which nothing
 * else in this element previously provided — FIX, added so that command actually works.
 * @module ui/elements/ScrollableText
 */

/**
 * @param {Phaser.Scene} scene
 * @param {object} elementManifest - `{ id, type: 'scrollable-text', width?, height?, text? }`
 * @param {{ settingsStore: object, windowHandle: object }} ctx
 * @returns {Phaser.GameObjects.Container} container also exposes `.appendLine(text)` and `.scrollToBottom()`
 */
export function buildScrollableText(scene, elementManifest, ctx) {
  const width = elementManifest.width ?? DEFAULT_WIDTH;
  const height = elementManifest.height ?? DEFAULT_HEIGHT;

  const textObject = scene.add.text(0, 0, elementManifest.text ?? '', {
    fontFamily: 'monospace',
    fontSize: '10px',
    color: '#ffffff',
    wordWrap: { width },
  });

  const content = scene.add.container(0, 0, [textObject]);

  const maskShape = scene.add.graphics();
  maskShape.fillRect(0, 0, width, height);
  maskShape.setVisible(false);
  content.mask = maskShape.createGeometryMask();

  const lines = [];

  /**
   * Clamps the text's vertical scroll so its bottom never rises above the panel's bottom edge
   * and its top never drops below the panel's top edge.
   * @returns {void}
   */
  const clampScroll = () => {
    const overflow = Math.max(0, textObject.height - height);
    content.y = Phaser.Math.Clamp(content.y, -overflow, 0);
  };

  const container = scene.add.container(0, 0, [content, maskShape]);

  container.appendLine = (line) => {
    lines.push(line);
    textObject.setText(lines.join('\n'));
    container.scrollToBottom();
  };

  container.scrollToBottom = () => {
    content.y = height - textObject.height;
    clampScroll();
  };

  /** Removes all lines (FIX: needed by CLIParser's `clear` command — see module docstring). */
  container.clear = () => {
    lines.length = 0;
    textObject.setText('');
    content.y = 0;
  };

  return container;
}
