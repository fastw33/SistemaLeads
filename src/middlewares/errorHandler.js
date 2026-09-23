'use strict';

const logger = require('../utils/logger');

module.exports = function errorHandler(error, req, res, _next) {
  const status = error.statusCode || error.status || 500;
  logger.error('request_error', {
    status,
    message: error.message,
    path: req.originalUrl,
    method: req.method,
    userId: req.user && req.user.id,
    stack: process.env.NODE_ENV === 'production' ? undefined : error.stack
  });

  res.status(status).json({
    error: true,
    message: status === 500 ? 'Error interno del servidor' : error.message
  });
};
