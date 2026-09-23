'use strict';

const { body } = require('express-validator');
const { objectIdParam } = require('../shared/validators');
const { BUSINESS_UNITS } = require('../shared/business.constants');

const validateCreate = [
  body('type').isString().notEmpty(),
  body('code').isString().notEmpty(),
  body('label').isString().notEmpty(),
  body('businessUnit').optional().isIn(BUSINESS_UNITS)
];

module.exports = { validateCreate, validateId: [objectIdParam()] };
