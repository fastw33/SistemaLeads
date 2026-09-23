'use strict';

const mongoose = require('mongoose');
const { actorSchema } = require('../shared/schema.helpers');

const importJobSchema = new mongoose.Schema({
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
  status: { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending', index: true },
  fileName: String,
  sheetName: String,
  totalRows: { type: Number, default: 0 },
  processedRows: { type: Number, default: 0 },
  validRows: { type: Number, default: 0 },
  duplicateRows: { type: Number, default: 0 },
  incompleteRows: { type: Number, default: 0 },
  rowErrors: [{
    rowNumber: Number,
    message: String,
    rawData: mongoose.Schema.Types.Mixed
  }],
  createdBy: actorSchema,
  completedAt: Date
}, { timestamps: true });

module.exports = mongoose.model('ImportJob', importJobSchema);
