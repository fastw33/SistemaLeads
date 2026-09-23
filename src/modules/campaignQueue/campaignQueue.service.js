'use strict';

const CampaignQueue = require('./campaignQueue.model');
const CampaignRecord = require('../campaigns/campaignRecord.model');
const Campaign = require('../campaigns/campaign.model');
const Lead = require('../leads/lead.model');
const LeadEvent = require('../leadEvents/leadEvent.model');
const FollowUp = require('../followUps/followUp.model');
const auditService = require('../audit/audit.service');
const counterService = require('../counters/counter.service');
const { actorFromReq } = require('../shared/schema.helpers');
const { httpError } = require('../shared/errors');
const { normalizePhone, normalizeEmail } = require('../../utils/normalize');
const { allowedBusinessUnits, assertBusinessUnitAccess } = require('../shared/leadLineAccess');

async function assertQueueBusinessUnit(queueItem, user) {
  const campaign = await Campaign.findById(queueItem.campaignId).select('businessUnit').lean();
  if (!campaign) throw httpError(404, 'Campaña no encontrada');
  assertBusinessUnitAccess(user, campaign.businessUnit);
  return campaign;
}

async function createOpportunityLead(queueItem, req) {
  const [record, campaign] = await Promise.all([
    CampaignRecord.findById(queueItem.campaignRecordId),
    Campaign.findById(queueItem.campaignId).lean()
  ]);

  if (!record || !campaign) throw httpError(404, 'Registro de campana no encontrado');
  assertBusinessUnitAccess(req.user, campaign.businessUnit);

  const phones = [...new Set(
    (record.detectedFields.phones?.length
      ? record.detectedFields.phones
      : [record.detectedFields.phone])
      .map(normalizePhone)
      .filter(Boolean)
  )];
  const emails = [...new Set(
    (record.detectedFields.emails?.length
      ? record.detectedFields.emails
      : [record.detectedFields.email])
      .map(normalizeEmail)
      .filter(Boolean)
  )];
  const or = [];
  if (phones.length) or.push({ 'phones.normalized': { $in: phones } });
  if (emails.length) or.push({ 'emails.normalized': { $in: emails } });

  let lead = or.length
    ? await Lead.findOne({ businessUnit: campaign.businessUnit, $or: or })
    : null;

  if (!lead) {
    lead = await Lead.create({
      code: await counterService.nextLeadCode(campaign.businessUnit),
      name: record.detectedFields.name,
      companyName: record.detectedFields.companyName,
      businessUnit: campaign.businessUnit,
      serviceLine: campaign.serviceLine,
      accountTypeIntent: campaign.targetAccountType === 'unknown' ? 'unknown' : campaign.targetAccountType,
      status: 'assigned',
      country: record.detectedFields.country || campaign.country,
      city: record.detectedFields.city,
      assignedAdvisorId: req.user.id,
      assignedAdvisorName: req.user.name,
      phones: phones.map((phone, index) => ({
        raw: phone,
        normalized: phone,
        label: index === 0 ? 'Principal' : 'Alternativo',
        preferred: index === 0
      })),
      emails: emails.map((email, index) => ({
        raw: email,
        normalized: email,
        label: index === 0 ? 'Principal' : 'Alternativo',
        preferred: index === 0
      })),
      source: 'campaign',
      campaignId: campaign._id,
      campaignRecordIds: [record._id],
      customFields: {
        campaignRecordCode: record.code,
        campaignPriority: record.detectedFields.priority,
        campaignIndustry: record.detectedFields.industry,
        probableMaterials: record.detectedFields.probableMaterials,
        website: record.detectedFields.website
      },
      sourcePayload: record.rawData
    });
  } else {
    lead.assignedAdvisorId = req.user.id;
    lead.assignedAdvisorName = req.user.name;
    lead.status = lead.status === 'new' || lead.status === 'queued' ? 'assigned' : lead.status;
    if (!lead.campaignRecordIds.some((id) => String(id) === String(record._id))) {
      lead.campaignRecordIds.push(record._id);
    }
    await lead.save();
  }

  record.leadId = lead._id;
  await record.save();

  return { lead: lead.toObject(), campaign, record: record.toObject() };
}

