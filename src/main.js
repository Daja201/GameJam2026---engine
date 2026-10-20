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

    // 7) Example-game tuning (module 09's documented placeholder, overwritten exactly once here).
    LoopManager.totalFragmentsNeeded = EXAMPLE_TOTAL_FRAGMENTS;

    this._engine = engine;

    // Not required by any module's own prompt, but module 02 built DisplayManager specifically
    // for this: without calling it, the game only ever gets Phaser's CSS-level FIT scaling, never
    // the integer pixel-art zoom DisplayManager.getBestIntegerScale/applyScale exist to apply.
    DisplayManager.watchResize(this.game);

    await engine.screenManager.switchTo('world');
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
