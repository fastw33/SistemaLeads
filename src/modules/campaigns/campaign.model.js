'use strict';

const mongoose = require('mongoose');
const { BUSINESS_UNITS, SERVICE_LINES } = require('../shared/business.constants');
const { actorSchema } = require('../shared/schema.helpers');

const campaignSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  code: { type: String, unique: true, sparse: true, index: true },
  objective: { type: String, trim: true },
  businessUnit: { type: String, enum: BUSINESS_UNITS, required: true, index: true },
  serviceLine: { type: String, enum: SERVICE_LINES, required: true, index: true },
  targetAccountType: { type: String, enum: ['customer', 'supplier', 'buyer', 'mixed', 'unknown'], default: 'unknown' },
  country: { type: String, index: true },
  startsAt: Date,
  endsAt: Date,
  status: { type: String, enum: ['draft', 'active', 'paused', 'closed'], default: 'draft', index: true },
  startedAt: Date,
  pausedUntil: { type: Date, index: true },
  stoppedAt: Date,
  responsibleId: { type: String, trim: true, index: true },
  responsibleName: { type: String, trim: true },
  advisorIds: [String],
  assignmentStrategy: {
    type: String,
    enum: ['round_robin', 'priority', 'manual'],
    default: 'round_robin'
  },
  fieldMappingId: { type: mongoose.Schema.Types.ObjectId, ref: 'FieldMapping' },
  recordSequence: { type: Number, default: 0 },
  fieldConfiguration: [{
    key: { type: String, required: true },
    label: { type: String, required: true },
    kind: { type: String, enum: ['text', 'url', 'select', 'phones', 'emails', 'contacts'], default: 'text' },
    sourceHeaders: [String],
    visibleToAdvisor: { type: Boolean, default: true },
    editableByAdvisor: { type: Boolean, default: false },
    order: { type: Number, default: 0 }
  }],
  stats: {
    imported: { type: Number, default: 0 },
    queued: { type: Number, default: 0 },
    worked: { type: Number, default: 0 },
    duplicated: { type: Number, default: 0 },
    incomplete: { type: Number, default: 0 }
  },
  createdBy: actorSchema,
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

campaignSchema.index({ businessUnit: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('Campaign', campaignSchema);
