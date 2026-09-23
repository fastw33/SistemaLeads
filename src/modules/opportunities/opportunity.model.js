'use strict';

const mongoose = require('mongoose');
const { BUSINESS_UNITS, SERVICE_LINES } = require('../shared/business.constants');
const { externalRefSchema } = require('../shared/schema.helpers');

const opportunitySchema = new mongoose.Schema({
  code: { type: String, unique: true, sparse: true, index: true },
  leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', index: true },
  requestId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommercialRequest', index: true },
  businessUnit: { type: String, enum: BUSINESS_UNITS, required: true, index: true },
  serviceLine: { type: String, enum: SERVICE_LINES, required: true, index: true },
  stage: {
    type: String,
    enum: ['qualified', 'meeting', 'quote', 'negotiation', 'won', 'lost'],
    default: 'qualified',
    index: true
  },
  expectedValue: Number,
  currency: String,
  probability: Number,
  assignedAdvisorId: { type: String, index: true },
  nextStep: String,
  nextFollowUpAt: Date,
  context: { type: mongoose.Schema.Types.Mixed, default: {} },
  externalRefs: [externalRefSchema],
  closedAt: Date,
  closedReason: String
}, { timestamps: true });

opportunitySchema.index({ businessUnit: 1, stage: 1, assignedAdvisorId: 1 });

module.exports = mongoose.model('Opportunity', opportunitySchema);
