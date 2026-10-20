/**
 * Maps `ScreenManifest.controller` names to controller classes.
 * Nothing is pre-registered here: module 11's bootstrap must register every controller
 * before any screen is pushed.
 * @module screens/ScreenControllerRegistry
 */

/** @type {Map<string, Function>} */
const controllers = new Map();

/**
 * Registers (or replaces) a controller class under a name.
 * @param {string} controllerName - matches the ScreenManifest.controller field
 * @param {typeof import('./ScreenController.js').ScreenController} controllerClass
 * @returns {void}
 */
export function registerController(controllerName, controllerClass) {
  if (typeof controllerClass !== 'function') {
    throw new Error(`registerController("${controllerName}"): second argument must be a class`);
  }
  controllers.set(controllerName, controllerClass);
}

/**
 * Looks up a controller class.
 * @param {string} controllerName
 * @returns {typeof import('./ScreenController.js').ScreenController}
 * @throws {Error} `Unknown screen controller: ${controllerName}` if not registered
 */
export function resolveController(controllerName) {
  const controllerClass = controllers.get(controllerName);
  if (!controllerClass) throw new Error(`Unknown screen controller: ${controllerName}`);
  return controllerClass;
}
