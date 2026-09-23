'use strict';

const allowed = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

module.exports = {
  origin(origin, callback) {
    if (!origin || allowed.length === 0 || allowed.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Origen CORS no permitido'));
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key']
};
