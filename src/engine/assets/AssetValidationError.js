/**
 * Error thrown whenever a manifest file is missing, unreadable, or invalid.
 * The message always names the file and the offending field so a
 * console.error of this object is immediately actionable.
 */
export class AssetValidationError extends Error {
  /**
   * @param {string} filePath - absolute or project-relative path of the offending manifest
   * @param {string} fieldPath - dotted path to the invalid field, e.g. "states.walk.frame_count"
   * @param {string} message - human-readable reason
   */
  constructor(filePath, fieldPath, message) {
    super(`Invalid manifest at ${filePath} (field: ${fieldPath}): ${message}`);
    this.name = 'AssetValidationError';
    /** @type {string} */
    this.filePath = filePath;
    /** @type {string} */
    this.fieldPath = fieldPath;
  }
}
