import { registerController } from '../../engine/screens/ScreenControllerRegistry.js';
import { WorldScreenController } from '../controllers/WorldScreenController.js';
import { TerminalScreenController } from '../controllers/TerminalScreenController.js';
import { SettingsModalController } from '../controllers/SettingsModalController.js';

/**
 * Registers every example-content screen controller under the name its screen manifest's
 * `controller` field uses. Call once at boot, before any `ScreenManager.push()`/`switchTo()`.
 * @returns {void}
 */
export function registerAllControllers() {
  registerController('WorldScreenController', WorldScreenController);
  registerController('TerminalScreenController', TerminalScreenController);
  registerController('SettingsModalController', SettingsModalController);
}
