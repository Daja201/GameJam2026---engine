import { DEPTH } from '../display/DepthLayers.js';
import { INTERNAL_WIDTH, INTERNAL_HEIGHT } from '../display/constants.js';

/** Spacing (px) between dots along a Wi-Fi edge's dotted line. */
const WIFI_DOT_SPACING = 6;
/** Radius (px) of each dot on a Wi-Fi edge. */
const WIFI_DOT_RADIUS = 1;
/** Radius (px) of a device node's drawn shape. */
const NODE_RADIUS = 10;
/** Margin (px) kept clear around the auto-layout circle of nodes. */
const LAYOUT_MARGIN = 40;

const COLOR_CONNECTED = 0x1fa12f;
const COLOR_DISCONNECTED = 0xc92a2a;
const COLOR_NODE_FILL = 0x222222;
const COLOR_TEXT = 0x111111;

/**
 * Builds (and owns) the full-screen `netstruct` overlay: a blank white background plus a
 * lightweight, Packet-Tracer-style topology diagram drawn from `NetworkGraph`'s current nodes/
 * edges. Pure rendering — reads `NetworkGraph` but never mutates it.
 *
 * Used by `TerminalScreenController`'s `netstruct` command (see
 * `_registerNetworkCommands` there); kept out of `CLIParser` on purpose, same reasoning as
 * `TerminalScreenController`'s own inventory commands — `CLIParser` stays pure/framework-
 * agnostic, no Phaser import (see that file's own docstring).
 *
 * LAYOUT: nodes are placed evenly around a circle, auto-sized to `INTERNAL_WIDTH`/
 * `INTERNAL_HEIGHT` — no manual per-device positioning, so a content author adding/removing
 * discovered devices never has to hand-place anything (matches the request's "driven by data,
 * not hardcoded per screen").
 *
 * @module network/NetworkStructRenderer
 */
export class NetworkStructRenderer {
  /**
   * @param {Phaser.Scene} scene
   */
  constructor(scene) {
    /** @type {Phaser.Scene} */
    this.scene = scene;
    /** @type {Phaser.GameObjects.Container|null} */
    this.container = null;
  }

  /** @returns {boolean} whether the overlay is currently built/visible */
  get isOpen() {
    return this.container !== null;
  }

  /**
   * Builds the overlay from the graph's CURRENT state (a snapshot — call `redraw()` later if the
   * graph changes while it's open; `netstruct` itself doesn't need that for jam scope, so nothing
   * currently calls it automatically).
   * @param {{getNodes: () => object[], getEdges: () => object[]}} networkGraph - `NetworkGraph`
   * @returns {void}
   */
  open(networkGraph) {
    if (this.isOpen) return;

    const container = this.scene.add.container(0, 0);
    container.setDepth(DEPTH.FX_OVERLAY);

    const background = this.scene.add.rectangle(
      0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT, 0xffffff,
    ).setOrigin(0, 0);
    container.add(background);

    const nodes = networkGraph.getNodes();
    const edges = networkGraph.getEdges();
    const positions = _layoutNodes(nodes);

    const graphics = this.scene.add.graphics();
    container.add(graphics);

    for (const edge of edges) {
      const from = positions.get(edge.fromId);
      const to = positions.get(edge.toId);
      if (!from || !to) continue; // ASSUMPTION: an edge referencing an unknown node id is skipped, not an error
      const color = edge.connected ? COLOR_CONNECTED : COLOR_DISCONNECTED;
      if (edge.medium === 'wifi') {
        _drawDottedLine(graphics, from, to, color);
      } else {
        graphics.lineStyle(1, color, 1).lineBetween(from.x, from.y, to.x, to.y);
      }
    }

    for (const node of nodes) {
      const pos = positions.get(node.id);
      if (!pos) continue;
      container.add(_buildNodeLabel(this.scene, node, pos));
    }

    this.container = container;
  }

