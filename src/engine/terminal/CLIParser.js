/**
 * The fake-Kali command-line parser: a pure, framework-agnostic command interpreter over a
 * fake filesystem object (see fakeFileSystem.example.js for the expected node shape). The only
 * thing here that isn't plain JS is the constructor's `eventEmitter` parameter — a generic
 * EventEmitter-shaped object (typically `scene.events`), used only to `emit()` on crack
 * success/failure (exact event names from 01_SHARED_CONTRACTS.md). No Phaser import anywhere
 * in this file.
 *
 * Commands are stored in a `Map<string, CommandHandler>` so a new command can be added from
 * outside this file with a single `parser.commands.set(name, handler)` call, without touching
 * a big switch statement.
 *
 * @module terminal/CLIParser
 */

/**
 * @callback CommandHandler
 * @param {string[]} args - whitespace-split tokens after the command name
 * @param {CLIParser} parser - the parser instance, so handlers can read/mutate `parser.state`,
 *   reach `parser.fileSystem`, or call `parser.eventEmitter.emit(...)`
 * @param {{ clear(): void }} [ui] - forwarded from `run()`, only used by `clear`
 * @returns {string[]} lines of output
 */

/**
 * Resolves a (possibly relative) path argument against a current working directory into an
 * absolute, normalized path. Pure function — exported for unit testing outside a running parser.
 *
 * Rules:
 * - An arg starting with `/` is already absolute and is used as-is (after normalization).
 * - Otherwise it is joined onto `cwd`.
 * - `.` segments are dropped, `..` segments pop the previous segment (clamped at the root).
 * - A missing/empty arg resolves to `cwd` itself (so `ls` with no path means "list cwd").
 * - The result always starts with `/` and never ends with `/` unless it IS `/` itself.
 *
 * @param {string} cwd - current working directory, e.g. `/home/user`
 * @param {string} [rawArg] - the raw path argument, e.g. `../etc`, `/var`, `notes.txt`
 * @returns {string} normalized absolute path
 */
export function resolvePath(cwd, rawArg) {
  const base = rawArg && rawArg.startsWith('/') ? rawArg : `${cwd}/${rawArg ?? ''}`;
  const segments = base.split('/').filter((segment) => segment.length > 0 && segment !== '.');

  const resolved = [];
  for (const segment of segments) {
    if (segment === '..') resolved.pop();
    else resolved.push(segment);
  }

  return resolved.length === 0 ? '/' : `/${resolved.join('/')}`;
}

export class CLIParser {
  /**
   * @param {{ emit: (eventName: string, payload?: object) => void }} eventEmitter - typically `scene.events`
   * @param {object} fileSystem - shape matching fakeFileSystem.example.js's export: a flat map of
   *   absolute path -> `{ type: 'dir', children: string[] }` or `{ type: 'file', content: string }`
   * @param {string} targetPassword - the answer `crack <guess>` is checked against (case-insensitive)
   */
  constructor(eventEmitter, fileSystem, targetPassword) {
    /** @type {{ emit: (eventName: string, payload?: object) => void }} */
    this.eventEmitter = eventEmitter;
    /** @type {object} */
    this.fileSystem = fileSystem;
    /** @type {string} */
    this.targetPassword = targetPassword;

    /** @type {{ cwd: string }} */
    this.state = { cwd: '/' };

    /** @type {Map<string, CommandHandler>} */
    this.commands = new Map();
    /** Descriptions shown by `help`, keyed the same as `commands`. @type {Map<string, string>} */
    this.descriptions = new Map();

    this._registerBuiltins();
  }

  /**
   * Registers a command.
   * @param {string} name
   * @param {CommandHandler} handler
   * @param {string} [description] - one-line text shown by `help`
   * @returns {void}
   */
  registerCommand(name, handler, description = '') {
    this.commands.set(name, handler);
    this.descriptions.set(name, description);
  }

  /**
   * Parses and runs one line of input.
   * @param {string} rawInput
   * @param {{ clear(): void }} [ui] - optional; only `clear` uses it
   * @returns {string[]} lines of output to display (empty array for a blank line or no output)
   */
  run(rawInput, ui) {
    const trimmed = rawInput.trim();
    if (trimmed === '') return [];

    const [name, ...args] = trimmed.split(/\s+/);
    const handler = this.commands.get(name);
    if (!handler) return [`${name}: command not found`];

    return handler(args, this, ui);
  }

  /**
   * Looks up a filesystem node by absolute path.
   * @param {string} path
   * @returns {{type:'dir',children:string[]}|{type:'file',content:string}|undefined}
   * @private
   */
  _lookup(path) {
    return this.fileSystem[path];
  }

  /** @returns {void} @private */
  _registerBuiltins() {
    this.registerCommand('help', () => {
      return [...this.descriptions.entries()].map(([name, desc]) => (desc ? `${name} - ${desc}` : name));
    }, 'list available commands');

    this.registerCommand('pwd', () => [this.state.cwd], 'print working directory');

    this.registerCommand('ls', (args) => {
      const path = resolvePath(this.state.cwd, args[0]);
      const node = this._lookup(path);
      if (!node || node.type !== 'dir') return [`ls: ${args[0] ?? path}: not a directory`];
      return [node.children.join('  ')];
    }, 'list directory contents');

    this.registerCommand('cd', (args) => {
      const path = resolvePath(this.state.cwd, args[0]);
      const node = this._lookup(path);
      if (!node || node.type !== 'dir') return [`cd: ${args[0] ?? path}: not a directory`];
      this.state.cwd = path;
      return [];
    }, 'change directory');

    this.registerCommand('cat', (args) => {
      const path = resolvePath(this.state.cwd, args[0]);
      const node = this._lookup(path);
      if (!node || node.type !== 'file') return [`cat: ${args[0] ?? path}: not a file`];
      return node.content.split('\n');
    }, 'print file contents');

    // ASSUMPTION: placeholder content, meant to be overridden per-game (thematically neutral on purpose).
    this.registerCommand('connect', () => [
      'Connecting to exit-node...',
      "Access denied. Use 'crack <password>'.",
    ], 'attempt a network connection');

    this.registerCommand('crack', (args) => {
      const guess = (args[0] ?? '').toUpperCase();
      if (guess === this.targetPassword.toUpperCase()) {
        this.eventEmitter.emit('terminal:crack-success');
        return ['ACCESS GRANTED.'];
      }
      this.eventEmitter.emit('terminal:crack-fail', { guess });
      return ['ACCESS DENIED.'];
    }, 'crack <guess> - attempt to guess the password');

    this.registerCommand('clear', (args, parser, ui) => {
      if (ui) ui.clear();
      return [];
    }, 'clear the screen');
  }
}
