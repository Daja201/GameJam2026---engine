/**
 * Error thrown whenever a quest definition is missing, malformed, or references an unknown
 * objective type/field. Mirrors `assets/AssetValidationError.js`'s shape (source + field +
 * message) so a `console.error` of this object is immediately actionable, even though quest
 * definitions are loaded from `/config/quests.default.json` rather than scanned by AssetRegistry.
 * @module quest/QuestValidationError
 */
export class QuestValidationError extends Error {
  /**
   * @param {string} questId - the offending quest's `id` (or `"(unknown)"` if not yet known)
   * @param {string} fieldPath - dotted path to the invalid field, e.g. "objectives[0].itemId"
   * @param {string} message - human-readable reason
   */
  constructor(questId, fieldPath, message) {
    super(`Invalid quest definition "${questId}" (field: ${fieldPath}): ${message}`);
    this.name = 'QuestValidationError';
    /** @type {string} */
    this.questId = questId;
    /** @type {string} */
    this.fieldPath = fieldPath;
  }
}
