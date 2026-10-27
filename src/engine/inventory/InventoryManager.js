import Phaser from 'phaser';
import { ItemValidationError } from './ItemValidationError.js';

/**
 * Full, content-agnostic inventory system: register item *definitions* (data, never hardcoded
 * here), then pick up / use / drop / reorder them in a fixed-size slot grid. Gameplay-agnostic the
 * same way `quest/QuestManager.js` is — this file contains no hardcoded item id, screen id, or
 * target id anywhere; every one of those is data, supplied via `loadDefinitions()` (content
 * authored as `/config/items.default.json`, parsed and handed in by the bootstrap).
 *
 * SINGLETON, same pattern as `quest/QuestManager.js`, `loop/LoopManager.js` and
 * `settings/SettingsStore.js`: `InventoryManager` below is a plain exported object (an instance
 * of the private `InventoryManagerImpl` class), never constructed by callers, and it must never be
 * stored on a Scene/GameObject since those are destroyed/recreated on scene restarts while this
 * state must survive them. It persists itself to localStorage the same way `QuestManager` does,
 * under its own key/version.
 *
 * SLOTS: a fixed-length array (`SLOT_COUNT`, see constant below), not a map — empty slots and
 * ordering are explicit, so a UI can render a stable grid directly off `getSlots()`. Each slot is
 * `{ slotIndex, itemId: string|null, count: number }`; an empty slot has `itemId: null, count: 0`.
 *
 * STACKING: a stackable item (`definition.stackable`) fills existing partial stacks of the same
 * item first (each capped at `definition.maxStack`), then spills into empty slots, each a fresh
 * stack up to `maxStack`. A non-stackable item always takes one whole slot per unit (effectively
 * `maxStack: 1`, enforced regardless of what the definition says — see `loadDefinitions`'s
 * validation). If every slot is full (or every stack of this item is capped and no empty slot
 * remains), `addItem` returns however many units it could NOT place — callers decide what that
 * means (a toast, refusing a pickup, etc.); nothing here silently drops or discards the overflow
 * itself, it is simply never added.
 *
 * USING AN ITEM: `useItem(slotIndex)` only fires the event and (if `definition.consumeOnUse`,
 * default true for a usable item) removes one unit — it has NO idea what "using" an item actually
 * DOES in the game (heal, unlock a door, satisfy a quest...). That's for game-layer content to
 * decide, listening for `'inventory:item-used'`, same separation `QuestManager` keeps between
 * objective bookkeeping and what interacting with a world object actually triggers.
 *
 * EVENTS: `InventoryManager.events` is this module's own `Phaser.Events.EventEmitter`,
 * independent of any scene's emitter (same reasoning as `QuestManager.events`). Emits:
 * - `'inventory:item-added'`    `{ itemId, amount, leftover }` — `amount` actually added (may be
 *   less than requested; `leftover` is what could NOT be added)
 * - `'inventory:item-removed'`  `{ itemId, amount }`
 * - `'inventory:item-used'`     `{ itemId, slotIndex, consumed }`
 * - `'inventory:item-dropped'`  `{ itemId, amount, slotIndex }`
 * - `'inventory:moved'`         `{ fromSlot, toSlot }`
 * - `'inventory:updated'`       no payload — fires after EVERY mutation above, for consumers
 *   (e.g. the inventory screen, the HUD button) that just want "something changed, redraw".
 *
 * @module inventory/InventoryManager
 */

/** Total number of inventory slots. A jam-scale fixed grid — see module docstring's SLOTS note. */
const SLOT_COUNT = 16;

/** Size of the cat's own, separate slot set — see `stashInCat`/`retrieveFromCat` below. A few
 * slots on purpose (per /storycontext.md's "The Cat" section: "a small, dedicated inventory
 * space"), not a second full grid. */
const CAT_SLOT_COUNT = 3;

const STORAGE_KEY_PREFIX = 'hackjam:inventory:v';
const SCHEMA_VERSION = 1;
const STORAGE_KEY = `${STORAGE_KEY_PREFIX}${SCHEMA_VERSION}`;

