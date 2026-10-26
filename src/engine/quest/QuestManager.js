import Phaser from 'phaser';
import { QuestValidationError } from './QuestValidationError.js';
import { InventoryManager } from '../inventory/InventoryManager.js';

/**
 * Full-on, content-agnostic quest system: register quest *definitions* (data, never hardcoded
 * here), assign them, feed it progress from wherever gameplay happens, and it tracks completion
 * and a permanent trace of every quest ever finished.
 *
 * SINGLETON, same pattern as `loop/LoopManager.js` and `settings/SettingsStore.js`: `QuestManager`
 * below is a plain exported object (an instance of the private `QuestManagerImpl` class), never
 * constructed by callers, and it must never be stored on a Scene/GameObject since those are
 * destroyed/recreated on scene restarts while this state must survive them. It persists itself to
 * localStorage the same way `SettingsStore` does, under its own key/version.
 *
 * NO CONTENT COUPLING: this file contains no hardcoded quest id, item id, screen id, or target id
 * anywhere — every one of those is data, supplied either via `loadDefinitions()` (content authored
 * as `/config/quests.default.json`, parsed and handed in by the bootstrap, module 11-equivalent)
 * or via `createAndAssignQuest()` (built entirely at runtime by *calling* code, e.g. a screen
 * controller or a terminal command deciding to hand the player a brand new quest on the fly —
 * this is the "assign whatever quest" entry point).
 *
 * ITEM TRACKING (CHANGED): item state used to be a tiny private `_inventory` Map living only in
 * this file, used solely to satisfy `collect_item` objectives. That has been pulled out into its
 * own full module, `engine/inventory/InventoryManager.js` (slots, stacking, use, drop — see its
 * docstring), which is now the single source of truth for "what does the player have". This
 * module's `collectItem`/`getItemCount`/`hasItem` below are now thin delegations to it, kept here
 * only because `collect_item` objectives and existing callers (e.g. world pickups) already expect
 * this exact API on `QuestManager`. `collectItem` reports quest progress for however many units
 * `InventoryManager.addItem` *actually* accepted — if the player's inventory is full, progress
 * stalls at the true collected amount rather than over-crediting a `collect_item` objective for
 * an item that was never really acquired.
 *
 * REWARD ITEMS: a quest definition may optionally list `rewardItems: [{ itemId, count? }]`. This
 * module does not grant them itself (same "no content coupling" reasoning as everywhere else
 * here) — it only validates the field and attaches it to the `'quest:completed'` event payload so
 * game-layer content (see `game/controllers/WorldScreenController.js`) can call
 * `InventoryManager.addItem` for each one when it sees that event.
 *
 * OBJECTIVE TYPES (the generic vocabulary every quest is built from — "getting some item" and
 * "getting somewhere" are just two instances of this, not special-cased anywhere below):
 * - `collect_item`  `{ itemId, count }`      — progressed by calling `collectItem(itemId, n)`
 * - `reach_location` `{ screenId, x, y, radius }` — progressed every frame via `reportLocation()`
 * - `interact`      `{ targetId, count }`    — progressed by calling `triggerInteract(targetId)`
 * - `custom`        `{ count }`              — progressed only by an explicit `completeObjective()`
 *   call naming that exact objective id; use this for anything the three built-ins don't cover
 *   (a dialogue choice, a boss defeated, a puzzle solved — whatever the calling content decides).
 * Every objective may omit `count` (defaults to 1): the number of matching progress calls needed
 * before that objective is done. A quest is `completed` once every one of its objectives is done.
 *
 * TRACING DONE QUESTS: `getCompletedQuests()` returns a permanent, timestamped log — entries are
 * never removed by anything in this file, so it reads as a history, not just a "completed" set.
 *
 * KEEPING IT OPEN: this module has no idea a quest log screen exists — "open" here just means
 * nothing about an assigned quest is ever hidden or locked away: `getActiveQuests()` always
 * reflects live, current progress, and the caller (see `game/controllers/QuestLogScreenController.js`)
 * is free to show it any time, repeatedly, without this module caring whether it's open or closed.
 *
 * EVENTS: `QuestManager.events` is this module's own `Phaser.Events.EventEmitter`, independent of
 * any scene's emitter (same reasoning as `LoopManager.events`). Emits:
 * - `'quest:assigned'`            `{ id }`
 * - `'quest:objective-progress'`  `{ questId, objectiveId, current, count }`
 * - `'quest:completed'`           `{ id, completedAt }`
 * - `'quest:updated'`             no payload — fires after EVERY mutation above (assign, progress,
 *   complete), for consumers (e.g. a quest log UI) that just want "something changed, redraw".
 *
 * @module quest/QuestManager
 */

