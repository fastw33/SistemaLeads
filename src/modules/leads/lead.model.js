'use strict';

const mongoose = require('mongoose');
const { BUSINESS_UNITS, SERVICE_LINES, LEAD_STATUSES } = require('../shared/business.constants');
const { externalRefSchema } = require('../shared/schema.helpers');

const leadSchema = new mongoose.Schema({
  code: { type: String, unique: true, sparse: true, index: true },
  name: { type: String, trim: true },
  companyName: { type: String, trim: true, index: true },
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', index: true },
  businessUnit: { type: String, enum: BUSINESS_UNITS, required: true, index: true },
  serviceLine: { type: String, enum: SERVICE_LINES, required: true, index: true },
  accountTypeIntent: { type: String, enum: ['customer', 'supplier', 'buyer', 'unknown'], default: 'unknown', index: true },
  status: { type: String, enum: LEAD_STATUSES, default: 'new', index: true },
  country: { type: String, index: true },
  city: { type: String, index: true },
  assignedAdvisorId: { type: String, index: true },
  assignedAdvisorName: String,
  phones: [{
    raw: String,
    normalized: { type: String, index: true },
    label: String,
    preferred: Boolean
  }],
  emails: [{
    raw: String,
    normalized: { type: String, index: true },
    label: String,
    preferred: Boolean
  }],
  source: {
    type: String,
    default: 'manual',
    index: true
  },
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', index: true },
  campaignRecordIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'CampaignRecord' }],
  tags: [String],
  customFields: { type: mongoose.Schema.Types.Mixed, default: {} },
  sourcePayload: { type: mongoose.Schema.Types.Mixed, default: {} },
  externalRefs: [externalRefSchema],
  lastContactAt: Date,
  nextFollowUpAt: { type: Date, index: true },
  closedAt: Date,
  closedReason: String
}, { timestamps: true });

leadSchema.index({ businessUnit: 1, status: 1, assignedAdvisorId: 1 });
leadSchema.index({ 'phones.normalized': 1, businessUnit: 1 }, { sparse: true });
leadSchema.index({ 'emails.normalized': 1, businessUnit: 1 }, { sparse: true });

module.exports = mongoose.model('Lead', leadSchema);