/** Lowercase snake_case id, same convention as every manifest id elsewhere in the engine. */
const ID_PATTERN = /^[a-z0-9]+(_[a-z0-9]+)*$/;

/**
 * Validates one item definition, throwing a descriptive `ItemValidationError` (fail loud, same
 * rule every manifest/content file in this project follows — never a silent fallback for
 * malformed content).
 * @param {object} def
 * @returns {void}
 * @throws {ItemValidationError}
 */
function validateItemDefinition(def) {
  const id = def && typeof def.id === 'string' ? def.id : '(unknown)';

  if (def === null || typeof def !== 'object') {
    throw new ItemValidationError(id, '(root)', 'item definition must be an object');
  }
  if (typeof def.id !== 'string' || !ID_PATTERN.test(def.id)) {
    throw new ItemValidationError(id, 'id', 'must be a lowercase_snake_case string');
  }
  if (typeof def.name !== 'string' || def.name.length === 0) {
    throw new ItemValidationError(id, 'name', 'must be a non-empty string');
  }
  if (def.description !== undefined && typeof def.description !== 'string') {
    throw new ItemValidationError(id, 'description', 'must be a string if present');
  }
  if (def.icon !== undefined && typeof def.icon !== 'string') {
    throw new ItemValidationError(id, 'icon', 'must be a string (asset key) if present');
  }
  if (def.stackable !== undefined && typeof def.stackable !== 'boolean') {
    throw new ItemValidationError(id, 'stackable', 'must be a boolean if present');
  }
  if (def.maxStack !== undefined && (!Number.isInteger(def.maxStack) || def.maxStack < 1)) {
    throw new ItemValidationError(id, 'maxStack', 'must be a positive integer if present');
  }
  if (def.usable !== undefined && typeof def.usable !== 'boolean') {
    throw new ItemValidationError(id, 'usable', 'must be a boolean if present');
  }
  if (def.consumeOnUse !== undefined && typeof def.consumeOnUse !== 'boolean') {
    throw new ItemValidationError(id, 'consumeOnUse', 'must be a boolean if present');
  }
  if (def.tags !== undefined) {
    if (!Array.isArray(def.tags) || def.tags.some((tag) => typeof tag !== 'string')) {
      throw new ItemValidationError(id, 'tags', 'must be an array of strings if present');
    }
  }
}

/**
 * Fills in every optional field with its documented default, and forces `maxStack: 1` for a
 * non-stackable item regardless of what the content author wrote there (see module docstring's
 * STACKING note).
 * @param {object} def - already validated by `validateItemDefinition`
 * @returns {object} normalized definition
 */
function normalizeItemDefinition(def) {
  const stackable = def.stackable ?? true;
  const usable = def.usable ?? false;
  return {
    id: def.id,
    name: def.name,
    description: def.description ?? '',
    icon: def.icon ?? null,
    stackable,
    maxStack: stackable ? (def.maxStack ?? 99) : 1,
    usable,
    consumeOnUse: usable ? (def.consumeOnUse ?? true) : false,
    tags: def.tags ?? [],
  };
}

class InventoryManagerImpl {
  constructor() {
    /** @type {Phaser.Events.EventEmitter} */
    this.events = new Phaser.Events.EventEmitter();

    /** @type {Map<string, object>} itemId -> normalized, validated definition */
    this._definitions = new Map();

    /** @type {{slotIndex: number, itemId: string|null, count: number}[]} fixed-length slot array */
    this._slots = Array.from({ length: SLOT_COUNT }, (unused, slotIndex) => ({
      slotIndex, itemId: null, count: 0,
    }));

    /** The cat's own slot array — see `stashInCat`/`retrieveFromCat` below for why this is kept
     * entirely separate from `_slots` (never touched by `resetAll()`).
     * @type {{slotIndex: number, itemId: string|null, count: number}[]} */
    this._catSlots = Array.from({ length: CAT_SLOT_COUNT }, (unused, slotIndex) => ({
      slotIndex, itemId: null, count: 0,
    }));
  }

