'use strict';

const mongoose = require('mongoose');
const { BUSINESS_UNITS, SERVICE_LINES } = require('../shared/business.constants');

const fieldMappingSchema = new mongoose.Schema({
  name: { type: String, required: true },
  businessUnit: { type: String, enum: BUSINESS_UNITS, index: true },
  serviceLine: { type: String, enum: SERVICE_LINES, index: true },
  mappings: {
    name: [String],
    companyName: [String],
    phone: [String],
    email: [String],
    phones: [String],
    emails: [String],
    country: [String],
    city: [String],
    notes: [String]
  },
  customFieldMappings: { type: mongoose.Schema.Types.Mixed, default: {} },
  active: { type: Boolean, default: true, index: true }
}, { timestamps: true });

module.exports = mongoose.model('FieldMapping', fieldMappingSchema);
