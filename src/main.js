import Phaser from 'phaser';
import { buildPhaserConfig } from './engine/display/phaserConfig.js';
import { DisplayManager } from './engine/display/DisplayManager.js';
import { loadFont } from './engine/display/FontLoader.js';
import { AssetRegistry } from './engine/assets/AssetRegistry.js';
import { queueSpriteFrames, queueBackgroundAssets } from './engine/assets/PreloadQueueBuilder.js';
import { SettingsStore } from './engine/settings/SettingsStore.js';
import { AudioManager } from './engine/audio/AudioManager.js';
import { InputRouter } from './engine/input/InputRouter.js';
import { parseInputProfiles } from './engine/input/InputProfiles.js';
import { ScreenManager } from './engine/screens/ScreenManager.js';
import { WindowFactory } from './engine/ui/WindowFactory.js';
import { LoopManager } from './engine/loop/LoopManager.js';
import { QuestManager } from './engine/quest/QuestManager.js';
import { InventoryManager } from './engine/inventory/InventoryManager.js';
import { registerAction } from './engine/ui/ActionRegistry.js';
import { buildEngineContext } from './game/EngineContext.js';
import { registerAllControllers } from './game/bootstrap/registerControllers.js';
import { MANIFEST_PATHS } from './game/bootstrap/manifestPaths.js';

/** Fragments needed to unlock terminal access in this example game (module 09's placeholder). */
const EXAMPLE_TOTAL_FRAGMENTS = 3;

/**
 * Waits for the scene's current load queue to finish, then resolves.
 * @param {Phaser.Scene} scene
 * @returns {Promise<void>}
 */
function runLoadQueue(scene) {
  return new Promise((resolve) => {
    scene.load.once('complete', resolve);
    scene.load.start();
  });
}

/**
 * The one bootstrap Phaser Scene. Defined inline here (rather than its own file) since it has no
 * gameplay of its own — it only wires every engine module together once, then hands off to
 * `ScreenManager`.
 */
