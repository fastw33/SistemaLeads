'use strict';

const mongoose = require('mongoose');
const { actorSchema } = require('../shared/schema.helpers');

const contactPolicySchema = new mongoose.Schema({
  leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
  type: { type: String, enum: ['do_not_contact', 'restricted', 'consent_required'], required: true, index: true },
  channel: { type: String, enum: ['phone', 'whatsapp', 'email', 'all'], default: 'all' },
  reason: String,
  active: { type: Boolean, default: true, index: true },
  createdBy: actorSchema,
  expiresAt: Date
}, { timestamps: true });

contactPolicySchema.index({ leadId: 1, type: 1, active: 1 });

module.exports = mongoose.model('ContactPolicy', contactPolicySchema);
