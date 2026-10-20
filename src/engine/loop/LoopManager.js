import Phaser from 'phaser';

/**
 * Tracks progress that survives Phaser scene restarts: fragments collected this loop, how many
 * loops have run, and whether enough fragments have been found to unlock the terminal.
 *
 * SINGLETON: `LoopManager` below is a plain exported object (an instance of the private
 * `LoopManagerImpl` class), not a class callers instantiate. It must never be stored on a Scene
 * or GameObject, since those get destroyed/recreated on scene restarts and this state must not.
 *
 * `totalFragmentsNeeded` has a placeholder default (5) and is meant to be overwritten exactly
 * once by the game bootstrap (module 11), immediately after import and before any gameplay
 * starts, e.g. `LoopManager.totalFragmentsNeeded = 8;`. It is intentionally not a constructor
 * parameter: this is a true singleton with no instantiation call site for callers to pass it to.
 *
 * EVENTS: `LoopManager.events` is this module's own `Phaser.Events.EventEmitter`, independent of
 * any scene's emitter, so any scene can subscribe without holding a reference to another scene.
 * `'loop:fragment-added'` fires from `addFragment` with `{ id, total }`. `'loop:reset'` fires
 * from `reset()` after state is cleared. Both event names are exact, from 01_SHARED_CONTRACTS.md.
 *
 * @module loop/LoopManager
 */
class LoopManagerImpl {
  constructor() {
    /**
     * Fragments required to unlock terminal access. Placeholder default — overwrite once at
     * boot (module 11), before any gameplay starts.
     * @type {number}
     */
    this.totalFragmentsNeeded = 5;

    /** @type {Phaser.Events.EventEmitter} */
    this.events = new Phaser.Events.EventEmitter();

    this.reset();
  }

  /**
   * Clears all progress for a fresh run (fragments, loop count, terminal unlock) and emits
   * `'loop:reset'`.
   * @returns {void}
   */
  reset() {
    /** @type {Set<string>} */
    this.fragments = new Set();
    /** @type {number} */
    this.loopCount = 0;
    /** @type {boolean} */
    this.unlockedTerminalAccess = false;
    this.events.emit('loop:reset');
  }

  /**
   * Increments the loop counter. Does NOT clear fragments — call `reset()` separately if the new
   * loop should start from zero fragments (the choice of which belongs to the caller, e.g. the
   * World screen controller's reset-trigger logic).
   * @returns {void}
   */
  startNewLoop() {
    this.loopCount += 1;
  }

  /**
   * Records a fragment as collected (idempotent — adding the same id twice is a no-op beyond the
   * event). Unlocks terminal access once `fragmentCount()` reaches `totalFragmentsNeeded`, and
   * always emits `'loop:fragment-added'` with `{ id, total: fragmentCount() }`.
   * @param {string} id
   * @returns {void}
   */
  addFragment(id) {
    this.fragments.add(id);
    if (this.fragmentCount() >= this.totalFragmentsNeeded) this.unlockedTerminalAccess = true;
    this.events.emit('loop:fragment-added', { id, total: this.fragmentCount() });
  }

  /**
   * @param {string} id
   * @returns {boolean} whether this fragment has already been collected this loop
   */
  hasFragment(id) {
    return this.fragments.has(id);
  }

  /** @returns {number} number of fragments collected so far this loop */
  fragmentCount() {
    return this.fragments.size;
  }

  /** @returns {number} 0..1 progress ratio, for scaling glitch visuals/audio */
  glitchLevel() {
    return Math.min(1, this.fragmentCount() / this.totalFragmentsNeeded);
  }
}

/** Module-level singleton. Import this directly — never construct `LoopManagerImpl` yourself. */
export const LoopManager = new LoopManagerImpl();
