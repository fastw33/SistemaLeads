'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const express = require('express');

test('supervision closure and evidence use a disposable database', { skip: process.env.RUN_TRACKING_DB_TESTS !== 'true', timeout: 60000 }, async t => {
  require('dotenv').config();
  const dbName = `codex_supervision_actions_${Date.now()}_${process.pid}`;
  await mongoose.connect(process.env.MONGO_URI, { dbName, autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db;
  let uploads = 0;
  t.mock.method(require('../src/modules/leads/leadPublic.storage'), 'uploadLeadFiles', async ({ files = [] }) => {
    uploads += files.length;
    return files.map(file => ({ fileName: file.originalname, mimeType: file.mimetype, size: file.buffer?.length || 5, storage: 's3', path: `test/${file.originalname}`, metadata: { bucket: 'test-only' } }));
  });
  t.mock.method(require('../src/modules/notifications/leadNotification.service'), 'notifySupervisionReview', async () => ({ created: 0 }));
  t.mock.method(require('../src/modules/audit/audit.service'), 'record', async () => {});
  const service = require('../src/modules/leads/lead.service');
  const supervisor = { user: { id: 'manager', name: 'Gerencia', permisos: { leadsSeguimiento: true, leadsHarvest: true } }, headers: {} };
  const advisor = { user: { id: 'advisor', name: 'Asesor', permisos: { leadsHarvest: true } }, headers: {} };
  const leadId = new mongoose.Types.ObjectId();
  const otherId = new mongoose.Types.ObjectId();
  const at = new Date('2026-10-20T12:00:00Z');
  const lead = { _id: leadId, code: 'LH-TEST', businessUnit: 'Harvest', status: 'assigned', assignedAdvisorId: 'advisor', assignedAdvisorName: 'Asesor', lastContactAt: at, customFields: { lastManagedAt: at, lastNote: 'Contacto del asesor', nextStep: 'Llamar', nextAction: { type: 'phone' } }, createdAt: at };
  let review;
  try {
    await db.collection('leads').insertMany([lead, { ...lead, _id: otherId, code: 'LH-OTHER' }]);
    await t.test('multipart creation and later additions remain tied to the supervisor note', async () => {
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => { req.user = supervisor.user; next(); });
      app.use('/leads', require('../src/modules/leads/lead.routes'));
      app.use(require('../src/middlewares/errorHandler'));
      const server = app.listen(0, '127.0.0.1');
      await new Promise(resolve => server.once('listening', resolve));
      const base = `http://127.0.0.1:${server.address().port}/leads/${leadId}`;
      try {
        const form = new FormData();
        form.append('note', 'Revisar documentos adjuntos antes de llamar');
        form.append('dueAt', new Date(Date.now() + 86400000).toISOString());
        form.append('files', new Blob(['photo'], { type: 'image/jpeg' }), 'foto.jpg');
        form.append('files', new Blob(['document'], { type: 'application/pdf' }), 'soporte.pdf');
        const created = await fetch(`${base}/reviews`, { method: 'POST', body: form });
        assert.equal(created.status, 201); review = await created.json();
        assert.equal(review.attachments.length, 2);
        assert.ok(review.attachments.every(file => file.metadata.reviewId === review._id));
        const more = new FormData(); more.append('files', new Blob(['acta']), 'acta.txt');
        const appended = await fetch(`${base}/reviews/${review._id}/attachments`, { method: 'POST', body: more });
        assert.equal(appended.status, 201);
        const invalidClose = await fetch(`${base}/supervision/close`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: '' }) });
        assert.equal(invalidClose.status, 400);
      } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
      const items = await service.listReviews(String(leadId), advisor);
      assert.equal(items[0].attachments.length, 3);
      const stored = await db.collection('attachments').find({ entityId: String(leadId) }).toArray();
      assert.ok(stored.every(file => file.uploadedBy.id === 'manager' && file.metadata.supervision === true));
      const history = await service.contactIntelligence({ leadId: String(leadId), timelineScope: 'lead' }, advisor);
      assert.equal(history.attachments.filter(file => file.metadata.reviewId === review._id).length, 3);
      assert.equal(history.timeline.find(item => item.reviewId === review._id).detail, review.note);
    });
    await t.test('operators cannot close leads or attach evidence as a supervisor; invalid input has no side effects', async () => {
      const before = uploads;
      await assert.rejects(service.closeBySupervision(String(leadId), { reason: 'No continuará' }, advisor), err => err.statusCode === 403);
      await assert.rejects(service.closeBySupervision(String(leadId), { reason: ' ' }, supervisor), err => err.statusCode === 400);
      await assert.rejects(service.closeBySupervision(String(leadId), { reason: 'No continuará' }, { ...supervisor, user: { ...supervisor.user, permisos: { leadsSeguimiento: true, leadsFastway: true } } }), err => err.statusCode === 403);
      await assert.rejects(service.addReviewAttachments(String(leadId), review._id, { ...advisor, files: [{ originalname: 'no.txt' }] }), err => err.statusCode === 403);
      await assert.rejects(service.addReviewAttachments(String(otherId), review._id, { ...supervisor, files: [{ originalname: 'wrong.txt' }] }), err => err.statusCode === 404);
      assert.equal(uploads, before);
      assert.equal((await db.collection('leads').findOne({ _id: leadId })).status, 'assigned');
    });
    await t.test('closure records a supervisor decision and cancels outstanding work without fabricating an advisor response', async () => {
      await db.collection('followups').insertOne({ leadId, assignedAdvisorId: 'advisor', status: 'pending', channel: 'visit', dueAt: new Date(Date.now() + 86400000) });
      await db.collection('meetings').insertOne({ leadId, status: 'scheduled', startsAt: new Date(Date.now() + 86400000) });
      const reason = 'Empresa confirmó que no continuará con la solicitud';
      const closed = await service.closeBySupervision(String(leadId), { reason }, supervisor);
      assert.equal(closed.lead.status, 'lost'); assert.equal(closed.lead.closedReason, reason);
      const stored = await db.collection('leads').findOne({ _id: leadId });
      assert.equal(stored.nextFollowUpAt, null); assert.equal(stored.customFields.nextStep, '');
      assert.equal(stored.lastContactAt.getTime(), at.getTime()); assert.equal(stored.customFields.lastNote, 'Contacto del asesor');
      assert.equal((await db.collection('followups').findOne({ leadId })).status, 'cancelled');
      assert.equal((await db.collection('meetings').findOne({ leadId })).status, 'cancelled');
      const resolved = await db.collection('leadreviews').findOne({ _id: new mongoose.Types.ObjectId(review._id) });
      assert.equal(resolved.resolutionType, 'lead_closed'); assert.equal(resolved.resolvedBy.id, 'manager');
      assert.equal(resolved.note, review.note); assert.match(resolved.resolution, /Empresa confirmó/);
      assert.equal((await service.pendingReviews({}, advisor)).total, 0);
      const history = await service.contactIntelligence({ leadId: String(leadId), timelineScope: 'lead' }, advisor);
      const closure = history.timeline.find(item => item.type === 'supervision_closure');
      assert.equal(closure.detail, reason); assert.equal(closure.actor.id, 'manager');
      assert.equal(history.timeline.filter(item => item.type === 'supervision_response').length, 0, 'closing a lead is not an advisor response');
      assert.equal(history.timeline.find(item => item.reviewId === review._id).resolutionType, 'lead_closed');
      assert.equal(history.attachments.length, 3);
      await assert.rejects(service.closeBySupervision(String(leadId), { reason: 'Otro cierre' }, supervisor), err => err.statusCode === 409);
      await assert.rejects(service.registerAction(String(leadId), { channel: 'phone', outcome: 'contacted' }, advisor), err => err.statusCode === 409);
      await assert.rejects(service.addEventAttachments(String(leadId), String(closed.event._id), { ...advisor, files: [{ originalname: 'no.txt' }] }), err => err.statusCode === 403);
      assert.equal(await db.collection('leadevents').countDocuments({ leadId, outcome: 'supervision_closed' }), 1);
      await assert.rejects(service.createReview(String(leadId), { note: 'Nueva tarea', dueAt: new Date(Date.now() + 86400000) }, supervisor), err => err.statusCode === 409);
    });
  } finally {
    assert.ok(db.databaseName.startsWith('codex_supervision_actions_'));
    await db.dropDatabase(); await mongoose.disconnect();
  }
});