async function currentForAdvisor(req) {
  const campaignIds = await Campaign.distinct('_id', {
    businessUnit: { $in: allowedBusinessUnits(req.user) }
  });
  const queueItem = await CampaignQueue.findOne({
    assignedAdvisorId: req.user.id,
    status: 'assigned',
    campaignId: { $in: campaignIds }
  }).sort({ updatedAt: -1 }).lean();
  if (!queueItem) return { item: null, message: 'No tienes un prospecto activo' };
  const [record, campaign, lead] = await Promise.all([
    CampaignRecord.findById(queueItem.campaignRecordId).lean(),
    Campaign.findById(queueItem.campaignId).lean(),
    queueItem.leadId ? Lead.findById(queueItem.leadId).lean() : null
  ]);
  assertBusinessUnitAccess(req.user, campaign?.businessUnit);
  return { item: queueItem, record, campaign, lead };
}

const EDITABLE_FIELDS = new Set([
  'name', 'companyName', 'city', 'priority', 'industry', 'probableMaterials',
  'website', 'phones', 'emails', 'contacts'
]);

async function enrich(queueId, payload, req) {
  const queueItem = await CampaignQueue.findById(queueId);
  if (!queueItem) throw httpError(404, 'Prospecto de campaña no encontrado');
  if (queueItem.assignedAdvisorId !== req.user.id) {
    throw httpError(403, 'Este prospecto no está asignado a tu usuario');
  }
  const [record, campaign, lead] = await Promise.all([
    CampaignRecord.findById(queueItem.campaignRecordId),
    Campaign.findById(queueItem.campaignId).lean(),
    queueItem.leadId ? Lead.findById(queueItem.leadId) : null
  ]);
  if (!record || !campaign) throw httpError(404, 'Registro de campaña no encontrado');
  assertBusinessUnitAccess(req.user, campaign.businessUnit);

  const configuredEditable = new Set(
    (campaign.fieldConfiguration || [])
      .filter((field) => field.editableByAdvisor)
      .map((field) => field.key)
  );
  const incoming = payload.fields && typeof payload.fields === 'object' ? payload.fields : {};
  const changed = [];
  for (const [key, value] of Object.entries(incoming)) {
    if (!EDITABLE_FIELDS.has(key) || !configuredEditable.has(key)) continue;
    const before = record.detectedFields[key];
    let after = value;
    if (key === 'phones') after = [...new Set((Array.isArray(value) ? value : [value]).map(normalizePhone).filter(Boolean))];
    if (key === 'emails') after = [...new Set((Array.isArray(value) ? value : [value]).map(normalizeEmail).filter(Boolean))];
    if (key === 'contacts') {
      after = (Array.isArray(value) ? value : []).map((item) => ({
        name: String(item?.name || '').trim(),
        role: String(item?.role || '').trim()
      })).filter((item) => item.name);
    }
    if (!['phones', 'emails', 'contacts'].includes(key)) after = String(value || '').trim();
    if (JSON.stringify(before ?? '') === JSON.stringify(after ?? '')) continue;
    record.detectedFields[key] = after;
    if (key === 'phones') record.detectedFields.phone = after[0] || '';
    if (key === 'emails') record.detectedFields.email = after[0] || '';
    changed.push({ key, before, after });
    record.changeHistory.push({
      fieldKey: key,
      before,
      after,
      actorId: req.user.id,
      actorName: req.user.name,
      note: ''
    });
  }

  if (payload.note) {
    record.changeHistory.push({
      fieldKey: 'note',
      before: null,
      after: payload.note,
      actorId: req.user.id,
      actorName: req.user.name,
      note: payload.note
    });
  }

  const hasContact = Boolean(record.detectedFields.phones?.length || record.detectedFields.emails?.length);
  record.status = 'enriching';
  await record.save();

  if (lead) {
    lead.name = record.detectedFields.name;
    lead.companyName = record.detectedFields.companyName;
    lead.city = record.detectedFields.city;
    lead.phones = (record.detectedFields.phones || []).map((phone, index) => ({ raw: phone, normalized: phone, label: index ? 'Alternativo' : 'Principal', preferred: index === 0 }));
    lead.emails = (record.detectedFields.emails || []).map((email, index) => ({ raw: email, normalized: email, label: index ? 'Alternativo' : 'Principal', preferred: index === 0 }));
    lead.customFields = {
      ...(lead.customFields || {}),
      campaignRecordCode: record.code,
      campaignPriority: record.detectedFields.priority,
      campaignIndustry: record.detectedFields.industry,
      probableMaterials: record.detectedFields.probableMaterials,
      website: record.detectedFields.website,
      campaignContacts: record.detectedFields.contacts
    };
    await lead.save();
    if (changed.length || payload.note) {
      await LeadEvent.create({
        leadId: lead._id,
        type: 'note',
        channel: 'manual',
        outcome: 'campaign_enrichment',
        notes: payload.note || 'Información de campaña actualizada',
        actor: actorFromReq(req),
        metadata: { campaignRecordCode: record.code, changedFields: changed.map((item) => item.key) }
      });
    }
  }
  await auditService.record(req, {
    action: 'campaignQueue.enrich',
    entityType: 'campaignRecord',
    entityId: record._id,
    metadata: { code: record.code, changedFields: changed.map((item) => item.key) }
  });
  return { item: queueItem.toObject(), record: record.toObject(), campaign, lead: lead?.toObject() || null };
}

