'use strict';

const auditService = require('../modules/audit/audit.service');
const { isAdminUser } = require('./auth.middleware');

function requireAdmin(req, res, next) {
  if (isAdminUser(req.user)) return next();

  auditService.record(req, {
    action: 'security.denied.admin_required',
    entityType: 'security',
    result: 'denied',
    metadata: { path: req.originalUrl, method: req.method }
  });

  return res.status(403).json({ error: true, message: 'Permiso administrativo requerido' });
}

module.exports = { requireAdmin };
