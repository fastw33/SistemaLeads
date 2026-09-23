'use strict';

const { param } = require('express-validator');

const objectIdParam = (name = 'id') => param(name).isMongoId().withMessage(`${name} invalido`);

module.exports = { objectIdParam };
