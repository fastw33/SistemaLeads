'use strict';

const Counter = require('./counter.model');

async function nextCode(prefix) {
  const counter = await Counter.findOneAndUpdate(
    { key: prefix },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  ).lean();

  return `${prefix}-${counter.seq}`;
}

async function nextLeadCode(businessUnit) {
  const unit = String(businessUnit || '').trim().toLowerCase();
  const prefix = unit === 'fastway'
    ? 'LF'
    : unit === 'harvest'
      ? 'LH'
      : unit === 'greenway'
        ? 'LG'
        : 'L';
  const counter = await Counter.findOneAndUpdate(
    { key: `LEAD:${prefix}` },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  ).lean();

  return `${prefix}-${counter.seq}`;
}

module.exports = { nextCode, nextLeadCode };
