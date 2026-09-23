'use strict';

const AuditLog = require('./auditLog.model');
const logger = require('../../utils/logger');
const { actorFromReq } = require('../shared/schema.helpers');

async function record(req, payload = {}) {
  try {
    await AuditLog.create({
      actor: actorFromReq(req),
      action: payload.action,
      entity: {
        type: payload.entityType,
        id: payload.entityId ? String(payload.entityId) : undefined
      },
      result: payload.result || 'success',
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      before: payload.before,
      after: payload.after,
      metadata: payload.metadata || {}
    });
  } catch (error) {
    logger.error('audit_log_failed', { message: error.message, action: payload.action });
  }
}

module.exports = { record };
