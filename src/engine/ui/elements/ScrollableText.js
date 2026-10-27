import Phaser from 'phaser';

const DEFAULT_WIDTH = 200;
const DEFAULT_HEIGHT = 80;
const DEFAULT_FONT_SIZE = '10px';
const DEFAULT_COLOR = '#ffffff';
const DEFAULT_FONT_FAMILY = 'monospace';

/**
 * A canvas-rendered `Phaser.GameObjects.Text` only has as many actual pixels to draw with as its
 * own logical (game-unit) size — the whole game canvas is then scaled up on top of that by
 * `DisplayManager`'s integer zoom (`game.scale.setZoom`, see display/DisplayManager.js), which
 * blurs/jaggies small text at zoom > 1 unless the Text object itself renders at a matching higher
 * internal pixel density to begin with. `resolution` is exactly that density knob. Recomputed
 * (not just set once) since the zoom can change later — window resize, entering/leaving
 * fullscreen — see the `resize`/`fullscreenchange` listeners below.
 * @param {Phaser.Scene} scene
 * @returns {number}
 */
function currentTextResolution(scene) {
  const zoom = scene.game?.scale?.zoom || 1;
  const dpr = window.devicePixelRatio || 1;
  // Clamped: past ~4x there's no visible sharpness gain at this engine's font sizes, and an
  // uncapped zoom*dpr (a large fullscreen window on a high-DPI/retina display easily produces
  // 8-10x) generates a needlessly huge per-Text canvas — some GPUs silently corrupt/garble glyphs
  // rather than erroring once a dynamic texture gets large enough, which reads as random blocky
  // artifacts in specific spots rather than a clean failure.
  return Math.min(zoom * dpr, 4);
}

/**
 * FIX (readability — text came out blurry/fuzzy, not crisp): `phaserConfig.js` sets
 * `pixelArt: true` project-wide so sprite textures use nearest-neighbor filtering (correct for
 * pixel art). Phaser's canvas-rendered Text objects are backed by a texture too, and by default
 * they inherit that same renderer-wide filter setting — nearest-neighbor sampling of an
 * antialiased font glyph is exactly the wrong filter (it's built for crisp hard pixel edges, not
 * smooth glyph curves), and is what was actually causing the fuzzy/aliased look, not a missing
 * `resolution` — `setResolution` alone was fighting the wrong filter the whole time. Forces this
 * one Text object's own texture back to linear/smooth filtering, independent of the project-wide
 * pixel-art default.
 * @param {Phaser.GameObjects.Text} textObject
 * @returns {void}
 */
function useLinearFiltering(textObject) {
  textObject.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
}

/**
 * A word-wrapped text panel that retains scrollback while rendering only the portion that fits
 * in its fixed viewport. Mouse-wheel scrolling browses retained output; new lines keep following
 * the bottom unless the user has scrolled into history.
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
 *
 * CLICKING A LINE: set `container.onLineClick = (lineIndex) => {...}` any time after this
 * returns (same opt-in pattern as `ListElement`'s `ctx.onItemClick`) to get a callback with the
 * index into the *committed* `lines` array (NOT the currently-visible slice — `renderFitting` may
 * have scrolled older lines out of view, so a raw visible-row count would point at the wrong
 * line the moment that happens). `lineIndex` lines up with whatever order the caller built via
 * `appendLine`, so a caller tracking "which block did line N belong to" (e.g. QuestLogScreenController
 * mapping lines back to quests) can use it directly.
 * @module ui/elements/ScrollableText
 */

/**
 * @param {Phaser.Scene} scene
 * @param {object} elementManifest - `{ id, type: 'scrollable-text', width?, height?, text?, fontSize?, color? }`
 * @param {{ settingsStore: object, windowHandle: object }} ctx
 * @returns {Phaser.GameObjects.Container} container also exposes `.appendLine(text)`,
 *   `.scrollToBottom()`, `.clear()`, `.setPendingLine(text)`,
 *   and the optional `.onLineClick(lineIndex)` hook described above
 */
