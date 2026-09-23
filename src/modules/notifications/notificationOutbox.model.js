'use strict';

const mongoose = require('mongoose');

const notificationOutboxSchema = new mongoose.Schema({
  channel: { type: String, enum: ['email', 'teams', 'internal', 'whatsapp'], required: true, index: true },
  recipient: {
    userId: String,
    email: String,
    phone: String,
    name: String
  },
  subject: String,
  body: String,
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  status: { type: String, enum: ['pending', 'sent', 'failed', 'cancelled'], default: 'pending', index: true },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now, index: true },
  sentAt: Date,
  lastError: String
}, { timestamps: true });

module.exports = mongoose.model('NotificationOutbox', notificationOutboxSchema);
