'use strict';

const mongoose = require('mongoose');
const { QUEUE_STATUSES } = require('../shared/business.constants');

const campaignQueueSchema = new mongoose.Schema({
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
  campaignRecordId: { type: mongoose.Schema.Types.ObjectId, ref: 'CampaignRecord', required: true, unique: true },
  leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', index: true },
  status: { type: String, enum: QUEUE_STATUSES, default: 'available', index: true },
  priority: { type: Number, default: 0, index: true },
  assignedAdvisorId: { type: String, index: true },
  assignedAdvisorName: String,
  lockedBy: { type: String, index: true },
  lockedAt: Date,
  lockExpiresAt: { type: Date, index: true },
  availableAt: { type: Date, default: Date.now, index: true },
  attempts: { type: Number, default: 0 },
  lastOutcome: String
}, { timestamps: true });

campaignQueueSchema.index({ status: 1, availableAt: 1, priority: -1, createdAt: 1 });
campaignQueueSchema.index({ assignedAdvisorId: 1, status: 1 });

module.exports = mongoose.model('CampaignQueue', campaignQueueSchema);
