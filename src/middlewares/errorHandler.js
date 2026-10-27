'use strict';

const logger = require('../utils/logger');

module.exports = function errorHandler(error, req, res, _next) {
  const uploadMessages = {
    LIMIT_FILE_SIZE: `Cada archivo debe pesar máximo ${process.env.LEADS_MAX_FILE_SIZE_MB || 20} MB`,
    LIMIT_FILE_COUNT: `Puedes subir máximo ${process.env.LEADS_MAX_FILES || 10} archivos por envío`,
    LIMIT_UNEXPECTED_FILE: 'Campo de archivo no permitido'
  };
  const uploadMessage = error.name === 'MulterError' && uploadMessages[error.code];
  const status = uploadMessage ? 400 : error.statusCode || error.status || 500;
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
    message: status === 500 ? 'Error interno del servidor' : uploadMessage || error.message
  });
};
