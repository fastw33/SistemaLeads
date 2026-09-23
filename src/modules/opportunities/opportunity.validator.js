'use strict';

const { body } = require('express-validator');
const { objectIdParam } = require('../shared/validators');
const { BUSINESS_UNITS, SERVICE_LINES } = require('../shared/business.constants');

const validateCreate = [
  body('leadId').isMongoId(),
  body('businessUnit').isIn(BUSINESS_UNITS),
  body('serviceLine').isIn(SERVICE_LINES)
];

module.exports = { validateCreate, validateId: [objectIdParam()] };
