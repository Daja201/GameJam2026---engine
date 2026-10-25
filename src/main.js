import Phaser from 'phaser';
import { buildPhaserConfig } from './engine/display/phaserConfig.js';
import { DisplayManager } from './engine/display/DisplayManager.js';
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
    this.load.json('controls-config', 'config/controls.default.json');
    this.load.json('quests-config', 'config/quests.default.json');
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
      const skinId = path.split('/').slice(-2, -1)[0];
      const key = `${skinId}:panel`;
      if (!this.textures.exists(key)) {
        this.load.image(key, `graphics/ui/windows/${skinId}/panel.png`);
      }
    }

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

    // 6b) Quest system (engine/quest/QuestManager.js): register this project's quest content,
    // then restore any saved progress, then auto-start whichever quests the config lists (a
    // design choice of THIS bootstrap, not the quest engine — QuestManager itself never assigns
    // anything on its own). `load()` runs after `loadDefinitions()` so saved quest ids can be
    // checked against what's actually registered (see QuestManager.load()'s own docs).
    const questsConfigJson = this.cache.json.get('quests-config');
    QuestManager.loadDefinitions(questsConfigJson.quests);
    QuestManager.load();
    // NOTE: auto-starting is deferred until AFTER `screenManager.switchTo('world')` below (see
    // end of this method) rather than happening here. WorldScreenController subscribes to
    // QuestManager's events in its own onEnter to show "Quest Started" toasts (ToastNotifier.js);
    // assigning here, before that screen exists, would silently miss those toasts for every
    // auto-started quest. Assigning after the World screen is mounted means the player actually
    // sees them pop in right as the game starts — the same beat most quest-driven games use.

    // 6c) Quest Log UI wiring: the two tab buttons in `quest_log_panel`'s manifest invoke the
    // parameterized action `"quest-log-tab:<tab>"` (see ActionRegistry.js's parameterized-action
    // docs). ActionRegistry has no notion of "the current screen", so this bootstrap — the one
    // place that already holds `engine` — registers the verb here, closing over
    // `engine.screenManager` to reach whichever controller is currently on top.
    registerAction('quest-log-tab', (context) => {
      engine.screenManager.topController?.setTab?.(context.arg);
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
      QuestManager.resetAll();
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

    await engine.screenManager.switchTo('world');

    // See the NOTE above step 6b: auto-start quests now that the World screen (and its toast
    // notifications) actually exists to react to them.
    for (const questId of questsConfigJson.autoStart ?? []) {
      if (!QuestManager.isQuestActive(questId) && !QuestManager.isQuestCompleted(questId)) {
        QuestManager.assignQuest(questId);
      }
    }
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