'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const AuditLog = require('./auditLog.model');

exports.list = asyncHandler(async (req, res) => {
  const page = Math.max(Number(req.query.page || 1), 1);
  const limit = Math.min(Math.max(Number(req.query.limit || 25), 1), 100);
  const filter = {};
  if (req.query.action) filter.action = req.query.action;
  if (req.query.entityType) filter['entity.type'] = req.query.entityType;
  if (req.query.actorId) filter['actor.id'] = req.query.actorId;

  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    AuditLog.countDocuments(filter)
  ]);

  res.json({ items, total, page, limit, pages: Math.ceil(total / limit) });
});
