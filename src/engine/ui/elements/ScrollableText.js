import Phaser from 'phaser';

const DEFAULT_WIDTH = 200;
const DEFAULT_HEIGHT = 80;
const DEFAULT_FONT_SIZE = '10px';
const DEFAULT_COLOR = '#ffffff';

/**
 * A word-wrapped, vertically scrolling text panel, clipped to a fixed rectangle via a geometry
 * mask. Exposes `appendLine(text)` and `scrollToBottom()` (module 08/Terminal calls these two by
 * name, so they must match precisely), plus `clear()` (for CLIParser's `clear` command) and
 * `setPendingLine(text)` (see below).
 *
 * FIX (terminal "doesn't write to fixed position" bug): the original design had the Terminal
 * controller draw its own separate `Phaser.GameObjects.Text` for the live input line, positioned
 * at a hardcoded (x, y) disconnected from this element's actual size/scroll state — so it drifted
 * out of sync with the scrolled output and wasn't visually "attached" to it. Fixed by moving the
 * live input line INTO this element as a genuine last line of the same text block: `setPendingLine`
 * redraws the buffer as `committed lines + pending line`, without pushing the pending text into the
 * permanent `lines` array, so backspacing/editing never touches committed history. Because it's
 * part of the exact same Text object/scroll math as everything else, it can never end up at a
 * stale fixed pixel position — it always sits immediately after the last committed line.
 *
 * STYLING: `elementManifest` may optionally set `fontSize` and `color` to override the plain-UI
 * defaults above — used by the Terminal's window manifest to get an authentic small-font
 * green-on-black monospace terminal look without needing a second, parallel text element.
 * @module ui/elements/ScrollableText
 */

/**
 * @param {Phaser.Scene} scene
 * @param {object} elementManifest - `{ id, type: 'scrollable-text', width?, height?, text?, fontSize?, color? }`
 * @param {{ settingsStore: object, windowHandle: object }} ctx
 * @returns {Phaser.GameObjects.Container} container also exposes `.appendLine(text)`,
 *   `.scrollToBottom()`, `.clear()`, and `.setPendingLine(text)`
 */
export function buildScrollableText(scene, elementManifest, ctx) {
  const width = elementManifest.width ?? DEFAULT_WIDTH;
  const height = elementManifest.height ?? DEFAULT_HEIGHT;
  const fontSize = elementManifest.fontSize ?? DEFAULT_FONT_SIZE;
  const color = elementManifest.color ?? DEFAULT_COLOR;

  const textObject = scene.add.text(0, 0, elementManifest.text ?? '', {
    fontFamily: 'monospace',
    fontSize,
    color,
    wordWrap: { width },
  });

  const content = scene.add.container(0, 0, [textObject]);

  const maskShape = scene.add.graphics();
  maskShape.fillRect(0, 0, width, height);
  maskShape.setVisible(false);
  content.mask = maskShape.createGeometryMask();

  /** Committed, permanent lines (survive `setPendingLine` calls). */
  const lines = [];
  /** Current uncommitted input line (e.g. what the user is still typing), or null for none. */
  let pendingLine = null;

  const redraw = () => {
    const allLines = pendingLine === null ? lines : [...lines, pendingLine];
    textObject.setText(allLines.join('\n'));
    container.scrollToBottom();
  };

  const container = scene.add.container(0, 0, [content, maskShape]);

  container.appendLine = (line) => {
    lines.push(line);
    redraw();
  };

  /**
   * Shows `text` as a live, not-yet-committed last line (e.g. the terminal prompt as the user
   * types) — call again on every keystroke, call with `null` to hide it. Never added to the
   * permanent `lines` history. See module docstring for why this replaced a separately
   * positioned Text object.
   * @param {string|null} text
   * @returns {void}
   */
  container.setPendingLine = (text) => {
    pendingLine = text;
    redraw();
  };

  container.scrollToBottom = () => {
    const overflow = Math.max(0, textObject.height - height);
    content.y = Phaser.Math.Clamp(height - textObject.height, -overflow, 0);
  };

  /** Removes all committed lines and any pending line. */
  container.clear = () => {
    lines.length = 0;
    pendingLine = null;
    textObject.setText('');
    content.y = 0;
  };

  return container;
}
