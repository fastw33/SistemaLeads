'use strict';

const mongoose = require('mongoose');
const { ACCOUNT_TYPES, BUSINESS_UNITS, SERVICE_LINES } = require('../shared/business.constants');
const { externalRefSchema } = require('../shared/schema.helpers');

const accountSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, index: true },
  normalizedName: { type: String, index: true },
  type: { type: String, enum: ACCOUNT_TYPES, required: true, index: true },
  businessUnit: { type: String, enum: BUSINESS_UNITS, required: true, index: true },
  serviceLines: [{ type: String, enum: SERVICE_LINES }],
  country: { type: String, index: true },
  taxId: { type: String, index: true },
  supplierClassification: {
    code: String,
    label: String,
    catalogId: { type: mongoose.Schema.Types.ObjectId, ref: 'Catalog' }
  },
  fixedProvider: { type: Boolean, default: false, index: true },
  buyerProfile: {
    materials: [String],
    targetCountries: [String],
    notes: String
  },
  contactSummary: {
    mainContactName: String,
    mainPhone: String,
    mainEmail: String
  },
  externalRefs: [externalRefSchema],
  customFields: { type: mongoose.Schema.Types.Mixed, default: {} },
  sourcePayload: { type: mongoose.Schema.Types.Mixed, default: {} },
  active: { type: Boolean, default: true, index: true }
}, { timestamps: true });

accountSchema.index({ businessUnit: 1, type: 1, country: 1 });
accountSchema.index({ taxId: 1, country: 1 }, { sparse: true });

module.exports = mongoose.model('Account', accountSchema);
