'use strict';

const mongoose = require('mongoose');

const campaignRecordSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, index: true },
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
  importJobId: { type: mongoose.Schema.Types.ObjectId, ref: 'ImportJob', index: true },
  rowNumber: { type: Number, required: true },
  rowHash: { type: String, required: true, index: true },
  rawData: { type: mongoose.Schema.Types.Mixed, default: {} },
  detectedFields: {
    name: String,
    companyName: String,
    phone: { type: String, index: true },
    email: { type: String, index: true },
    phones: [{ type: String, index: true }],
    emails: [{ type: String, index: true }],
    country: String,
    city: { type: String, index: true },
    priority: { type: String, enum: ['A', 'B', 'C', ''], index: true },
    industry: String,
    probableMaterials: String,
    website: { type: String, index: true },
    contacts: [{
      name: String,
      role: String
    }]
  },
  leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', index: true },
  status: {
    type: String,
    enum: ['pending', 'pending_enrichment', 'enriching', 'ready', 'queued', 'assigned', 'worked', 'manual_review', 'no_contact', 'duplicate_candidate', 'incomplete', 'discarded'],
    default: 'pending',
    index: true
  },
  duplicateOf: { type: mongoose.Schema.Types.ObjectId, ref: 'CampaignRecord' },
  attempts: { type: Number, default: 0 },
  changeHistory: [{
    fieldKey: String,
    before: mongoose.Schema.Types.Mixed,
    after: mongoose.Schema.Types.Mixed,
    actorId: String,
    actorName: String,
    note: String,
    channel: String,
    result: String,
    nextAttemptAt: Date,
    changedAt: { type: Date, default: Date.now }
  }],
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

campaignRecordSchema.index({ campaignId: 1, rowHash: 1 }, { unique: true });
campaignRecordSchema.index({ campaignId: 1, status: 1 });
campaignRecordSchema.index({ 'changeHistory.changedAt': -1, 'changeHistory.actorId': 1 });

module.exports = mongoose.model('CampaignRecord', campaignRecordSchema);