const STORAGE_KEY_PREFIX = 'hackjam:quests:v';
const SCHEMA_VERSION = 1;
const STORAGE_KEY = `${STORAGE_KEY_PREFIX}${SCHEMA_VERSION}`;

const OBJECTIVE_TYPES = ['collect_item', 'reach_location', 'interact', 'custom'];

/** Lowercase snake_case id, same convention as every manifest id elsewhere in the engine. */
const ID_PATTERN = /^[a-z0-9]+(_[a-z0-9]+)*$/;

/**
 * Validates one quest definition, throwing a descriptive `QuestValidationError` (fail loud, same
 * rule every manifest in this project follows — never a silent fallback for malformed content).
 * @param {object} def
 * @returns {void}
 * @throws {QuestValidationError}
 */
function validateQuestDefinition(def) {
  const id = def && typeof def.id === 'string' ? def.id : '(unknown)';

  if (def === null || typeof def !== 'object') {
    throw new QuestValidationError(id, '(root)', 'quest definition must be an object');
  }
  if (typeof def.id !== 'string' || !ID_PATTERN.test(def.id)) {
    throw new QuestValidationError(id, 'id', 'must be a lowercase_snake_case string');
  }
  if (typeof def.title !== 'string' || def.title.length === 0) {
    throw new QuestValidationError(id, 'title', 'must be a non-empty string');
  }
  if (def.description !== undefined && typeof def.description !== 'string') {
    throw new QuestValidationError(id, 'description', 'must be a string if present');
  }
  if (!Array.isArray(def.objectives) || def.objectives.length === 0) {
    throw new QuestValidationError(id, 'objectives', 'must be a non-empty array');
  }
  if (def.rewardItems !== undefined) {
    if (!Array.isArray(def.rewardItems)) {
      throw new QuestValidationError(id, 'rewardItems', 'must be an array if present');
    }
    def.rewardItems.forEach((reward, index) => {
      const path = `rewardItems[${index}]`;
      if (reward === null || typeof reward !== 'object') {
        throw new QuestValidationError(id, path, 'must be an object');
      }
      if (typeof reward.itemId !== 'string' || reward.itemId.length === 0) {
        throw new QuestValidationError(id, `${path}.itemId`, 'must be a non-empty string');
      }
      if (reward.count !== undefined && (!Number.isInteger(reward.count) || reward.count < 1)) {
        throw new QuestValidationError(id, `${path}.count`, 'must be a positive integer if present');
      }
    });
  }

  const seenObjectiveIds = new Set();
  def.objectives.forEach((objective, index) => {
    const path = `objectives[${index}]`;
    if (objective === null || typeof objective !== 'object') {
      throw new QuestValidationError(id, path, 'must be an object');
    }
    if (typeof objective.id !== 'string' || objective.id.length === 0) {
      throw new QuestValidationError(id, `${path}.id`, 'must be a non-empty string');
    }
    if (seenObjectiveIds.has(objective.id)) {
      throw new QuestValidationError(id, `${path}.id`, `duplicate objective id "${objective.id}" in this quest`);
    }
    seenObjectiveIds.add(objective.id);

    if (!OBJECTIVE_TYPES.includes(objective.type)) {
      throw new QuestValidationError(id, `${path}.type`, `must be one of ${OBJECTIVE_TYPES.join(', ')}`);
    }
    if (typeof objective.description !== 'string' || objective.description.length === 0) {
      throw new QuestValidationError(id, `${path}.description`, 'must be a non-empty string');
    }
    if (objective.count !== undefined && (!Number.isInteger(objective.count) || objective.count < 1)) {
      throw new QuestValidationError(id, `${path}.count`, 'must be a positive integer if present');
    }

    if (objective.type === 'collect_item' && (typeof objective.itemId !== 'string' || objective.itemId.length === 0)) {
      throw new QuestValidationError(id, `${path}.itemId`, 'required (non-empty string) for type "collect_item"');
    }
    if (objective.type === 'reach_location') {
      if (typeof objective.screenId !== 'string' || objective.screenId.length === 0) {
        throw new QuestValidationError(id, `${path}.screenId`, 'required (non-empty string) for type "reach_location"');
      }
      for (const field of ['x', 'y', 'radius']) {
        if (typeof objective[field] !== 'number') {
          throw new QuestValidationError(id, `${path}.${field}`, 'required (number) for type "reach_location"');
        }
      }
    }
    if (objective.type === 'interact' && (typeof objective.targetId !== 'string' || objective.targetId.length === 0)) {
      throw new QuestValidationError(id, `${path}.targetId`, 'required (non-empty string) for type "interact"');
    }
  });
}

