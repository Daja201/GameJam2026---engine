import { ScreenController } from '../../engine/screens/ScreenController.js';
import { CLIParser } from '../../engine/terminal/CLIParser.js';
import { exampleFileSystem, EXAMPLE_TARGET_PASSWORD } from '../../engine/terminal/fakeFileSystem.example.js';
import { LoopManager } from '../../engine/loop/LoopManager.js';
import { InventoryManager } from '../../engine/inventory/InventoryManager.js';

/** Id `LoopManager.addFragment` is recorded under for a successful crack. */
const FRAGMENT_ID = 'terminal-root';
/** Beat (ms) between a successful crack and popping back to the World. */
const POP_DELAY_MS = 900;
/** How often (ms) the input-line cursor toggles between visible/hidden, for a realistic blink. */
const CURSOR_BLINK_MS = 450;

/**
 * Example "Terminal" screen: composes module 08's `CLIParser` with module 07's
 * `scrollable-text` element (via the `terminal_output` window, this screen's one `ui_window`).
 *
 * FIX (this revision): the input line used to be a second, separately positioned
 * `Phaser.GameObjects.Text` with a hardcoded (x, y) — it could visually drift out of sync with
 * the scrollable output below it. It now lives INSIDE the `scrollable-text` element itself via
 * `ScrollableText`'s new `setPendingLine(text)` (see that file's docstring) — the prompt is
 * always the literal last line of the same scrolling text block, so it can never end up at a
 * stale fixed position again. A blinking block cursor is appended to make it read as a real
 * terminal rather than a static label.
 *
 * `ScreenManager` already forwards every abstract InputRouter action to the active screen's
 * `onInput(action, event)` — so, like `WorldScreenController`, this controller reacts to
 * `text-char`/`text-backspace`/`text-enter`/`cancel` from `onInput` rather than subscribing to
 * `InputRouter` directly.
 * @module game/controllers/TerminalScreenController
 */
export class TerminalScreenController extends ScreenController {
  /** @param {object} [params] @returns {void} */
  onEnter(params) {
    const { scene } = this.engine;

    this.parser = new CLIParser(scene.events, exampleFileSystem, EXAMPLE_TARGET_PASSWORD);
    this._registerInventoryCommands(this.parser);

    // This screen's manifest lists `ui_windows: ["terminal_output"]`, so ScreenManager already
    // built it and stored the handle on `this.windows` before calling onEnter.
    const outputHandle = this.windows[0];
    this.output = outputHandle.getElement('output');
    this.output.appendLine('=== fake-kali v0.1 ===');
    this.output.appendLine('type "help" to begin');
    this.output.appendLine('');

    this.buffer = '';
    this._cursorOn = true;
    this._blinkAccum = 0;
    this._redrawPrompt();

    // FIX (file-crack unification): CLIParser's `crack` now also handles `crack <file> <guess>`,
    // reusing this SAME event rather than inventing a second one (see CLIParser.js's own doc) —
    // its payload carries `{ file }` when it was a file unlock. Only the ORIGINAL root-password
    // guess (no `file` in the payload) should award a fragment and kick the player back out to
    // World; a file-crack should just leave them in the terminal to read what they unlocked.
    this._onCrackSuccess = (payload) => {
      if (payload && payload.file) return;
      LoopManager.addFragment(FRAGMENT_ID);
      scene.time.delayedCall(POP_DELAY_MS, () => this.engine.screenManager.pop());
    };
    scene.events.on('terminal:crack-success', this._onCrackSuccess);

  }

  /**
   * @param {string} action
   * @param {{char?: string}} event
   * @returns {void}
   */
  onInput(action, event) {
    if (action === 'text-char') {
      this.buffer += event.char;
      this._redrawPrompt();
    } else if (action === 'text-backspace') {
      this.buffer = this.buffer.slice(0, -1);
      this._redrawPrompt();
    } else if (action === 'text-enter') {
      this.output.appendLine(`${this._promptPrefix()}${this.buffer}`);
      const lines = this.parser.run(this.buffer, { clear: () => this.output.clear() });
      lines.forEach((line) => this.output.appendLine(line));
      this.buffer = '';
      this._redrawPrompt();
    } else if (action === 'cancel') {
      this.engine.screenManager.pop();
    }
  }

  /** @param {number} time @param {number} delta @returns {void} */
  onUpdate(time, delta) {
    this._blinkAccum += delta;
    if (this._blinkAccum >= CURSOR_BLINK_MS) {
      this._blinkAccum = 0;
      this._cursorOn = !this._cursorOn;
      this._redrawPrompt();
    }
  }

  /** Redraws the live (uncommitted) input line as the scrollable text's last line, with a
   * blinking block cursor — see module docstring for why this replaced a separate Text object.
   * @returns {void} @private */
  _redrawPrompt() {
    const cursor = this._cursorOn ? '\u2588' : ' '; // U+2588 FULL BLOCK, classic terminal caret
    this.output.setPendingLine(`${this._promptPrefix()}${this.buffer}${cursor}`);
  }