  /**
   * Registers item definitions so they can be added to the inventory later. Safe to call more
   * than once (e.g. once at boot with the default content, again later if more content is
   * streamed in) — existing definitions with the same id are replaced; slots already holding that
   * item are left as-is (their `count`/`slotIndex` don't change, only future lookups of the
   * definition see the new data).
   * @param {object[]} definitions - array of item definitions (see module docstring)
   * @returns {void}
   * @throws {ItemValidationError} on the first invalid definition found
   */
  loadDefinitions(definitions) {
    if (!Array.isArray(definitions)) {
      throw new ItemValidationError('(unknown)', '(root)', 'loadDefinitions() expects an array of item definitions');
    }
    for (const def of definitions) {
      validateItemDefinition(def);
      this._definitions.set(def.id, normalizeItemDefinition(def));
    }
  }

  /**
   * @param {string} itemId
   * @returns {object|null} the normalized item definition, or null if `itemId` was never registered
   */
  getItemDefinition(itemId) {
    return this._definitions.get(itemId) ?? null;
  }

  /**
   * Adds `amount` (default 1) of an item into the slot grid — see module docstring's STACKING
   * note for exactly how it's placed. Fully idempotent/safe to call speculatively: it never
   * throws for a full inventory, it just reports the leftover.
   * @param {string} itemId
   * @param {number} [amount]
   * @returns {number} how many units could NOT be placed (0 means every unit was added)
   * @throws {Error} if `itemId` was never registered via `loadDefinitions`
   */
  addItem(itemId, amount = 1) {
    const definition = this._definitions.get(itemId);
    if (!definition) throw new Error(`InventoryManager.addItem: unknown item "${itemId}" (load its definition first)`);
    if (amount <= 0) return 0;

    let remaining = amount;

    if (definition.stackable) {
      for (const slot of this._slots) {
        if (remaining <= 0) break;
        if (slot.itemId !== itemId || slot.count >= definition.maxStack) continue;
        const space = definition.maxStack - slot.count;
        const take = Math.min(space, remaining);
        slot.count += take;
        remaining -= take;
      }
    }

    // Spill into empty slots (always for a non-stackable item: one whole slot per unit; for a
    // stackable item, only once existing partial stacks above are already topped up).
    for (const slot of this._slots) {
      if (remaining <= 0) break;
      if (slot.itemId !== null) continue;
      const take = Math.min(definition.maxStack, remaining);
      slot.itemId = itemId;
      slot.count = take;
      remaining -= take;
    }

    const added = amount - remaining;
    if (added > 0) {
      this.events.emit('inventory:item-added', { itemId, amount: added, leftover: remaining });
      this._touch();
    }
    return remaining;
  }

  /**
   * Removes up to `amount` (default 1) units of `itemId`, taking from whichever slots hold it
   * (oldest/lowest slot index first) until satisfied. All-or-nothing: if fewer than `amount` are
   * held in total, nothing is removed.
   * @param {string} itemId
   * @param {number} [amount]
   * @returns {boolean} whether the removal happened
   */
  removeItem(itemId, amount = 1) {
    if (amount <= 0) return true;
    if (this.getItemCount(itemId) < amount) return false;

    let remaining = amount;
    for (const slot of this._slots) {
      if (remaining <= 0) break;
      if (slot.itemId !== itemId) continue;
      const take = Math.min(slot.count, remaining);
      slot.count -= take;
      remaining -= take;
      if (slot.count === 0) slot.itemId = null;
    }

    this.events.emit('inventory:item-removed', { itemId, amount });
    this._touch();
    return true;
  }

  /**
   * @param {string} itemId
   * @returns {number} total units of that item currently held, across every slot
   */
  getItemCount(itemId) {
    return this._slots.reduce((sum, slot) => (slot.itemId === itemId ? sum + slot.count : sum), 0);
  }

