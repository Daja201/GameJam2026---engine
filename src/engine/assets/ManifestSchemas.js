/**
 * Hand-rolled, JSON-Schema-like definitions for every manifest type.
 * Read by ManifestValidator.js — no external schema library is used.
 *
 * Supported schema keys (all optional unless noted):
 * - `type`        (required) 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null', or an array of these
 * - `enum`        allowed values
 * - `min`, `max`, `exclusiveMin`, `integer`   number constraints
 * - `minLength`, `pattern`                    string constraints (pattern is a RegExp)
 * - `required`    array of required property names (objects)
 * - `properties`  map of property name -> schema (objects; unknown extra properties are allowed)
 * - `values`      schema applied to every value of an object used as a map (e.g. `states`)
 * - `minProperties`  minimum number of keys (objects)
 * - `requiredWhen`   array of conditional rules (objects):
 *                    `{ field, equals, require: [names], stringContains: { name: substring } }`
 * - `items`       schema applied to every array element
 * - `minItems`    minimum array length
 *
 * ASSUMPTIONS (shared contract only defines SpriteManifest and ScreenManifest fully):
 * - BackgroundManifest and WindowManifest shapes below are this module's own definition;
 *   modules 05 and 07 should read their fields from these schemas.
 * - Sprite `pivot`, `hitbox`, `scale`, `display_name` are optional (module 04 applies defaults).
 *
 * @module assets/ManifestSchemas
 */

const DIRECTION_NAMES = [
  'south', 'south-east', 'east', 'north-east',
  'north', 'north-west', 'west', 'south-west',
];

const TRANSITION_NAMES = ['fade', 'crt-flicker', 'instant', 'wipe-left'];

/** Lowercase snake_case id (must also match the manifest's folder name; checked by AssetRegistry). */
const ID_SCHEMA = { type: 'string', pattern: /^[a-z0-9]+(_[a-z0-9]+)*$/ };

/**
 * Schema for `/graphics/sprites/<id>/manifest.json`.
 * @type {object}
 */
export const SPRITE_MANIFEST_SCHEMA = {
  type: 'object',
  required: ['id', 'type', 'frame_size', 'directionality', 'states'],
  properties: {
    id: ID_SCHEMA,
    display_name: { type: 'string' },
    type: { type: 'string', enum: ['character', 'npc', 'prop', 'effect'] },
    frame_size: {
      type: 'object',
      required: ['width', 'height'],
      properties: {
        width: { type: 'number', integer: true, min: 1 },
        height: { type: 'number', integer: true, min: 1 },
      },
    },
    pivot: {
      type: 'object',
      required: ['x', 'y'],
      properties: {
        x: { type: 'number', min: 0, max: 1 },
        y: { type: 'number', min: 0, max: 1 },
      },
    },
    directionality: {
      type: 'object',
      required: ['mode'],
      properties: {
        mode: { type: 'string', enum: ['1-dir', '4-dir', '8-dir', 'free-rotation'] },
        directions: { type: 'array', items: { type: 'string', enum: DIRECTION_NAMES } },
      },
    },
    states: {
      type: 'object',
      minProperties: 1,
      values: {
        type: 'object',
        required: ['type', 'source'],
        properties: {
          type: { type: 'string', enum: ['static-per-direction', 'animated-per-direction'] },
          frame_rate: { type: 'number', exclusiveMin: 0 },
          loop: { type: 'boolean' },
          frame_count: { type: 'number', integer: true, min: 1 },
          source: { type: 'string', minLength: 1 },
          fallback: { type: 'string', minLength: 1 },
          events: {
            type: 'array',
            items: {
              type: 'object',
              required: ['frame', 'emit'],
              properties: {
                frame: { type: 'number', integer: true, min: 0 },
                emit: { type: 'string', minLength: 1 },
              },
            },
          },
        },
        requiredWhen: [
          {
            field: 'type',
            equals: 'animated-per-direction',
            require: ['frame_rate', 'frame_count'],
            stringContains: { source: '{frame:' },
          },
        ],
      },
    },
    hitbox: {
      type: 'object',
      required: ['width', 'height'],
      properties: {
        width: { type: 'number', min: 0 },
        height: { type: 'number', min: 0 },
        // How far up from the bottom edge of a frame the art's feet actually sit. Either a
        // single number applied to every frame size, OR an object keyed by frame pixel height
        // (e.g. `{ "32": 1, "48": 8 }`) for sprites whose states are authored on differently
        // sized canvases (e.g. static poses vs. animated walk/attack frames). The validator
        // here only checks the "single number" shape and the "is an object" shape — the
        // per-key numbers of the keyed form aren't schema-checked (this hand-rolled validator
        // has no `anyOf`/numeric-map-values support); Actor.js's `_applyHitbox` is defensive
        // about a missing/malformed entry regardless. See that method's doc for how this is
        // used; omitted entirely, the hitbox sits flush with the frame's bottom edge.
        margin_bottom: { type: ['number', 'object'] },
      },
    },
    scale: { type: 'number', exclusiveMin: 0 },
  },
};

