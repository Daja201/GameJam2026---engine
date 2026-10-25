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
// FIX (auto-size): used only when manifest.size is NOT given — the minimum a panel can shrink
// to, and the breathing room left around measured content so elements don't sit flush against
// the panel's edge/nineslice border.
const MIN_PANEL_WIDTH = 64;
const MIN_PANEL_HEIGHT = 48;
const AUTO_SIZE_PADDING = 12;

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

    const autoSizing = !manifest.size;
    const autoSize = autoSizing ? computeAutoSize(elementContainers, elementSizes) : null;
    const panelWidth = manifest.size?.width ?? autoSize.width;
    const panelHeight = manifest.size?.height ?? autoSize.height;
    if (autoSizing) {
      // Shift every element inward so content doesn't sit flush against the auto-sized panel's
      // edge — the same padding computeAutoSize() budgeted for when it measured maxRight/maxBottom.
      elementContainers.forEach((container) => {
        container.setPosition(container.x + AUTO_SIZE_PADDING, container.y + AUTO_SIZE_PADDING);
      });
    }
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
    const repositionRoot = () => {
      const cam = scene.cameras.main;
      rootContainer.setPosition(basePosition.x + cam.scrollX, basePosition.y + cam.scrollY);
    };
    repositionRoot();
    scene.events.on('update', repositionRoot);

    /** @type {Phaser.GameObjects.Rectangle|null} */
    let overlay = null;
    let repositionOverlay = null;
    if (manifest.modal) {
      overlay = scene.add.rectangle(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT, 0x000000, 0.5);
      overlay.setOrigin(0, 0);
      overlay.setDepth(DEPTH.UI_MODAL_OVERLAY);
      overlay.setInteractive(); // no handler: this alone swallows clicks to anything below it
      // Same fix as rootContainer: keep scrollFactor default and manually track the camera so the
      // overlay's actual (hit-tested) position always matches its visible, screen-fixed position.
      repositionOverlay = () => {
        const cam = scene.cameras.main;
        overlay.setPosition(cam.scrollX, cam.scrollY);
      };
      repositionOverlay();
      scene.events.on('update', repositionOverlay);
    }

    const panel = scene.add.nineslice(
      0, 0, `${manifest.skin}:panel`,
      undefined, panelWidth, panelHeight,
      16, 16, 16, 16, // default slice insets; a jam-scale skin convention, not asset-specific
    ).setOrigin(0, 0);
    rootContainer.add(panel);

    // Elements were built, measured, and positioned above (before panel size was even known);
    // now that rootContainer exists, parent them into it.
    elementContainers.forEach((container) => rootContainer.add(container));

    const handle = {
      container: rootContainer,
      close() {
        elementContainers.forEach((container) => {
          if (typeof container.unsubscribe === 'function') container.unsubscribe();
        });
        // FIX: must remove the per-frame camera-tracking listeners before destroying, or the
        // scene keeps calling repositionRoot/repositionOverlay on destroyed GameObjects every
        // frame (Phaser logs no error for this, it just silently no-ops/throws inside a
        // try-less callback) — a slow leak and a source of "ghost" console errors after closing
        // several windows in one play session.
        scene.events.off('update', repositionRoot);
        if (repositionOverlay) scene.events.off('update', repositionOverlay);
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