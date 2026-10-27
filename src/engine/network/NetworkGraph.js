import Phaser from 'phaser';

/**
 * Content-agnostic, in-memory graph of "devices currently known to be part of the network the
 * fiction has the player inside" — backs the terminal's `netstruct` command (see
 * `game/controllers/TerminalScreenController.js`'s `_registerNetworkCommands`, and
 * `engine/network/NetworkStructRenderer.js` for the actual drawing).
 *
 * SINGLETON, same pattern as `quest/QuestManager.js`, `inventory/InventoryManager.js` and
 * `loop/LoopManager.js`: `NetworkGraph` below is a plain exported object (an instance of the
 * private `NetworkGraphImpl` class), never constructed by callers, and must never be stored on a
 * Scene/GameObject since those are destroyed/recreated on scene restarts while this state must
 * survive them. Unlike those three it is NOT persisted to localStorage (jam scope) — it starts
 * from whatever `loadDefinitions()` is given at boot and is mutated purely in-memory from there
 * by quest/fragment content as the player discovers more of the network.
 *
 * NO CONTENT COUPLING: this file contains no hardcoded device id, ip, or screen id anywhere —
 * every one of those is data, supplied via `loadDefinitions()` (e.g.
 * `engine/network/exampleNetworkGraph.example.js`, parsed/handed in by the bootstrap) or via the
 * individual `addNode`/`addEdge` calls a quest/fragment event handler can make at runtime as the
 * player discovers a new device or link.
 *
 * NODE SHAPE: `{ id, type: 'camera'|'switch'|'pc'|'server'|'router', displayName, ip }`.
 * `type` is used only to pick a drawing shape in `NetworkStructRenderer` — any other string is
 * still accepted and drawn as a generic box, so new device types never need an engine change.
 *
 * EDGE SHAPE: `{ id, fromId, toId, medium: 'wired'|'wifi', connected: boolean }`. `medium` picks
 * the dash pattern, `connected` picks the colour (green when true, red when false) — see
 * `NetworkStructRenderer`.
 *
 * EVENTS: `NetworkGraph.events` is this module's own `Phaser.Events.EventEmitter`, independent of
 * any scene's emitter (same reasoning as `QuestManager.events`/`InventoryManager.events`). Emits:
 * - `'network:node-added'`   `{ id }`
 * - `'network:node-removed'` `{ id }`
 * - `'network:edge-added'`   `{ id }`
 * - `'network:edge-removed'` `{ id }`
 * - `'network:edge-updated'` `{ id, connected }`
 * - `'network:updated'`      no payload — fires after EVERY mutation above, for a currently-open
 *   `netstruct` overlay (or any other consumer) that just wants "something changed, redraw".
 *
 * @module network/NetworkGraph
 */
class NetworkGraphImpl {
  constructor() {
    /** @type {Map<string, {id:string,type:string,displayName:string,ip:string}>} */
    this._nodes = new Map();
    /** @type {Map<string, {id:string,fromId:string,toId:string,medium:'wired'|'wifi',connected:boolean}>} */
    this._edges = new Map();
    /** @type {Phaser.Events.EventEmitter} */
    this.events = new Phaser.Events.EventEmitter();
  }

  /**
   * Replaces the whole graph with content-authored starting data (e.g.
   * `exampleNetworkGraph.example.js`'s export). Call once at boot, same spirit as
   * `QuestManager.loadDefinitions`. Safe to call again (e.g. on a loop reset) — fully replaces.
   * @param {{nodes?: object[], edges?: object[]}} definitions
   * @returns {void}
   */
  loadDefinitions(definitions = {}) {
    this._nodes = new Map((definitions.nodes ?? []).map((node) => [node.id, { ...node }]));
    this._edges = new Map((definitions.edges ?? []).map((edge) => [edge.id, { ...edge }]));
    this.events.emit('network:updated');
  }

  /**
   * Adds (or overwrites, if `id` already exists) one device node. This is the hook a quest/
   * fragment event handler calls when the player discovers a new device.
   * @param {{id:string,type:string,displayName:string,ip:string}} node
   * @returns {void}
   */
  addNode(node) {
    this._nodes.set(node.id, { ...node });
    this.events.emit('network:node-added', { id: node.id });
    this.events.emit('network:updated');
  }

  /**
   * Removes a node and any edge touching it (an edge can't dangle on a removed device).
   * @param {string} id
   * @returns {void}
   */
  removeNode(id) {
    if (!this._nodes.delete(id)) return;
    for (const edge of [...this._edges.values()]) {
      if (edge.fromId === id || edge.toId === id) this._edges.delete(edge.id);
    }
    this.events.emit('network:node-removed', { id });
    this.events.emit('network:updated');
  }

  /**
   * Adds (or overwrites) one edge between two nodes. `connected` defaults to `true`;
   * `medium` defaults to `'wired'`.
   * @param {{id:string,fromId:string,toId:string,medium?:'wired'|'wifi',connected?:boolean}} edge
   * @returns {void}
   */
  addEdge(edge) {
    this._edges.set(edge.id, {
      medium: 'wired',
      connected: true,
      ...edge,
    });
    this.events.emit('network:edge-added', { id: edge.id });
    this.events.emit('network:updated');
  }

  /**
   * @param {string} id
   * @returns {void}
   */
  removeEdge(id) {
    if (!this._edges.delete(id)) return;
    this.events.emit('network:edge-removed', { id });
    this.events.emit('network:updated');
  }

  /**
   * Flips an existing edge's connected/disconnected (green/red) state without touching its
   * medium or endpoints — e.g. a quest beat that "cuts" a link rather than removing it outright.
   * @param {string} id
   * @param {boolean} connected
   * @returns {void}
   */
  setEdgeConnected(id, connected) {
    const edge = this._edges.get(id);
    if (!edge) return;
    edge.connected = connected;
    this.events.emit('network:edge-updated', { id, connected });
    this.events.emit('network:updated');
  }

  /** @returns {{id:string,type:string,displayName:string,ip:string}[]} */
  getNodes() {
    return [...this._nodes.values()];
  }

  /** @returns {{id:string,fromId:string,toId:string,medium:'wired'|'wifi',connected:boolean}[]} */
  getEdges() {
    return [...this._edges.values()];
  }
}

/** Singleton — see module docstring. @type {NetworkGraphImpl} */
export const NetworkGraph = new NetworkGraphImpl();
