'use strict';

const mongoose = require('mongoose');
const { BUSINESS_UNITS, SERVICE_LINES } = require('../shared/business.constants');
const { externalRefSchema } = require('../shared/schema.helpers');

const commercialRequestSchema = new mongoose.Schema({
  code: { type: String, unique: true, sparse: true, index: true },
  leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', index: true },
  businessUnit: { type: String, enum: BUSINESS_UNITS, required: true, index: true },
  serviceLine: { type: String, enum: SERVICE_LINES, required: true, index: true },
  type: {
    type: String,
    enum: ['general_query', 'price_inquiry', 'logistics_quote', 'supplier_classification', 'buyer_interest', 'meeting_request'],
    required: true,
    index: true
  },
  status: {
    type: String,
    enum: ['open', 'pending_meeting', 'pending_external', 'answered', 'converted', 'closed'],
    default: 'open',
    index: true
  },
  subject: String,
  description: String,
  requiresMeeting: { type: Boolean, default: false },
  assignedAdvisorId: { type: String, index: true },
  context: { type: mongoose.Schema.Types.Mixed, default: {} },
  externalRefs: [externalRefSchema],
  closedAt: Date,
  closedReason: String
}, { timestamps: true });

commercialRequestSchema.index({ leadId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('CommercialRequest', commercialRequestSchema);
