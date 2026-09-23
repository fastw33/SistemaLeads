'use strict';

const mongoose = require('mongoose');

const integrationLogSchema = new mongoose.Schema({
  system: { type: String, required: true, index: true },
  operation: { type: String, required: true, index: true },
  request: mongoose.Schema.Types.Mixed,
  response: mongoose.Schema.Types.Mixed,
  status: { type: String, enum: ['success', 'failed'], required: true, index: true },
  statusCode: Number,
  errorMessage: String,
  relatedEntity: {
    type: String,
    id: String
  }
}, { timestamps: true });

integrationLogSchema.index({ system: 1, createdAt: -1 });

module.exports = mongoose.model('IntegrationLog', integrationLogSchema);