class QuestManagerImpl {
  constructor() {
    /** @type {Phaser.Events.EventEmitter} */
    this.events = new Phaser.Events.EventEmitter();

    /** @type {Map<string, object>} questId -> validated definition (as authored) */
    this._definitions = new Map();

    /**
     * @type {Map<string, {
     *   status: 'active'|'completed',
     *   startedAt: number,
     *   completedAt: number|null,
     *   objectives: Map<string, { current: number, count: number, done: boolean }>
     * }>}
     */
    this._state = new Map();

    /** @type {string|null} the one quest a HUD is expected to keep showing — see `setTrackedQuest`. */
    this._trackedQuestId = null;
  }

  /**
   * Registers quest definitions so they can be assigned later. Safe to call more than once (e.g.
   * once at boot with the default content, again later if more content is streamed in) — existing
   * definitions with the same id are replaced, in-progress state for that id is left untouched.
   * @param {object[]} definitions - array of quest definitions (see module docstring)
   * @returns {void}
   * @throws {QuestValidationError} on the first invalid definition found
   */
  loadDefinitions(definitions) {
    if (!Array.isArray(definitions)) {
      throw new QuestValidationError('(unknown)', '(root)', 'loadDefinitions() expects an array of quest definitions');
    }
    for (const def of definitions) {
      validateQuestDefinition(def);
      this._definitions.set(def.id, def);
    }
  }

  /**
   * Registers a brand new quest definition built entirely at runtime (not pre-authored content)
   * and immediately assigns it. This is the generic "assign whatever quest" entry point: any
   * calling code — a terminal command, a dialogue choice, procedurally generated content — can
   * hand the player a quest of any shape the objective vocabulary supports.
   * @param {object} definition - same shape as a `loadDefinitions()` entry
   * @returns {object} the quest's live state, as `getQuest(definition.id)` would return it
   * @throws {QuestValidationError} if the definition is invalid
   */
  createAndAssignQuest(definition) {
    validateQuestDefinition(definition);
    this._definitions.set(definition.id, definition);
    return this.assignQuest(definition.id);
  }

  /**
   * Moves a registered quest definition into the active list, initializing fresh objective
   * progress. Idempotent for an already-active quest (returns its current state unchanged); an
   * already-completed quest is NOT reset — call `resetQuest(id)` first if a replay is wanted.
   * @param {string} questId
   * @returns {object} the quest's live state (see `getQuest`)
   * @throws {Error} if `questId` was never registered via `loadDefinitions`/`createAndAssignQuest`
   */
  assignQuest(questId) {
    const definition = this._definitions.get(questId);
    if (!definition) throw new Error(`QuestManager.assignQuest: unknown quest "${questId}" (load its definition first)`);

    const existing = this._state.get(questId);
    if (existing) return this.getQuest(questId);

    const objectives = new Map();
    for (const objective of definition.objectives) {
      objectives.set(objective.id, { current: 0, count: objective.count ?? 1, done: false });
    }
    this._state.set(questId, {
      status: 'active', startedAt: Date.now(), completedAt: null, objectives,
    });

    // A HUD should always have *something* to show when any quest is active (see `setTrackedQuest`'s
    // docstring) — the simplest way to guarantee that without a UI having to think about it is to
    // auto-track the first quest assigned whenever nothing is currently tracked.
    if (this._trackedQuestId === null) this._trackedQuestId = questId;

    this.events.emit('quest:assigned', { id: questId });
    this._touch();
    return this.getQuest(questId);
  }