class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  /** @returns {void} */
  preload() {
    // FIX (missing-graphics placeholder color): Phaser's own fallback for a failed image load is
    // its built-in "missing texture" (a jarring magenta/black checker) — never themed, never this
    // project's own look. Any `scene.load.image(key, path)` call whose file 404s (an
    // not-yet-authored sprite/background/window-skin PNG — see PreloadQueueBuilder.js's own
    // "a missing PNG just triggers Phaser's normal loaderror" note) now instead gets a flat,
    // solid-color placeholder generated right here, in this project's one recurring accent color
    // (teal/cyan-green, `#35e0a8` — the same color MapOverlay's ring border and WindowFactory's
    // new scrollbar use) rather than a generic gray or Phaser's
    // magenta. One listener, attached before any `scene.load.image(...)` call anywhere in this
    // bootstrap (AssetRegistry.scan, PreloadQueueBuilder, the window-skin/HUD loads further down
    // in create()) runs through this same `this.load`, so this single early registration covers
    // every one of them.
    this.load.on('loaderror', (file) => {
      if (file.type !== 'image' || this.textures.exists(file.key)) return;
      const placeholder = this.make.graphics({ x: 0, y: 0, add: false });
      placeholder.fillStyle(0x35e0a8, 1);
      placeholder.fillRect(0, 0, 32, 32);
      placeholder.generateTexture(file.key, 32, 32);
      placeholder.destroy();
    });

    this.load.json('controls-config', 'config/controls.default.json');
    this.load.json('quests-config', 'config/quests.default.json');
    this.load.json('items-config', 'config/items.default.json');
    this.load.audio('music:gui-menu', 'audio/music/gui.ogg');
    this.load.audio('music:gameplay', 'audio/music/lofi.mp3');
  }

  /** @returns {Promise<void>} */
  async create() {
    // 1) Index every manifest (module 03). This runs its own load cycle internally.
    await AssetRegistry.scan(this, MANIFEST_PATHS);

    // 2) Queue the actual sprite/background PNGs those manifests reference (module 03).
    for (const id of AssetRegistry.listSpriteIds()) {
      queueSpriteFrames(this, AssetRegistry.getSpriteManifest(id));
    }
    for (const id of AssetRegistry.listBackgroundIds()) {
      queueBackgroundAssets(this, AssetRegistry.getBackgroundManifest(id));
    }

    // FIX: no module queues UI window skin art — module 07's WindowFactory only documents the
    // texture-key convention it expects (`${skin}:panel`, from `graphics/ui/windows/${skin}/
    // panel.png`), and neither the shared contract nor module 03's AssetRegistry exposes a way
    // to list window ids generically (there is no `listWindowIds()`). As the one module allowed
    // to know specific content ids, this bootstrap queues them directly from its own manifest
    // path list.
    for (const path of MANIFEST_PATHS.windows) {
      const windowId = path.split('/').slice(-2, -1)[0];
      const skinId = AssetRegistry.getWindowManifest(windowId).skin;
      if (!skinId) continue;
      const key = `${skinId}:panel`;
      if (!this.textures.exists(key)) {
        this.load.image(key, `graphics/ui/windows/${skinId}/panel.png`);
      }
    }

    // HUD panel art (module 11 addition): not part of any manifest-driven system (sprites,
    // backgrounds, windows) — fixed HUD images are queued directly here, the same way the
    // window-skin panel textures above are queued directly rather than going through
    // AssetRegistry. See src/game/ui/HudPanel.js for the keys used.
    // FIX (map button removed): 'hud:map' (the old clickable Map button face) is no longer loaded
    // — HudPanel.js's Map entry is now plain hint text, same as Quest Log/Inventory/Pause, with
    // no button image at all. 'hud:quit' was already unused (left loaded harmlessly before this
    // revision); both are dropped now that nothing in this column is a clickable image anymore.
    this.load.image('hud:portrait', 'graphics/ui/hud/portrait.png');

    // SFX: the cat's reaction sound when the player's fight-mode punch lands on it (see
    // WorldScreenController's '_onAttackAnimationComplete' -> cat-hit check). Not manifest-driven
    // (same reasoning as the HUD art above — a single fixed, always-on sound, not generic
    // sprite/background/window content), so it's queued directly here.
    this.load.audio('sfx:cat-meow', 'audio/sfx/meowmeow.mp3');

    await runLoadQueue(this);

    // 3) Settings + audio (module 10).
    SettingsStore.load();
    AudioManager.init(this);

    // 4) Input (module 06).
    const controlsConfigJson = this.cache.json.get('controls-config');
    const inputRouter = new InputRouter(this.input.keyboard);
    inputRouter.setProfiles(parseInputProfiles(controlsConfigJson));

    // 5) Screen manager + engine context (module 06 + this module).
    // ScreenManager's constructor reads engine.inputRouter immediately, so screenManager starts
    // out null and is patched onto the same object right after — see EngineContext.js's doc.
    const engine = buildEngineContext(this, {
      assetRegistry: AssetRegistry,
      inputRouter,
      windowFactory: WindowFactory,
      settingsStore: SettingsStore,
      audioManager: AudioManager,
      screenManager: null,
    });
    engine.screenManager = new ScreenManager(engine);

    // 6) Register example-content controllers (module 06's registry, this module's classes).
    registerAllControllers();

    // 6a) Inventory system (engine/inventory/InventoryManager.js): register this project's item
    // content, then restore any saved slot contents. Loaded BEFORE the quest system below since
    // `QuestManager.collectItem()` now delegates straight into `InventoryManager.addItem()` (see
    // QuestManager.js's module docstring) — its definitions must already be registered by then.
    const itemsConfigJson = this.cache.json.get('items-config');
    InventoryManager.loadDefinitions(itemsConfigJson.items);
    InventoryManager.load();

    // 6b) Quest system (engine/quest/QuestManager.js): register this project's quest content,
    // then restore any saved progress, then auto-start whichever quests the config lists (a
    // design choice of THIS bootstrap, not the quest engine — QuestManager itself never assigns
    // anything on its own). `load()` runs after `loadDefinitions()` so saved quest ids can be
    // checked against what's actually registered (see QuestManager.load()'s own docs).
    const questsConfigJson = this.cache.json.get('quests-config');
    QuestManager.loadDefinitions(questsConfigJson.quests);
    QuestManager.load();
    // NOTE: auto-starting is deferred until the player presses Start on the menu screen and the
    // World screen actually mounts (see the 'menu-start' action registered below) rather than
    // happening here. WorldScreenController subscribes to QuestManager's events in its own
    // onEnter to show "Quest Started" toasts (ToastNotifier.js); assigning here, before that
    // screen exists, would silently miss those toasts for every auto-started quest.

    // 6c) Quest Log UI wiring: the two tab buttons in `quest_log_panel`'s manifest invoke the
    // parameterized action `"quest-log-tab:<tab>"` (see ActionRegistry.js's parameterized-action
    // docs). ActionRegistry has no notion of "the current screen", so this bootstrap — the one
    // place that already holds `engine` — registers the verb here, closing over
    // `engine.screenManager` to reach whichever controller is currently on top.
    registerAction('quest-log-tab', (context) => {
      engine.screenManager.topController?.setTab?.(context.arg);
    });

    // 6c-bis) Inventory UI wiring: same closing-over-topController pattern as the quest-log tab
    // buttons above, for `inventory_panel`'s Use/Drop buttons (see InventoryScreenController.js).
    registerAction('inventory-use', () => {
      engine.screenManager.topController?.useSelected?.();
    });
    registerAction('inventory-drop', () => {
      engine.screenManager.topController?.dropSelected?.();
    });

    // 6c-ter) Menu screen wiring (see MenuScreenController.js and screens/menu/manifest.json):
    // 'menu-start' is the unified Start/Resume button's action. It lives here, not on the
    // controller, because "starting fresh" also has to run the SAME quest auto-start step that
    // used to run immediately after `screenManager.switchTo('world')` at the bottom of this
    // method (see the NOTE that used to sit there, now moved here) — this is the one place that
    // already holds both `engine` and `questsConfigJson`, same reasoning as the quest-log/
    // inventory action wiring just above. `engine.worldController` (set/cleared by
    // WorldScreenController's onEnter/onExit) is truthy exactly when a game is already in
    // progress, i.e. this menu was opened as a pause screen — see MenuScreenController's class
    // docstring for why no separate "game started" flag is needed.
    registerAction('menu-start', () => {
      if (engine.worldController) {
        engine.screenManager.pop(); // Resume: back to the already-running World screen.
        return;
      }
      // Start: enter the World screen for the first time, then auto-start whichever quests the
      // config lists — deferred until after the World screen actually exists so its toast
      // notifications (subscribed in WorldScreenController.onEnter) can show them.
      engine.screenManager.switchTo('world').then(() => {
        const autoStartQuestIds = questsConfigJson.autoStart ?? [];
        for (const questId of autoStartQuestIds) {
          if (!QuestManager.isQuestActive(questId) && !QuestManager.isQuestCompleted(questId)) {
            QuestManager.assignQuest(questId);
          }
        }
        const firstAutoStartQuestId = autoStartQuestIds[0];
        if (firstAutoStartQuestId && QuestManager.isQuestActive(firstAutoStartQuestId)) {
          QuestManager.setTrackedQuest(firstAutoStartQuestId);
        }
        engine.showPhaseWindow(
          'You just woke up like every other day. It is about 20 minutes to work so you should hurry up. There, take the elevator.'
        );
      });
    });
    registerAction('menu-settings', () => {
      engine.screenManager.push('settings_modal');
    });

    // 6c-quater) Pause menu wiring (see PauseMenuScreenController.js and
    // graphics/ui/windows/pause_panel/manifest.json): the Map/Inventory/Quests buttons that
    // screen's old unified-menu ancestor never had. Registered here for the same reason as
    // 'menu-start'/'menu-settings' just above: this is the one place already holding `engine`.
    registerAction('pause-open-inventory', () => {
      engine.screenManager.push('inventory');
    });
    registerAction('pause-open-quests', () => {
      engine.screenManager.push('quest_log');
    });
    registerAction('pause-open-map', () => {
      // MapOverlay belongs to the (currently paused, currently hidden — see
      // WorldScreenController.onPause) World screen, not to this pause menu, so the World screen
      // has to actually be resumed (popping this one off) before its full map can be toggled on.
      engine.screenManager.pop().then(() => {
        engine.worldController?.mapOverlay?.toggleFull();
      });
    });

    // BUG FIX: ActionRegistry.js's built-in 'close-window' only closes the WindowHandle
    // (destroys that window's Phaser objects) — it never pops the screen that window belongs
    // to off `ScreenManager`'s stack. Every screen that uses a "Close" button
    // (`graphics/ui/windows/quest_log_panel` and `.../default_panel`) exists ONLY to show that
    // one window — it's pushed via `screenManager.push(...)` and has no content of its own — so
    // leaving the screen on the stack after its window is gone is always wrong, never intended.
    // Symptoms this caused: the Close button looked like it worked (window vanished) but input
    // stayed captured by the now-windowless screen, so the player couldn't move until pressing
    // ESC/cancel too (which DOES call screenManager.pop(), via each such screen's onInput); and
    // reopening before doing that pushed a SECOND instance of the same screen on top of the
    // first still-live one, leaving the first's event subscriptions (e.g.
    // QuestLogScreenController's `QuestManager.events.on('quest:updated', ...)`) still firing
    // against an already-destroyed window/text objects, throwing on every later quest update and
    // leaving the UI increasingly broken the more times Close (rather than ESC) was used.
    // FIX: override the built-in so 'close-window' pops the current screen (identical to the
    // 'cancel' action already does in both QuestLogScreenController and SettingsModalController);
    // ScreenManager.pop() -> _exitEntry() already calls the screen's onExit() AND closes every
    // one of its windows, so this single call does both correctly, in the right order, exactly
    // once.
    registerAction('close-window', () => {
      engine.screenManager.pop();
    });

    // 6d) DEV-ONLY: "Hard Reset" button in the Settings window (graphics/ui/windows/default_panel/
    // manifest.json). Wipes every bit of this game's persisted state — quest progress/history
    // (QuestManager.resetAll() + its localStorage key), settings (SettingsStore's localStorage
    // key) — and reloads, so a finished/in-progress quest goes back to never-started. Scoped to
    // exactly this game's two `hackjam:*` localStorage keys (not `localStorage.clear()`), so it
    // can't wipe unrelated data the page/origin might hold. `window.confirm` is a deliberately
    // blunt, dependency-free guard here — this is a developer utility for a game jam build, not
    // end-user-facing production UX, so it doesn't need a themed in-engine confirmation dialog.
    registerAction('hard-reset', () => {
      const confirmed = window.confirm(
        'Hard reset: this wipes ALL quest progress/history and settings, and reloads the game. Continue?'
      );
      if (!confirmed) return;
      QuestManager.resetAll(); // also clears InventoryManager (see QuestManager.resetAll()'s doc)
      // Remove every `hackjam:*` key (quests, settings, and any future ones) rather than
      // hardcoding today's schema-versioned key names, so this keeps working if either module's
      // SCHEMA_VERSION changes later.
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('hackjam:')) localStorage.removeItem(key);
      }
      window.location.reload();
    });

    // 7) Example-game tuning (module 09's documented placeholder, overwritten exactly once here).
    LoopManager.totalFragmentsNeeded = EXAMPLE_TOTAL_FRAGMENTS;

    this._engine = engine;

    // Not required by any module's own prompt, but module 02 built DisplayManager specifically
    // for this: without calling it, the game only ever gets Phaser's CSS-level FIT scaling, never
    // the integer pixel-art zoom DisplayManager.getBestIntegerScale/applyScale exist to apply.
    DisplayManager.watchResize(this.game);
    // Browsers only allow entering fullscreen from inside a real user-gesture handler (see
    // DisplayManager's own doc on requestFullscreenOnFirstInput) — so this arms a one-time
    // listener for the player's first click/keypress rather than calling requestFullscreen()
    // directly here, which the browser would just reject.
    DisplayManager.requestFullscreenOnFirstInput(this.game);

    // Terminal screen's webfont (see ScrollableText.js's `fontFamily` support + that screen's
    // own window manifest) — loaded here, once, so it's guaranteed ready well before the player
    // can ever reach the Terminal screen (see FontLoader.js's own doc for why boot is the only
    // correct place to await this). Fails soft: if the font file hasn't been dropped into
    // graphics/fonts/ yet, Terminal just falls back to the manifest's trailing `, monospace`.
    try {
      await loadFont('Ubuntu Mono', 'graphics/fonts/Ubuntu_Mono/UbuntuMono-Regular.ttf');
    } catch (error) {
      console.warn('[main] Ubuntu Mono webfont failed to load; Terminal will fall back to monospace.', error);
    }

    // Boot into the unified menu screen (main menu) rather than straight into World — see
    // MenuScreenController.js. Quest auto-start now happens inside the 'menu-start' action
    // registered above, once the player actually presses Start and the World screen mounts.
    await engine.screenManager.switchTo('menu');
  }

  /**
   * Standard Phaser pattern: drive ScreenManager from this Scene's own update(), not a
   * `this.events.on('update', ...)` listener (module 11's own prompt explicitly preferred this).
   * @param {number} time
   * @param {number} delta
   * @returns {void}
   */
  update(time, delta) {
    this._engine?.screenManager.topController?.onUpdate(time, delta);
  }
}

// eslint-disable-next-line no-new
new Phaser.Game(buildPhaserConfig([BootScene]));