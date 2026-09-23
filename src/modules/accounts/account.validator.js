'use strict';

const { body } = require('express-validator');
const { objectIdParam } = require('../shared/validators');
const { ACCOUNT_TYPES, BUSINESS_UNITS } = require('../shared/business.constants');

const validateCreate = [
  body('name').isString().notEmpty(),
  body('type').isIn(ACCOUNT_TYPES),
  body('businessUnit').isIn(BUSINESS_UNITS)
];

module.exports = { validateCreate, validateId: [objectIdParam()] };