  /**
   * Picks which active quest a HUD should keep displaying — e.g. a small always-on-screen line
   * like "Quest: Scrap Run — Collect 2x Scrap Metal (1/2)". Purely a UI convenience: it changes
   * nothing about quest state or progress, it only remembers which one the player (or whichever
   * system calls this, e.g. a quest log screen letting the player pick) wants kept in view.
   * `assignQuest` auto-tracks a quest whenever nothing is tracked yet, and `_progressObjective`
   * auto-retargets to another active quest if the tracked one just completed — between those two,
   * a tracked quest is shown whenever at least one quest is active, with no caller having to
   * manage that themselves; passing `null` explicitly clears it (shows nothing).
   * @param {string|null} questId - must be a currently ACTIVE quest id, or null to clear
   * @returns {void}
   * @throws {Error} if `questId` is not null and isn't currently active
   */
  setTrackedQuest(questId) {
    if (questId !== null && !this.isQuestActive(questId)) {
      throw new Error(`QuestManager.setTrackedQuest: "${questId}" is not an active quest`);
    }
    this._trackedQuestId = questId;
    this._touch();
  }

  /** @returns {string|null} the currently tracked quest's id, or null if none */
  getTrackedQuestId() {
    return this._trackedQuestId;
  }

  /**
   * @returns {object|null} the tracked quest (see `getQuest`), or null if nothing is tracked or
   *   the tracked quest is no longer active (defensive — `_progressObjective` already retargets
   *   this automatically, so that case shouldn't normally arise)
   */
  getTrackedQuest() {
    if (this._trackedQuestId === null || !this.isQuestActive(this._trackedQuestId)) return null;
    return this.getQuest(this._trackedQuestId);
  }

  /**
   * Clears all progress/state for one quest (it goes back to "available", as if never assigned).
   * Does not remove its definition. Useful for a quest the player should be able to repeat.
   * @param {string} questId
   * @returns {void}
   */
  resetQuest(questId) {
    this._state.delete(questId);
    if (this._trackedQuestId === questId) this._trackedQuestId = null;
    this._touch();
  }

  /**
   * Adds `amount` (default 1) of an item to `InventoryManager` (see module docstring's ITEM
   * TRACKING note), then progresses every active quest's not-yet-done `collect_item` objectives
   * targeting that exact `itemId` by however many units were ACTUALLY accepted into the inventory
   * (never over-crediting an objective past its own `count`, and never crediting more than
   * `InventoryManager.addItem` reports as added — if the inventory is full, progress stalls at
   * the true collected amount rather than counting units that were never really acquired).
   * @param {string} itemId
   * @param {number} [amount]
   * @returns {void}
   */
  collectItem(itemId, amount = 1) {
    const leftover = InventoryManager.addItem(itemId, amount);
    const actuallyAdded = amount - leftover;
    if (actuallyAdded <= 0) return;

    for (const [questId, state] of this._state) {
      if (state.status !== 'active') continue;
      const definition = this._definitions.get(questId);
      for (const objective of definition.objectives) {
        if (objective.type === 'collect_item' && objective.itemId === itemId) {
          this._progressObjective(questId, objective.id, actuallyAdded);
        }
      }
    }
    this._touch();
  }

  /**
   * @param {string} itemId
   * @returns {number} how many of that item are currently in the inventory (delegates to
   *   `InventoryManager.getItemCount`; see module docstring's ITEM TRACKING note)
   */
  getItemCount(itemId) {
    return InventoryManager.getItemCount(itemId);
  }

  /**
   * @param {string} itemId
   * @param {number} [amount]
   * @returns {boolean} whether at least `amount` (default 1) of that item is currently held
   *   (delegates to `InventoryManager.hasItem`)
   */
  hasItem(itemId, amount = 1) {
    return InventoryManager.hasItem(itemId, amount);
  }

  /**
   * Call every frame (or however often is convenient) with the player's current position, to
   * progress every active quest's not-yet-done `reach_location` objectives whose `screenId`
   * matches. Cheap no-op scan when no active quest has a matching objective.
   * @param {string} screenId - e.g. the screen manifest id the player is currently standing in
   * @param {number} x
   * @param {number} y
   * @returns {void}
   */
  reportLocation(screenId, x, y) {
    let changed = false;
    for (const [questId, state] of this._state) {
      if (state.status !== 'active') continue;
      const definition = this._definitions.get(questId);
      for (const objective of definition.objectives) {
        if (objective.type !== 'reach_location' || objective.screenId !== screenId) continue;
        const progress = state.objectives.get(objective.id);
        if (progress.done) continue;
        const distance = Phaser.Math.Distance.Between(x, y, objective.x, objective.y);
        if (distance <= objective.radius) {
          this._progressObjective(questId, objective.id, progress.count - progress.current);
          changed = true;
        }
      }
    }
    if (changed) this._touch();
  }

