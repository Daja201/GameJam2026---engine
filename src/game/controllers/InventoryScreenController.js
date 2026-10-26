import { ScreenController } from '../../engine/screens/ScreenController.js';
import { InventoryManager } from '../../engine/inventory/InventoryManager.js';

/**
 * "Inventory" screen: a live view of `InventoryManager`'s slot grid, built the same way
 * `QuestLogScreenController` composes `scrollable-text` (this screen's one `ui_window`,
 * `inventory_panel`) — the window is static (Use/Drop/Close buttons, one output panel);
 * everything dynamic is redrawn into that one element.
 *
 * SELECTING A SLOT: `menu-up`/`menu-down` (profile `inventory`, UP/DOWN) move the highlight
 * across non-empty slots only (there's nothing useful to select in an empty one); clicking a
 * line does the same (mouse-equivalent of up/down), same pattern as `QuestLogScreenController`'s
 * `output.onLineClick`.
 *
 * USE / DROP: `confirm` (ENTER) or the "Use" button calls `InventoryManager.useItem()` on the
 * highlighted slot; `drop-item` (X) or the "Drop" button calls `InventoryManager.dropItem()` for
 * the WHOLE stack in that slot. Both buttons go through `ActionRegistry` verbs
 * (`inventory-use`/`inventory-drop`) registered once in `main.js`, closing over
 * `engine.screenManager.topController` — same wiring `main.js` already uses for the Quest Log's
 * tab buttons — which is why this class exposes `useSelected()`/`dropSelected()` as public methods.
 *
 * LIVE UPDATES: subscribes to `InventoryManager.events`'s `'inventory:updated'` for the lifetime
 * of this screen, so anything that changed the inventory while this screen was closed (a world
 * pickup, a terminal `give`) is already reflected the moment it's opened, and anything that
 * happens while it IS open (e.g. using an item from here) stays in sync live.
 * @module game/controllers/InventoryScreenController
 */
export class InventoryScreenController extends ScreenController {
  /** @param {object} [params] @returns {void} */
  onEnter(params) {
    const outputHandle = this.windows[0];
    this.output = outputHandle.getElement('output');

    /** Index into the current non-empty-slot list (NOT a raw slot index — see `_redraw`).
     * @type {number} */
    this.selectedIndex = 0;

    /** Parallel to `output`'s committed lines: which non-empty-slot-list index line N belongs
     * to, or `null` for a blank/footer line. Rebuilt by every `_redraw()`. @type {Array<number|null>} */
    this._lineSlotIndex = [];
    /** The current non-empty-slot list itself (same order `_lineSlotIndex` indexes into), so
     * `useSelected`/`dropSelected`/`onLineClick` can map an index straight back to a real slot.
     * @type {{slotIndex:number, itemId:string, count:number}[]} */
    this._visibleSlots = [];

    this.output.onLineClick = (lineIndex) => {
      const listIndex = this._lineSlotIndex[lineIndex];
      if (listIndex === null || listIndex === undefined) return;
      if (listIndex >= this._visibleSlots.length) return; // stale click racing a live update
      this.selectedIndex = listIndex;
      this._redraw();
    };

    this._onInventoryUpdated = () => this._redraw();
    InventoryManager.events.on('inventory:updated', this._onInventoryUpdated);

    this._redraw();
  }

  /**
   * Uses whatever is in the currently highlighted slot. Called by the `inventory-use` action
   * (see class docstring).
   * @returns {void}
   */
  useSelected() {
    const slot = this._visibleSlots[this.selectedIndex];
    if (!slot) return;
    InventoryManager.useItem(slot.slotIndex);
    // No explicit _redraw() here: useItem() emits 'inventory:updated', which this screen is
    // already subscribed to (see onEnter) and which redraws for us.
  }

  /**
   * Drops the WHOLE stack in the currently highlighted slot. Called by the `inventory-drop`
   * action (see class docstring).
   * @returns {void}
   */
  dropSelected() {
    const slot = this._visibleSlots[this.selectedIndex];
    if (!slot) return;
    InventoryManager.dropItem(slot.slotIndex);
  }

  /**
   * Rebuilds the output panel's full contents from current `InventoryManager` state.
   * @private
   * @returns {void}
   */
  _redraw() {
    this.output.clear();
    this._lineSlotIndex = [];

    /**
     * `output.appendLine`, but also records which non-empty-slot-list index this line belongs
     * to, mirroring `QuestLogScreenController`'s `appendLine` helper.
     * @param {string} text
     * @param {number|null} listIndex
     * @returns {void}
     */
    const appendLine = (text, listIndex) => {
      this.output.appendLine(text);
      this._lineSlotIndex.push(listIndex);
    };

    this._visibleSlots = InventoryManager.getSlots().filter((slot) => slot.itemId !== null);

    if (this._visibleSlots.length === 0) {
      appendLine('(inventory empty)', null);
      return;
    }

    this.selectedIndex = Math.min(this.selectedIndex, this._visibleSlots.length - 1);

    this._visibleSlots.forEach((slot, index) => {
      const definition = InventoryManager.getItemDefinition(slot.itemId);
      const cursor = index === this.selectedIndex ? '\u25b6' : ' ';
      const stackTag = definition?.stackable ? ` x${slot.count}` : '';
      const usableTag = definition?.usable ? '' : ' (not usable)';
      appendLine(`${cursor} [${slot.slotIndex}] ${definition?.name ?? slot.itemId}${stackTag}${usableTag}`, index);
      if (definition?.description) appendLine(`    ${definition.description}`, index);
    });

    appendLine('', null);
    appendLine('[UP/DOWN] or click an item   [ENTER] use   [X] drop', null);
  }

  /**
   * @param {string} action
   * @returns {void}
   */
  onInput(action) {
    if (action === 'cancel') {
      this.engine.screenManager.pop();
      return;
    }
    if (this._visibleSlots.length === 0) return;

    if (action === 'menu-up') {
      this.selectedIndex = (this.selectedIndex - 1 + this._visibleSlots.length) % this._visibleSlots.length;
      this._redraw();
    } else if (action === 'menu-down') {
      this.selectedIndex = (this.selectedIndex + 1) % this._visibleSlots.length;
      this._redraw();
    } else if (action === 'confirm') {
      this.useSelected();
    } else if (action === 'drop-item') {
      this.dropSelected();
    }
  }

  /** @param {number} time @param {number} delta @returns {void} */
  onUpdate(time, delta) {}

  /** @returns {void} */
  onExit() {
    InventoryManager.events.off('inventory:updated', this._onInventoryUpdated);
  }

  /** @returns {void} */
  onPause() {}

  /** @returns {void} */
  onResume() {}
}