async function finishEnrichment(queueId, payload, req) {
  const queueItem = await CampaignQueue.findById(queueId);
  if (!queueItem) throw httpError(404, 'Prospecto de campaña no encontrado');
  if (queueItem.assignedAdvisorId !== req.user.id) {
    throw httpError(403, 'Este prospecto no está asignado a tu usuario');
  }
  await assertQueueBusinessUnit(queueItem, req.user);
  let record = await CampaignRecord.findById(queueItem.campaignRecordId);
  if (!record) throw httpError(404, 'Registro de campaña no encontrado');
  const result = ['ready', 'no_answer', 'follow_up', 'not_interested', 'no_contact', 'manual_review'].includes(payload.result)
    ? payload.result
    : 'manual_review';
  if (result === 'ready' && !(record.detectedFields.phones?.length || record.detectedFields.emails?.length || record.detectedFields.website)) {
    throw httpError(409, 'Agrega un teléfono, correo o página web antes de finalizar como listo');
  }

  let lead = null;
  if (result === 'ready') {
    const conversion = await createOpportunityLead(queueItem, req);
    lead = conversion.lead;
    queueItem.leadId = lead._id;
    record = await CampaignRecord.findById(queueItem.campaignRecordId);
  }

  const rescheduled = ['no_answer', 'follow_up'].includes(result);
  const nextAttemptAt = payload.nextAttemptAt
    ? new Date(payload.nextAttemptAt)
    : result === 'no_answer'
      ? new Date(Date.now() + 24 * 60 * 60 * 1000)
      : null;
  if (result === 'follow_up' && !nextAttemptAt) {
    throw httpError(400, 'Indica cuándo se debe volver a contactar');
  }

  const previousStatus = record.status;
  record.status = rescheduled ? 'enriching' : result === 'not_interested' ? 'discarded' : result;
  record.attempts += 1;
  record.changeHistory.push({
    fieldKey: 'contact_result',
    before: previousStatus,
    after: result,
    actorId: req.user.id,
    actorName: req.user.name,
    note: payload.note,
    channel: payload.channel,
    result,
    nextAttemptAt
  });
  queueItem.attempts += 1;
  queueItem.status = rescheduled ? 'rescheduled' : 'worked';
  if (rescheduled) queueItem.availableAt = nextAttemptAt;
  queueItem.lastOutcome = result;
  await Promise.all([record.save(), queueItem.save()]);
  if (queueItem.leadId) {
    await LeadEvent.create({
      leadId: queueItem.leadId,
      type: 'note',
      channel: ['phone', 'whatsapp', 'email'].includes(payload.channel) ? payload.channel : 'manual',
      outcome: `campaign_enrichment_${result}`,
      notes: payload.note || (result === 'ready' ? 'Prospecto enriquecido y listo para gestión comercial' : 'Enriquecimiento finalizado'),
      actor: actorFromReq(req),
      metadata: { campaignRecordCode: record.code, enrichmentResult: result }
    });
  }
  if (!rescheduled) {
    await Campaign.findByIdAndUpdate(queueItem.campaignId, { $inc: { 'stats.worked': 1 } });
  }
  return { item: queueItem.toObject(), record: record.toObject(), lead, result, nextAttemptAt };
}

