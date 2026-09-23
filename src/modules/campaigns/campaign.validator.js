'use strict';

const { body } = require('express-validator');
const { objectIdParam } = require('../shared/validators');
const { BUSINESS_UNITS, SERVICE_LINES } = require('../shared/business.constants');

const validateCreate = [
  body('name').isString().trim().isLength({ min: 3, max: 120 }),
  body('objective').isString().trim().isLength({ min: 3, max: 500 }),
  body('businessUnit').isIn(BUSINESS_UNITS),
  body('serviceLine').isIn(SERVICE_LINES),
  body('country').isString().trim().notEmpty(),
  body('startsAt').isISO8601(),
  body('endsAt').isISO8601(),
  body('status').optional().isIn(['draft', 'active', 'paused', 'closed']),
  body('responsibleId').isString().trim().notEmpty(),
  body('responsibleName').isString().trim().notEmpty(),
  body('advisorIds').optional().isArray()
];

const validateImportJson = [
  objectIdParam(),
  body('records').isArray({ min: 1 }).withMessage('records debe ser un arreglo con filas')
];

const validatePause = [
  objectIdParam(),
  body('pausedUntil').isISO8601().withMessage('Fecha de reactivación inválida')
];

module.exports = {
  validateCreate,
  validateId: [objectIdParam()],
  validateImportJson,
  validatePause
};
