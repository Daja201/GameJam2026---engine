/**
 * Global registry of named actions that UI elements invoke (Button clicks, etc. — see
 * WindowManifest element `action` field in 01_SHARED_CONTRACTS.md). Lets window content
 * (authored as data) call into engine/game behavior without any element file hardcoding it.
 *
 * Pre-registers two built-ins so a window works before module 11 wires anything up:
 * - 'close-window': closes the window the action fired from (needs `context.windowHandle`).
 * - 'noop': does nothing. Useful as a placeholder while authoring content.
 *
 * PARAMETERIZED ACTIONS: an action name containing a colon, e.g. `"open-window:settings"`,
 * is split into `[verb, arg]`. `invokeAction` looks up a handler registered under just the
 * verb (`"open-window"`) and calls it with `{ ...context, arg: "settings" }`. Register the verb,
 * not the full string, e.g. `registerAction('open-window', (ctx) => engine.windowFactory.build(ctx.scene, ctx.arg))`.
 *
 * @module ui/ActionRegistry
 */

/** @type {Map<string, (context: object) => void>} */
const actions = new Map();

/**
 * Registers (or replaces) a named action handler.
 * @param {string} actionName - plain name, or the "verb" half of a `"verb:arg"` parameterized action
 * @param {(context: object) => void} handler
 * @returns {void}
 */
export function registerAction(actionName, handler) {
  actions.set(actionName, handler);
}

/**
 * Invokes a registered action by name. If `actionName` contains a colon, it is split into
 * `[verb, arg]`; the handler registered under `verb` is called with `{ ...context, arg }`.
 * @param {string} actionName
 * @param {object} context - arbitrary data the handler needs (e.g. `{ windowHandle, scene, settingsStore }`)
 * @returns {void}
 * @throws {Error} `Unknown UI action: ${actionName}` if no handler is registered for it (or its verb)
 */
export function invokeAction(actionName, context) {
  let verb = actionName;
  let arg;
  const colonIndex = actionName.indexOf(':');
  if (colonIndex !== -1) {
    verb = actionName.slice(0, colonIndex);
    arg = actionName.slice(colonIndex + 1);
  }

  const handler = actions.get(verb);
  if (!handler) throw new Error(`Unknown UI action: ${actionName}`);
  handler(arg === undefined ? context : { ...context, arg });
}

registerAction('close-window', (context) => {
  context.windowHandle.close();
});

registerAction('noop', () => {});
