'use strict';

const mongoose = require('mongoose');
const { BUSINESS_UNITS, SERVICE_LINES } = require('../shared/business.constants');
const { externalRefSchema } = require('../shared/schema.helpers');

const advisorProfileSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  email: String,
  active: { type: Boolean, default: true, index: true },
  businessUnits: [{ type: String, enum: BUSINESS_UNITS }],
  serviceLines: [{ type: String, enum: SERVICE_LINES }],
  countries: [String],
  dailyCapacity: { type: Number, default: 0 },
  currentLoad: { type: Number, default: 0 },
  externalRefs: [externalRefSchema],
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

module.exports = mongoose.model('AdvisorProfile', advisorProfileSchema);
