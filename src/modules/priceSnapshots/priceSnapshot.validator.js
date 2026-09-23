'use strict';

const { body } = require('express-validator');
const { objectIdParam } = require('../shared/validators');

const validateCreate = [
  body('leadId').isMongoId(),
  body('source').isIn(['local_prices', 'lme', 'tungsteno', 'logistics', 'manual']),
  body('materialId').optional().isString().trim().isLength({ max: 120 }),
  body('priceHistoryId').optional().isString().trim().isLength({ max: 120 }),
  body('material').optional().isString().trim().isLength({ max: 240 }),
  body('section').optional().isString().trim().isLength({ max: 80 }),
  body('observedAt').optional().isISO8601(),
  body('suggestedPrice').optional().isFloat({ min: 0 }),
  body('informedPrice').optional().isFloat({ min: 0 }),
  body('currency').optional().isString().trim().isLength({ min: 3, max: 8 }),
  body('unit').optional().isString().trim().isLength({ max: 40 }),
  body('notes').optional().isString().trim().isLength({ max: 1000 }),
  body('informed').optional().isBoolean(),
  body('context').optional().isObject(),
  body('sourcePayload').optional().isObject()
];

module.exports = { validateCreate, validateId: [objectIdParam()] };
