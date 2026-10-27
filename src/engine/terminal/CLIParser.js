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

    /** @type {{ cwd: string, identity: string }} */
    this.state = { cwd: '/', identity: 'luca@term-local' };

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

    // UNIFIED (file-crack + root-password-crack now share one command/one event pattern, per
    // request — see `hash` below for the file side of this). Mode is picked by whether the
    // first arg resolves to an existing FILE node: `crack <file> <guess>` unlocks a file that
    // `hash` previously locked; `crack <guess>` (unchanged) is the original root-password guess.
    // Both paths emit the SAME `terminal:crack-success`/`terminal:crack-fail` events — a
    // file-crack's payload carries `{ file }` so a listener (TerminalScreenController) can tell
    // the two apart without a second event name existing anywhere.
    this.registerCommand('crack', (args) => {
      const positional = args.filter((arg) => !arg.startsWith('-'));
      const [first, second] = positional;
      const firstPath = first ? resolvePath(this.state.cwd, first) : null;
      const firstNode = firstPath ? this._lookup(firstPath) : undefined;

      if (firstNode && firstNode.type === 'file') {
        if (!firstNode.locked) return [`crack: ${first}: not locked`];

        const wordlistFlag = args.find((arg) => arg.startsWith('--wordlist='));
        const bruteforce = args.includes('-b') || args.includes('--bruteforce');
        if (wordlistFlag || bruteforce) {
          // STUB (jam scope): no real wordlist/bruteforce attack exists yet — always fails, but
          // still routes through the same fail event as a direct wrong guess.
          this.eventEmitter.emit('terminal:crack-fail', { file: first, mode: wordlistFlag ? 'wordlist' : 'bruteforce' });
          return [wordlistFlag
            ? `crack: wordlist attack not available on this build — try 'crack ${first} <guess>'`
            : `crack: bruteforce not available on this build — try 'crack ${first} <guess>'`];
        }

        if (!second) return [`usage: crack ${first} <guess>`];
        const guess = second.toUpperCase();
        if (guess === (firstNode.lockPassword ?? '').toUpperCase()) {
          firstNode.locked = false;
          firstNode.content = firstNode._plainContent ?? firstNode.content;
          this.eventEmitter.emit('terminal:crack-success', { file: first });
          return [`${first}: unlocked.`, 'ACCESS GRANTED.'];
        }
        this.eventEmitter.emit('terminal:crack-fail', { file: first, guess });
        return ['ACCESS DENIED.'];
      }

      // Original root-password guess — unchanged behavior/event payload shape.
      const guess = (first ?? '').toUpperCase();
      if (guess === this.targetPassword.toUpperCase()) {
        this.eventEmitter.emit('terminal:crack-success');
        return ['ACCESS GRANTED.'];
      }
      this.eventEmitter.emit('terminal:crack-fail', { guess });
      return ['ACCESS DENIED.'];
    }, 'crack <guess> | crack <file> <guess> [--wordlist=<name>] [-b|--bruteforce] - guess the root password, or unlock a hashed file');

    // "Encrypts" a file in the fake filesystem: flags it locked, stashes its real content so
    // `crack` can restore it verbatim, and assigns the password `crack` will check against — a
    // content author can pre-set `node.lockPassword` on a file in their own fileSystem content
    // to script a specific intended answer; otherwise one is generated deterministically from
    // the file's own path (same file always locks to the same password within a session).
    // `--algo` is flavor text only, same spirit as the existing `connect` stub's ASSUMPTION note.
    this.registerCommand('hash', (args) => {
      const algoFlag = args.find((arg) => arg.startsWith('--algo='));
      const algo = algoFlag ? algoFlag.slice('--algo='.length) : 'sha256';
      const target = args.find((arg) => !arg.startsWith('-'));
      if (!target) return ['usage: hash <file> [--algo=<name>]'];

      const path = resolvePath(this.state.cwd, target);
      const node = this._lookup(path);
      if (!node || node.type !== 'file') return [`hash: ${target}: not a file`];
      if (node.locked) return [`hash: ${target}: already locked`];

      node._plainContent = node.content;
      node.content = `[ENCRYPTED - ${algo.toUpperCase()}]`;
      node.locked = true;
      node.lockPassword = node.lockPassword ?? _fakeHashFromPath(path);
      return [`hashing ${target} (${algo})...`, `${target}: locked.`];
    }, 'hash <file> [--algo=<name>] - lock a file (crack it later to read it again)');

    // STUB (jam scope, intentional — no real multi-host network exists yet): always fails, with
    // in-fiction flavor rather than a bare error. If `ssh`/`telnet` ever actually change terminal
    // context (e.g. logging into a relay), `whoami` should start reflecting that via
    // `this.state.identity` — not implemented yet, reserved for later network content.
    this.registerCommand('ssh', (args) => {
      const host = args.find((arg) => !arg.startsWith('-'));
      if (!host) return ['usage: ssh <host> [-p <port>] [-l <user>]'];
      const portIndex = args.indexOf('-p');
      const port = portIndex !== -1 ? args[portIndex + 1] : '22';
      return [`ssh: connect to host ${host} port ${port}: hardened, connection refused`];
    }, 'ssh <host> [-p <port>] [-l <user>] - attempt a secure remote connection');

    // STUB (jam scope, same status as `ssh` above). FUTURE (not required now): once real network
    // content exists, specific legacy/in-fiction hosts could be made to succeed here — insecure
    // legacy regime infrastructure vs. hardened modern ssh targets — as narrative texture.
    this.registerCommand('telnet', (args) => {
      const host = args[0];
      if (!host) return ['usage: telnet <host> [<port>]'];
      const port = args[1] ?? '23';
      return [`telnet: ${host}:${port}: connection refused (legacy protocol disabled)`];
    }, 'telnet <host> [<port>] - attempt a legacy remote connection');

    this.registerCommand('whoami', () => [this.state.identity], 'print the current identity');

    // STUB (jam scope, by design): no placeholder/real network graph exists yet, just a static
    // ASCII stub to hang future content on.
    this.registerCommand('struct', () => [
      'network structure (cached, last sync unknown):',
      '  [???]────[???]',
      '    │         │',
      '  [???]────[LOCAL]',
      'struct: topology data incomplete',
    ], 'struct [-t|--tree] - display a (placeholder) network structure diagram');

    this.registerCommand('ipshow', (args) => {
      const lines = ['eth0: 10.66.13.37'];
      if (args.includes('-v')) lines.push('  mask: 255.255.255.0', '  gateway: 10.66.13.1', '  mac: 5A:3F:0C:9D:12:E4');
      return lines;
    }, 'ipshow [-v] - show this terminal\'s (fake) network address');

    // STUB (jam scope, by design): no actual network of hosts exists yet.
    this.registerCommand('netscan', () => [
      'netscan: uplink restricted — no reachable hosts',
    ], 'netscan [--quick] - scan for reachable hosts on the local network');

    this.registerCommand('clear', (args, parser, ui) => {
      if (ui) ui.clear();
      return [];
    }, 'clear the screen');
  }
}

/**
 * Deterministic placeholder "hash"/password for a file `hash` locks without the content author
 * having pre-set `node.lockPassword` themselves — same input path always produces the same
 * output within a session, so a file isn't re-lockable to a different answer by accident.
 * Flavor-grade only (not cryptographic), matching `hash`'s own `--algo` flag.
 * @param {string} path
 * @returns {string}
 */
function _fakeHashFromPath(path) {
  let h = 0;
  for (let i = 0; i < path.length; i += 1) {
    h = (Math.imul(h, 31) + path.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, '0').toUpperCase();
}
