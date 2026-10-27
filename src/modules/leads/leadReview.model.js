'use strict';
const mongoose = require('mongoose');
const { actorSchema } = require('../shared/schema.helpers');

const schema = new mongoose.Schema({
  leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
  assignedAdvisorId: { type: String, required: true },
  assignedAdvisorName: String,
  note: { type: String, required: true },
  dueAt: { type: Date, required: true },
  status: { type: String, enum: ['pending', 'resolved'], default: 'pending' },
  createdBy: actorSchema,
  resolution: String,
  resolutionType: { type: String, enum: ['response', 'lead_closed'], default: 'response' },
  resolvedAt: Date,
  resolvedBy: actorSchema
}, { timestamps: true });
schema.index({ leadId: 1, createdAt: -1 });
schema.index({ leadId: 1, status: 1, dueAt: 1 });
schema.index({ assignedAdvisorId: 1, status: 1, createdAt: -1 });
module.exports = mongoose.model('LeadReview', schema);
