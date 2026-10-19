/**
 * Canonical Phaser depth values.
 *
 * RULE FOR ALL DEVELOPERS: every `setDepth()` call anywhere in the codebase
 * (any module) MUST use one of the named values below. Never invent a raw
 * depth number. If you need an offset within a layer, use DEPTH.X + small
 * integer, but the base must be a named value from this object.
 *
 * @module display/DepthLayers
 */

/**
 * Frozen map of named depth layers.
 * @type {Readonly<Record<string, number>>}
 */
export const DEPTH = Object.freeze({
  BACKGROUND_FAR: -30,
  BACKGROUND_MID: -20,
  BACKGROUND_NEAR: -10,
  WORLD_GROUND: 0,
  WORLD_ENTITIES: 10,
  WORLD_FOREGROUND: 20,
  UI_HUD: 100,
  UI_WINDOW: 200,
  UI_MODAL_OVERLAY: 190,
  FX_OVERLAY: 300,
});
