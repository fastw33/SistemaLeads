'use strict';

const { body } = require('express-validator');
const { objectIdParam } = require('../shared/validators');
const { EVENT_TYPES } = require('../shared/business.constants');

const validateCreate = [
  body('leadId').isMongoId(),
  body('type').isIn(EVENT_TYPES),
  body('notes').optional().isString()
];

module.exports = { validateCreate, validateId: [objectIdParam()] };
