/**
 * Loads a custom webfont via the FontFace API, once, caching the in-flight/resolved promise so
 * asking for the same font again (e.g. re-entering a screen) doesn't refetch it.
 *
 * WHY THIS EXISTS: Phaser's canvas-rendered `Text` GameObjects silently fall back to the
 * browser's default font if a Text object referencing a custom `fontFamily` is created before
 * that font has actually finished loading — just naming it in a Phaser text style is NOT enough,
 * the font file has to already be registered on `document.fonts` first. `main.js` awaits
 * `loadFont(...)` once at boot, before the Menu screen (and therefore before anything that could
 * ever reach a screen using the font, e.g. Terminal) is shown — `ScreenManager` already builds a
 * screen's `ui_windows` (and therefore its Text objects) BEFORE that screen's own `onEnter()`
 * runs, so there is no later, per-screen hook that would still be in time.
 *
 * @module display/FontLoader
 */

/** @type {Map<string, Promise<FontFace>>} */
const _loaded = new Map();

/**
 * @param {string} family - the CSS font-family name Text objects should reference
 * @param {string} url - path to the font file (e.g. 'graphics/fonts/Ubuntu_Mono/UbuntuMono-Regular.ttf')
 * @returns {Promise<FontFace>} resolves once the font is loaded AND registered on `document.fonts`
 */
export function loadFont(family, url) {
  const cacheKey = `${family}::${url}`;
  const cached = _loaded.get(cacheKey);
  if (cached) return cached;

  const promise = (async () => {
    const face = new FontFace(family, `url(${url})`);
    const loadedFace = await face.load();
    document.fonts.add(loadedFace);
    return loadedFace;
  })();

  _loaded.set(cacheKey, promise);
  return promise;
}
