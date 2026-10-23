import Phaser from 'phaser';
import { ScreenController } from '../../engine/screens/ScreenController.js';
import { INTERNAL_HEIGHT, INTERNAL_WIDTH } from '../../engine/display/constants.js';
import { DEPTH } from '../../engine/display/DepthLayers.js';

const PANEL_WIDTH = 320;
const PANEL_HEIGHT = 210;
const VIEWPORT_TOP = 74;
const VIEWPORT_BOTTOM = 194;
const SLIDER_LEFT = (INTERNAL_WIDTH - PANEL_WIDTH) / 2 + 46;
const SLIDER_WIDTH = 182;

/**
 * Settings modal with screen-fixed, directly interactive controls.
 * @module game/controllers/SettingsModalController
 */
export class SettingsModalController extends ScreenController {
  /** @param {object} [params] @returns {void} */
  onEnter(params) {
    const { scene, settingsStore } = this.engine;
    this.uiObjects = [];
    this.unsubscribers = [];
    this.scrollOffset = 0;
    this.isDraggingVolume = false;
    this.isClosing = false;
    this.escapeKey = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this._onEscape = (event) => {
      if (event.key === 'Escape' || event.keyCode === 27) this._closeSettings();
    };
    scene.input.keyboard.on('keydown', this._onEscape);

    this._addObject(
      scene.add.rectangle(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT, 0x000000, 0.62)
        .setOrigin(0, 0)
        .setDepth(DEPTH.UI_MODAL_OVERLAY)
        .setInteractive(),
    );

    const panelX = (INTERNAL_WIDTH - PANEL_WIDTH) / 2;
    const panelY = (INTERNAL_HEIGHT - PANEL_HEIGHT) / 2;
    const panel = this._addObject(
      scene.add.rectangle(panelX, panelY, PANEL_WIDTH, PANEL_HEIGHT, 0x242437)
        .setOrigin(0, 0)
        .setStrokeStyle(2, 0x8a8aaa)
        .setDepth(DEPTH.UI_WINDOW),
    );
    panel.setScrollFactor(0);

    this._addText('Settings', INTERNAL_WIDTH / 2, panelY + 18, 15, DEPTH.UI_WINDOW + 1);

    const closeButton = this._addButton(
      panelX + PANEL_WIDTH - 28,
      panelY + 20,
      20,
      18,
      'X',
      () => this._closeSettings(),
    );
    closeButton.background.setFillStyle(0x553344);

    const viewport = this._addObject(
      scene.add.rectangle(panelX + 12, VIEWPORT_TOP, PANEL_WIDTH - 24, VIEWPORT_BOTTOM - VIEWPORT_TOP, 0x171725, 0.55)
        .setOrigin(0, 0)
        .setStrokeStyle(1, 0x45455e)
        .setDepth(DEPTH.UI_WINDOW + 1),
    );
    viewport.setScrollFactor(0);

    const rowX = panelX + 24;
    this.hitboxLabel = this._addText('Show hitboxes', rowX, 91, 11, DEPTH.UI_WINDOW + 2, 'left');
    this.hitboxButton = this._addButton(
      panelX + PANEL_WIDTH - 52,
      91,
      50,
      20,
      '',
      () => settingsStore.set('video.showHitboxes', !settingsStore.get('video.showHitboxes')),
    );

    this.volumeLabel = this._addText('Master volume', rowX, 126, 11, DEPTH.UI_WINDOW + 2, 'left');
    this.sliderTrack = this._addObject(
      scene.add.rectangle(SLIDER_LEFT, 148, SLIDER_WIDTH, 4, 0x66667f)
        .setOrigin(0, 0.5)
        .setDepth(DEPTH.UI_WINDOW + 2),
    );
    this.sliderHitArea = this._addObject(
      scene.add.rectangle(SLIDER_LEFT, 148, SLIDER_WIDTH, 16, 0xffffff, 0)
        .setOrigin(0, 0.5)
        .setDepth(DEPTH.UI_WINDOW + 3)
        .setInteractive({ useHandCursor: true }),
    );
    this.sliderHandle = this._addObject(
      scene.add.rectangle(SLIDER_LEFT, 148, 12, 12, 0xe3e3f2)
        .setDepth(DEPTH.UI_WINDOW + 4)
        .setInteractive({ useHandCursor: true }),
    );
    this.volumeValue = this._addText('', SLIDER_LEFT + SLIDER_WIDTH + 26, 148, 10, DEPTH.UI_WINDOW + 2);
    this.sliderObjects = [
      this.volumeLabel,
      this.sliderTrack,
      this.sliderHitArea,
      this.sliderHandle,
      this.volumeValue,
    ];

    this.muteButton = this._addButton(
      INTERNAL_WIDTH / 2,
      178,
      116,
      22,
      '',
      () => settingsStore.set('audio.muted', !settingsStore.get('audio.muted')),
    );
    this.scrollHint = this._addText('Use mouse wheel to scroll', INTERNAL_WIDTH / 2, 211, 9, DEPTH.UI_WINDOW + 2);
    this.scrollTrack = this._addObject(
      scene.add.rectangle(panelX + PANEL_WIDTH - 17, VIEWPORT_TOP + 3, 3, VIEWPORT_BOTTOM - VIEWPORT_TOP - 6, 0x45455e)
        .setOrigin(0.5, 0)
        .setDepth(DEPTH.UI_WINDOW + 2),
    );
    this.scrollThumb = this._addObject(
      scene.add.rectangle(panelX + PANEL_WIDTH - 17, VIEWPORT_TOP + 3, 3, 22, 0xb5b5cf)
        .setOrigin(0.5, 0)
        .setDepth(DEPTH.UI_WINDOW + 3),
    );

    this.sliderHitArea.on('pointerdown', (pointer) => this._startVolumeDrag(pointer));
    this.sliderHandle.on('pointerdown', (pointer) => this._startVolumeDrag(pointer));
    this._onPointerMove = (pointer) => {
      if (this.isDraggingVolume && pointer.isDown) this._setVolumeFromPointer(pointer.x);
    };
    this._onPointerUp = () => {
      this.isDraggingVolume = false;
    };
    this._onWheel = (pointer, gameObjects, deltaX, deltaY) => {
      if (
        pointer.x < panelX + 12 || pointer.x > panelX + PANEL_WIDTH - 12
        || pointer.y < VIEWPORT_TOP || pointer.y > VIEWPORT_BOTTOM
      ) return;
      this.scrollOffset += Math.sign(deltaY) * 12;
      this._layoutSettings();
    };
    scene.input.on('pointermove', this._onPointerMove);
    scene.input.on('pointerup', this._onPointerUp);
    scene.input.on('wheel', this._onWheel);

    this.unsubscribers.push(settingsStore.subscribe('video.showHitboxes', (value) => {
      this.hitboxButton.label.setText(value ? 'ON' : 'OFF');
    }));
    this.unsubscribers.push(settingsStore.subscribe('audio.master', (value) => {
      this._refreshVolume(value);
    }));
    this.unsubscribers.push(settingsStore.subscribe('audio.muted', () => {
      this._refreshAudioControls();
    }));

    this.hitboxButton.label.setText(settingsStore.get('video.showHitboxes') ? 'ON' : 'OFF');
    this._refreshVolume(settingsStore.get('audio.master'));
    this._refreshAudioControls();
  }

