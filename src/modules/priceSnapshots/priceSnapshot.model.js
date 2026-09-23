'use strict';

const mongoose = require('mongoose');
const { actorSchema } = require('../shared/schema.helpers');

const priceSnapshotSchema = new mongoose.Schema({
  leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
  requestId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommercialRequest', index: true },
  source: {
    type: String,
    enum: ['local_prices', 'lme', 'tungsteno', 'logistics', 'manual'],
    required: true,
    index: true
  },
  materialId: String,
  priceHistoryId: String,
  material: String,
  section: String,
  observedAt: Date,
  suggestedPrice: Number,
  informedPrice: Number,
  currency: String,
  unit: String,
  notes: String,
  informed: { type: Boolean, default: false, index: true },
  informedAt: Date,
  actor: actorSchema,
  context: { type: mongoose.Schema.Types.Mixed, default: {} },
  sourcePayload: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

priceSnapshotSchema.index({ leadId: 1, createdAt: -1 });

module.exports = mongoose.model('PriceSnapshot', priceSnapshotSchema);