  /**
   * @param {string} itemId
   * @param {number} [amount]
   * @returns {boolean} whether at least `amount` (default 1) of that item is currently held
   */
  hasItem(itemId, amount = 1) {
    return this.getItemCount(itemId) >= amount;
  }

  /** @returns {boolean} whether at least one slot is empty */
  hasFreeSlot() {
    return this._slots.some((slot) => slot.itemId === null);
  }

  /**
   * Uses one unit of whatever is in `slotIndex`. Fires `'inventory:item-used'` regardless of
   * whether the item defines itself as `usable` (a non-usable item simply never gets consumed —
   * see module docstring's USING AN ITEM note for why the actual *effect* is never decided here).
   * @param {number} slotIndex
   * @returns {object|null} the item's definition if something was used, or null if the slot is
   *   empty or out of range
   */
  useItem(slotIndex) {
    const slot = this._slots[slotIndex];
    if (!slot || slot.itemId === null) return null;

    const definition = this._definitions.get(slot.itemId);
    const consumed = !!definition?.usable && !!definition?.consumeOnUse;
    this.events.emit('inventory:item-used', { itemId: slot.itemId, slotIndex, consumed });

    if (consumed) {
      slot.count -= 1;
      if (slot.count <= 0) {
        slot.itemId = null;
        slot.count = 0;
      }
    }
    this._touch();
    return definition ?? null;
  }

  /**
   * The cat's own small, dedicated slot set (see /storycontext.md's "The Cat" section) — the
   * ONLY storage meant to survive whatever "wipe everything" logic eventually gets wired to the
   * loop-reset event; it is a completely separate array from `_slots` and `resetAll()` never
   * touches it. Moves `amount` (default 1) of `itemId` OUT of the normal inventory and into the
   * cat: all-or-nothing (a probe placement is tried first against a scratch copy of the cat's
   * slots, so a stash can never half-succeed and leave the player's items split awkwardly
   * between the two).
   * @param {string} itemId
   * @param {number} [amount]
   * @returns {{success: boolean, reason?: 'not-held'|'cat-full'}}
   */
  stashInCat(itemId, amount = 1) {
    const definition = this._definitions.get(itemId);
    if (!definition) throw new Error(`InventoryManager.stashInCat: unknown item "${itemId}" (load its definition first)`);
    if (!this.hasItem(itemId, amount)) return { success: false, reason: 'not-held' };

    const probe = this._catSlots.map((slot) => ({ ...slot }));
    if (this._fillSlots(probe, itemId, amount) > 0) return { success: false, reason: 'cat-full' };

    this.removeItem(itemId, amount);
    this._fillSlots(this._catSlots, itemId, amount);
    this.events.emit('inventory:cat-updated');
    this.save();
    return { success: true };
  }

  /**
   * The inverse of `stashInCat`: moves `amount` (default 1) of `itemId` back out of the cat's
   * slots and into the normal inventory. If the normal inventory can't take everything (it's
   * full), whatever didn't fit is put straight back into the cat rather than lost — the slots
   * just freed by removing `amount` from the cat guarantee there's room for that rollback.
   * @param {string} itemId
   * @param {number} [amount]
   * @returns {{success: boolean, reason?: 'not-in-cat'|'inventory-full'}}
   */
  retrieveFromCat(itemId, amount = 1) {
    const definition = this._definitions.get(itemId);
    if (!definition) throw new Error(`InventoryManager.retrieveFromCat: unknown item "${itemId}" (load its definition first)`);
    if (this.getCatItemCount(itemId) < amount) return { success: false, reason: 'not-in-cat' };

    let remaining = amount;
    for (const slot of this._catSlots) {
      if (remaining <= 0) break;
      if (slot.itemId !== itemId) continue;
      const take = Math.min(slot.count, remaining);
      slot.count -= take;
      remaining -= take;
      if (slot.count === 0) slot.itemId = null;
    }

    const leftover = this.addItem(itemId, amount);
    if (leftover > 0) this._fillSlots(this._catSlots, itemId, leftover); // rollback, see doc above

    this.events.emit('inventory:cat-updated');
    this.save();
    return leftover > 0 ? { success: false, reason: 'inventory-full' } : { success: true };
  }

