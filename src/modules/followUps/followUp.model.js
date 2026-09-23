'use strict';

const mongoose = require('mongoose');

const followUpSchema = new mongoose.Schema({
  leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
  requestId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommercialRequest', index: true },
  opportunityId: { type: mongoose.Schema.Types.ObjectId, ref: 'Opportunity', index: true },
  assignedAdvisorId: { type: String, required: true, index: true },
  dueAt: { type: Date, required: true, index: true },
  channel: { type: String, enum: ['phone', 'whatsapp', 'email', 'meeting', 'visit', 'pickup', 'task'], default: 'phone' },
  reason: String,
  participants: [{
    personalId: { type: String, required: true, trim: true },
    name: { type: String, trim: true },
    role: { type: String, trim: true }
  }],
  priority: { type: Number, default: 0, index: true },
  status: { type: String, enum: ['pending', 'done', 'overdue', 'cancelled'], default: 'pending', index: true },
  completedAt: Date,
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

followUpSchema.index({ assignedAdvisorId: 1, status: 1, dueAt: 1 });

module.exports = mongoose.model('FollowUp', followUpSchema);
