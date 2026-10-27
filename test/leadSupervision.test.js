'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { supervisionTimeline } = require('../src/modules/leads/leadSupervision');

test('preexisting supervision notes retain their authors, dates and independent response in the history', () => {
  const review = { _id: 'review-1', leadId: 'lead-1', note: 'Primera línea\nSegunda línea', status: 'pending', createdAt: new Date('2026-10-20T14:00:00Z'), dueAt: new Date('2026-11-01T14:00:00Z'), createdBy: { id: 'manager', name: 'Gerencia' } };
  const original = structuredClone(review);
  const pending = supervisionTimeline([review]);
  assert.equal(pending.length, 1); assert.equal(pending[0].detail, review.note);
  assert.equal(pending[0].actor.name, 'Gerencia'); assert.equal(pending[0].at, review.createdAt);
  assert.equal(pending[0].type, 'supervision'); assert.equal(pending[0].eventId, undefined);
  const resolved = supervisionTimeline([{ ...review, status: 'resolved', resolution: 'Volumen confirmado', resolvedAt: new Date('2026-10-22T14:00:00Z'), resolvedBy: { id: 'advisor' } }]);
  assert.equal(resolved.length, 2); assert.equal(new Set(resolved.map(item => item.id)).size, 2);
  assert.equal(resolved[0].detail, review.note); assert.equal(resolved[1].detail, 'Volumen confirmado');
  assert.equal(resolved[1].actor.id, 'advisor'); assert.equal(resolved[1].note, review.note);
  assert.deepEqual(review, original);
});

test('new review notification targets only the responsible advisor and opens the correct lead', async t => {
  const client = require('../src/integrations/tareas/tareas.client');
  let sent;
  t.mock.method(client, 'createSystemNotification', async (payload, bearer) => { sent = { payload, bearer }; return { created: 1 }; });
  const notifications = require('../src/modules/notifications/leadNotification.service');
  const args = { lead: { _id: 'lead-1', code: 'LH-1', assignedAdvisorId: 'advisor-1' }, review: { _id: 'review-1', note: 'Confirmar volumen' }, actor: { id: 'manager-1' }, bearerToken: 'test-only' };
  await notifications.notifySupervisionReview(args);
  assert.deepEqual(sent.payload.to_ids, ['advisor-1']); assert.equal(sent.bearer, 'test-only');
  assert.equal(sent.payload.type, 'comercial.supervision'); assert.match(sent.payload.body, /Confirmar volumen/);
  assert.equal(sent.payload.meta.reviewId, 'review-1'); assert.match(sent.payload.target.url, /leadId=lead-1/);
  t.mock.method(client, 'createSystemNotification', async () => { throw new Error('Integration unavailable'); });
  const failed = await notifications.notifySupervisionReview(args);
  assert.equal(failed.failed, true, 'a notification outage must not prevent saving the supervision note');
});
