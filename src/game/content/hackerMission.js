/**
 * Content for the underground hacker room's final network-breach mission (quest
 * `hacker_final_mission` in config/quests.default.json). This is no longer a practice rig — it's
 * the real SUB-net the group traced back from the soldiers who took Louisa, run from the real
 * terminal the community hands the player (`SUB Linux`, not a sandboxed stand-in). Pure data +
 * text, no Phaser/engine imports — wired up by `game/controllers/TerminalScreenController.js`.
 *
 * NETWORK SHAPE: router <-> switch (cable), router <-> camera-1, router <-> camera-2, router <->
 * turret, switch <-> pc. Only the router is known at boot; `netscan` (once connected to it)
 * reveals the rest in one go via `DISCOVERED_NODES`/`DISCOVERED_EDGES`. The turret is new: once
 * the cameras are blind, the facility's last line of defense before the holding block is an
 * automatic turret the player has to authenticate to and power down same as the cameras.
 *
 * @module game/content/hackerMission
 */

export const ROUTER_ID = 'sub-router';
export const SWITCH_ID = 'sub-switch';
export const PC_ID = 'sub-pc';
export const CAMERA_1_ID = 'sub-cam-1';
export const CAMERA_2_ID = 'sub-cam-2';
export const TURRET_ID = 'sub-turret';

export const ROUTER_IP = '192.168.0.1';
export const SWITCH_IP = '192.168.0.2';
export const PC_IP = '192.168.0.10';
export const CAMERA_1_IP = '192.168.0.11';
export const CAMERA_2_IP = '192.168.0.12';
export const TURRET_IP = '192.168.0.13';

/** Password that unlocks `/etc/passwd.hash` on the PC and authenticates the cameras + turret. */
export const MISSION_PASSWORD = 'SUBPASSKEY';

/** Only node known at boot — the mission starts "outside" the network, router-only. */
export const SEED_NODES = [
  { id: ROUTER_ID, type: 'router', displayName: 'facility-rt01', ip: ROUTER_IP },
];

/** Revealed by a successful `netscan` once connected to the router. */
export const DISCOVERED_NODES = [
  { id: SWITCH_ID, type: 'switch', displayName: 'facility-sw01', ip: SWITCH_IP },
  { id: PC_ID, type: 'pc', displayName: 'facility-pc01', ip: PC_IP },
  { id: CAMERA_1_ID, type: 'camera', displayName: 'cam-01', ip: CAMERA_1_IP },
  { id: CAMERA_2_ID, type: 'camera', displayName: 'cam-02', ip: CAMERA_2_IP },
  { id: TURRET_ID, type: 'turret', displayName: 'turret-01', ip: TURRET_IP },
];

export const DISCOVERED_EDGES = [
  { id: 'router-switch', fromId: ROUTER_ID, toId: SWITCH_ID, medium: 'wired', connected: true },
  { id: 'router-cam1', fromId: ROUTER_ID, toId: CAMERA_1_ID, medium: 'wired', connected: true },
  { id: 'router-cam2', fromId: ROUTER_ID, toId: CAMERA_2_ID, medium: 'wired', connected: true },
  { id: 'router-turret', fromId: ROUTER_ID, toId: TURRET_ID, medium: 'wired', connected: true },
  { id: 'switch-pc', fromId: SWITCH_ID, toId: PC_ID, medium: 'wired', connected: true },
];

/** Local terminal filesystem, before `connect <pc ip>` mounts the PC's own. */
export const LOCAL_FILE_SYSTEM = {
  '/': { type: 'dir', children: ['readme.txt'] },
  '/readme.txt': {
    type: 'file',
    content: 'This is it. connect to the router to reach the rest of the facility network.',
  },
};

/** Mounted in place of the local filesystem once `connect <pc ip>` succeeds. */
export const PC_FILE_SYSTEM = {
  '/': { type: 'dir', children: ['etc', 'home'] },
  '/etc': { type: 'dir', children: ['passwd.hash'] },
  '/etc/passwd.hash': {
    type: 'file',
    content: '[ENCRYPTED - SHA256]',
    locked: true,
    lockPassword: MISSION_PASSWORD,
    _plainContent: `user:${MISSION_PASSWORD}:1000:1000::/home/user:/bin/sh`,
  },
  '/home': { type: 'dir', children: ['user'] },
  '/home/user': { type: 'dir', children: [] },
};

/**
 * Ordered mission steps. `id` matches an objective id on the `hacker_final_mission` quest
 * (config/quests.default.json) — the instruction panel shows the first one whose objective isn't
 * done yet.
 * @type {{id: string, text: string}[]}
 */
export const MISSION_STEPS = [
  { id: 'connect_router', text: `Connect to the facility router:\nconnect ${ROUTER_IP}` },
  { id: 'scan_network', text: 'Scan the local network:\nnetscan' },
  { id: 'connect_pc', text: `Connect to the PC on the switch:\nconnect ${PC_IP}` },
  {
    id: 'crack_password',
    text: `Find & crack the password hash:\ncat /etc/passwd.hash\ncrack /etc/passwd.hash`,
  },
  {
    id: 'disable_camera_1',
    text: `Authenticate & disable camera 1:\nconnect ${CAMERA_1_IP} ${MISSION_PASSWORD.toLowerCase()}\ndisable ${CAMERA_1_IP}`,
  },
  {
    id: 'disable_camera_2',
    text: `Authenticate & disable camera 2:\nconnect ${CAMERA_2_IP} ${MISSION_PASSWORD.toLowerCase()}\ndisable ${CAMERA_2_IP}`,
  },
  {
    id: 'disable_turret',
    text: `Authenticate & disable the automatic turret:\nconnect ${TURRET_IP} ${MISSION_PASSWORD.toLowerCase()}\ndisable ${TURRET_IP}`,
  },
];
