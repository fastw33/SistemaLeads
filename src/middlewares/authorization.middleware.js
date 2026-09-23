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

function requirePermission(permission) {
  return function permissionMiddleware(req, res, next) {
    if (
      req.user?.permisos?.esAdmin === true ||
      req.user?.permisos?.[permission] === true
    ) return next();

    auditService.record(req, {
      action: 'security.denied.permission_required',
      entityType: 'security',
      result: 'denied',
      metadata: { path: req.originalUrl, method: req.method, permission }
    });

    return res.status(403).json({ error: true, message: 'No tienes permiso para realizar esta acción' });
  };
}

module.exports = { requireAdmin, requirePermission };
