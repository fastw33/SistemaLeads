'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const Lead = require('../src/modules/leads/lead.model');
const LeadEvent = require('../src/modules/leadEvents/leadEvent.model');
const Attachment = require('../src/modules/attachments/attachment.model');
const storage = require('../src/modules/leads/leadPublic.storage');
const audit = require('../src/modules/audit/audit.service');

test('multiple evidences remain bound to the original event and respect lead permissions', async t => {
  const leadId = '507f1f77bcf86cd799439011';
  const eventId = '507f1f77bcf86cd799439012';
  const lead = { _id: leadId, code: 'LH-TEST', assignedAdvisorId: 'advisor', businessUnit: 'Harvest' };
  const event = { _id: eventId, leadId, channel: 'whatsapp', outcome: 'contacted', notes: 'Original', metadata: { attachmentCount: 1 } };
  const req = { user: { id: 'advisor', name: 'Asesor', permisos: { leadsHarvest: true } }, headers: {}, files: [] };
  const records = [];
  const increments = [];
  let uploads = 0;
  t.mock.method(Lead, 'findById', async () => lead);
  t.mock.method(LeadEvent, 'findOne', filter => ({ lean: async () => filter.leadId === leadId && filter._id === eventId ? event : null }));
  t.mock.method(LeadEvent, 'updateOne', async (filter, update) => { increments.push(update); });
  t.mock.method(Attachment, 'insertMany', async files => files.map((file, index) => {
    const stored = { ...file, _id: `attachment-${records.length + index}` }; records.push(stored); return stored;
  }));
  t.mock.method(audit, 'record', async () => {});
  t.mock.method(storage, 'uploadLeadFiles', async ({ files }) => {
    uploads++;
    return files.map(file => ({ fileName: file.originalname, mimeType: file.mimetype, size: 5, storage: 's3', path: file.originalname, metadata: { bucket: 'test' } }));
  });
  // The service captures the storage function on import. No MongoDB or S3 connection is used.
  const service = require('../src/modules/leads/lead.service');
  await t.test('rejects another advisor, another line, another event and empty uploads before storage', async () => {
    await assert.rejects(service.addEventAttachments(leadId, eventId, { ...req, user: { ...req.user, id: 'other' } }), err => err.statusCode === 403);
    await assert.rejects(service.addEventAttachments(leadId, eventId, { ...req, user: { ...req.user, permisos: { leadsFastway: true } } }), err => err.statusCode === 403);
    await assert.rejects(service.addEventAttachments(leadId, '507f1f77bcf86cd799439099', req), err => err.statusCode === 404);
    await assert.rejects(service.addEventAttachments(leadId, eventId, req), err => err.statusCode === 400);
    assert.equal(uploads, 0); assert.equal(records.length, 0);
  });
  await t.test('adds photos and documents in successive batches without editing the conversation', async () => {
    const before = structuredClone(event);
    const first = await service.addEventAttachments(leadId, eventId, { ...req, files: [{ originalname: 'foto.jpg', mimetype: 'image/jpeg' }, { originalname: 'propuesta.pdf', mimetype: 'application/pdf' }] });
    const second = await service.addEventAttachments(leadId, eventId, { ...req, files: [{ originalname: 'acta.docx', mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }] });
    assert.equal(first.attachments.length, 2); assert.equal(second.attachments.length, 1);
    assert.ok(records.every(file => file.metadata.eventId === eventId && file.entityId === leadId && file.uploadedBy.id === 'advisor'));
    assert.equal(first.attachments[0].isPhoto, true);
    assert.deepEqual(increments, [{ $inc: { 'metadata.attachmentCount': 2 } }, { $inc: { 'metadata.attachmentCount': 1 } }]);
    assert.deepEqual(event, before);
  });
  await t.test('multipart route accepts multiple files and reports invalid ids and upload limits', async () => {
    const app = express();
    app.use((request, _response, next) => { request.user = req.user; next(); });
    app.use('/api/leads', require('../src/modules/leads/lead.routes'));
    app.use(require('../src/middlewares/errorHandler'));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/leads`;
    const form = count => {
      const data = new FormData();
      for (let index = 0; index < count; index++) data.append('files', new Blob(['evidence']), `file-${index}.txt`);
      return data;
    };
    try {
      const success = await fetch(`${base}/${leadId}/events/${eventId}/attachments`, { method: 'POST', body: form(2) });
      assert.equal(success.status, 201);
      assert.equal((await success.json()).attachments.length, 2);
      const invalid = await fetch(`${base}/${leadId}/events/invalid/attachments`, { method: 'POST', body: form(1) });
      assert.equal(invalid.status, 400);
      const tooMany = await fetch(`${base}/${leadId}/events/${eventId}/attachments`, { method: 'POST', body: form(11) });
      assert.equal(tooMany.status, 400); assert.match((await tooMany.json()).message, /máximo 10/);
      const oversized = new FormData();
      oversized.append('files', new Blob([new Uint8Array(20 * 1024 * 1024 + 1)]), 'large.bin');
      const tooLarge = await fetch(`${base}/${leadId}/events/${eventId}/attachments`, { method: 'POST', body: oversized });
      assert.equal(tooLarge.status, 400); assert.match((await tooLarge.json()).message, /20 MB/);
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
});
