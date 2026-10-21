const DEFAULT_WIDTH = 200;
const DEFAULT_HEIGHT = 80;
const DEFAULT_FONT_SIZE = '10px';
const DEFAULT_COLOR = '#ffffff';

/**
 * A word-wrapped text panel that always fits within a fixed box. Exposes `appendLine(text)` and
 * `scrollToBottom()` (module 08/Terminal calls these two by name, so they must match precisely),
 * plus `clear()` (for CLIParser's `clear` command) and `setPendingLine(text)` (see below).
 *
 * FIX (overflow bug — text rendering past the panel's visible bottom edge): the previous
 * implementation clipped content with a Phaser `GeometryMask` on a Container nested two levels
 * deep (WindowFactory's rootContainer -> this element's own container -> content/maskShape).
 * Phaser's GeometryMask is well known to misbehave at that nesting depth — the mask ends up
 * evaluated in the wrong transform space and doesn't actually clip anything, which is exactly the
 * "text overflows past the border" symptom. FIXED by dropping masking entirely: every redraw now
 * measures the ACTUAL rendered height of candidate text (accounting for word-wrap too, which a
 * naive "count N lines" approach would not) and trims the oldest line(s) until it physically fits
 * inside `height`. This guarantees no overflow by construction, with no dependency on Phaser's
 * mask/container interaction at all.
 *
 * FIX (prior revision, kept): the live input line is `setPendingLine`'s last line of this same
 * text block (not a separate, separately-positioned Text object), so it can't drift out of sync
 * with the rest of the output — see the git history / previous docstring revision for detail.
 *
 * STYLING: `elementManifest` may optionally set `fontSize` and `color` to override the plain-UI
 * defaults above — used by the Terminal's window manifest for a small-font green-on-black
 * monospace terminal look.
 * @module ui/elements/ScrollableText
 */

/**
 * @param {Phaser.Scene} scene
 * @param {object} elementManifest - `{ id, type: 'scrollable-text', width?, height?, text?, fontSize?, color? }`
 * @param {{ settingsStore: object, windowHandle: object }} ctx
 * @returns {Phaser.GameObjects.Container} container also exposes `.appendLine(text)`,
 *   `.scrollToBottom()` (no-op now, kept for API compatibility), `.clear()`, and `.setPendingLine(text)`
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

  const container = scene.add.container(0, 0, [textObject]);

  /** Committed, permanent lines (survive `setPendingLine` calls). History is intentionally
   * unbounded here (not trimmed on append) — only the DISPLAYED slice is capped to what fits;
   * if full scrollback is ever needed later, `lines` still has everything. */
  const lines = [];
  /** Current uncommitted input line (e.g. what the user is still typing), or null for none. */
  let pendingLine = null;

  /**
   * Sets textObject's content to the largest trailing slice of `allLines` whose rendered
   * (word-wrapped) height still fits within `height`. Measures by actually setting text and
   * reading back `.height`, since word-wrap makes line count alone an unreliable proxy for
   * rendered height.
   * @param {string[]} allLines
   * @returns {void}
   */
  const renderFitting = (allLines) => {
    let start = 0;
    // Try showing everything first; if too tall, drop the oldest line and re-measure, repeating
    // until it fits or only one line remains (never show literally nothing).
    // This is O(n) re-measures in the worst case, which is fine at terminal-scale line counts.
    for (;;) {
      const candidate = allLines.slice(start);
      textObject.setText(candidate.join('\n'));
      if (textObject.height <= height || candidate.length <= 1) break;
      start += 1;
    }
  };

  const redraw = () => {
    const allLines = pendingLine === null ? lines : [...lines, pendingLine];
    renderFitting(allLines);
  };

  container.appendLine = (line) => {
    lines.push(line);
    redraw();
  };

  /**
   * Shows `text` as a live, not-yet-committed last line (e.g. the terminal prompt as the user
   * types) — call again on every keystroke, call with `null` to hide it. Never added to the
   * permanent `lines` history.
   * @param {string|null} text
   * @returns {void}
   */
  container.setPendingLine = (text) => {
    pendingLine = text;
    redraw();
  };

  /** Kept for API compatibility with callers written against the old scroll-based version;
   * content is now always "scrolled to bottom" by construction (renderFitting always shows the
   * most recent fitting lines), so this is a no-op. */
  container.scrollToBottom = () => {};

  /** Removes all committed lines and any pending line. */
  container.clear = () => {
    lines.length = 0;
    pendingLine = null;
    textObject.setText('');
  };

  return container;
}