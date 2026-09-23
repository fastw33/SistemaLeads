'use strict';

const mongoose = require('mongoose');
const { actorSchema } = require('../shared/schema.helpers');

const pricingSettingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, index: true },
  discountPercent: { type: Number, min: 0, max: 100, default: 0 },
  markupPercent: { type: Number, min: 0, max: 100 },
  updatedBy: actorSchema
}, { timestamps: true });

module.exports = mongoose.model('PricingSetting', pricingSettingSchema);
