'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

// Explicit opt-in: all fixtures live in a new temporary database, never the configured application database.
test('tracking pagination, history completeness and supervision against MongoDB', { skip: process.env.RUN_TRACKING_DB_TESTS !== 'true', timeout: 90000 }, async t => {
  require('dotenv').config();
  const dbName = `codex_tracking_test_${Date.now()}_${process.pid}`;
  await mongoose.connect(process.env.MONGO_URI, { dbName, autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000 });
  t.mock.method(require('../src/modules/notifications/leadNotification.service'), 'notifySupervisionReview', async () => ({ created: 0 }));
  const service = require('../src/modules/leads/lead.service');
  const db = mongoose.connection.db;
  const id = () => new mongoose.Types.ObjectId();
  const supervisor = { user: { id: 'supervisor', name: 'Supervisión', permisos: { leadsSeguimiento: true, leadsHarvest: true } } };
  const advisor = { user: { id: 'a-1', name: 'Asesor Uno', permisos: { leadsHarvest: true } } };
  const now = new Date();
  const leads = Array.from({ length: 137 }, (_, index) => ({ _id: id(), code: `TEST-${index}`, name: `Lead ${index}`, businessUnit: 'Harvest', serviceLine: 'metales', status: 'assigned', assignedAdvisorId: index < 100 ? 'a-1' : 'a-2', assignedAdvisorName: index < 100 ? 'Asesor Uno' : 'Asesor Dos', createdAt: new Date('2026-10-15T12:00:00Z'), phones: [{ normalized: '1234' }] }));
  leads.push({ ...leads[0], _id: id(), code: 'INTAKE', status: 'incomplete' }, { ...leads[0], _id: id(), code: 'DISCARDED', status: 'discarded' }, { ...leads[0], _id: id(), code: 'OTHER-LINE', businessUnit: 'Greenway' });
  const selected = leads[0];
  const campaignId = id();
  const comment = 'Comentario íntegro\n' + 'Información relevante para supervisión. '.repeat(80);
  try {
    await db.collection('leads').insertMany(leads);
    await db.collection('leadevents').insertMany(Array.from({ length: 75 }, (_, index) => ({ _id: id(), leadId: selected._id, type: 'call', channel: 'phone', outcome: 'no_answer', notes: `${index}: ${comment}`, actor: { id: 'a-1', name: 'Asesor Uno' }, createdAt: new Date(now.getTime() - index * 60000) })));
    await db.collection('followups').insertMany([
      { _id: id(), leadId: selected._id, assignedAdvisorId: 'a-1', channel: 'phone', status: 'pending', reason: 'Compromiso vencido', dueAt: new Date(now.getTime() - 86400000), createdAt: now },
      { _id: id(), leadId: selected._id, assignedAdvisorId: 'a-1', channel: 'visit', status: 'done', reason: 'Visita programada', dueAt: new Date(now.getTime() - 86400000), completedAt: now, metadata: { comment: 'Resultado completo de visita', result: 'contacted' }, createdAt: now }
    ]);
    await db.collection('campaigns').insertOne({ _id: campaignId, businessUnit: 'Harvest', name: 'Campaña vinculada' });
    await db.collection('campaignrecords').insertOne({ _id: id(), code: 'RECORD', campaignId, leadId: selected._id, status: 'worked', createdAt: now, changeHistory: [{ fieldKey: 'contact_result', result: 'contacted', note: 'Comentario anterior a la conversión', actorName: 'Asesor Uno', changedAt: now }] });

    await t.test('all 137 active leads remain reachable with stable pages and complete advisor filters', async () => {
      const first = await service.tracking({ limit: 100 }, supervisor);
      const second = await service.tracking({ page: 2, limit: 100 }, supervisor);
      assert.equal(first.total, 137); assert.equal(first.items.length, 100); assert.equal(second.items.length, 37);
      assert.equal(new Set([...first.items, ...second.items].map(item => String(item._id))).size, 137);
      assert.equal(first.views.all, 139); assert.equal(first.advisors.length, 2);
      const filtered = await service.tracking({ assignedAdvisorId: 'a-2', limit: 100 }, supervisor);
      assert.equal(filtered.total, 37); assert.ok(filtered.items.every(item => item.assignedAdvisorId === 'a-2'));
      const mine = await service.tracking({ limit: 100 }, advisor);
      assert.equal(mine.total, 100);
      const all = await service.tracking({ view: 'all', limit: 100 }, supervisor);
      assert.equal(all.total, 139);
      const closures = await service.tracking({ view: 'closures' }, supervisor);
      assert.equal(closures.items[0].status, 'discarded');
    });
    await t.test('won, unsuccessful and discarded views have independent totals and preserve filters', async () => {
      const fixtures = ['won', 'purchase_completed', 'lost', 'do_not_contact'].map((status, index) => ({
        ...leads[0], _id: id(), code: `CLOSURE-${status}`, status,
        assignedAdvisorId: index % 2 ? 'a-2' : 'a-1',
        closedAt: new Date('2026-10-16T04:59:59Z')
      }));
      fixtures.push({ ...fixtures[0], _id: id(), businessUnit: 'Greenway' });
      await db.collection('leads').insertMany(fixtures);
      try {
        const won = await service.tracking({ view: 'won', limit: 1 }, supervisor);
        const second = await service.tracking({ view: 'won', limit: 1, page: 2 }, supervisor);
        assert.equal(won.total, 2); assert.equal(won.pages, 2);
        assert.deepEqual(new Set([...won.items, ...second.items].map(item => item.status)), new Set(['won', 'purchase_completed']));
        assert.equal(won.views.won, 2); assert.equal(won.views.lost, 2); assert.equal(won.views.discarded, 1);
        assert.equal(won.views.closures, 5); assert.equal(won.views.all, 143);
        assert.equal(won.metrics.won, 2); assert.equal(won.metrics.unsuccessful, 0);
        const lost = await service.tracking({ view: 'lost' }, supervisor);
        assert.deepEqual(new Set(lost.items.map(item => item.status)), new Set(['lost', 'do_not_contact']));
        assert.equal(lost.metrics.unsuccessful, 2); assert.equal(lost.metrics.discarded, 0);
        const discarded = await service.tracking({ view: 'discarded' }, supervisor);
        assert.equal(discarded.total, 1); assert.equal(discarded.metrics.unsuccessful, 0);
        assert.equal(discarded.metrics.discarded, 1);
        const combined = await service.tracking({ view: 'closures' }, supervisor);
        assert.equal(combined.total, 5); assert.equal(combined.metrics.unsuccessful, 2);
        assert.equal((await service.tracking({ view: 'lost', assignedAdvisorId: 'a-2' }, supervisor)).total, 1);
        assert.equal((await service.tracking({ view: 'won', status: 'lost' }, supervisor)).total, 0);
        assert.equal((await service.tracking({ view: 'won', dateField: 'closed', from: '2026-10-15', to: '2026-10-15' }, supervisor)).total, 2);
        assert.equal((await service.tracking({ view: 'won', dateField: 'closed', from: '2026-10-16' }, supervisor)).total, 0);
        assert.equal((await service.tracking({ view: 'won' }, advisor)).total, 1);
      } finally {
        await db.collection('leads').deleteMany({ _id: { $in: fixtures.map(item => item._id) } });
      }
    });
    await t.test('column sorting applies before pagination and keeps missing dates last in both directions', async () => {
      const first = await service.tracking({ sortBy: 'id', sortDirection: 'asc', limit: 100 }, supervisor);
      const second = await service.tracking({ sortBy: 'id', sortDirection: 'asc', limit: 100, page: 2 }, supervisor);
      assert.deepEqual([...first.items, ...second.items].map(item => item.code), Array.from({ length: 137 }, (_, index) => `TEST-${index}`));
      const reverse = await service.tracking({ sortBy: 'id', sortDirection: 'desc', limit: 1 }, supervisor);
      assert.equal(reverse.items[0].code, 'TEST-136');
      const fixtures = [
        { code: 'SORT-10', name: 'Carlos', status: 'opportunity', assignedAdvisorName: 'Zora', lastContactAt: new Date('2026-10-20'), customFields: { nextStep: 'Visitar', lastOperation: { operationType: 'lot', operationId: '10' } }, closedReason: 'Zeta', closedAt: new Date('2026-10-22') },
        { code: 'SORT-2', name: 'Ana', status: 'quote_created', assignedAdvisorName: 'Ana', lastContactAt: new Date('2026-10-19'), customFields: { nextStep: 'Llamar' }, closedReason: 'Alfa', closedAt: new Date('2026-10-21') },
        { code: 'SORT-1', name: 'Beatriz', status: 'contacted', assignedAdvisorName: 'Beatriz', customFields: { nextStep: 'Revisar' }, closedReason: 'Beta' }
      ].map(item => ({ ...leads[0], lastContactAt: null, _id: id(), ...item }));
      await db.collection('leads').insertMany(fixtures);
      try {
        const expected = { id: ['SORT-1', 'SORT-2', 'SORT-10'], lead: ['SORT-2', 'SORT-1', 'SORT-10'], advisor: ['SORT-2', 'SORT-1', 'SORT-10'], status: ['SORT-1', 'SORT-2', 'SORT-10'], managedAt: ['SORT-2', 'SORT-10', 'SORT-1'], closedAt: ['SORT-2', 'SORT-10', 'SORT-1'], nextStep: ['SORT-2', 'SORT-1', 'SORT-10'], closureDetail: ['SORT-2', 'SORT-1', 'SORT-10'] };
        for (const [sortBy, codes] of Object.entries(expected)) {
          const asc = await service.tracking({ q: 'SORT-', view: 'all', sortBy, sortDirection: 'asc', limit: 2 }, supervisor);
          const ascNext = await service.tracking({ q: 'SORT-', view: 'all', sortBy, sortDirection: 'asc', limit: 2, page: 2 }, supervisor);
          assert.deepEqual([...asc.items, ...ascNext.items].map(item => item.code), codes, sortBy);
          const desc = await service.tracking({ q: 'SORT-', view: 'all', sortBy, sortDirection: 'desc' }, supervisor);
          const descending = ['managedAt', 'closedAt'].includes(sortBy) ? [codes[1], codes[0], codes[2]] : [...codes].reverse();
          assert.deepEqual(desc.items.map(item => item.code), descending, `${sortBy} descending`);
          assert.ok(desc.items.every(item => !('_sortValue' in item) && !('_sortMissing' in item)));
        }
        await assert.rejects(service.tracking({ sortBy: '$where' }, supervisor), /Columna de orden inválida/);
        await assert.rejects(service.tracking({ sortBy: 'id', sortDirection: 'bad' }, supervisor), /Dirección de orden inválida/);
      } finally {
        await db.collection('leads').deleteMany({ _id: { $in: fixtures.map(item => item._id) } });
      }
    });
    await t.test('date filters and overdue classification apply before pagination', async () => {
      const dates = await service.tracking({ from: '2026-10-15', to: '2026-10-15', limit: 25 }, supervisor);
      assert.equal(dates.total, 137); assert.equal(dates.items.length, 25);
      const none = await service.tracking({ from: '2026-10-16' }, supervisor);
      assert.equal(none.total, 0);
      const due = await service.tracking({ attention: 'overdue' }, supervisor);
      assert.equal(due.total, 1); assert.equal(due.items[0].code, selected.code);
      const repeated = await service.tracking({ attention: 'repeated' }, supervisor);
      assert.equal(repeated.total, 1);
    });
    await t.test('history preserves more than 40 events, full comments, campaign history and completion notes', async () => {
      const args = { leadId: String(selected._id), timelineScope: 'lead', timelineLimit: 25 };
      const first = await service.contactIntelligence(args, supervisor);
      const all = [];
      for (let page = 1; page <= first.timelinePagination.pages; page++) all.push(...(await service.contactIntelligence({ ...args, timelinePage: page }, supervisor)).timeline);
      assert.equal(all.filter(item => item.type === 'contact').length, 75);
      assert.equal(new Set(all.map(item => item.id || item.leadId)).size, all.length);
      assert.ok(all.find(item => item.detail === `74: ${comment}`));
      assert.ok(all.find(item => item.detail === 'Comentario anterior a la conversión'));
      assert.ok(all.find(item => item.note === 'Resultado completo de visita'));
      assert.ok(all.every(item => item.leadId === String(selected._id)));
      assert.equal(first.agenda.find(item => item.status === 'done').comment, 'Resultado completo de visita');
      const legacy = await service.contactIntelligence({ leadId: String(selected._id), timelineScope: 'lead' }, supervisor);
      assert.equal(legacy.timeline.length, all.length);
      await assert.rejects(service.contactIntelligence({ leadId: String(selected._id) }, { user: { id: 'other', permisos: { leadsHarvest: true } } }), /No autorizado/);
    });
    await t.test('supervision instructions retain the original text and an accountable response', async () => {
      const review = await service.createReview(String(selected._id), { note: 'Llamar y confirmar volumen', dueAt: new Date(Date.now() + 3600000).toISOString() }, supervisor);
      const pending = await service.tracking({ attention: 'review' }, supervisor);
      assert.equal(pending.total, 1); assert.equal(pending.items[0].tracking.pendingReviews, 1);
      const inbox = await service.pendingReviews({}, advisor);
      assert.equal(inbox.total, 1); assert.equal(inbox.items[0].note, 'Llamar y confirmar volumen');
      assert.equal(String(inbox.items[0].leadId), String(selected._id));
      assert.equal((await service.pendingReviews({}, { user: { ...advisor.user, id: 'other' } })).total, 0);
      assert.equal((await service.pendingReviews({}, { user: { ...advisor.user, permisos: { leadsFastway: true } } })).total, 0);
      const history = await service.contactIntelligence({ leadId: String(selected._id), timelineScope: 'lead' }, advisor);
      const instruction = history.timeline.find(item => item.reviewId === String(review._id));
      assert.equal(instruction.type, 'supervision'); assert.equal(instruction.detail, review.note);
      assert.equal(instruction.actor.id, supervisor.user.id);
      await assert.rejects(service.createReview(String(selected._id), { note: 'No autorizado', dueAt: now.toISOString() }, advisor), /No autorizado/);
      const resolved = await service.resolveReview(String(selected._id), String(review._id), { resolution: 'Se llamó; volumen confirmado.' }, advisor);
      assert.equal(resolved.status, 'resolved'); assert.equal(resolved.note, 'Llamar y confirmar volumen'); assert.equal(resolved.resolvedBy.id, 'a-1');
      const again = await service.resolveReview(String(selected._id), String(review._id), { resolution: 'Otro texto' }, supervisor);
      assert.equal(again.resolution, 'Se llamó; volumen confirmado.');
      assert.equal((await service.tracking({ attention: 'review' }, supervisor)).total, 0);
      assert.equal((await service.pendingReviews({}, advisor)).total, 0);
      const after = await service.contactIntelligence({ leadId: String(selected._id), timelineScope: 'lead' }, advisor);
      const entries = after.timeline.filter(item => item.reviewId === String(review._id));
      assert.equal(entries.length, 2);
      assert.equal(entries.find(item => item.type === 'supervision').detail, review.note);
      assert.equal(entries.find(item => item.type === 'supervision_response').detail, resolved.resolution);
    });
    await t.test('rejects past next actions for every channel without recording any management', async () => {
      const beforeEvents = await db.collection('leadevents').countDocuments({ leadId: selected._id });
      const beforeFollowUps = await db.collection('followups').countDocuments({ leadId: selected._id });
      const past = new Date(Date.now() - 60000).toISOString();
      for (const channel of ['phone', 'whatsapp', 'email', 'meeting', 'visit', 'pickup']) {
        await assert.rejects(service.registerAction(String(selected._id), {
          channel, outcome: 'follow_up_required', nextActionType: channel, nextActionAt: past, nextActionPurpose: 'Prueba'
        }, advisor), error => error.statusCode === 400 && /futuras/.test(error.message));
      }
      const followUps = require('../src/modules/followUps/followUp.service');
      const meetings = require('../src/modules/meetings/meeting.service');
      await assert.rejects(followUps.create({ leadId: selected._id, dueAt: past }, { req: advisor }), /futuras/);
      await assert.rejects(meetings.create({ leadId: selected._id, startsAt: past }, { req: advisor }), /futuras/);
      await assert.rejects(service.createReview(String(selected._id), { note: 'Indicación vencida', dueAt: past }, supervisor), /futuras/);
      assert.equal(await db.collection('leadevents').countDocuments({ leadId: selected._id }), beforeEvents);
      assert.equal(await db.collection('followups').countDocuments({ leadId: selected._id }), beforeFollowUps);
      const overdue = await db.collection('followups').findOne({ leadId: selected._id, status: 'pending' });
      const resolved = await followUps.update(String(overdue._id), { status: 'done' }, { req: { user: { ...advisor.user, permisos: { esAdmin: true } } } });
      assert.equal(resolved.status, 'done', 'overdue existing activities can still be completed');
    });
  } finally {
    assert.ok(mongoose.connection.db.databaseName.startsWith('codex_tracking_test_'));
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  }
});