  /** @returns {string} @private */
  _promptPrefix() {
    return `${this.parser.state.identity}:${this.parser.state.cwd}$ `;
  }

  /**
   * Registers this game's `inventory`/`give`/`use` commands onto a freshly-built `CLIParser`
   * instance (content, not engine — `CLIParser` itself only knows about its own built-ins; see
   * its module docstring's note on adding commands from outside via `registerCommand`). `give`
   * is the hacking-theme entry point for granting items from the terminal (alongside world
   * pickups and quest rewards — see `InventoryManager.js`'s module docstring).
   * @param {CLIParser} parser
   * @private
   * @returns {void}
   */
  _registerInventoryCommands(parser) {
    parser.registerCommand('inventory', () => {
      const slots = InventoryManager.getSlots().filter((slot) => slot.itemId !== null);
      if (slots.length === 0) return ['(inventory empty)'];
      return slots.map((slot) => {
        const definition = InventoryManager.getItemDefinition(slot.itemId);
        const stackTag = definition?.stackable ? ` x${slot.count}` : '';
        return `[${slot.slotIndex}] ${definition?.name ?? slot.itemId}${stackTag}`;
      });
    }, 'list inventory contents');

    parser.registerCommand('give', (args) => {
      const [itemId, countArg] = args;
      if (!itemId) return ['usage: give <itemId> [count]'];
      if (!InventoryManager.getItemDefinition(itemId)) return [`give: unknown item "${itemId}"`];
      const count = Number.isInteger(Number(countArg)) && Number(countArg) > 0 ? Number(countArg) : 1;
      const leftover = InventoryManager.addItem(itemId, count);
      const gained = count - leftover;
      if (gained <= 0) return ['give: inventory full, nothing granted'];
      return leftover > 0
        ? [`granted ${gained}x ${itemId} (inventory full, ${leftover} lost)`]
        : [`granted ${gained}x ${itemId}`];
    }, 'give <itemId> [count] - grant yourself an item (debug/hacking)');

    parser.registerCommand('use', (args) => {
      const slotIndex = Number(args[0]);
      if (!Number.isInteger(slotIndex)) return ['usage: use <slot>'];
      const definition = InventoryManager.useItem(slotIndex);
      return definition ? [`used ${definition.name}`] : [`use: slot ${slotIndex} is empty`];
    }, 'use <slot> - use an item by its inventory slot number');

    // The diegetic "cat" mechanic (see /storycontext.md's "The Cat" section): `save` moves an
    // item OUT of the normal inventory and into the cat's own small, reset-exempt slot set
    // (`InventoryManager.stashInCat`/`retrieveFromCat` — see that file's doc for why it's a
    // separate array, never touched by the regular `resetAll()`). This is the player's actual
    // risk/tension decision each session, so it has to move real items, not just print flavor
    // text. ASSUMPTION: `--slot=<n>` is accepted but ignored (placement in the cat is automatic,
    // not manually targetable) — jam-scope stub, flagged here rather than left silently unused.
    parser.registerCommand('save', (args) => {
      const [itemId] = args.filter((arg) => !arg.startsWith('-'));
      if (!itemId) return ['usage: save <item> [--slot=<n>]'];
      const definition = InventoryManager.getItemDefinition(itemId);
      if (!definition) return [`save: unknown item "${itemId}"`];
      const result = InventoryManager.stashInCat(itemId, 1);
      if (!result.success) {
        return [result.reason === 'not-held'
          ? `save: you aren't carrying ${itemId}`
          : "save: the cat has nowhere left to hide that"];
      }
      return [`${definition.name} hidden in the cat. it should survive the walk out.`];
    }, 'save <item> [--slot=<n>] - hide an item in the cat (survives a reset)');

    parser.registerCommand('load', (args) => {
      const [itemId] = args.filter((arg) => !arg.startsWith('-'));
      if (!itemId) return ['usage: load <item> [--slot=<n>]'];
      const definition = InventoryManager.getItemDefinition(itemId);
      if (!definition) return [`load: unknown item "${itemId}"`];
      const result = InventoryManager.retrieveFromCat(itemId, 1);
      if (!result.success) {
        return [result.reason === 'inventory-full'
          ? 'load: inventory full, left it with the cat'
          : `load: the cat isn't carrying ${itemId}`];
      }
      return [`retrieved ${definition.name} from the cat.`];
    }, 'load <item> [--slot=<n>] - retrieve an item the cat was hiding');
  }

  /** @returns {void} */
  onExit() {
    this.engine.scene.events.off('terminal:crack-success', this._onCrackSuccess);
  }

  /** @returns {void} */
  onPause() {}

  /** @returns {void} */
  onResume() {}
}