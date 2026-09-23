'use strict';

const mongoose = require('mongoose');

const meetingSchema = new mongoose.Schema({
  leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
  followUpId: { type: mongoose.Schema.Types.ObjectId, ref: 'FollowUp', index: true, unique: true, sparse: true },
  requestId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommercialRequest', index: true },
  advisorId: { type: String, required: true, index: true },
  advisorName: String,
  title: { type: String, required: true },
  startsAt: { type: Date, required: true, index: true },
  endsAt: Date,
  channel: { type: String, enum: ['teams', 'meet', 'phone', 'presential', 'other'], default: 'presential' },
  location: String,
  attendees: [{
    personalId: { type: String, trim: true },
    name: String,
    email: String,
    role: String
  }],
  status: {
    type: String,
    enum: ['scheduled', 'completed', 'cancelled', 'failed_integration'],
    default: 'scheduled',
    index: true
  },
  meetingUrl: String,
  microsoft: {
    eventId: String,
    calendarId: String,
    response: mongoose.Schema.Types.Mixed,
    syncedAt: Date
  },
  result: {
    outcome: String,
    notes: String,
    completedAt: Date
  },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

meetingSchema.index({ advisorId: 1, startsAt: 1 });
meetingSchema.index({ 'attendees.personalId': 1, startsAt: 1 });

module.exports = mongoose.model('Meeting', meetingSchema);
