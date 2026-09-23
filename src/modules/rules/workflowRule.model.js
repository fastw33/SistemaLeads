'use strict';

const mongoose = require('mongoose');
const { BUSINESS_UNITS, SERVICE_LINES } = require('../shared/business.constants');

const workflowRuleSchema = new mongoose.Schema({
  name: { type: String, required: true },
  businessUnit: { type: String, enum: BUSINESS_UNITS, index: true },
  serviceLine: { type: String, enum: SERVICE_LINES, index: true },
  type: {
    type: String,
    enum: ['territory', 'retry', 'meeting_required', 'assignment', 'supplier_classification'],
    required: true,
    index: true
  },
  priority: { type: Number, default: 0, index: true },
  active: { type: Boolean, default: true, index: true },
  conditions: { type: mongoose.Schema.Types.Mixed, default: {} },
  actions: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

module.exports = mongoose.model('WorkflowRule', workflowRuleSchema);
