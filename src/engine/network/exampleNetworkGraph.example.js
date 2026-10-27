/**
 * EXAMPLE starting content for `NetworkGraph` (module `engine/network/NetworkGraph.js`). Named
 * `.example.js` on purpose, same convention as `terminal/fakeFileSystem.example.js` — this is
 * demo content, not something production game code should import as-is.
 *
 * HOW TO MAKE YOUR OWN: copy this file's structure into your game-specific content folder (e.g.
 * `/src/game/content/networkGraph.js`), keep the node/edge shapes below, and change the strings.
 * Only "discovered" devices/links belong here at boot — everything else gets added later via
 * `NetworkGraph.addNode`/`addEdge` from quest/fragment event handlers as the story unlocks more
 * of the network (see `NetworkGraph.js`'s own docstring for that wiring).
 *
 * @module network/exampleNetworkGraph.example
 */

/** @type {{id:string,type:'camera'|'switch'|'pc'|'server'|'router',displayName:string,ip:string}[]} */
export const exampleNetworkNodes = [
  { id: 'local-pc', type: 'pc', displayName: 'LOCAL', ip: '10.66.13.37' },
  { id: 'core-switch', type: 'switch', displayName: 'core-sw01', ip: '10.66.13.1' },
  { id: 'lobby-camera', type: 'camera', displayName: 'cam-lobby', ip: '10.66.13.52' },
];

/** @type {{id:string,fromId:string,toId:string,medium:'wired'|'wifi',connected:boolean}[]} */
export const exampleNetworkEdges = [
  { id: 'local-core', fromId: 'local-pc', toId: 'core-switch', medium: 'wired', connected: true },
  { id: 'core-camera', fromId: 'core-switch', toId: 'lobby-camera', medium: 'wifi', connected: false },
];
