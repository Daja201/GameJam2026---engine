/**
 * The pre-enumerated manifest path list `AssetRegistry.scan()` requires (browsers can't list
 * directories — see module 03's documented constraint in `AssetRegistry.js`).
 *
 * FIX vs. this module's original draft: paths here have NO leading slash. Module 03's
 * `PreloadQueueBuilder.js` documents an explicit assumption that every asset path is
 * project-relative with no leading slash ("works when the game is hosted in a sub-folder, e.g.
 * on itch.io"); a leading slash would be inconsistent with that and would break on itch.io-style
 * sub-folder hosting. `AssetRegistry.scan()`'s own usage example (see its top-of-file comment)
 * also uses no leading slash, so this file now matches both.
 *
 * When adding new content, append its manifest path here — this file is the one
 * deliberately-manual registry the whole otherwise-automatic AssetRegistry depends on.
 *
 * @type {{ sprites: string[], backgrounds: string[], screens: string[], windows: string[] }}
 */
export const MANIFEST_PATHS = {
  sprites: [
    'graphics/sprites/main_char/manifest.json',
    'graphics/sprites/cat_companion/manifest.json',
    'graphics/sprites/soldier/manifest.json',
    'graphics/sprites/teach/manifest.json',
    'graphics/sprites/computer/manifest.json',
    'graphics/sprites/npc1/manifest.json',
  ],
  backgrounds: [
    'graphics/backgrounds/example_room/manifest.json',
    'graphics/backgrounds/city/manifest.json',
    'graphics/backgrounds/under/manifest.json',
  ],
  screens: [
    'screens/menu/manifest.json',
    'screens/pause_menu/manifest.json',
    'screens/world/manifest.json',
    'screens/terminal/manifest.json',
    'screens/settings_modal/manifest.json',
    'screens/quest_log/manifest.json',
    'screens/inventory/manifest.json',
    'screens/phase_story/manifest.json',
  ],
  // NOTE: 'terminal_output' and 'quest_log_panel' are this bootstrap's own additions (not in the
  // original module file lists) — the Terminal and Quest Log screens' `ui_windows` each need a
  // window manifest to display their (dynamically redrawn) output.
  windows: [
    'graphics/ui/windows/default_panel/manifest.json',
    'graphics/ui/windows/menu_panel/manifest.json',
    'graphics/ui/windows/pause_panel/manifest.json',
    'graphics/ui/windows/terminal_output/manifest.json',
    'graphics/ui/windows/quest_log_panel/manifest.json',
    'graphics/ui/windows/inventory_panel/manifest.json',
    'graphics/ui/windows/phase_story/manifest.json',
  ],
};