  /** Destroys the overlay (no-op if it isn't open). @returns {void} */
  close() {
    if (!this.container) return;
    this.container.destroy();
    this.container = null;
  }
}

/**
 * Evenly places every node around a circle centered in the internal resolution.
 * A single node is placed at the center (a circle of one point has no well-defined angle).
 * @param {{id:string}[]} nodes
 * @returns {Map<string, {x:number,y:number}>}
 * @private
 */
function _layoutNodes(nodes) {
  const positions = new Map();
  const centerX = INTERNAL_WIDTH / 2;
  const centerY = INTERNAL_HEIGHT / 2;
  const radius = Math.min(INTERNAL_WIDTH, INTERNAL_HEIGHT) / 2 - LAYOUT_MARGIN;

  if (nodes.length === 1) {
    positions.set(nodes[0].id, { x: centerX, y: centerY });
    return positions;
  }

  nodes.forEach((node, index) => {
    const angle = (index / nodes.length) * Math.PI * 2 - Math.PI / 2;
    positions.set(node.id, {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
    });
  });
  return positions;
}

/**
 * Draws a straight line as a series of evenly spaced dots (the "cheap Wi-Fi vs. cable"
 * distinction the request calls for, with no new art).
 * @param {Phaser.GameObjects.Graphics} graphics
 * @param {{x:number,y:number}} from
 * @param {{x:number,y:number}} to
 * @param {number} color
 * @returns {void}
 * @private
 */
function _drawDottedLine(graphics, from, to, color) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.floor(length / WIFI_DOT_SPACING));
  graphics.fillStyle(color, 1);
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    graphics.fillCircle(from.x + dx * t, from.y + dy * t, WIFI_DOT_RADIUS);
  }
}

/**
 * Builds one device node's visual: a labeled shape (reused across all device types — no new art,
 * per the request's time-pressure rule) plus its displayName/ip written underneath.
 * @param {Phaser.Scene} scene
 * @param {{id:string,type:string,displayName:string,ip:string}} node
 * @param {{x:number,y:number}} pos
 * @returns {Phaser.GameObjects.Container}
 * @private
 */
function _buildNodeLabel(scene, node, pos) {
  const shape = scene.add.graphics();
  shape.fillStyle(COLOR_NODE_FILL, 1);
  shape.lineStyle(1, COLOR_NODE_FILL, 1);
  // ASSUMPTION: shape-per-type is a cheap, no-new-art stand-in for a real device icon —
  // router/switch get a square (network gear), pc/server get a rounded box, camera gets a
  // triangle (lens-ish); any unrecognized type falls back to a plain circle.
  if (node.type === 'router' || node.type === 'switch') {
    shape.strokeRect(pos.x - NODE_RADIUS, pos.y - NODE_RADIUS, NODE_RADIUS * 2, NODE_RADIUS * 2);
  } else if (node.type === 'camera') {
    shape.beginPath();
    shape.moveTo(pos.x, pos.y - NODE_RADIUS);
    shape.lineTo(pos.x + NODE_RADIUS, pos.y + NODE_RADIUS);
    shape.lineTo(pos.x - NODE_RADIUS, pos.y + NODE_RADIUS);
    shape.closePath();
    shape.strokePath();
  } else if (node.type === 'pc' || node.type === 'server') {
    shape.strokeRoundedRect(pos.x - NODE_RADIUS, pos.y - NODE_RADIUS * 0.7, NODE_RADIUS * 2, NODE_RADIUS * 1.4, 2);
  } else {
    shape.strokeCircle(pos.x, pos.y, NODE_RADIUS);
  }

  const label = scene.add.text(pos.x, pos.y + NODE_RADIUS + 2, `${node.displayName}\n${node.ip}`, {
    fontFamily: 'monospace',
    fontSize: '8px',
    color: `#${COLOR_TEXT.toString(16).padStart(6, '0')}`,
    align: 'center',
  }).setOrigin(0.5, 0);

  return scene.add.container(0, 0, [shape, label]);
}
