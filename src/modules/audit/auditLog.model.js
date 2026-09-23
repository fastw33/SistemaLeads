'use strict';

const mongoose = require('mongoose');
const { actorSchema } = require('../shared/schema.helpers');

const auditLogSchema = new mongoose.Schema({
  actor: actorSchema,
  action: { type: String, required: true, index: true },
  entity: {
    type: { type: String, required: true, index: true },
    id: { type: String, index: true }
  },
  result: { type: String, enum: ['success', 'denied', 'failed'], default: 'success', index: true },
  ip: String,
  userAgent: String,
  before: mongoose.Schema.Types.Mixed,
  after: mongoose.Schema.Types.Mixed,
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ 'actor.id': 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