  /** @returns {{slotIndex: number, itemId: string|null, count: number}[]} snapshot copy of the cat's slots */
  getCatSlots() {
    return this._catSlots.map((slot) => ({ ...slot }));
  }

  /**
   * @param {string} itemId
   * @returns {number} total units of that item currently hidden in the cat
   */
  getCatItemCount(itemId) {
    return this._catSlots.reduce((sum, slot) => (slot.itemId === itemId ? sum + slot.count : sum), 0);
  }

  /**
   * Shared placement loop for `stashInCat`/`retrieveFromCat`'s rollback — same stacking rule as
   * `addItem` (see module docstring's STACKING note), just parameterized over which slot array
   * to fill, since the cat's slots are a second, much smaller array of the exact same shape.
   * Does NOT touch `_definitions`/events/persistence itself; callers do that.
   * @param {{slotIndex: number, itemId: string|null, count: number}[]} slots
   * @param {string} itemId
   * @param {number} amount
   * @returns {number} leftover units that did NOT fit
   * @private
   */
  _fillSlots(slots, itemId, amount) {
    const definition = this._definitions.get(itemId);
    let remaining = amount;
    if (definition.stackable) {
      for (const slot of slots) {
        if (remaining <= 0) break;
        if (slot.itemId !== itemId || slot.count >= definition.maxStack) continue;
        const space = definition.maxStack - slot.count;
        const take = Math.min(space, remaining);
        slot.count += take;
        remaining -= take;
      }
    }
    for (const slot of slots) {
      if (remaining <= 0) break;
      if (slot.itemId !== null) continue;
      const take = Math.min(definition.maxStack, remaining);
      slot.itemId = itemId;
      slot.count = take;
      remaining -= take;
    }
    return remaining;
  }

  /**
   * Removes up to `amount` (default: the whole stack) units from one specific slot and fires
   * `'inventory:item-dropped'` — world code decides whether that means spawning a pickup back, or
   * just discarding it.
   * @param {number} slotIndex
   * @param {number} [amount]
   * @returns {boolean} whether anything was dropped
   */
  dropItem(slotIndex, amount) {
    const slot = this._slots[slotIndex];
    if (!slot || slot.itemId === null) return false;

    const dropAmount = Math.min(amount ?? slot.count, slot.count);
    if (dropAmount <= 0) return false;

    const itemId = slot.itemId;
    slot.count -= dropAmount;
    if (slot.count <= 0) {
      slot.itemId = null;
      slot.count = 0;
    }

    this.events.emit('inventory:item-dropped', { itemId, amount: dropAmount, slotIndex });
    this._touch();
    return true;
  }

  /**
   * Moves/reorders slot contents, for a drag-and-drop or keyboard-reorder UI. If the destination
   * holds the same stackable item, the two stacks are merged (capped at `maxStack`, any overflow
   * stays behind in the source slot rather than being lost); otherwise the two slots are swapped.
   * @param {number} fromSlot
   * @param {number} toSlot
   * @returns {boolean} whether anything changed
   */
  moveItem(fromSlot, toSlot) {
    const from = this._slots[fromSlot];
    const to = this._slots[toSlot];
    if (!from || !to || fromSlot === toSlot || from.itemId === null) return false;

    const definition = this._definitions.get(from.itemId);
    if (to.itemId === from.itemId && definition?.stackable) {
      const space = definition.maxStack - to.count;
      const take = Math.min(space, from.count);
      to.count += take;
      from.count -= take;
      if (from.count <= 0) {
        from.itemId = null;
        from.count = 0;
      }
    } else {
      const swap = { itemId: to.itemId, count: to.count };
      to.itemId = from.itemId;
      to.count = from.count;
      from.itemId = swap.itemId;
      from.count = swap.count;
    }

    this.events.emit('inventory:moved', { fromSlot, toSlot });
    this._touch();
    return true;
  }

