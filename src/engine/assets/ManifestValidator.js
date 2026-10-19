import { AssetValidationError } from './AssetValidationError.js';

/**
 * Returns true if `value` matches one schema type name.
 * @param {*} value
 * @param {string} typeName
 * @returns {boolean}
 */
function matchesType(value, typeName) {
  switch (typeName) {
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    case 'array': return Array.isArray(value);
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
    default: return false;
  }
}

/**
 * Short human-readable description of a value's type, for error messages.
 * @param {*} value
 * @returns {string}
 */
function describe(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Joins a parent field path and a child key ("states" + "walk" -> "states.walk").
 * @param {string} parent
 * @param {string} key
 * @returns {string}
 */
function join(parent, key) {
  return parent ? `${parent}.${key}` : key;
}

/** @param {*} v @returns {boolean} true when a property is absent. */
function isMissing(v) {
  return v === undefined;
}

/**
 * Recursively validates one value against one schema node. Throws on the first violation.
 * @param {*} value
 * @param {object} schema
 * @param {string} filePath
 * @param {string} fieldPath
 * @returns {void}
 */
function validateNode(value, schema, filePath, fieldPath) {
  const fail = (msg, path = fieldPath) => {
    throw new AssetValidationError(filePath, path || '(root)', msg);
  };

  // type
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (!types.some((t) => matchesType(value, t))) {
    fail(`expected ${types.join(' or ')} but got ${describe(value)}`);
  }

  // enum
  if (schema.enum && !schema.enum.includes(value)) {
    fail(`must be one of [${schema.enum.join(', ')}] but got "${value}"`);
  }

  // number constraints
  if (typeof value === 'number') {
    if (schema.integer && !Number.isInteger(value)) fail(`must be an integer but got ${value}`);
    if (schema.min !== undefined && value < schema.min) fail(`must be >= ${schema.min} but got ${value}`);
    if (schema.max !== undefined && value > schema.max) fail(`must be <= ${schema.max} but got ${value}`);
    if (schema.exclusiveMin !== undefined && value <= schema.exclusiveMin) {
      fail(`must be > ${schema.exclusiveMin} but got ${value}`);
    }
  }

  // string constraints
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      fail(`must not be empty (min length ${schema.minLength})`);
    }
    if (schema.pattern && !schema.pattern.test(value)) {
      fail(`"${value}" does not match the required format ${schema.pattern}`);
    }
  }

  // arrays
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      fail(`must have at least ${schema.minItems} item(s)`);
    }
    if (schema.items) {
      value.forEach((item, i) => {
        validateNode(item, schema.items, filePath, `${fieldPath}[${i}]`);
      });
    }
  }

  // objects
  if (matchesType(value, 'object')) {
    for (const key of schema.required || []) {
      if (isMissing(value[key])) fail('missing required field', join(fieldPath, key));
    }
    if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) {
      fail(`must have at least ${schema.minProperties} entr${schema.minProperties === 1 ? 'y' : 'ies'}`);
    }
    for (const [key, childSchema] of Object.entries(schema.properties || {})) {
      if (!isMissing(value[key])) validateNode(value[key], childSchema, filePath, join(fieldPath, key));
    }
    if (schema.values) {
      for (const [key, child] of Object.entries(value)) {
        validateNode(child, schema.values, filePath, join(fieldPath, key));
      }
    }
    for (const rule of schema.requiredWhen || []) {
      if (value[rule.field] !== rule.equals) continue;
      for (const key of rule.require || []) {
        if (isMissing(value[key])) {
          fail(`required when ${rule.field} is "${rule.equals}"`, join(fieldPath, key));
        }
      }
      for (const [key, needle] of Object.entries(rule.stringContains || {})) {
        if (typeof value[key] === 'string' && !value[key].includes(needle)) {
          fail(`must contain "${needle}" when ${rule.field} is "${rule.equals}"`, join(fieldPath, key));
        }
      }
    }
  }
}

/**
 * Validates parsed manifest JSON against one of the schemas in ManifestSchemas.js.
 * Checks required fields, types, enums, number/string constraints and nested shapes.
 * Passes silently when valid.
 *
 * @param {object} manifestJson - parsed JSON content
 * @param {object} schema - one of the exports from ManifestSchemas.js
 * @param {string} filePath - for error reporting
 * @throws {AssetValidationError} on first violation found (field name required/type mismatch/enum violation)
 * @returns {void}
 */
export function validateManifest(manifestJson, schema, filePath) {
  validateNode(manifestJson, schema, filePath, ''); // '' = root; reported as "(root)" in errors
}
