import { ScreenController } from '../../engine/screens/ScreenController.js';
import { CLIParser, resolvePath } from '../../engine/terminal/CLIParser.js';
import { LoopManager } from '../../engine/loop/LoopManager.js';
import { QuestManager } from '../../engine/quest/QuestManager.js';
import { NetworkGraph } from '../../engine/network/NetworkGraph.js';
import { NetworkStructRenderer } from '../../engine/network/NetworkStructRenderer.js';
import { INTERNAL_WIDTH } from '../../engine/display/constants.js';
import { DEPTH } from '../../engine/display/DepthLayers.js';
import {
  ROUTER_ID, PC_ID, CAMERA_1_ID, CAMERA_2_ID, TURRET_ID,
  MISSION_PASSWORD, SEED_NODES, DISCOVERED_NODES, DISCOVERED_EDGES,
  LOCAL_FILE_SYSTEM, PC_FILE_SYSTEM, MISSION_STEPS,
} from '../content/hackerMission.js';

/** Id `LoopManager.addFragment` is recorded under for a successful (non-mission) root crack. */
const FRAGMENT_ID = 'terminal-root';
/** Beat (ms) between a successful crack/mission-complete and popping back to the World. */
const POP_DELAY_MS = 900;
/** How often (ms) the input-line cursor toggles between visible/hidden, for a realistic blink. */
const CURSOR_BLINK_MS = 450;
/** Quest id for the hacker room's final network-breach mission (config/quests.default.json). */
const HACKER_MISSION_QUEST_ID = 'hacker_final_mission';
/** Quest assigned the moment this mission completes — see `_onMissionQuestCompleted`. */
const FIND_PRISON_QUEST_ID = 'find_provisional_prison';
/** Placeholder root password — no mission step uses bare `crack <guess>` anymore. */
const UNUSED_ROOT_PASSWORD = 'UNUSED';

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

    this.parser = new CLIParser(scene.events, LOCAL_FILE_SYSTEM, UNUSED_ROOT_PASSWORD);
    this._defaultCrackHandler = this.parser.commands.get('crack');
    this.parser.registerCommand('crack', (args, parser) => {
      const target = args[0] ? resolvePath(parser.state.cwd, args[0]) : null;
      const node = target ? parser.fileSystem[target] : undefined;
      if (target !== '/etc/passwd.hash' || args.length !== 1 || !node?.locked) {
        return this._defaultCrackHandler(args, parser);
      }
      this._startMissionPasswordCrack(target);
      return [];
    }, 'crack <file> - crack a password hash');

    // MISSION SCOPE (per request): strip every command not used by the hacker-room's final
    // mission — this terminal only ever runs that mission, so inventory/save/load and the unused
    // ssh/telnet/hash/struct/ipshow/whoami stubs are just noise in `help`. `connect`/`netscan`
    // are overridden below with mission-aware versions; everything else kept is used as-is.
    for (const name of ['ssh', 'telnet', 'hash', 'struct', 'ipshow', 'whoami']) {
      this.parser.commands.delete(name);
      this.parser.descriptions.delete(name);
    }

    this._registerNetworkCommands(this.parser);
    this._registerMissionCommands(this.parser);

    // This screen's manifest lists `ui_windows: ["terminal_output"]`, so ScreenManager already
    // built it and stored the handle on `this.windows` before calling onEnter.
    const outputHandle = this.windows[0];
    this.output = outputHandle.getElement('output');
    this.output.appendLine('=== SUB Linux v1.0 ===');
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
      if (payload && payload.file) {
        if (payload.file === '/etc/passwd.hash') this._completeMissionObjective('crack_password');
        return;
      }
      LoopManager.addFragment(FRAGMENT_ID);
      scene.time.delayedCall(POP_DELAY_MS, () => this.engine.screenManager.pop());
    };
    scene.events.on('terminal:crack-success', this._onCrackSuccess);

    this._closing = false;
    this._onExitRequested = () => {
      this._closing = true;
      this.engine.screenManager.pop();
    };
    scene.events.on('terminal:exit', this._onExitRequested);

    // Mission state: which devices we've authenticated to this terminal session (cameras only —
    // router/pc need no stored credential, see `_registerMissionCommands`).
    this._authedDevices = new Set();
    this._routerConnected = false;
    this._networkRevealed = false;

    // Top-right "quest-like" instruction popup, kept in sync with the mission's objectives —
    // see `_refreshMissionInstruction`. Built even if the quest isn't active yet (it just stays
    // hidden) so there's no ordering dependency on exactly when `hacker_final_mission` gets
    // assigned relative to this screen opening.
    this._missionPanel = this._buildMissionPanel(scene);
    this._onMissionQuestCompleted = ({ id }) => {
      if (id !== HACKER_MISSION_QUEST_ID) return;
      this._missionPanel.setText('Cameras blind. Turret down. Mission complete.');
      this.output.appendLine('');
      this.output.appendLine('TRANSFER ORDER FOUND: subject "Louisa" relocated to the government provisional prison.');
      QuestManager.assignQuest(FIND_PRISON_QUEST_ID);
      scene.time.delayedCall(POP_DELAY_MS, () => this.engine.screenManager.pop());
    };
    QuestManager.events.on('quest:completed', this._onMissionQuestCompleted);
    this._onQuestUpdated = () => this._refreshMissionInstruction();
    QuestManager.events.on('quest:updated', this._onQuestUpdated);
    this._refreshMissionInstruction();
  }

  /**
   * @param {string} action
   * @param {{char?: string}} event
   * @returns {void}
   */
  onInput(action, event) {
    // The `netstruct` full-screen overlay (see `_registerNetworkCommands`) covers the whole
    // terminal window, so while it's open every key is swallowed here EXCEPT Backspace (this
    // screen's "text-entry" input profile maps BACKSPACE to 'text-backspace', not 'cancel' — see
    // InputProfiles.js's own doc), which closes it and returns to the terminal exactly as it
    // was — nothing below this `if` ever runs, so the CLI buffer/history is untouched.
    if (this.netstructRenderer && this.netstructRenderer.isOpen) {
      if (action === 'text-backspace') this.netstructRenderer.close();
      return;
    }

    if (action === 'text-char') {
      if (this._crackRunning) return;
      this.buffer += event.char;
      this._redrawPrompt();
    } else if (action === 'text-backspace') {
      if (this._crackRunning) return;
      this.buffer = this.buffer.slice(0, -1);
      this._redrawPrompt();
    } else if (action === 'text-enter') {
      if (this._crackRunning) return;
      this.output.appendLine(`${this._promptPrefix()}${this.buffer}`);
      const lines = this.parser.run(this.buffer, { clear: () => this.output.clear() });
      lines.forEach((line) => this.output.appendLine(line));
      this.buffer = '';
      if (!this._closing) this._redrawPrompt();
    } else if (action === 'cancel') {
      this.engine.screenManager.pop();
    }
  }

  /** @param {number} time @param {number} delta @returns {void} */
  onUpdate(time, delta) {
    if (this._closing || this._crackRunning) return;
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
   * Plays the mission's short, fictional password-cracking animation.
   * @param {string} target
   * @returns {void}
   * @private
   */
  _startMissionPasswordCrack(target) {
    const node = this.parser.fileSystem[target];
    if (!node?.locked) return;

    this._crackRunning = true;
    let progress = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    this._crackTimer = this.engine.scene.time.addEvent({
      delay: 10,
      repeat: 63,
      callback: () => {
        progress += characters[Math.floor(Math.random() * characters.length)];
        this.output.setPendingLine(progress);
        if (progress.length !== 64) return;

        this._crackTimer = null;
        this._crackRunning = false;
        this.output.setPendingLine(null);
        this.output.appendLine(progress);
        this.output.appendLine(`PASSWORD FOUND: ${MISSION_PASSWORD}`);
        const result = this._defaultCrackHandler([target, MISSION_PASSWORD], this.parser);
        result.forEach((line) => this.output.appendLine(line));
        if (!this._closing) this._redrawPrompt();
      },
    });
  }

  /**
   * Registers this game's `netstruct` command: a full-screen topology overlay drawn from
   * `NetworkGraph`'s current nodes/edges (see that module's docstring, and
   * `NetworkStructRenderer.js` for the actual drawing). Kept here rather than in `CLIParser`,
   * same reasoning as `_registerMissionCommands` — `CLIParser` stays pure/content-agnostic with
   * no Phaser import, this is game-layer content wiring it in.
   *
   * ASSUMPTION: `NetworkGraph` is only seeded with `hackerMission.js`'s `SEED_NODES` the FIRST
   * time it's empty — not on every terminal re-entry — so nodes/edges `netscan` added at runtime
   * survive leaving and re-entering the terminal (see `NetworkGraph.js`'s own doc on that wiring).
   * @param {CLIParser} parser
   * @private
   * @returns {void}
   */
  _registerNetworkCommands(parser) {
    if (NetworkGraph.getNodes().length === 0) {
      NetworkGraph.loadDefinitions({ nodes: SEED_NODES, edges: [] });
    }

    this.netstructRenderer = new NetworkStructRenderer(this.engine.scene);

    parser.registerCommand('netstruct', () => {
      this.netstructRenderer.open(NetworkGraph);
      return [];
    }, 'netstruct - open a visual map of the currently known network (backspace to close)');
  }

  /**
   * Registers the hacker-room mission's own `connect`/`netscan`/`disable` commands (`netscan`
   * overrides CLIParser's stub by name — see that file's docstring, `commands` is a plain `Map`
   * so re-`set`ting a name just replaces the handler). `crack`/`cat`/`ls`/`cd` are CLIParser's
   * existing builtins, untouched — the mission reaches its goal entirely through those plus the
   * three below, matching the request's step list one-for-one.
   * @param {CLIParser} parser
   * @private
   * @returns {void}
   */
  _registerMissionCommands(parser) {
    parser.registerCommand('connect', (args) => {
      const [ip, password] = args;
      if (!ip) return ['usage: connect <ip> [password]'];
      const node = NetworkGraph.getNodes().find((candidate) => candidate.ip === ip);
      if (!node) return [`connect: no route to host ${ip}`];

      if (node.id === ROUTER_ID) {
        this._routerConnected = true;
        this._completeMissionObjective('connect_router');
        return [
          `Connecting to ${node.displayName} (${ip})...`,
          'ACCESS GRANTED.',
          "run 'netscan' to map the local network.",
        ];
      }

      if (!this._networkRevealed) return [`connect: no route to host ${ip}`];

      if (node.id === PC_ID) {
        parser.fileSystem = PC_FILE_SYSTEM;
        parser.state.cwd = '/';
        parser.state.identity = 'luca@sub-pc01';
        this._completeMissionObjective('connect_pc');
        return [`Connecting to ${node.displayName} (${ip})...`, 'ACCESS GRANTED.', 'filesystem mounted.'];
      }

      if (node.type === 'camera' || node.type === 'turret') {
        if ((password ?? '').toUpperCase() !== MISSION_PASSWORD) {
          return [`connect: ${node.displayName} requires authentication.`, `usage: connect ${ip} <password>`];
        }
        this._authedDevices.add(node.id);
        return [
          `Connecting to ${node.displayName} (${ip})...`,
          'ACCESS GRANTED.',
          `run 'disable ${ip}' to power it down.`,
        ];
      }

      return [`connect: ${node.displayName} (${ip}): connection refused`];
    }, 'connect <ip> [password] - connect to a device on the local network');

    parser.registerCommand('netscan', () => {
      if (!this._routerConnected) return ['netscan: no active connection. connect to the router first.'];
      if (!this._networkRevealed) {
        this._networkRevealed = true;
        for (const node of DISCOVERED_NODES) NetworkGraph.addNode(node);
        for (const edge of DISCOVERED_EDGES) NetworkGraph.addEdge(edge);
        this._completeMissionObjective('scan_network');
      }
      this.netstructRenderer.open(NetworkGraph);
      return [`netscan: ${DISCOVERED_NODES.length} hosts found.`, 'opening network map (backspace to close)...'];
    }, 'netscan - scan the local network and open a graphical map');

    parser.registerCommand('disable', (args) => {
      const [ip] = args;
      if (!ip) return ['usage: disable <ip>'];
      const node = NetworkGraph.getNodes().find(
        (candidate) => candidate.ip === ip && (candidate.type === 'camera' || candidate.type === 'turret'),
      );
      if (!node) return [`disable: ${ip}: not a camera or turret on this network`];
      if (!this._authedDevices.has(node.id)) return [`disable: not authenticated on ${ip}`];

      const edge = NetworkGraph.getEdges().find(
        (candidate) => (candidate.fromId === node.id || candidate.toId === node.id),
      );
      if (edge) NetworkGraph.setEdgeConnected(edge.id, false);
      if (node.id === CAMERA_1_ID) this._completeMissionObjective('disable_camera_1');
      else if (node.id === CAMERA_2_ID) this._completeMissionObjective('disable_camera_2');
      else if (node.id === TURRET_ID) this._completeMissionObjective('disable_turret');
      return [`${node.displayName}: powered down.`];
    }, 'disable <ip> - power down an authenticated camera or turret');
  }

  /**
   * Completes one objective of `hacker_final_mission` if it's active and that objective isn't
   * already done — a no-op otherwise (so mission commands can call this unconditionally without
   * each one re-checking quest state first).
   * @param {string} objectiveId
   * @private
   * @returns {void}
   */
  _completeMissionObjective(objectiveId) {
    if (!QuestManager.isQuestActive(HACKER_MISSION_QUEST_ID)) return;
    const quest = QuestManager.getQuest(HACKER_MISSION_QUEST_ID);
    const objective = quest?.objectives.find((candidate) => candidate.id === objectiveId);
    if (!objective || objective.done) return;
    QuestManager.completeObjective(HACKER_MISSION_QUEST_ID, objectiveId);
  }

  /**
   * Shows the instruction text for the first not-yet-done mission step (see `MISSION_STEPS` in
   * `hackerMission.js`), or hides the panel if the quest isn't active or every step is done.
   * Called once up front and again on every `quest:updated` (cheaper than threading a refresh
   * call through each mission command individually).
   * @private
   * @returns {void}
   */
  _refreshMissionInstruction() {
    if (!QuestManager.isQuestActive(HACKER_MISSION_QUEST_ID)) {
      this._missionPanel.hide();
      return;
    }
    const quest = QuestManager.getQuest(HACKER_MISSION_QUEST_ID);
    const nextStep = MISSION_STEPS.find((step) => {
      const objective = quest.objectives.find((candidate) => candidate.id === step.id);
      return objective && !objective.done;
    });
    if (!nextStep) {
      this._missionPanel.hide();
      return;
    }
    this._missionPanel.setText(nextStep.text);
  }

  /**
   * Builds the top-right "quest-like" instruction popup (per request) — a small persistent card,
   * same visual language as `ui/ToastNotifier.js`'s toasts (dark panel, accent bar, monospace
   * text) but hand-built here rather than reusing that module: its toasts auto-dismiss and its
   * one pinned slot is hardcoded to the bottom-left, neither of which fits "stays up top-right
   * until the step is done" — so this stays a small, self-contained addition instead of changing
   * shared engine UI. Sits above `netstruct`'s full-screen overlay (`DEPTH.FX_OVERLAY`) so the
   * current instruction is still visible while the graphical map is open.
   * @param {Phaser.Scene} scene
   * @private
   * @returns {{setText(text: string): void, hide(): void, destroy(): void}}
   */
  _buildMissionPanel(scene) {
    const WIDTH = 170;
    const MARGIN = 4;
    const PADDING = 6;

    const bg = scene.add.rectangle(0, 0, WIDTH, 18, 0x1a1a2a, 0.92).setOrigin(0, 0);
    bg.setStrokeStyle(1, 0x8aa8ff);
    const accent = scene.add.rectangle(0, 0, 3, 18, 0x8aa8ff).setOrigin(0, 0);
    const label = scene.add.text(PADDING, 3, 'OBJECTIVE', {
      fontFamily: 'monospace', fontSize: '7px', color: '#8aa8ff',
    }).setOrigin(0, 0);
    const body = scene.add.text(PADDING, 13, '', {
      fontFamily: 'monospace', fontSize: '8px', color: '#ffffff', lineSpacing: 2,
      wordWrap: { width: WIDTH - PADDING - 8 },
    }).setOrigin(0, 0);

    const container = scene.add.container(INTERNAL_WIDTH - WIDTH - MARGIN, MARGIN, [bg, accent, label, body]);
    container.setScrollFactor(0);
    container.setDepth(DEPTH.FX_OVERLAY + 1);
    container.setVisible(false);

    return {
      setText(text) {
        body.setText(text);
        const height = Math.max(18, body.height + 20);
        bg.setSize(WIDTH, height);
        accent.setSize(3, height);
        container.setVisible(true);
      },
      hide() { container.setVisible(false); },
      destroy() { container.destroy(); },
    };
  }

  /** @returns {void} */
  onExit() {
    this._crackTimer?.remove(false);
    this._crackTimer = null;
    this._crackRunning = false;
    if (this.netstructRenderer) this.netstructRenderer.close();
    if (this._missionPanel) this._missionPanel.destroy();
    this.engine.scene.events.off('terminal:crack-success', this._onCrackSuccess);
    this.engine.scene.events.off('terminal:exit', this._onExitRequested);
    QuestManager.events.off('quest:completed', this._onMissionQuestCompleted);
    QuestManager.events.off('quest:updated', this._onQuestUpdated);
  }

  /** @returns {void} */
  onPause() {}

  /** @returns {void} */
  onResume() {}
}