import { ScreenController } from '../../engine/screens/ScreenController.js';
import { CLIParser } from '../../engine/terminal/CLIParser.js';
import { exampleFileSystem, EXAMPLE_TARGET_PASSWORD } from '../../engine/terminal/fakeFileSystem.example.js';
import { createCRTOverlay } from '../../engine/terminal/CRTOverlay.js';
import { LoopManager } from '../../engine/loop/LoopManager.js';

/** Id `LoopManager.addFragment` is recorded under for a successful crack. */
const FRAGMENT_ID = 'terminal-root';
/** Beat (ms) between a successful crack and popping back to the World. */
const POP_DELAY_MS = 900;

/**
 * Example "Terminal" screen: composes module 08's `CLIParser` with module 07's
 * `scrollable-text` element (via the `terminal_output` window, this screen's one `ui_window`)
 * and module 08's `CRTOverlay`.
 *
 * INPUT-LINE DESIGN NOTE (a real gap this reconciles): module 07's `text-input` element only
 * binds its buffer to a `SettingsStore` path (see `TextInput.js`) — it has no way to hand an
 * arbitrary submitted line to a callback, which is exactly what a terminal prompt needs (pass
 * the line to `CLIParser.run`, not write it to a settings key). So this controller manages its
 * own small input buffer directly, the same way `TextInput.js` does internally, rendered as a
 * plain prompt line inside the window's own container (not built through `WindowFactory`).
 *
 * Also note: `ScreenManager` already forwards every abstract InputRouter action to the active
 * screen's `onInput(action, event)` (see its constructor) — so, like `WorldScreenController`,
 * this controller reacts to `text-char`/`text-backspace`/`text-enter`/`cancel` from `onInput`
 * rather than subscribing to `InputRouter` directly.
 * @module game/controllers/TerminalScreenController
 */
export class TerminalScreenController extends ScreenController {
  /** @param {object} [params] @returns {void} */
  onEnter(params) {
    const { scene } = this.engine;

    this.parser = new CLIParser(scene.events, exampleFileSystem, EXAMPLE_TARGET_PASSWORD);

    // This screen's manifest lists `ui_windows: ["terminal_output"]`, so ScreenManager already
    // built it and stored the handle on `this.windows` before calling onEnter.
    const outputHandle = this.windows[0];
    this.output = outputHandle.getElement('output');
    this.output.appendLine('fake-kali v0.1 -- type "help" to begin');

    this.buffer = '';
    this.promptText = scene.add.text(4, 148, '> ', {
      fontFamily: 'monospace',
      fontSize: '10px',
      color: '#8aff8a',
    });
    outputHandle.container.add(this.promptText);

    this._onCrackSuccess = () => {
      LoopManager.addFragment(FRAGMENT_ID);
      scene.time.delayedCall(POP_DELAY_MS, () => this.engine.screenManager.pop());
    };
    scene.events.on('terminal:crack-success', this._onCrackSuccess);

    this.crt = createCRTOverlay(scene);
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
      this.output.appendLine(`> ${this.buffer}`);
      const lines = this.parser.run(this.buffer, { clear: () => this.output.clear() });
      lines.forEach((line) => this.output.appendLine(line));
      this.buffer = '';
      this._redrawPrompt();
    } else if (action === 'cancel') {
      this.engine.screenManager.pop();
    }
  }

  /** @returns {void} @private */
  _redrawPrompt() {
    this.promptText.setText(`> ${this.buffer}`);
  }

  /** @returns {void} */
  onExit() {
    this.engine.scene.events.off('terminal:crack-success', this._onCrackSuccess);
    this.crt.destroy();
    this.promptText.destroy();
  }

  /** @param {number} time @param {number} delta @returns {void} */
  onUpdate(time, delta) {}

  /** @returns {void} */
  onPause() {}

  /** @returns {void} */
  onResume() {}
}
