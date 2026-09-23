'use strict';

function sanitizeMongoKeys(value, preserveRaw = false) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeMongoKeys(item, preserveRaw));
  }

  if (!value || typeof value !== 'object' || value instanceof Date) {
    return value;
  }

  const out = {};
  for (const [key, inner] of Object.entries(value)) {
    if (!preserveRaw && (key.startsWith('$') || key.includes('.'))) {
      continue;
    }
    const safeKey = preserveRaw ? key.replace(/\./g, '_').replace(/^\$/g, '_') : key;
    out[safeKey] = sanitizeMongoKeys(inner, preserveRaw || key === 'rawData' || key === 'sourcePayload');
  }
  return out;
}

module.exports = { sanitizeMongoKeys };