  /**
   * @returns {{slotIndex: number, itemId: string|null, count: number}[]} a snapshot copy of every
   *   slot, in slot order — safe for a UI to hold onto without it mutating live state
   */
  getSlots() {
    return this._slots.map((slot) => ({ ...slot }));
  }

  /**
   * @param {number} slotIndex
   * @returns {{slotIndex: number, itemId: string|null, count: number}|null}
   */
  getSlot(slotIndex) {
    const slot = this._slots[slotIndex];
    return slot ? { ...slot } : null;
  }

  /**
   * Empties every slot (definitions stay registered). Mirrors `QuestManager.resetAll()`'s
   * scope/shape for consistency — see that method's own doc for why nothing in the engine calls
   * this automatically.
   * @returns {void}
   */
  resetAll() {
    for (const slot of this._slots) {
      slot.itemId = null;
      slot.count = 0;
    }
    this._touch();
  }

  /**
   * Emits `'inventory:updated'` and persists. Called after every mutating method above so an
   * inventory UI/HUD can subscribe to one event and always redraw current truth.
   * @private
   * @returns {void}
   */
  _touch() {
    this.events.emit('inventory:updated');
    this.save();
  }

  /**
   * Persists slot contents to localStorage. Definitions are NOT persisted (re-registered via
   * `loadDefinitions` every boot, same as content elsewhere in the engine).
   * @returns {void}
   */
  save() {
    const payload = {
      slots: this._slots.map((slot) => ({ itemId: slot.itemId, count: slot.count })),
      // Persisted alongside the regular grid (same storage key) but kept in its own field so
      // older saves without it just fall back to an empty cat (see `load()` below) rather than
      // breaking.
      catSlots: this._catSlots.map((slot) => ({ itemId: slot.itemId, count: slot.count })),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }

  /**
   * Loads previously saved slot contents from localStorage, if any. Call AFTER `loadDefinitions()`
   * so saved item ids can be checked against what's currently registered. A saved slot
   * referencing an item whose definition is no longer registered (content removed since the save
   * was written) is cleared with a `console.warn` rather than crashing — same resilience
   * `QuestManager.load()` has. Malformed/missing storage also falls back to a clean empty state
   * silently.
   * @returns {void}
   */
  load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return;

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (error) {
      console.warn(`[InventoryManager] stored inventory at "${STORAGE_KEY}" is malformed; starting fresh.`, error);
      return;
    }

    const savedSlots = Array.isArray(payload.slots) ? payload.slots : [];
    savedSlots.forEach((saved, index) => {
      const slot = this._slots[index];
      if (!slot) return; // saved with a larger SLOT_COUNT than this build has; ignore the rest
      if (saved.itemId === null || saved.itemId === undefined) {
        slot.itemId = null;
        slot.count = 0;
        return;
      }
      if (!this._definitions.has(saved.itemId)) {
        console.warn(`[InventoryManager] saved slot ${index} references unknown item "${saved.itemId}"; clearing it.`);
        slot.itemId = null;
        slot.count = 0;
        return;
      }
      slot.itemId = saved.itemId;
      slot.count = saved.count ?? 0;
    });

    // Cat slots — same resilience rules as the main grid just above.
    const savedCatSlots = Array.isArray(payload.catSlots) ? payload.catSlots : [];
    savedCatSlots.forEach((saved, index) => {
      const slot = this._catSlots[index];
      if (!slot) return;
      if (saved.itemId === null || saved.itemId === undefined) {
        slot.itemId = null;
        slot.count = 0;
        return;
      }
      if (!this._definitions.has(saved.itemId)) {
        console.warn(`[InventoryManager] saved cat slot ${index} references unknown item "${saved.itemId}"; clearing it.`);
        slot.itemId = null;
        slot.count = 0;
        return;
      }
      slot.itemId = saved.itemId;
      slot.count = saved.count ?? 0;
    });
  }
}

/** Module-level singleton. Import this directly — never construct `InventoryManagerImpl` yourself. */
export const InventoryManager = new InventoryManagerImpl();