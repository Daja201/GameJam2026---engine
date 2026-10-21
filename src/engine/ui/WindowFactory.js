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
    const panelWidth = manifest.size?.width ?? 200;
    const panelHeight = manifest.size?.height ?? 120;
    const { x, y } = resolveAnchorPosition(manifest.anchor, panelWidth, panelHeight);

    const rootContainer = scene.add.container(x, y);
    rootContainer.setDepth(DEPTH.UI_WINDOW);
    // FIX: the engine runs every screen inside ONE Phaser Scene/camera (ScreenManager docstring),
    // and WorldScreenController calls cameras.main.startFollow(player). Without scrollFactor 0,
    // this window's position (computed in fixed INTERNAL_WIDTH/HEIGHT coordinates) gets dragged
    // around by however far the camera has scrolled to follow the player — so it visually drifts
    // off-center the moment the player has walked away from the origin. Pinning scrollFactor to 0
    // makes every UI window screen-fixed regardless of camera movement, which is what "centered"
    // actually requires here.
    rootContainer.setScrollFactor(0);

    /** @type {Phaser.GameObjects.Rectangle|null} */
    let overlay = null;
    if (manifest.modal) {
      overlay = scene.add.rectangle(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT, 0x000000, 0.5);
      overlay.setOrigin(0, 0);
      overlay.setDepth(DEPTH.UI_MODAL_OVERLAY);
      overlay.setScrollFactor(0); // same reasoning as rootContainer above — must stay screen-fixed
      overlay.setInteractive(); // no handler: this alone swallows clicks to anything below it
    }

    const panel = scene.add.nineslice(
      0, 0, `${manifest.skin}:panel`,
      undefined, panelWidth, panelHeight,
      16, 16, 16, 16, // default slice insets; a jam-scale skin convention, not asset-specific
    ).setOrigin(0, 0);
    rootContainer.add(panel);

    /** @type {Map<string, Phaser.GameObjects.Container>} elementId -> its built container */
    const elementsById = new Map();
    const elementContainers = [];

    const windowHandleRef = {}; // filled in once `handle` exists below, so elements can reference it
    const elementCtx = { settingsStore: ctx.settingsStore, inputRouter: ctx.inputRouter, windowHandle: windowHandleRef };

    for (const elementManifest of manifest.elements) {
      const builder = ELEMENT_BUILDERS[elementManifest.type];
      if (!builder) throw new Error(`WindowFactory: no builder registered for element type "${elementManifest.type}"`);
      const elementContainer = builder(scene, elementManifest, elementCtx);
      elementsById.set(elementManifest.id, elementContainer);
      elementContainers.push(elementContainer);
      rootContainer.add(elementContainer);
    }

    layoutElements(elementContainers, manifest.elements, manifest.layout);

    const handle = {
      container: rootContainer,
      close() {
        elementContainers.forEach((container) => {
          if (typeof container.unsubscribe === 'function') container.unsubscribe();
        });
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