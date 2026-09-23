'use strict';

const mongoose = require('mongoose');
const { actorSchema } = require('../shared/schema.helpers');

const attachmentSchema = new mongoose.Schema({
  entityType: { type: String, required: true, index: true },
  entityId: { type: String, required: true, index: true },
  fileName: { type: String, required: true },
  mimeType: String,
  size: Number,
  storage: { type: String, enum: ['local', 's3', 'external'], default: 'local' },
  path: String,
  url: String,
  uploadedBy: actorSchema,
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

module.exports = mongoose.model('Attachment', attachmentSchema);
