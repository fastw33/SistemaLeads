'use strict';

const { body } = require('express-validator');
const { objectIdParam } = require('../shared/validators');

const validateCreate = [
  body('leadId').isMongoId(),
  body('dueAt').isISO8601()
];

module.exports = { validateCreate, validateId: [objectIdParam()] };