async function resolveFollowUp(queueId, payload, req) {
  const queueItem = await CampaignQueue.findById(queueId);
  if (!queueItem) throw httpError(404, 'Seguimiento de campaña no encontrado');
  if (queueItem.assignedAdvisorId !== req.user.id) {
    throw httpError(403, 'Este seguimiento no está asignado a tu usuario');
  }
  await assertQueueBusinessUnit(queueItem, req.user);
  if (queueItem.status !== 'rescheduled') {
    throw httpError(409, 'Este seguimiento ya fue resuelto');
  }

  const record = await CampaignRecord.findById(queueItem.campaignRecordId);
  if (!record) throw httpError(404, 'Registro de campaña no encontrado');

  const performed = payload.performed === true || String(payload.performed).toLowerCase() === 'true';
  const result = performed ? 'follow_up_completed' : 'follow_up_cancelled';
  const note = String(payload.note || '').trim();
  const channel = ['phone', 'whatsapp', 'email', 'task'].includes(payload.channel)
    ? payload.channel
    : 'phone';
  const completedAt = new Date();
  const scheduledAt = queueItem.availableAt;
  const previousRecordStatus = record.status;

  queueItem.status = 'worked';
  queueItem.availableAt = null;
  queueItem.lastOutcome = result;
  if (performed) queueItem.attempts += 1;

  record.status = 'worked';
  if (performed) record.attempts += 1;
  record.changeHistory.push({
    fieldKey: 'follow_up_result',
    before: { status: 'pending', dueAt: scheduledAt },
    after: performed ? 'done' : 'cancelled',
    actorId: req.user.id,
    actorName: req.user.name,
    note,
    channel,
    result,
    changedAt: completedAt
  });

  await Promise.all([queueItem.save(), record.save()]);

  if (queueItem.leadId) {
    await LeadEvent.create({
      leadId: queueItem.leadId,
      type: 'note',
      channel: ['phone', 'whatsapp', 'email'].includes(channel) ? channel : 'manual',
      outcome: `campaign_${result}`,
      notes: note,
      actor: actorFromReq(req),
      metadata: {
        campaignId: String(queueItem.campaignId),
        campaignRecordId: String(record._id),
        campaignRecordCode: record.code,
        scheduledAt,
        completedAt,
        performed
      }
    });
  }

  await Campaign.findByIdAndUpdate(queueItem.campaignId, { $inc: { 'stats.worked': 1 } });

  await auditService.record(req, {
    action: 'campaignQueue.resolveFollowUp',
    entityType: 'campaignRecord',
    entityId: record._id,
    metadata: { campaignId: queueItem.campaignId, queueId: queueItem._id, result, performed }
  });

  return {
    item: queueItem.toObject(),
    record: record.toObject(),
    result,
    performed,
    previousRecordStatus,
    completedAt
  };
}

