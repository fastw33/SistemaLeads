'use strict';

const mongoose = require('mongoose');
const { EVENT_TYPES } = require('../shared/business.constants');
const { actorSchema } = require('../shared/schema.helpers');

const leadEventSchema = new mongoose.Schema({
  leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
  type: { type: String, enum: EVENT_TYPES, required: true, index: true },
  channel: { type: String, enum: ['phone', 'whatsapp', 'email', 'meeting', 'visit', 'pickup', 'system', 'manual'], default: 'manual' },
  outcome: String,
  notes: String,
  actor: actorSchema,
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

leadEventSchema.index({ leadId: 1, createdAt: -1 });

module.exports = mongoose.model('LeadEvent', leadEventSchema);
