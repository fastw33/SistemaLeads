'use strict';

const mongoose = require('mongoose');
const { BUSINESS_UNITS } = require('../shared/business.constants');

const catalogSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
    index: true
  },
  code: {
    type: String,
    required: true,
    trim: true
  },
  label: {
    type: String,
    required: true,
    trim: true
  },
  businessUnit: {
    type: String,
    enum: BUSINESS_UNITS,
    index: true
  },
  description: String,
  active: {
    type: Boolean,
    default: true,
    index: true
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, { timestamps: true });

catalogSchema.index({ type: 1, code: 1, businessUnit: 1 }, { unique: true });

module.exports = mongoose.model('Catalog', catalogSchema);
