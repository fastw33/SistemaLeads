'use strict';

const { body } = require('express-validator');

const validateHarvestUpdate = [
  body('discountPercent')
    .isFloat({ min: 0, max: 100 })
    .withMessage('El porcentaje debe estar entre 0 y 100'),
  body('reason')
    .isString()
    .trim()
    .isLength({ min: 5, max: 500 })
    .withMessage('Indica un motivo de al menos 5 caracteres')
];

module.exports = { validateHarvestUpdate };
