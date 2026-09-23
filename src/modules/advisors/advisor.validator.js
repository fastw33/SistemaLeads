'use strict';

const { body } = require('express-validator');
const { objectIdParam } = require('../shared/validators');

const validateCreate = [
  body('userId').isString().notEmpty(),
  body('name').isString().notEmpty(),
  body('email').optional().isEmail()
];

module.exports = { validateCreate, validateId: [objectIdParam()] };
