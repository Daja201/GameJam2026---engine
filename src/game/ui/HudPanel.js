import { DEPTH } from '../../engine/display/DepthLayers.js';
import { INTERNAL_HEIGHT, INTERNAL_WIDTH } from '../../engine/display/constants.js';

/**
 * The always-on World-screen HUD panel (see `graphics/ui/hud/*.png`, sourced from the
 * `gui.zip` mockup): a pill status bar in the bottom-left, a Map button top-right, and a small
 * keyboard-shortcut hint readout underneath it.
 *
 * The circular minimap outline is drawn by `engine/world/MapOverlay.js`; it does not use a HUD
 * image. The status bar stays independent from the quest labels.
 *
 * FIX (menu/pause screen): the Quit and Inventory BUTTONS that used to sit in this column are
 * gone. Quit's destination (Settings) is now reached via Backspace -> the pause menu -> Settings
 * (see `game/controllers/MenuScreenController.js`), and Inventory already has its own keyboard
 * shortcut. Both are listed below as a short hint readout instead of clickable buttons — see
 * `HINT_LINES` below. The key letters there are for display only (not wired to input); they're
 * kept in sync with `config/controls.default.json`'s "movement" profile, which is what actually
 * handles them (`M`/`toggle-map`, `L`/`open-quest-log`, `I`/`open-inventory`,
 * `BACKSPACE`/`cancel`) — see that file and `InputRouter.js`.
 *
 * FIX (map button removed): "Map" used to be the one clickable button left in this column. It's
 * now just another hint line like the rest — M still toggles the full-screen map (see
 * `engine/world/MapOverlay.js` and `WorldScreenController.onInput`'s 'toggle-map' handling) — so
 * this panel no longer needs an `onMap` callback at all; it now takes no `opts`.
 *
 * HUD objects use `scrollFactor(0)` so both their rendered positions and pointer hit areas stay
 * fixed to the screen while the world camera follows the player.
 *
 * @param {Phaser.Scene} scene
 * @returns {{ setBarFraction(frac: number): void, getDisplayObjects(): object[], destroy(): void }}
 */
export function createHudPanel(scene) {
  const MARGIN = 4;

  // --- Status bar (top-left) ----------------------------------------------------------------
  const barX = MARGIN;
  const barBg = scene.add.image(barX, 0, 'hud:bar').setOrigin(0, 0).setScrollFactor(0);
  barBg.setDepth(DEPTH.UI_HUD);
  // Fill drawn as a tinted rectangle cropped to the bar's interior, rather than a second image,
  // since there's no separate "bar fill" asset in the mockup — only the empty pill outline.
  const barInsetX = 3;
  const barInsetY = 3;
  const barFillMaxWidth = barBg.width - barInsetX * 2;
  const barFillHeight = barBg.height - barInsetY * 2;
  const barFill = scene.add
    .rectangle(barX + barInsetX, 0, barFillMaxWidth, barFillHeight, 0x35e0a8)
    .setOrigin(0, 0)
    .setScrollFactor(0);
  barFill.setDepth(DEPTH.UI_HUD + 1);

  barBg.setY(INTERNAL_HEIGHT - MARGIN - barBg.height);
  barFill.setY(barBg.y + barInsetY);

  // --- Keyboard-shortcut hint readout (top-right) -----------------------------------------
  // Replaces the removed Quit/Inventory/Map BUTTONS (see class docstring) — this column is now
  // key-hints only, no clickable images at all. Small and low-contrast on purpose — it's a
  // reminder, not a call to action, so it shouldn't compete visually with the rest of the HUD.
  // Styled like WorldScreenController's own small HUD text (monospace, 8px).
  const HINT_LINES = [
    { key: 'M', label: 'Map' },
    { key: 'L', label: 'Quest Log' },
    { key: 'I', label: 'Inventory' },
    { key: 'Backspace', label: 'Pause' },
  ];
  const hintText = scene.add.text(
    INTERNAL_WIDTH - MARGIN,
    MARGIN,
    HINT_LINES.map(({ key, label }) => `${key} ... ${label}`).join('\n'),
    {
      fontFamily: 'monospace',
      fontSize: '8px',
      color: '#8aa8ff',
      align: 'right',
      lineSpacing: 2,
    },
  ).setOrigin(1, 0).setScrollFactor(0);
  hintText.setDepth(DEPTH.UI_HUD);

  return {
    /**
     * @param {number} frac - 0..1
     * @returns {void}
     */
    setBarFraction(frac) {
      const clamped = Math.max(0, Math.min(1, frac));
      barFill.width = barFillMaxWidth * clamped;
    },
    /**
     * Every GameObject this panel owns — for callers (e.g. `MapOverlay`) that need to make their
     * own camera(s) ignore the whole HUD so it doesn't also render tiny inside them.
     * @returns {object[]}
     */
    getDisplayObjects() {
      return [barBg, barFill, hintText];
    },
    destroy() {
      barBg.destroy();
      barFill.destroy();
      hintText.destroy();
    },
  };
}