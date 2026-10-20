/**
 * EXAMPLE fake filesystem content for the Terminal/CLI subsystem (module 08). This file is named
 * `.example.js` on purpose: it is demo content, not something production game code should import.
 *
 * HOW TO MAKE YOUR OWN: copy this file's structure into your game-specific content folder (e.g.
 * `/src/game/content/fileSystem.js`), keep the exact node shape below, and change the strings:
 * - a directory node: `{ type: 'dir', children: ['name1', 'name2'] }` — `children` are bare
 *   names (not full paths); CLIParser resolves them against the path they're looked up under.
 * - a file node: `{ type: 'file', content: 'line one\nline two' }` — `content` is a single
 *   string, newline-separated; `cat` splits it into display lines.
 * Every key in the object is the node's own absolute path, so a directory's `children` entries
 * must each also exist as a key of `path/childName`.
 *
 * @module terminal/fakeFileSystem.example
 */

/** @type {Object<string, {type:'dir',children:string[]}|{type:'file',content:string}>} */
export const exampleFileSystem = {
  '/': { type: 'dir', children: ['home', 'var', 'etc'] },

  '/home': { type: 'dir', children: ['user'] },
  '/home/user': { type: 'dir', children: ['notes.txt', 'projects'] },
  '/home/user/notes.txt': {
    type: 'file',
    content: 'remember to check the exit-node logs\nforgot the password again, it\'s somewhere in /etc',
  },
  '/home/user/projects': { type: 'dir', children: ['loop_tracker.log'] },
  '/home/user/projects/loop_tracker.log': {
    type: 'file',
    content: 'loop 001: fragment recovered\nloop 002: fragment recovered\nloop 003: connection lost',
  },

  '/var': { type: 'dir', children: ['log'] },
  '/var/log': { type: 'dir', children: ['system.log'] },
  '/var/log/system.log': {
    type: 'file',
    content: '[boot] exit-node handshake failed\n[warn] retry limit reached\n[info] fallback terminal online',
  },

  '/etc': { type: 'dir', children: ['passwd'] },
  '/etc/passwd': {
    type: 'file',
    content: 'user:x:1000:1000::/home/user:/bin/sh\n# hint: the exit-node password is hidden near the loop tracker',
  },
};

/** Password `crack` checks guesses against (case-insensitive), matching the hint above. */
export const EXAMPLE_TARGET_PASSWORD = 'EXIT404';
