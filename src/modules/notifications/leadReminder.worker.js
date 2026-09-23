'use strict';

const FollowUp = require('../followUps/followUp.model');
const Lead = require('../leads/lead.model');
const logger = require('../../utils/logger');
const { notifyFollowUpReminder } = require('./leadNotification.service');

const TEN_MINUTES_MS = 10 * 60 * 1000;
const CLAIM_TIMEOUT_MS = 2 * 60 * 1000;
const RETRY_DELAY_MS = 60 * 1000;
const MAX_PER_RUN = 100;

let timer = null;
let running = false;

async function claimNextReminder(now) {
  const reminderLimit = new Date(now.getTime() + TEN_MINUTES_MS);
  const staleClaim = new Date(now.getTime() - CLAIM_TIMEOUT_MS);

  return FollowUp.findOneAndUpdate(
    {
      status: 'pending',
      dueAt: { $gt: now, $lte: reminderLimit },
      $and: [
        {
          $or: [
            { 'metadata.reminder10SentAt': { $exists: false } },
            { 'metadata.reminder10SentAt': null }
          ]
        },
        {
          $or: [
            { 'metadata.reminder10ClaimedAt': { $exists: false } },
            { 'metadata.reminder10ClaimedAt': null },
            { 'metadata.reminder10ClaimedAt': { $lt: staleClaim } }
          ]
        },
        {
          $or: [
            { 'metadata.reminder10NextAttemptAt': { $exists: false } },
            { 'metadata.reminder10NextAttemptAt': null },
            { 'metadata.reminder10NextAttemptAt': { $lte: now } }
          ]
        }
      ]
    },
    {
      $set: {
        'metadata.reminder10ClaimedAt': now,
        'metadata.reminder10AttemptedAt': now
      },
      $inc: { 'metadata.reminder10Attempts': 1 }
    },
    { new: true, sort: { dueAt: 1 } }
  ).lean();
}

async function processLeadReminders() {
  if (running) return;
  running = true;

  try {
    for (let index = 0; index < MAX_PER_RUN; index += 1) {
      const now = new Date();
      const followUp = await claimNextReminder(now);
      if (!followUp) break;

      try {
        const lead = await Lead.findById(followUp.leadId)
          .select('_id code name companyName businessUnit')
          .lean();

        if (!lead) {
          await FollowUp.updateOne(
            { _id: followUp._id },
            {
              $set: {
                'metadata.reminder10SentAt': now,
                'metadata.reminder10Result': 'lead_not_found'
              },
              $unset: { 'metadata.reminder10ClaimedAt': 1 }
            }
          );
          continue;
        }

        const result = await notifyFollowUpReminder({ lead, followUp });
        await FollowUp.updateOne(
          { _id: followUp._id },
          {
            $set: {
              'metadata.reminder10SentAt': new Date(),
              'metadata.reminder10Result': result
            },
            $unset: {
              'metadata.reminder10ClaimedAt': 1,
              'metadata.reminder10NextAttemptAt': 1,
              'metadata.reminder10LastError': 1
            }
          }
        );
      } catch (error) {
        await FollowUp.updateOne(
          { _id: followUp._id },
          {
            $set: {
              'metadata.reminder10NextAttemptAt': new Date(Date.now() + RETRY_DELAY_MS),
              'metadata.reminder10LastError': error.message
            },
            $unset: { 'metadata.reminder10ClaimedAt': 1 }
          }
        );
        logger.warn('lead_reminder_failed', {
          followUpId: String(followUp._id),
          message: error.message
        });
      }
    }
  } catch (error) {
    logger.error('lead_reminder_worker_error', {
      message: error.message,
      stack: error.stack
    });
  } finally {
    running = false;
  }
}

function startLeadReminderWorker() {
  if (timer) return timer;

  const intervalMs = Math.max(
    Number(process.env.LEAD_REMINDER_INTERVAL_MS || 30000),
    10000
  );

  setTimeout(processLeadReminders, 3000).unref();
  timer = setInterval(processLeadReminders, intervalMs);
  timer.unref();
  logger.info('Recordatorios comerciales activos', { intervalMs });
  return timer;
}

module.exports = {
  processLeadReminders,
  startLeadReminderWorker
};