async function nextForAdvisor(req, filters = {}) {
  const now = new Date();
  await CampaignQueue.updateMany(
    { status: 'locked', lockExpiresAt: { $lte: now } },
    {
      $set: { status: 'available', availableAt: now },
      $unset: { lockedBy: 1, lockedAt: 1, lockExpiresAt: 1 }
    }
  );
  await Campaign.updateMany(
    { status: 'paused', pausedUntil: { $lte: now } },
    { $set: { status: 'active' }, $unset: { pausedUntil: 1 } }
  );
  const campaignFilter = {
    status: 'active',
    businessUnit: { $in: allowedBusinessUnits(req.user) }
  };
  if (filters.campaignId) campaignFilter._id = filters.campaignId;
  const activeCampaignIds = await Campaign.distinct('_id', campaignFilter);
  const query = {
    campaignId: { $in: activeCampaignIds },
    status: { $in: ['available', 'rescheduled'] },
    availableAt: { $lte: now }
  };

  const queueItem = await CampaignQueue.findOneAndUpdate(
    query,
    {
      $set: {
        status: 'locked',
        lockedBy: req.user.id,
        lockedAt: now,
        lockExpiresAt: new Date(now.getTime() + 10 * 60 * 1000)
      }
    },
    { new: true, sort: { priority: -1, availableAt: 1, createdAt: 1 } }
  );

  if (!queueItem) {
    return { item: null, message: 'No hay contactos disponibles' };
  }

  const [campaign, record] = await Promise.all([
    Campaign.findById(queueItem.campaignId).lean(),
    CampaignRecord.findById(queueItem.campaignRecordId)
  ]);
  if (!campaign || !record) throw httpError(404, 'Registro de campaña no encontrado');
  assertBusinessUnitAccess(req.user, campaign.businessUnit);

  queueItem.status = 'assigned';
  queueItem.assignedAdvisorId = req.user.id;
  queueItem.assignedAdvisorName = req.user.name;
  const previousRecordStatus = record.status;
  record.status = 'enriching';
  record.changeHistory.push({
    fieldKey: 'attention',
    before: previousRecordStatus,
    after: 'enriching',
    actorId: req.user.id,
    actorName: req.user.name,
    note: 'Contacto tomado para investigación de campaña'
  });
  await Promise.all([queueItem.save(), record.save()]);

  await auditService.record(req, {
    action: 'campaignQueue.reveal',
    entityType: 'campaignRecord',
    entityId: record._id,
    metadata: { campaignId: campaign._id, campaignRecordId: record._id }
  });

  return { item: queueItem.toObject(), lead: null, campaign, record: record.toObject() };
}

async function complete(queueId, payload, req) {
  const queueItem = await CampaignQueue.findById(queueId);
  if (!queueItem) throw httpError(404, 'Item de cola no encontrado');
  if (queueItem.assignedAdvisorId !== req.user.id) throw httpError(403, 'Este contacto no esta asignado a tu usuario');
  await assertQueueBusinessUnit(queueItem, req.user);
  if (!payload.outcome) throw httpError(400, 'Resultado requerido');

  const event = await LeadEvent.create({
    leadId: queueItem.leadId,
    type: payload.eventType || 'call',
    channel: payload.channel || 'phone',
    outcome: payload.outcome,
    notes: payload.notes,
    actor: actorFromReq(req),
    metadata: payload.metadata || {}
  });

  queueItem.attempts += 1;
  queueItem.lastOutcome = payload.outcome;

  if (['no_answer', 'not_contacted', 'busy'].includes(payload.outcome)) {
    const dueAt = payload.nextAttemptAt ? new Date(payload.nextAttemptAt) : new Date(Date.now() + 24 * 60 * 60 * 1000);
    queueItem.status = 'rescheduled';
    queueItem.availableAt = dueAt;
    queueItem.priority += 1;

    await FollowUp.create({
      leadId: queueItem.leadId,
      assignedAdvisorId: req.user.id,
      dueAt,
      channel: payload.channel || 'phone',
      reason: payload.outcome,
      priority: queueItem.priority
    });
  } else {
    queueItem.status = 'worked';
    await CampaignRecord.findByIdAndUpdate(queueItem.campaignRecordId, { status: 'worked', attempts: queueItem.attempts });
    await Lead.findByIdAndUpdate(queueItem.leadId, {
      status: payload.nextLeadStatus || 'contacted',
      lastContactAt: new Date()
    });
  }

  await queueItem.save();

  await auditService.record(req, {
    action: 'campaignQueue.complete',
    entityType: 'campaignQueue',
    entityId: queueItem._id,
    metadata: { outcome: payload.outcome }
  });

  return { queueItem: queueItem.toObject(), event: event.toObject() };
}

module.exports = {
  nextForAdvisor,
  currentForAdvisor,
  enrich,
  finishEnrichment,
  resolveFollowUp,
  complete
};