  /** @private @returns {void} */
  _layoutSettings() {
    const muted = this.engine.settingsStore.get('audio.muted');
    const contentBottom = muted ? 158 : 220;
    const viewportHeight = VIEWPORT_BOTTOM - VIEWPORT_TOP;
    const maxScroll = Math.max(0, contentBottom - VIEWPORT_TOP - viewportHeight);
    this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxScroll));

    const hitboxY = 91 - this.scrollOffset;
    this.hitboxLabel.setY(hitboxY);
    this.hitboxButton.container.setY(hitboxY);
    this.hitboxButton.label.setY(hitboxY);
    this._setGroupVisible([this.hitboxLabel, this.hitboxButton.container], hitboxY - 12, hitboxY + 12);

    const sliderY = 148 - this.scrollOffset;
    for (const object of this.sliderObjects) {
      if (object === this.volumeLabel) object.setY(126 - this.scrollOffset);
      else if (object === this.volumeValue) object.setY(sliderY);
      else object.setY(sliderY);
    }
    const sliderVisible = !muted && 116 - this.scrollOffset >= VIEWPORT_TOP
      && 154 - this.scrollOffset <= VIEWPORT_BOTTOM;
    this.sliderObjects.forEach((object) => object.setVisible(sliderVisible));

    const muteY = (muted ? 132 : 178) - this.scrollOffset;
    this.muteButton.container.setY(muteY);
    this.muteButton.label.setY(muteY);
    this._setGroupVisible([this.muteButton.container], muteY - 13, muteY + 13);

    const hintY = 211 - this.scrollOffset;
    this.scrollHint.setY(hintY);
    this.scrollHint.setVisible(hintY >= VIEWPORT_TOP && hintY <= VIEWPORT_BOTTOM);

    this.scrollTrack.setVisible(maxScroll > 0);
    this.scrollThumb.setVisible(maxScroll > 0);
    if (maxScroll > 0) {
      const thumbHeight = Math.max(20, viewportHeight * viewportHeight / (contentBottom - VIEWPORT_TOP));
      const travel = viewportHeight - thumbHeight;
      this.scrollThumb.setSize(3, thumbHeight);
      this.scrollThumb.y = VIEWPORT_TOP + 3 + (this.scrollOffset / maxScroll) * travel;
    }
  }

  /** @private @param {Phaser.GameObjects.GameObject[]} objects @param {number} top @param {number} bottom @returns {void} */
  _setGroupVisible(objects, top, bottom) {
    const visible = top >= VIEWPORT_TOP && bottom <= VIEWPORT_BOTTOM;
    objects.forEach((object) => object.setVisible(visible));
  }

  /** @private @param {number} value @returns {void} */
  _refreshVolume(value) {
    const ratio = Math.max(0, Math.min(1, value));
    this.sliderHandle.x = SLIDER_LEFT + ratio * SLIDER_WIDTH;
    this.volumeValue.setText(`${Math.round(ratio * 100)}%`);
  }

  /** @private @returns {void} */
  _refreshAudioControls() {
    const muted = this.engine.settingsStore.get('audio.muted');
    this.muteButton.label.setText(muted ? 'UNMUTE' : 'MUTE');
    this.muteButton.background.setFillStyle(muted ? 0x665044 : 0x34344b);
    this._layoutSettings();
  }

  /** @private @param {Phaser.Input.Pointer} pointer @returns {void} */
  _startVolumeDrag(pointer) {
    this.isDraggingVolume = true;
    this._setVolumeFromPointer(pointer.x);
  }

  /** @private @param {number} pointerX @returns {void} */
  _setVolumeFromPointer(pointerX) {
    const ratio = Math.max(0, Math.min(1, (pointerX - SLIDER_LEFT) / SLIDER_WIDTH));
    this.engine.settingsStore.set('audio.master', ratio);
  }

  /** @private @returns {void} */
  _closeSettings() {
    if (this.isClosing || this.engine.screenManager.topController !== this) return;
    this.isClosing = true;
    this.engine.screenManager.pop();
  }

  /**
   * Adds a screen-fixed object on top of the modal backdrop.
   * @private
   * @param {Phaser.GameObjects.GameObject} object
   * @returns {Phaser.GameObjects.GameObject}
   */
  _addObject(object) {
    object.setScrollFactor(0);
    this.uiObjects.push(object);
    return object;
  }

  /**
   * Adds monospace, screen-fixed text.
   * @private
   * @param {string} text
   * @param {number} x
   * @param {number} y
   * @param {number} size
   * @param {number} depth
   * @param {'left'|'center'} [align]
   * @returns {Phaser.GameObjects.Text}
   */
  _addText(text, x, y, size, depth, align = 'center') {
    const originX = align === 'left' ? 0 : 0.5;
    return this._addObject(
      this.engine.scene.add.text(x, y, text, {
        fontFamily: 'monospace',
        fontSize: `${size}px`,
        color: '#eeeeff',
      }).setOrigin(originX, 0.5).setDepth(depth),
    );
  }

  /**
   * Adds a clickable button without placing its interactive object inside a Phaser container.
   * @private
   * @param {number} x
   * @param {number} y
   * @param {number} width
   * @param {number} height
   * @param {string} text
   * @param {() => void} onClick
   * @returns {{container: Phaser.GameObjects.Rectangle, background: Phaser.GameObjects.Rectangle, label: Phaser.GameObjects.Text}}
   */
  _addButton(x, y, width, height, text, onClick) {
    const background = this._addObject(
      this.engine.scene.add.rectangle(x, y, width, height, 0x34344b)
        .setStrokeStyle(1, 0x8888aa)
        .setDepth(DEPTH.UI_WINDOW + 3)
        .setInteractive({ useHandCursor: true }),
    );
    const label = this._addText(text, x, y, 10, DEPTH.UI_WINDOW + 4);
    background.on('pointerdown', onClick);
    return { container: background, background, label };
  }

  /** @returns {void} */
  onExit() {
    const { scene } = this.engine;
    scene.input.keyboard.off('keydown', this._onEscape);
    scene.input.off('pointermove', this._onPointerMove);
    scene.input.off('pointerup', this._onPointerUp);
    scene.input.off('wheel', this._onWheel);
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.uiObjects.forEach((object) => object.destroy());
  }

  /** @param {number} time @param {number} delta @returns {void} */
  onUpdate(time, delta) {
    if (Phaser.Input.Keyboard.JustDown(this.escapeKey)) this._closeSettings();
  }

  /**
   * @param {string} action
   * @returns {void}
   */
  onInput(action) {
    if (action === 'cancel') this._closeSettings();
  }

  /** @returns {void} */
  onPause() {}

  /** @returns {void} */
  onResume() {}
}
