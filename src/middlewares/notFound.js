'use strict';

module.exports = function notFound(req, res) {
  res.status(404).json({
    error: true,
    message: `Ruta no encontrada: ${req.method} ${req.originalUrl}`
  });
};