  /**
   * Progresses every active quest's not-yet-done `interact` objectives targeting `targetId` by
   * one. Call this from wherever an `InteractiveObject.trigger()` (or any other interaction)
   * fires, passing whatever id that target is known by.
   * @param {string} targetId
   * @returns {void}
   */
  triggerInteract(targetId) {
    for (const [questId, state] of this._state) {
      if (state.status !== 'active') continue;
      const definition = this._definitions.get(questId);
      for (const objective of definition.objectives) {
        if (objective.type === 'interact' && objective.targetId === targetId) {
          this._progressObjective(questId, objective.id, 1);
        }
      }
    }
    this._touch();
  }

  /**
   * Manually completes one objective outright (its full remaining `count` is credited at once).
   * This is the ONLY way a `custom` objective ever progresses, and also works as an escape hatch
   * for any other objective type when calling content needs to force-complete it.
   * @param {string} questId
   * @param {string} objectiveId
   * @returns {void}
   * @throws {Error} if the quest isn't active or has no such objective
   */
  completeObjective(questId, objectiveId) {
    const state = this._state.get(questId);
    if (!state || state.status !== 'active') throw new Error(`QuestManager.completeObjective: "${questId}" is not an active quest`);
    const progress = state.objectives.get(objectiveId);
    if (!progress) throw new Error(`QuestManager.completeObjective: "${questId}" has no objective "${objectiveId}"`);

    this._progressObjective(questId, objectiveId, progress.count - progress.current);
    this._touch();
  }

  /**
   * Shared progress bookkeeping for every objective-advancing call above: clamps, marks done,
   * emits `'quest:objective-progress'`, and checks whether the whole quest just finished.
   * @param {string} questId
   * @param {string} objectiveId
   * @param {number} incrementBy
   * @private
   * @returns {void}
   */
  _progressObjective(questId, objectiveId, incrementBy) {
    if (incrementBy <= 0) return;
    const state = this._state.get(questId);
    if (!state || state.status !== 'active') return;
    const progress = state.objectives.get(objectiveId);
    if (!progress || progress.done) return;

    progress.current = Math.min(progress.count, progress.current + incrementBy);
    progress.done = progress.current >= progress.count;

    this.events.emit('quest:objective-progress', {
      questId, objectiveId, current: progress.current, count: progress.count,
    });

    const allDone = [...state.objectives.values()].every((p) => p.done);
    if (allDone) {
      state.status = 'completed';
      state.completedAt = Date.now();
      // rewardItems travels on the event itself (see module docstring's REWARD ITEMS note) —
      // this module never calls InventoryManager.addItem itself, it only hands the list off.
      this.events.emit('quest:completed', {
        id: questId, completedAt: state.completedAt, rewardItems: definition.rewardItems ?? [],
      });

      // Keep the HUD showing SOMETHING (see `setTrackedQuest`'s docstring): if the quest that
      // just finished was the tracked one, hand tracking to another active quest if any remain.
      if (this._trackedQuestId === questId) {
        const nextActiveId = [...this._state.entries()].find(([, s]) => s.status === 'active')?.[0];
        this._trackedQuestId = nextActiveId ?? null;
      }
    }
  }

  /**
   * @returns {object[]} every currently active quest, each as `getQuest(id)` would return it
   */
  getActiveQuests() {
    return [...this._state.entries()]
      .filter(([, state]) => state.status === 'active')
      .map(([id]) => this.getQuest(id));
  }

  /**
   * The permanent, timestamped trace of every quest ever finished — see module docstring's
   * "TRACING DONE QUESTS". Sorted most-recently-completed first.
   * @returns {object[]}
   */
  getCompletedQuests() {
    return [...this._state.entries()]
      .filter(([, state]) => state.status === 'completed')
      .map(([id]) => this.getQuest(id))
      .sort((a, b) => b.completedAt - a.completedAt);
  }

