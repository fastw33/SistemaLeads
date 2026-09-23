'use strict';

const { body } = require('express-validator');
const { objectIdParam } = require('../shared/validators');
const { BUSINESS_UNITS, SERVICE_LINES } = require('../shared/business.constants');

const validateCreate = [
  body('name').isString().trim().isLength({ min: 2, max: 120 }),
  body('type').isIn(['territory', 'retry', 'meeting_required', 'assignment', 'supplier_classification']),
  body('businessUnit').optional().isIn(BUSINESS_UNITS),
  body('serviceLine').optional().isIn(SERVICE_LINES),
  body('priority').optional().isInt({ min: 0, max: 100 })
];

module.exports = { validateCreate, validateId: [objectIdParam()] };
