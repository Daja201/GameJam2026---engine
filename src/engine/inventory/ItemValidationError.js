/**
 * Error thrown whenever an item definition is missing, malformed, or has an invalid field.
 * Mirrors `quest/QuestValidationError.js`'s shape (source id + field path + message) so a
 * `console.error` of this object is immediately actionable, even though item definitions are
 * loaded from `/config/items.default.json` rather than scanned by AssetRegistry.
 * @module inventory/ItemValidationError
 */
export class ItemValidationError extends Error {
  /**
   * @param {string} itemId - the offending item's `id` (or `"(unknown)"` if not yet known)
   * @param {string} fieldPath - dotted path to the invalid field, e.g. "maxStack"
   * @param {string} message - human-readable reason
   */
  constructor(itemId, fieldPath, message) {
    super(`Invalid item definition "${itemId}" (field: ${fieldPath}): ${message}`);
    this.name = 'ItemValidationError';
    /** @type {string} */
    this.itemId = itemId;
    /** @type {string} */
    this.fieldPath = fieldPath;
  }
}