export function buildScrollableText(scene, elementManifest, ctx) {
  const width = elementManifest.width ?? DEFAULT_WIDTH;
  const height = elementManifest.height ?? DEFAULT_HEIGHT;
  const fontSize = elementManifest.fontSize ?? DEFAULT_FONT_SIZE;
  const color = elementManifest.color ?? DEFAULT_COLOR;
  // Optional override — e.g. the Terminal's window manifest sets this to a loaded webfont (see
  // display/FontLoader.js) with a trailing `, monospace` fallback. Every other existing caller
  // omits it and keeps getting plain 'monospace', unchanged.
  const fontFamily = elementManifest.fontFamily ?? DEFAULT_FONT_FAMILY;

  const textObject = scene.add.text(0, 0, elementManifest.text ?? '', {
    fontFamily,
    fontSize,
    color,
    wordWrap: { width },
  });
  textObject.setResolution(currentTextResolution(scene));
  useLinearFiltering(textObject);

  const container = scene.add.container(0, 0, [textObject]);

  /** Committed, permanent lines (survive `setPendingLine` calls). History is intentionally
   * unbounded here (not trimmed on append) — only the DISPLAYED slice is capped to what fits;
   * if full scrollback is ever needed later, `lines` still has everything. */
  const lines = [];
  /** Current uncommitted input line (e.g. what the user is still typing), or null for none. */
  let pendingLine = null;

  /** First transcript line in the viewport. */
  let scrollOffset = 0;
  /** Whether new output should keep the viewport pinned to the newest lines. */
  let followsBottom = true;
  /** First line index that displays the newest output while filling the viewport. */
  let maxScrollOffset = 0;
  /**
   * BUG FIX (click hit-testing pointed at the wrong quest/line): visible ROWS and committed
   * LINES are not the same thing once word-wrap is involved — a single long `appendLine(...)`
   * call (e.g. a quest description) can render as two or more visual rows. The previous
   * pointerdown handler divided the click's local Y by one fixed `lineHeight` to get a row
   * count and used THAT directly as an index into `lines`, which only happens to be correct
   * for the first wrapped row of the first line; every row after any wrapped line is off by
   * however many extra rows wrapping has added above it, so clicks land on the wrong quest
   * (or on nothing) as soon as a description/title wraps. `rowOwners[visibleRow]` instead maps
   * every actually-rendered visual row to its real `lines` index, rebuilt on every `redraw()`.
   * @type {number[]}
   */
  let rowOwners = [];

  /**
   * Renders the largest wrapped slice that fits from the selected first line. At the bottom,
   * anchors the viewport to the newest output; when scrolled, the start index is preserved.
   * @param {string[]} allLines
   * @returns {void}
   */
  const renderFitting = (allLines) => {
    if (allLines.length === 0) {
      textObject.setText('');
      scrollOffset = 0;
      maxScrollOffset = 0;
      rowOwners = [];
      return;
    }

    let bottomStart = allLines.length - 1;
    textObject.setText(allLines.slice(bottomStart).join('\n'));
    while (bottomStart > 0) {
      const candidateStart = bottomStart - 1;
      textObject.setText(allLines.slice(candidateStart).join('\n'));
      if (textObject.height > height) {
        textObject.setText(allLines.slice(bottomStart).join('\n'));
        break;
      }
      bottomStart = candidateStart;
    }

    maxScrollOffset = bottomStart;
    const start = followsBottom
      ? bottomStart
      : Math.min(scrollOffset, bottomStart);
    scrollOffset = start;

    let end = start + 1;
    textObject.setText(allLines.slice(start, end).join('\n'));
    while (end < allLines.length) {
      textObject.setText(allLines.slice(start, end + 1).join('\n'));
      if (textObject.height > height) {
        textObject.setText(allLines.slice(start, end).join('\n'));
        break;
      }
      end += 1;
    }

    // Rebuild the visual-row -> real-line-index map (see `rowOwners` doc above). Each committed
    // line is measured on its own, with the exact same font/wordWrap settings as the real text
    // object, to find out how many rows IT ALONE renders as; that count of rows is then
    // attributed to that line's real index in `lines`.
    rowOwners = [];
    allLines.slice(start, end).forEach((lineText, i) => {
      rowHeightProbe.setText(lineText);
      const rowCount = Math.max(1, Math.round(rowHeightProbe.height / lineHeight));
      for (let r = 0; r < rowCount; r += 1) rowOwners.push(start + i);
    });
  };

  const redraw = () => {
    const allLines = pendingLine === null ? lines : [...lines, pendingLine];
    renderFitting(allLines);
    // FIX (blur came back after the very first keystroke/appendLine): `Text#setText` — called
    // inside `renderFitting` above, every single redraw — rebuilds the GameObject's underlying
    // WebGL texture from scratch each time (`renderer.canvasToTexture`), which resets its filter
    // back to this project's `pixelArt: true` default (nearest-neighbor) on every rebuild, not
    // just the first one. Setting it once at creation (further down) only held until the next
    // character typed; it has to be re-applied after every redraw, not once.
    useLinearFiltering(textObject);
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

  container.scrollToBottom = () => {
    followsBottom = true;
    scrollOffset = 0;
    redraw();
  };

  /** Removes all committed lines and any pending line. */
  container.clear = () => {
    lines.length = 0;
    pendingLine = null;
    followsBottom = true;
    scrollOffset = 0;
    redraw();
  };

  /** Optional per-line click hook; a no-op until a caller assigns one (see module docstring). */
  container.onLineClick = null;

  // One-line probe in the exact same style textObject uses, just to read a reliable per-line
  // pixel height back from Phaser (word-wrapped multi-line height isn't a clean multiple of a
  // single line's height, so measuring a lone line is the only accurate way to get this).
  const lineHeightProbe = scene.add.text(0, 0, 'Mg', { fontFamily, fontSize, wordWrap: { width } });
  const lineHeight = lineHeightProbe.height || 1;
  lineHeightProbe.destroy();

  // Reused every redraw to measure how many visual rows each individual committed line wraps
  // to (see `rowOwners` / `renderFitting` above). Not a child of `container`, so it must be
  // cleaned up explicitly when the container goes away, or it leaks a Text object + GL resources
  // every time this element is rebuilt (e.g. every time the Quest Log is reopened).
  const rowHeightProbe = scene.add.text(0, 0, '', { fontFamily, fontSize, wordWrap: { width } });
  container.once('destroy', () => rowHeightProbe.destroy());

  // Keeps `textObject`'s resolution matching the CURRENT zoom (see `currentTextResolution`'s own
  // doc) — a resize or fullscreen toggle changes `DisplayManager`'s integer zoom well after this
  // element is first built, and a stale resolution would silently go blurry again from that
  // point on.
  // FIX: `setResolution` rebuilds the Text object's internal canvas texture, which resets its
  // filter mode back to the project-wide `pixelArt` default — so `useLinearFiltering` has to be
  // re-applied every time resolution is recalculated, not just once at creation, or the blur
  // would come back the first time the window is resized/fullscreen is toggled.
  const updateTextResolution = () => {
    textObject.setResolution(currentTextResolution(scene));
    useLinearFiltering(textObject);
  };
  window.addEventListener('resize', updateTextResolution);
  document.addEventListener('fullscreenchange', updateTextResolution);
  container.once('destroy', () => {
    window.removeEventListener('resize', updateTextResolution);
    document.removeEventListener('fullscreenchange', updateTextResolution);
  });

  container.setInteractive(new Phaser.Geom.Rectangle(0, 0, width, height), Phaser.Geom.Rectangle.Contains);
  const localPoint = new Phaser.Math.Vector2();
  const onWheel = (pointer, _over, _deltaX, deltaY) => {
    container.getWorldTransformMatrix().applyInverse(pointer.worldX, pointer.worldY, localPoint);
    if (localPoint.x < 0 || localPoint.x > width || localPoint.y < 0 || localPoint.y > height) return;

    const allLines = pendingLine === null ? lines : [...lines, pendingLine];
    if (allLines.length === 0) return;
    const direction = Math.sign(deltaY);
    if (direction === 0) return;
    scrollOffset = Math.max(0, Math.min(maxScrollOffset, scrollOffset + direction * 3));
    followsBottom = scrollOffset === maxScrollOffset;
    redraw();
  };
  scene.input.on('wheel', onWheel);
  container.once('destroy', () => scene.input.off('wheel', onWheel));
  container.on('pointerdown', (pointer, localX, localY) => {
    if (!container.onLineClick) return;
    const visibleRow = Math.floor(localY / lineHeight);
    const realIndex = rowOwners[visibleRow];
    if (realIndex === undefined || realIndex < 0 || realIndex >= lines.length) return;
    container.onLineClick(realIndex);
  });

  return container;
}