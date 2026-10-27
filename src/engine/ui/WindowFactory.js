import { INTERNAL_WIDTH, INTERNAL_HEIGHT } from '../display/constants.js';
import { DEPTH } from '../display/DepthLayers.js';
import { buildLabel } from './elements/Label.js';
import { buildButton } from './elements/Button.js';
import { buildSlider } from './elements/Slider.js';
import { buildToggle } from './elements/Toggle.js';
import { buildTextInput } from './elements/TextInput.js';
import { buildKeybindList } from './elements/KeybindList.js';
import { buildScrollableText } from './elements/ScrollableText.js';
import { buildListElement } from './elements/ListElement.js';

/**
 * Builds every on-screen UI panel (settings menu, dialogue boxes, terminal frame, HUD widgets)
 * from a generic, manifest-driven WindowManifest (01_SHARED_CONTRACTS.md). This is the only
 * place in the engine that assembles UI panels; everything else just calls `WindowFactory.build`.
 *
 * ROW SPACING (vertical-list layout): ROW_HEIGHT = 24px, document here since it's not in the
 * shared contract.
 * GRID COLUMNS (grid layout): GRID_COLUMNS = 3, chosen as a simple default that fits comfortably
 * inside INTERNAL_WIDTH at the engine's panel sizes.
 * SKIN PATH CONVENTION: a window's panel texture is expected to already be loaded (by module 03)
 * under the key `${manifest.skin}:panel`, from `/graphics/ui/windows/${manifest.skin}/panel.png`
 * (module 03 does not special-case UI skins, so this file documents the convention it relies on).
 * @module ui/WindowFactory
 */

const ROW_HEIGHT = 24;
const GRID_COLUMNS = 3;
// FIX (centered + scrollable settings): 'vertical-list' content is now centered horizontally and
// wrapped in a scrollable, masked viewport with a themed right-edge scrollbar (like a website's),
// instead of a flush left-aligned, never-scrolling column. CONTENT_PADDING matches the nineslice's
// own border inset (16, see the `scene.add.nineslice(...)` call below) so content never sits under
// the panel's drawn frame; SCROLLBAR_WIDTH/SCROLLBAR_GAP reserve a thin strip along the right edge
// for the track+thumb, subtracted from the width content is centered within so centering accounts
// for the scrollbar instead of visually drifting left of it.
const CONTENT_PADDING = 16;
const SCROLLBAR_WIDTH = 6;
const SCROLLBAR_GAP = 6;
const SCROLLBAR_COLOR = 0x35e0a8; // this project's one recurring accent color (HUD bar/border, map ring)
const SCROLLBAR_TRACK_COLOR = 0x1a1a2a;
const WHEEL_SCROLL_SPEED = 0.4;
// FIX (auto-size): used only when manifest.size is NOT given — the minimum a panel can shrink
// to, and the breathing room left around measured content so elements don't sit flush against
// the panel's edge/nineslice border.
const MIN_PANEL_WIDTH = 64;
const MIN_PANEL_HEIGHT = 48;
const AUTO_SIZE_PADDING = 12;
// FIX (fill-size): used only when manifest.size === 'fill' — how much of INTERNAL_WIDTH/HEIGHT
// the panel leaves as a margin on each side, so a "full screen" window still shows a sliver of
// whatever's behind it (world/backdrop) instead of covering literally every pixel.
const FILL_MARGIN = 8;

/**
 * Parses a `"#rrggbb"` string into a Phaser-style `0xrrggbb` number, for `manifest.backgroundColor`
 * on a skin-less window (see the panel-building block below). Returns `null` for anything that
 * doesn't match, in which case the caller falls back to black.
 * @param {string} hex
 * @returns {number|null}
 */
function parseHexColor(hex) {
  const match = typeof hex === 'string' ? /^#?([0-9a-fA-F]{6})$/.exec(hex.trim()) : null;
  return match ? parseInt(match[1], 16) : null;
}

/** Element type name -> builder function. */
const ELEMENT_BUILDERS = {
  label: buildLabel,
  button: buildButton,
  slider: buildSlider,
  toggle: buildToggle,
  'text-input': buildTextInput,
  keybind_list: buildKeybindList,
  'scrollable-text': buildScrollableText,
  list: buildListElement,
};

/**
 * Computes the root container's top-left position for a given anchor.
 * @param {string} anchor - only `'center'` is required; anything else also falls back to center
 *   (documented here since the spec only mandates `'center'` support)
 * @param {number} panelWidth
 * @param {number} panelHeight
 * @returns {{x:number, y:number}}
 */
