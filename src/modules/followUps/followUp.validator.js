'use strict';

const { body } = require('express-validator');
const { objectIdParam } = require('../shared/validators');
const { validateFutureDate } = require('../shared/futureDate');

const validateCreate = [
  body('leadId').isMongoId(),
  body('dueAt').isISO8601().bail().custom(validateFutureDate)
];

module.exports = { validateCreate, validateId: [objectIdParam()] };
