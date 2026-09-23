'use strict';

const { validationResult } = require('express-validator');

module.exports = function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: true,
      message: 'Error de validacion',
      errors: errors.array()
    });
  }
  return next();
};