function resolveAnchorPosition(anchor, panelWidth, panelHeight) {
  // 'center' (and the fallback for any unrecognized anchor) places the panel in the middle
  // of the internal resolution.
  return {
    x: (INTERNAL_WIDTH - panelWidth) / 2,
    y: (INTERNAL_HEIGHT - panelHeight) / 2,
  };
}

/**
 * Positions each element container according to `manifest.layout`.
 * @param {Phaser.GameObjects.Container[]} elementContainers - in the same order as `manifest.elements`
 * @param {object[]} elementManifests - `manifest.elements`
 * @param {string} layout - `'vertical-list' | 'grid' | 'free'`
 * @returns {void}
 */
function layoutElements(elementContainers, elementManifests, layout) {
  elementContainers.forEach((container, i) => {
    const elementManifest = elementManifests[i];
    if (layout === 'grid') {
      const col = i % GRID_COLUMNS;
      const row = Math.floor(i / GRID_COLUMNS);
      const cellWidth = 64; // fixed cell size; simplest default for a jam-scale UI
      container.setPosition(col * cellWidth, row * ROW_HEIGHT);
    } else if (layout === 'free') {
      container.setPosition(elementManifest.x ?? 0, elementManifest.y ?? 0);
    } else {
      // 'vertical-list' (also the default for an unrecognized layout value)
      container.setPosition(0, i * ROW_HEIGHT);
    }
  });
}

/**
 * Measures an element container's own footprint in its local space. Must be called before the
 * container is positioned by `layoutElements` and before it's added to `rootContainer` — while
 * it's still a detached, (0,0)-rooted container, `getBounds()` returns exactly its own
 * local-space bounding box (no parent transform to subtract out).
 * @param {Phaser.GameObjects.Container} container
 * @returns {{width:number, height:number}}
 */
function measureElement(container) {
  const bounds = container.getBounds();
  return { width: bounds.width, height: bounds.height };
}

/**
 * FIX (auto-size): computes the smallest panel size that fits every laid-out element, used when
 * `manifest.size` isn't given in the manifest. Elements are already positioned (by
 * `layoutElements`, called beforehand) in container-local space; this just finds the
 * furthest-right and furthest-down edge across all of them and adds padding.
 * @param {Phaser.GameObjects.Container[]} elementContainers - already positioned
 * @param {{width:number, height:number}[]} sizes - same order/index as elementContainers,
 *   from `measureElement` (captured before positioning)
 * @returns {{width:number, height:number}}
 */
function computeAutoSize(elementContainers, sizes) {
  let maxRight = 0;
  let maxBottom = 0;
  elementContainers.forEach((container, i) => {
    const size = sizes[i];
    maxRight = Math.max(maxRight, container.x + size.width);
    maxBottom = Math.max(maxBottom, container.y + size.height);
  });
  return {
    width: Math.max(MIN_PANEL_WIDTH, maxRight + AUTO_SIZE_PADDING * 2),
    height: Math.max(MIN_PANEL_HEIGHT, maxBottom + AUTO_SIZE_PADDING * 2),
  };
}

/**
 * @typedef {Object} WindowHandle
 * @property {Phaser.GameObjects.Container} container
 * @property {() => void} close
 * @property {(elementId: string, value: any) => void} setElementValue
 * @property {(elementId: string) => Phaser.GameObjects.Container|undefined} getElement
 *   FIX: added because some elements expose custom methods beyond the generic bind/value
 *   contract (e.g. `scrollable-text`'s `appendLine`/`scrollToBottom`, used by module 08's
 *   Terminal) that `setElementValue` has no way to reach. Returns the exact container the
 *   element's builder produced, or `undefined` if `elementId` isn't in this window.
 */

