import { registerController } from '../../engine/screens/ScreenControllerRegistry.js';
import { MenuScreenController } from '../controllers/MenuScreenController.js';
import { PauseMenuScreenController } from '../controllers/PauseMenuScreenController.js';
import { WorldScreenController } from '../controllers/WorldScreenController.js';
import { TerminalScreenController } from '../controllers/TerminalScreenController.js';
import { SettingsModalController } from '../controllers/SettingsModalController.js';
import { QuestLogScreenController } from '../controllers/QuestLogScreenController.js';
import { InventoryScreenController } from '../controllers/InventoryScreenController.js';

/**
 * Registers every example-content screen controller under the name its screen manifest's
 * `controller` field uses. Call once at boot, before any `ScreenManager.push()`/`switchTo()`.
 * @returns {void}
 */
export function registerAllControllers() {
  registerController('MenuScreenController', MenuScreenController);
  registerController('PauseMenuScreenController', PauseMenuScreenController);
  registerController('WorldScreenController', WorldScreenController);
  registerController('TerminalScreenController', TerminalScreenController);
  registerController('SettingsModalController', SettingsModalController);
  registerController('QuestLogScreenController', QuestLogScreenController);
  registerController('InventoryScreenController', InventoryScreenController);
}