/**
 * Schema for `/graphics/backgrounds/<id>/manifest.json`.
 * Image/tilemap paths are relative to the background's own folder.
 * A tilemap-only background uses `"layers": []`.
 * @type {object}
 */
export const BACKGROUND_MANIFEST_SCHEMA = {
  type: 'object',
  // FIX (was inconsistent with module 05's BackgroundLoader, which branches on `manifest.type`
  // and never saw it in this schema): `type` is now required here, with the exact 3 values
  // BackgroundLoader.js switches on.
  required: ['id', 'type', 'layers'],
  properties: {
    id: ID_SCHEMA,
    display_name: { type: 'string' },
    type: { type: 'string', enum: ['parallax-layered', 'tilemap', 'static'] },
    // 'static' is authored as a single-entry `layers` array (BackgroundLoader reads layer 0);
    // 'tilemap' may use an empty `layers: []` when it has no separate parallax art.
    layers: {
      type: 'array',
      items: {
        type: 'object',
        required: ['image'],
        properties: {
          image: { type: 'string', minLength: 1 },
          // FIX (was `depth_layer`, a name BackgroundLoader never read): renamed to `depth` to
          // match `layer.depth` in BackgroundLoader.js. Accepts either a named band or a raw
          // Phaser depth number.
          depth: { type: ['string', 'number'] },
          scroll_factor: { type: 'number', min: 0, max: 1 },
        },
      },
    },
    tilemap: {
      type: 'object',
      required: ['source', 'tileset_image'],
      properties: {
        // FIX (was `tiled_json`): renamed to `source` to match `manifest.tilemap.source` used
        // by both PreloadQueueBuilder (as the load path) and BackgroundLoader (as the basis for
        // the registered cache key `${id}:tilemap`).
        source: { type: 'string', minLength: 1 },
        tileset_image: { type: 'string', minLength: 1 },
        additional_tilesets: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name', 'image'],
            properties: {
              name: { type: 'string', minLength: 1 },
              image: { type: 'string', minLength: 1 },
            },
          },
        },
        y_sorted_layers: { type: 'array', items: { type: 'string', minLength: 1 } },
        collision_layer: { type: 'string', minLength: 1 },
      },
    },
    ambient_tint: { type: 'string', pattern: /^#[0-9a-fA-F]{6}$/ },
  },
  requiredWhen: [
    { field: 'type', equals: 'tilemap', require: ['tilemap'] },
  ],
};

/**
 * Schema for `/screens/<id>/manifest.json` (matches ScreenManifest in the shared contract).
 * @type {object}
 */
export const SCREEN_MANIFEST_SCHEMA = {
  type: 'object',
  required: [
    'id', 'controller', 'input_profile', 'background',
    'ui_windows', 'transition_in', 'transition_out',
  ],
  properties: {
    id: ID_SCHEMA,
    display_name: { type: 'string' },
    controller: { type: 'string', minLength: 1 },
    input_profile: { type: 'string', minLength: 1 },
    background: { type: ['string', 'null'] },
    ui_windows: { type: 'array', items: { type: 'string', minLength: 1 } },
    transition_in: { type: 'string', enum: TRANSITION_NAMES },
    transition_out: { type: 'string', enum: TRANSITION_NAMES },
  },
};

/**
 * Schema for `/graphics/ui/windows/<id>/manifest.json`.
 * Elements with `bind` read/write SettingsStore; elements with `action` call ActionRegistry.
 * Extra element fields (position, size, text, options...) are allowed and read by module 07.
 * @type {object}
 */
export const WINDOW_MANIFEST_SCHEMA = {
  type: 'object',
  required: ['id', 'elements'],
  properties: {
    id: ID_SCHEMA,
    display_name: { type: 'string' },
    showPanel: { type: 'boolean' },
    elements: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'type'],
        properties: {
          id: { type: 'string', minLength: 1 },
          type: {
            type: 'string',
            enum: [
              'label', 'button', 'slider', 'toggle',
              'text-input', 'keybind_list', 'scrollable-text', 'list',
            ],
          },
          bind: { type: 'string', minLength: 1 },
          action: { type: 'string', minLength: 1 },
        },
      },
    },
  },
};