  /**
   * @returns {object[]} every registered quest definition not currently active or completed
   */
  getAvailableQuests() {
    return [...this._definitions.keys()]
      .filter((id) => !this._state.has(id))
      .map((id) => this._definitions.get(id));
  }

  /**
   * @param {string} questId
   * @returns {object|null} `{ id, title, description, status, startedAt, completedAt, objectives: [{id, description, type, current, count, done}] }`,
   *   or null if `questId` has never been assigned
   */
  getQuest(questId) {
    const state = this._state.get(questId);
    const definition = this._definitions.get(questId);
    if (!state || !definition) return null;

    return {
      id: questId,
      title: definition.title,
      description: definition.description ?? '',
      status: state.status,
      startedAt: state.startedAt,
      completedAt: state.completedAt,
      objectives: definition.objectives.map((objective) => {
        const progress = state.objectives.get(objective.id);
        return {
          id: objective.id,
          description: objective.description,
          type: objective.type,
          current: progress.current,
          count: progress.count,
          done: progress.done,
        };
      }),
    };
  }

  /** @param {string} questId @returns {boolean} */
  isQuestActive(questId) {
    return this._state.get(questId)?.status === 'active';
  }

  /** @param {string} questId @returns {boolean} */
  isQuestCompleted(questId) {
    return this._state.get(questId)?.status === 'completed';
  }

  /**
   * Clears ALL quest progress (definitions stay registered) AND, since items are now tracked by
   * `InventoryManager` (see module docstring's ITEM TRACKING note), the player's whole inventory
   * too — mirrors this method's previous scope/shape exactly, just delegating the item half.
   * Mirrors `LoopManager.reset()`'s scope/shape for consistency; unlike `LoopManager`, nothing
   * in this engine calls this automatically — it's here for calling content to use deliberately
   * (e.g. a "new game" action), since quest progress/history is meant to persist across ordinary
   * loop resets by default (see module docstring's "KEEPING IT OPEN").
   * @returns {void}
   */
  resetAll() {
    this._state.clear();
    InventoryManager.resetAll();
    this._trackedQuestId = null;
    this._touch();
  }

  /**
   * Emits `'quest:updated'` and persists. Called after every mutating method above so a quest log
   * UI can subscribe to one event and always redraw current truth.
   * @private
   * @returns {void}
   */
  _touch() {
    this.events.emit('quest:updated');
    this.save();
  }

  /**
   * Persists active/completed quest state to localStorage. Item state is no longer this module's
   * to persist — `InventoryManager` saves itself under its own key (see module docstring's ITEM
   * TRACKING note). Definitions are NOT persisted (they are re-registered via `loadDefinitions`
   * every boot, same as content elsewhere in the engine is re-declared rather than saved).
   * @returns {void}
   */
  save() {
    const serializedState = [...this._state.entries()].map(([id, state]) => [
      id,
      {
        status: state.status,
        startedAt: state.startedAt,
        completedAt: state.completedAt,
        objectives: [...state.objectives.entries()],
      },
    ]);
    const payload = {
      state: serializedState,
      trackedQuestId: this._trackedQuestId,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }

  /**
   * Loads previously saved progress from localStorage, if any. Call AFTER `loadDefinitions()` so
   * saved quest ids can be checked against what's currently registered. A saved quest whose
   * definition is no longer registered (content removed since the save was written) is skipped
   * with a `console.warn` rather than crashing — same resilience `SettingsStore.load()` has for a
   * malformed save. Malformed/missing storage also falls back to a clean empty state silently.
   * @returns {void}
   */
  load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return;

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (error) {
      console.warn(`[QuestManager] stored progress at "${STORAGE_KEY}" is malformed; starting fresh.`, error);
      return;
    }

    this._state.clear();

    for (const [id, state] of payload.state ?? []) {
      if (!this._definitions.has(id)) {
        console.warn(`[QuestManager] saved progress references unknown quest "${id}"; skipping it.`);
        continue;
      }
      this._state.set(id, {
        status: state.status,
        startedAt: state.startedAt,
        completedAt: state.completedAt,
        objectives: new Map(state.objectives),
      });
    }
    const trackedId = payload.trackedQuestId ?? null;
    this._trackedQuestId = trackedId !== null && this._state.get(trackedId)?.status === 'active' ? trackedId : null;
  }
}

/** Module-level singleton. Import this directly — never construct `QuestManagerImpl` yourself. */
export const QuestManager = new QuestManagerImpl();