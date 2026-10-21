import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCHEMA_DIR = path.join(REPO_ROOT, 'evolve', 'schema');

const schemaCache = new Map();

export const KNOWN_SCHEMAS = ['failure', 'probe', 'candidate', 'provenance', 'summary'];

// Loads a schema by type name or filename
export function loadSchema(schemaType) {
  const normalized = schemaType.replace(/\.schema\.json$/, '').toLowerCase();
  if (schemaCache.has(normalized)) {
    return schemaCache.get(normalized);
  }

  const filename = `${normalized}.schema.json`;
  const schemaPath = path.join(SCHEMA_DIR, filename);
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Unknown schema type or schema file not found: ${schemaType} (resolved ${schemaPath})`);
  }

  const raw = fs.readFileSync(schemaPath, 'utf8');
  const schema = JSON.parse(raw);
  schemaCache.set(normalized, schema);
  return schema;
}

// Validates a value against a JSON schema definition
function validateNode(schema, value, pathStr, errors) {
  if (schema === true) return;
  if (schema === false) {
    errors.push(`${pathStr}: schema is false, value rejected`);
    return;
  }

  // Type check
  if (schema.type) {
    const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actualType = getValueType(value);
    const matchesType = expected.some((t) => {
      if (t === 'integer') return actualType === 'integer';
      if (t === 'number') return actualType === 'integer' || actualType === 'number';
      return actualType === t;
    });

    if (!matchesType) {
      errors.push(`${pathStr}: expected type '${expected.join('|')}', got '${actualType}'`);
      return;
    }
  }

  // Const check
  if ('const' in schema) {
    if (value !== schema.const) {
      errors.push(`${pathStr}: expected const value '${schema.const}', got '${value}'`);
    }
  }

  // Enum check
  if (Array.isArray(schema.enum)) {
    if (!schema.enum.includes(value)) {
      errors.push(`${pathStr}: value '${value}' is not in enum [${schema.enum.join(', ')}]`);
    }
  }

  // String checks
  if (typeof value === 'string') {
    // Unredacted user path check (/Users/ or /home/)
    if (/(?:^|[\\/])Users[\\/]|(?:^|[\\/])home[\\/][a-zA-Z0-9_-]+[\\/]/.test(value)) {
      errors.push(`${pathStr}: contains unredacted absolute user path with '/Users/' or '/home/'`);
    }

    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push(`${pathStr}: string length ${value.length} is less than minLength ${schema.minLength}`);
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      errors.push(`${pathStr}: string length ${value.length} exceeds maxLength ${schema.maxLength}`);
    }
    if (schema.pattern) {
      const regex = new RegExp(schema.pattern);
      if (!regex.test(value)) {
        errors.push(`${pathStr}: value '${value}' does not match pattern '${schema.pattern}'`);
      }
    }
  }

  // Number / Integer checks
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push(`${pathStr}: value ${value} is less than minimum ${schema.minimum}`);
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push(`${pathStr}: value ${value} exceeds maximum ${schema.maximum}`);
    }
  }

  // Array checks
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errors.push(`${pathStr}: array length ${value.length} is less than minItems ${schema.minItems}`);
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      errors.push(`${pathStr}: array length ${value.length} exceeds maxItems ${schema.maxItems}`);
    }
    if (schema.items) {
      for (let i = 0; i < value.length; i++) {
        validateNode(schema.items, value[i], `${pathStr}[${i}]`, errors);
      }
    }
  }

  // Object checks
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    // Required properties
    if (Array.isArray(schema.required)) {
      for (const req of schema.required) {
        if (!(req in value) || value[req] === undefined) {
          errors.push(`${pathStr}: missing required property '${req}'`);
        }
      }
    }

    const properties = schema.properties || {};
    const propertyKeys = new Set(Object.keys(properties));

    // Check defined properties
    for (const [key, propSchema] of Object.entries(properties)) {
      if (key in value && value[key] !== undefined) {
        validateNode(propSchema, value[key], `${pathStr}.${key}`, errors);
      }
    }

    // Additional properties check
    if (schema.additionalProperties === false) {
      for (const actualKey of Object.keys(value)) {
        if (!propertyKeys.has(actualKey)) {
          errors.push(`${pathStr}: unexpected property '${actualKey}' (additionalProperties is false)`);
        }
      }
    } else if (typeof schema.additionalProperties === 'object') {
      for (const [actualKey, actualVal] of Object.entries(value)) {
        if (!propertyKeys.has(actualKey)) {
          validateNode(schema.additionalProperties, actualVal, `${pathStr}.${actualKey}`, errors);
        }
      }
    }
  }
}

function getValueType(val) {
  if (val === null) return 'null';
  if (Array.isArray(val)) return 'array';
  if (typeof val === 'number') {
    return Number.isInteger(val) ? 'integer' : 'number';
  }
  return typeof val;
}

// Validates data against a named schema or schema object
export function validateSchema(schemaOrType, data) {
  const errors = [];
  let schema;

  try {
    if (typeof schemaOrType === 'string') {
      schema = loadSchema(schemaOrType);
    } else if (schemaOrType && typeof schemaOrType === 'object') {
      schema = schemaOrType;
    } else {
      return { valid: false, errors: ['Invalid schema parameter: must be string or schema object'] };
    }
  } catch (err) {
    return { valid: false, errors: [err.message] };
  }

  if (data === undefined) {
    return { valid: false, errors: ['Data to validate is undefined'] };
  }

  validateNode(schema, data, '$', errors);

  return {
    valid: errors.length === 0,
    errors,
  };
}

export default {
  loadSchema,
  validateSchema,
  KNOWN_SCHEMAS,
};
