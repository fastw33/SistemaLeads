'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validationResult } = require('express-validator');
const { assertFutureDate } = require('../src/modules/shared/futureDate');
const { validateAction } = require('../src/modules/leads/lead.validator');
const { validateCreate: followUpValidators } = require('../src/modules/followUps/followUp.validator');
const { validateCreate: meetingValidators } = require('../src/modules/meetings/meeting.validator');
const { validateComplete, validateFinishEnrichment } = require('../src/modules/campaignQueue/campaignQueue.validator');
const leadId = '000000000000000000000001';

test('a future action excludes past dates, earlier hours today and the exact present', () => {
  const now = Date.parse('2026-10-15T15:11:30Z');
  for (const value of ['', null, 'bad', '2026-10-14T15:11:30Z', '2026-10-15T10:10:00-05:00', '2026-10-15T10:11:30-05:00']) {
    assert.throws(() => assertFutureDate(value, now), error => error.statusCode === 400);
  }
  assert.equal(assertFutureDate('2026-10-15T10:12:00-05:00', now).toISOString(), '2026-10-15T15:12:00.000Z');
  const selected = '2026-10-15T15:12:00Z';
  assert.throws(() => assertFutureDate(selected, now + 120000), /futuras/, 'a previously valid selection expires while the form remains open');
});

async function errors(validators, body) {
  const req = { body, params: { id: leadId } };
  for (const validator of validators) await validator.run(req);
  return validationResult(req).array();
}

test('API validators reject past scheduling for every action and accept future dates', async () => {
  const past = new Date(Date.now() - 60000).toISOString();
  const future = new Date(Date.now() + 3600000).toISOString();
  for (const channel of ['phone', 'whatsapp', 'email', 'meeting', 'visit', 'pickup']) {
    const body = { channel, outcome: 'follow_up_required', nextActionType: channel, nextActionAt: past };
    assert.ok((await errors(validateAction, body)).some(error => error.path === 'nextActionAt' && /futuras/.test(error.msg)));
    assert.equal((await errors(validateAction, { ...body, nextActionAt: future })).length, 0);
  }
  for (const [validators, body, field] of [
    [followUpValidators, { leadId, dueAt: past }, 'dueAt'],
    [meetingValidators, { leadId, title: 'Reunión', startsAt: past }, 'startsAt'],
    [validateComplete, { outcome: 'no_answer', nextAttemptAt: past }, 'nextAttemptAt'],
    [validateFinishEnrichment, { result: 'follow_up', channel: 'phone', note: 'Volver a llamar', nextAttemptAt: past }, 'nextAttemptAt']
  ]) {
    assert.ok((await errors(validators, body)).some(error => error.path === field && /futuras/.test(error.msg)));
    assert.equal((await errors(validators, { ...body, [field]: future })).length, 0);
  }
  assert.equal((await errors(validateAction, { channel: 'phone', outcome: 'contacted', nextActionType: 'none', nextActionAt: '', nextFollowUpAt: '' })).length, 0);
});