export const WindowFactory = {
  /**
   * @param {Phaser.Scene} scene
   * @param {WindowManifest} manifest - from `AssetRegistry.getWindowManifest(id)`
   * @param {{ settingsStore: import('../settings/SettingsStore.js').SettingsStore, inputRouter?: import('../input/InputRouter.js').InputRouter }} ctx
   * @returns {WindowHandle}
   * @throws {Error} if an element's `type` has no registered builder
   */
  build(scene, manifest, ctx) {
    // FIX (auto-size): build + measure elements BEFORE deciding panel size/position, so a
    // manifest that omits `size` gets a panel sized to fit its content instead of the old
    // hardcoded 200x120 fallback. Elements are built detached (no parent, no windowHandle
    // dependency on container state) so measuring them here has no side effects.
    const windowHandleRef = {}; // filled in once `handle` exists below, so elements can reference it
    const elementCtx = { settingsStore: ctx.settingsStore, inputRouter: ctx.inputRouter, windowHandle: windowHandleRef };

    const elementsById = new Map();
    const elementContainers = [];
    const elementSizes = [];
    for (const elementManifest of manifest.elements) {
      const builder = ELEMENT_BUILDERS[elementManifest.type];
      if (!builder) throw new Error(`WindowFactory: no builder registered for element type "${elementManifest.type}"`);
      const elementContainer = builder(scene, elementManifest, elementCtx);
      elementsById.set(elementManifest.id, elementContainer);
      elementContainers.push(elementContainer);
      elementSizes.push(measureElement(elementContainer)); // must happen before layoutElements moves it
    }
    layoutElements(elementContainers, manifest.elements, manifest.layout);

    // FIX (fill-size): `manifest.size` has three forms now —
    //   - { width, height } (unchanged): exact size, as before.
    //   - omitted: auto-fit tightly to content (previous FIX), for small HUD-style windows.
    //   - the literal string 'fill': take up (almost) the whole INTERNAL_WIDTH/HEIGHT canvas,
    //     regardless of how little content there is — for windows that should visually dominate
    //     the screen (e.g. a quest log or settings menu meant to feel full-screen).
    const sizingMode = manifest.size === 'fill' ? 'fill' : manifest.size ? 'explicit' : 'auto';
    const autoSize = sizingMode === 'auto' ? computeAutoSize(elementContainers, elementSizes) : null;
    const fillSize = sizingMode === 'fill'
      ? { width: INTERNAL_WIDTH - FILL_MARGIN * 2, height: INTERNAL_HEIGHT - FILL_MARGIN * 2 }
      : null;
    const panelWidth = sizingMode === 'explicit' ? manifest.size.width : sizingMode === 'fill' ? fillSize.width : autoSize.width;
    const panelHeight = sizingMode === 'explicit' ? manifest.size.height : sizingMode === 'fill' ? fillSize.height : autoSize.height;
    if (sizingMode === 'auto') {
      // Shift every element inward so content doesn't sit flush against the auto-sized panel's
      // edge — the same padding computeAutoSize() budgeted for when it measured maxRight/maxBottom.
      elementContainers.forEach((container) => {
        container.setPosition(container.x + AUTO_SIZE_PADDING, container.y + AUTO_SIZE_PADDING);
      });
    }
    // 'fill' intentionally does NOT auto-pad/shift elements: a fill window's content is expected
    // to be laid out (via 'free' x/y, typically) against the panel's own known full-canvas size,
    // the same way the existing 480x270 explicit-size manifests already position their elements.
    const { x, y } = resolveAnchorPosition(manifest.anchor, panelWidth, panelHeight);

    const rootContainer = scene.add.container(x, y);
    rootContainer.setDepth(DEPTH.UI_WINDOW);
    // FIX: the engine runs every screen inside ONE Phaser Scene/camera (ScreenManager docstring),
    // and WorldScreenController calls cameras.main.startFollow(player). Phaser's input/hit-test
    // system does NOT correctly account for a non-default scrollFactor (known Phaser limitation):
    // rendering respects setScrollFactor(0) fine, so the window still looks screen-fixed, but
    // click hit-testing keeps using the camera's scroll, so the clickable area drifts by roughly
    // how far the camera has scrolled since boot. Walk further -> bigger offset; walk far enough
    // and the hit-box lands entirely outside the visible window and nothing registers at all.
    // FIX (different approach): leave scrollFactor at its default (1) — the code path Phaser's
    // input system is actually built and tested for — and instead manually re-position the
    // container every frame to cancel out the camera's scroll: screenPos = basePos + camera.scroll.
    // That keeps it visually pinned to the screen exactly like scrollFactor(0) did, but hit-testing
    // now works against the container's *real* position, which always matches what's drawn.
    const basePosition = { x, y };
    const cam = scene.cameras.main;
    const repositionRoot = () => {
      rootContainer.setPosition(basePosition.x + cam.scrollX, basePosition.y + cam.scrollY);
    };
    repositionRoot();
    // FIX (shaking GUI): this used to run on the scene's 'update' event. Scene 'update' fires
    // during the *update* step of the frame, but the camera's follow logic (which changes
    // scrollX/scrollY) only runs afterwards, during the *render* step (Camera.preRender). So a
    // scene-'update' listener always read last frame's scroll value, one step behind the scroll
    // the renderer was about to draw with. Visually that 1-frame lag shows up as the whole window
    // jittering/shaking in the opposite direction of player movement, worse the faster you move.
    // Camera's 'followupdate' event fires synchronously inside preRender, right after scrollX/Y
    // are recalculated for this frame and before anything is drawn, so reading cam.scrollX/Y here
    // always matches what's about to be rendered — no lag, no shake. It only fires while the
    // camera has an active follow target, which matches every screen that showed the shake; when
    // nothing is being followed the scroll never changes anyway, so the initial repositionRoot()
    // call above already leaves the window correctly placed.
    cam.on('followupdate', repositionRoot);

    /** @type {Phaser.GameObjects.Rectangle|null} */
    let overlay = null;
    let repositionOverlay = null;
    if (manifest.modal) {
      overlay = scene.add.rectangle(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT, 0x000000, 0.5);
      overlay.setOrigin(0, 0);
      overlay.setDepth(DEPTH.UI_MODAL_OVERLAY);
      overlay.setInteractive(); // no handler: this alone swallows clicks to anything below it
      // Same fix as rootContainer: track the camera's 'followupdate' event (fired at the right
      // point in the frame, see above) instead of scene 'update', so the overlay's actual
      // (hit-tested) position never lags a frame behind its visible, screen-fixed position.
      repositionOverlay = () => {
        overlay.setPosition(cam.scrollX, cam.scrollY);
      };
      repositionOverlay();
      cam.on('followupdate', repositionOverlay);
    }

    // `manifest.skin` is optional: most windows still use a nineslice-framed panel texture
    // (unchanged, see SKIN PATH CONVENTION doc above). A window with `"skin": null` instead gets
    // a single flat rectangle with NO 9-slice border/chrome at all — for a screen meant to read
    // as a full takeover (e.g. the Terminal) rather than "a window opened over the world/UI
    // behind it". `manifest.backgroundColor` (a `"#rrggbb"` string) tints it; omitted, it's
    // pure black (`0x000000`) — e.g. an OLED-style terminal background.
    if (manifest.showPanel !== false) {
      const panel = manifest.skin
        ? scene.add.nineslice(
            0, 0, `${manifest.skin}:panel`,
            undefined, panelWidth, panelHeight,
            16, 16, 16, 16, // default slice insets; a jam-scale skin convention, not asset-specific
          ).setOrigin(0, 0)
        : scene.add.rectangle(
            0, 0, panelWidth, panelHeight,
            parseHexColor(manifest.backgroundColor) ?? 0x000000,
          ).setOrigin(0, 0);
      rootContainer.add(panel);
    }

    // Elements were built, measured, and positioned above (before panel size was even known);
    // now that rootContainer exists, parent them into it.
    //
    // FIX (centered + scrollable settings): 'vertical-list' is now a special case — every other
    // layout ('grid', 'free', and auto/fill-sized panels generally) parents elements straight into
    // rootContainer exactly as before. 'vertical-list' instead re-centers each row horizontally
    // and nests the whole stack inside its own `scrollContainer`, clipped to the panel's content
    // area with a geometry mask whenever the stacked rows are taller than that area, with a
    // draggable/wheel-scrollable themed scrollbar along the right edge (see constants above).
    let scrollCleanup = null;
    if (manifest.layout === 'vertical-list') {
      const contentAreaWidth = panelWidth - CONTENT_PADDING * 2 - SCROLLBAR_WIDTH - SCROLLBAR_GAP;
      const contentAreaHeight = panelHeight - CONTENT_PADDING * 2;
      const totalContentHeight = elementContainers.length * ROW_HEIGHT;

      // Center each row horizontally within the (scrollbar-aware) content width.
      elementContainers.forEach((container, i) => {
        const rowWidth = elementSizes[i].width;
        container.setPosition(Math.max(0, (contentAreaWidth - rowWidth) / 2), i * ROW_HEIGHT);
      });

      const scrollContainer = scene.add.container(CONTENT_PADDING, CONTENT_PADDING);
      elementContainers.forEach((container) => scrollContainer.add(container));
      rootContainer.add(scrollContainer);

      const maxScroll = Math.max(0, totalContentHeight - contentAreaHeight);
      if (maxScroll > 0) {
        // Clips `scrollContainer` to the panel's content rect. The mask shape is a standalone
        // GameObject (not nested inside rootContainer), so — same reasoning as rootContainer's
        // own `repositionRoot`/the modal `overlay` above — it must be repositioned every
        // `followupdate` to stay aligned with rootContainer's actual (camera-scroll-compensated)
        // position, or it would silently drift out of sync as soon as the world camera moves.
        const maskShape = scene.add.graphics();
        maskShape.setVisible(false);
        const updateMaskShape = () => {
          maskShape.clear();
          maskShape.fillStyle(0xffffff);
          maskShape.fillRect(
            rootContainer.x + CONTENT_PADDING,
            rootContainer.y + CONTENT_PADDING,
            contentAreaWidth,
            contentAreaHeight,
          );
        };
        updateMaskShape();
        scrollContainer.setMask(maskShape.createGeometryMask());
        cam.on('followupdate', updateMaskShape);

        // Scrollbar track + thumb, themed to match the rest of this project's teal/cyan accent
        // color (HudPanel's bar fill, MapOverlay's border) rather than a generic gray.
        const trackX = panelWidth - CONTENT_PADDING - SCROLLBAR_WIDTH;
        const track = scene.add.rectangle(trackX, CONTENT_PADDING, SCROLLBAR_WIDTH, contentAreaHeight, SCROLLBAR_TRACK_COLOR)
          .setOrigin(0, 0);
        track.setStrokeStyle(1, SCROLLBAR_COLOR, 0.35);
        const thumbHeight = Math.max(16, contentAreaHeight * (contentAreaHeight / totalContentHeight));
        const thumbTravel = contentAreaHeight - thumbHeight;
        const thumb = scene.add.rectangle(trackX, CONTENT_PADDING, SCROLLBAR_WIDTH, thumbHeight, SCROLLBAR_COLOR)
          .setOrigin(0, 0);
        rootContainer.add([track, thumb]);

        let scrollY = 0;
        const applyScroll = () => {
          scrollContainer.y = CONTENT_PADDING - scrollY;
          thumb.y = CONTENT_PADDING + thumbTravel * (scrollY / maxScroll);
          updateMaskShape();
        };
        const setScroll = (value) => {
          scrollY = Math.max(0, Math.min(maxScroll, value));
          applyScroll();
        };

        // Mouse wheel, only while the pointer is over this panel (pointer.worldX/Y already
        // include the camera's scroll, same coordinate space rootContainer's own position is
        // kept in via repositionRoot above, so comparing the two directly is valid).
        const onWheel = (pointer, _over, _dx, deltaY) => {
          const withinX = pointer.worldX >= rootContainer.x && pointer.worldX <= rootContainer.x + panelWidth;
          const withinY = pointer.worldY >= rootContainer.y && pointer.worldY <= rootContainer.y + panelHeight;
          if (withinX && withinY) setScroll(scrollY + deltaY * WHEEL_SCROLL_SPEED);
        };
        scene.input.on('wheel', onWheel);

        // Draggable thumb, same "website scrollbar" affordance as the wheel.
        thumb.setInteractive({ useHandCursor: true });
        scene.input.setDraggable(thumb);
        const onThumbDrag = (pointer, dragX, dragY) => {
          const clampedY = Math.max(0, Math.min(thumbTravel, dragY - CONTENT_PADDING));
          setScroll(thumbTravel > 0 ? (clampedY / thumbTravel) * maxScroll : 0);
        };
        thumb.on('drag', onThumbDrag);

        scrollCleanup = () => {
          cam.off('followupdate', updateMaskShape);
          scene.input.off('wheel', onWheel);
          maskShape.destroy();
        };
      }
    } else {
      elementContainers.forEach((container) => rootContainer.add(container));
    }

    const handle = {
      container: rootContainer,
      close() {
        elementContainers.forEach((container) => {
          if (typeof container.unsubscribe === 'function') container.unsubscribe();
        });
        // FIX: must remove the per-frame camera-tracking listeners before destroying, or the
        // camera keeps calling repositionRoot/repositionOverlay on destroyed GameObjects every
        // frame (Phaser logs no error for this, it just silently no-ops/throws inside a
        // try-less callback) — a slow leak and a source of "ghost" console errors after closing
        // several windows in one play session.
        cam.off('followupdate', repositionRoot);
        if (repositionOverlay) cam.off('followupdate', repositionOverlay);
        scrollCleanup?.();
        rootContainer.destroy();
        if (overlay) overlay.destroy();
      },
      setElementValue(elementId, value) {
        const elementManifest = manifest.elements.find((element) => element.id === elementId);
        if (!elementManifest) throw new Error(`WindowFactory.setElementValue: unknown element id "${elementId}"`);
        if (elementManifest.bind) ctx.settingsStore.set(elementManifest.bind, value);
        // Visual refresh happens via each element's own settingsStore.subscribe, so no further
        // action is needed here for bound elements. Unbound elements (e.g. a plain Label) have
        // no generic way to update their visual from a raw value, so this is a no-op for them.
      },
      getElement(elementId) {
        return elementsById.get(elementId);
      },
    };
    Object.assign(windowHandleRef, handle); // elements built above now see a usable windowHandle

    return handle;
  },
};