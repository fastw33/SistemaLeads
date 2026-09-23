'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');
const readXlsxFile = require('read-excel-file/node');
const { readSheetNames } = require('read-excel-file/node');
const { parse: parseCsv } = require('csv-parse/sync');

const Campaign = require('./campaign.model');
const ImportJob = require('./importJob.model');
const CampaignRecord = require('./campaignRecord.model');
const CampaignQueue = require('../campaignQueue/campaignQueue.model');
const Lead = require('../leads/lead.model');
const LeadEvent = require('../leadEvents/leadEvent.model');
const buildCrudService = require('../shared/crud.service');
const counterService = require('../counters/counter.service');
const auditService = require('../audit/audit.service');
const { actorFromReq } = require('../shared/schema.helpers');
const { httpError } = require('../shared/errors');
const {
  cleanString,
  inferDetectedFields,
  normalizeEmail,
  normalizePhone
} = require('../../utils/normalize');
const { sanitizeMongoKeys } = require('../../utils/mongoSafe');

const crud = buildCrudService(Campaign, {
  buildFilter(query) {
    const filter = {};
    if (query.status) filter.status = query.status;
    if (query.businessUnit) filter.businessUnit = query.businessUnit;
    if (query.serviceLine) filter.serviceLine = query.serviceLine;
    return filter;
  },
  async beforeCreate(payload, { req }) {
    const startsAt = new Date(payload.startsAt);
    const endsAt = new Date(payload.endsAt);
    if (endsAt < startsAt) {
      const error = new Error('La fecha final debe ser posterior a la fecha inicial');
      error.statusCode = 400;
      throw error;
    }
    return {
      ...payload,
      startsAt,
      endsAt,
      code: payload.code || await counterService.nextCode('HC-CAMP'),
      createdBy: actorFromReq(req)
    };
  }
});

async function resumeExpiredCampaigns() {
  await Campaign.updateMany(
    { status: 'paused', pausedUntil: { $lte: new Date() } },
    { $set: { status: 'active' }, $unset: { pausedUntil: 1 } }
  );
}

async function list(query = {}, context = {}) {
  await resumeExpiredCampaigns();
  return crud.list(query, context);
}

async function startCampaign(campaignId, req) {
  const campaign = await Campaign.findById(campaignId);
  if (!campaign) {
    const error = new Error('Campaña no encontrada');
    error.statusCode = 404;
    throw error;
  }
  if (campaign.status === 'closed') {
    const error = new Error('Una campaña detenida no puede volver a iniciarse');
    error.statusCode = 409;
    throw error;
  }

  const records = await CampaignRecord.find({
    campaignId,
    status: { $in: ['pending', 'pending_enrichment', 'ready'] }
  }).select('_id detectedFields.priority').lean();
  if (!records.length) {
    const error = new Error('La campaña no tiene contactos válidos pendientes');
    error.statusCode = 409;
    throw error;
  }

  await CampaignQueue.bulkWrite(records.map((record) => ({
    updateOne: {
      filter: { campaignRecordId: record._id },
      update: {
        $setOnInsert: {
          campaignId,
          campaignRecordId: record._id,
          status: 'available',
          priority: record.detectedFields?.priority === 'A' ? 30 : record.detectedFields?.priority === 'B' ? 20 : 10,
          availableAt: new Date()
        }
      },
      upsert: true
    }
  })));

  campaign.status = 'active';
  campaign.startedAt = campaign.startedAt || new Date();
  campaign.pausedUntil = undefined;
  campaign.stats.queued = await CampaignQueue.countDocuments({ campaignId });
  await campaign.save();

  await auditService.record(req, {
    action: 'campaign.start',
    entityType: 'campaign',
    entityId: campaignId,
    metadata: { queued: campaign.stats.queued }
  });
  return campaign.toObject();
}

async function pauseCampaign(campaignId, pausedUntil, req) {
  const campaign = await Campaign.findById(campaignId);
  if (!campaign) {
    const error = new Error('Campaña no encontrada');
    error.statusCode = 404;
    throw error;
  }
  if (campaign.status !== 'active') {
    const error = new Error('Solo una campaña activa puede pausarse');
    error.statusCode = 409;
    throw error;
  }
  const until = new Date(pausedUntil);
  if (Number.isNaN(until.getTime()) || until <= new Date()) {
    const error = new Error('La reactivación debe programarse para una fecha futura');
    error.statusCode = 400;
    throw error;
  }

  campaign.status = 'paused';
  campaign.pausedUntil = until;
  await campaign.save();
  await auditService.record(req, {
    action: 'campaign.pause',
    entityType: 'campaign',
    entityId: campaignId,
    metadata: { pausedUntil: until }
  });
  return campaign.toObject();
}

async function stopCampaign(campaignId, req) {
  const campaign = await Campaign.findById(campaignId);
  if (!campaign) {
    const error = new Error('Campaña no encontrada');
    error.statusCode = 404;
    throw error;
  }
  if (campaign.status === 'closed') return campaign.toObject();

  campaign.status = 'closed';
  campaign.stoppedAt = new Date();
  campaign.pausedUntil = undefined;
  await Promise.all([
    campaign.save(),
    CampaignQueue.updateMany(
      { campaignId, status: { $in: ['available', 'locked', 'rescheduled'] } },
      { $set: { status: 'closed' }, $unset: { lockedBy: 1, lockedAt: 1, lockExpiresAt: 1 } }
    )
  ]);
  await auditService.record(req, {
    action: 'campaign.stop',
    entityType: 'campaign',
    entityId: campaignId
  });
  return campaign.toObject();
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function listContacts(campaignId, query = {}) {
  const campaign = await Campaign.findById(campaignId).select('_id').lean();
  if (!campaign) {
    const error = new Error('Campaña no encontrada');
    error.statusCode = 404;
    throw error;
  }
  const page = Math.max(Number(query.page || 1), 1);
  const limit = Math.min(Math.max(Number(query.limit || 25), 1), 2000);
  const filter = { campaignId };
  if (query.status) filter.status = query.status;
  if (query.search) {
    const regex = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [
      { 'detectedFields.name': regex },
      { 'detectedFields.companyName': regex },
      { 'detectedFields.city': regex },
      { code: regex },
      { 'detectedFields.industry': regex },
      { 'detectedFields.probableMaterials': regex },
      { 'detectedFields.website': regex },
      { 'detectedFields.phones': regex },
      { 'detectedFields.emails': regex }
    ];
  }

  const [records, total, grouped] = await Promise.all([
    CampaignRecord.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    CampaignRecord.countDocuments(filter),
    CampaignRecord.aggregate([
      { $match: { campaignId: campaign._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ])
  ]);
  const recordIds = records.map((record) => record._id);
  const leadIds = records.map((record) => record.leadId).filter(Boolean);
  const [queues, leads, leadEvents] = await Promise.all([
    recordIds.length ? CampaignQueue.find({ campaignRecordId: { $in: recordIds } }).lean() : [],
    leadIds.length ? Lead.find({ _id: { $in: leadIds } })
      .select('_id code status assignedAdvisorId assignedAdvisorName lastContactAt nextFollowUpAt')
      .lean() : [],
    leadIds.length ? LeadEvent.find({
      leadId: { $in: leadIds },
      'metadata.campaignRecordCode': { $in: records.map((record) => record.code) }
    })
      .select('leadId type channel outcome notes actor metadata createdAt')
      .sort({ createdAt: -1 })
      .lean() : []
  ]);
  const queueByRecord = new Map(queues.map((item) => [String(item.campaignRecordId), item]));
  const leadById = new Map(leads.map((item) => [String(item._id), item]));
  const eventsByRecordCode = leadEvents.reduce((result, event) => {
    const code = event.metadata?.campaignRecordCode;
    if (!code) return result;
    if (!result.has(code)) result.set(code, []);
    result.get(code).push(event);
    return result;
  }, new Map());
  const summary = grouped.reduce((result, item) => ({ ...result, [item._id]: item.count }), {});

  return {
    items: records.map((record) => ({
      ...record,
      queue: queueByRecord.get(String(record._id)) || null,
      lead: record.leadId ? leadById.get(String(record.leadId)) || null : null,
      leadHistory: eventsByRecordCode.get(record.code) || []
    })),
    summary,
    total,
    page,
    limit,
    pages: Math.ceil(total / limit)
  };
}

async function adminContacts(query = {}) {
  const page = Math.max(Number(query.page || 1), 1);
  const limit = Math.min(Math.max(Number(query.limit || 25), 1), 100);
  const filter = {};
  if (query.campaignId) {
    if (!mongoose.isValidObjectId(query.campaignId)) throw httpError(400, 'Campaña inválida');
    filter.campaignId = query.campaignId;
  }
  if (query.status) filter.status = query.status;
  if (query.search) {
    const regex = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [
      { code: regex },
      { 'detectedFields.name': regex },
      { 'detectedFields.companyName': regex },
      { 'detectedFields.phones': regex },
      { 'detectedFields.emails': regex }
    ];
  }
  if (query.advisorId) {
    const recordIds = await CampaignQueue.distinct('campaignRecordId', { assignedAdvisorId: query.advisorId });
    filter._id = { $in: recordIds };
  }

  const [records, total] = await Promise.all([
    CampaignRecord.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    CampaignRecord.countDocuments(filter)
  ]);
  const recordIds = records.map((record) => record._id);
  const campaignIds = [...new Set(records.map((record) => String(record.campaignId)))];
  const [queues, campaigns] = await Promise.all([
    CampaignQueue.find({ campaignRecordId: { $in: recordIds } }).lean(),
    Campaign.find({ _id: { $in: campaignIds } }).select('code name businessUnit status').lean()
  ]);
  const queueByRecord = new Map(queues.map((item) => [String(item.campaignRecordId), item]));
  const campaignById = new Map(campaigns.map((item) => [String(item._id), item]));

  return {
    items: records.map((record) => ({
      ...record,
      queue: queueByRecord.get(String(record._id)) || null,
      campaign: campaignById.get(String(record.campaignId)) || null
    })),
    total,
    page,
    limit,
    pages: Math.ceil(total / limit)
  };
}

async function assignContact(campaignId, recordId, payload = {}, req) {
  const advisorId = cleanString(payload.advisorId);
  const advisorName = cleanString(payload.advisorName);
  const reason = cleanString(payload.reason);
  if (!advisorId || !advisorName) throw httpError(400, 'Selecciona el asesor responsable');
  if (reason.length < 5) throw httpError(400, 'Indica el motivo de la asignación');
  const [record, queue] = await Promise.all([
    CampaignRecord.findOne({ _id: recordId, campaignId }),
    CampaignQueue.findOne({ campaignRecordId: recordId, campaignId })
  ]);
  if (!record || !queue) throw httpError(404, 'Contacto de campaña no encontrado');
  if (record.leadId) throw httpError(409, 'Este contacto ya se convirtió en lead; reasígnalo desde la pestaña de Leads');

  const previousAdvisorId = queue.assignedAdvisorId || '';
  const previousStatus = record.status;
  queue.assignedAdvisorId = advisorId;
  queue.assignedAdvisorName = advisorName;
  if (!['rescheduled'].includes(queue.status)) {
    queue.status = 'assigned';
    queue.availableAt = new Date();
  }
  queue.lockedBy = undefined;
  queue.lockedAt = undefined;
  queue.lockExpiresAt = undefined;
  record.status = 'enriching';
  record.changeHistory.push({
    fieldKey: 'admin_assignment',
    before: { advisorId: previousAdvisorId, status: previousStatus },
    after: { advisorId, status: 'enriching' },
    actorId: req.user.id,
    actorName: req.user.name,
    note: reason
  });
  await Promise.all([record.save(), queue.save()]);
  await auditService.record(req, {
    action: 'campaign.contact.assign',
    entityType: 'campaignRecord',
    entityId: record._id,
    metadata: { campaignId, previousAdvisorId, advisorId, reason }
  });
  return { record: record.toObject(), queue: queue.toObject() };
}

async function deleteContact(campaignId, recordId, reasonValue, req) {
  const reason = cleanString(reasonValue);
  if (reason.length < 5) throw httpError(400, 'Indica el motivo de eliminación');
  const [campaign, record, queue] = await Promise.all([
    Campaign.findById(campaignId),
    CampaignRecord.findOne({ _id: recordId, campaignId }),
    CampaignQueue.findOne({ campaignRecordId: recordId, campaignId }).lean()
  ]);
  if (!campaign || !record) throw httpError(404, 'Contacto de campaña no encontrado');

  await auditService.record(req, {
    action: 'campaign.contact.delete',
    entityType: 'campaignRecord',
    entityId: record._id,
    before: record.toObject(),
    metadata: { campaignId, code: record.code, reason }
  });
  await Promise.all([
    CampaignQueue.deleteOne({ campaignRecordId: record._id }),
    CampaignRecord.deleteOne({ _id: record._id }),
    record.leadId ? Lead.updateOne({ _id: record.leadId }, { $pull: { campaignRecordIds: record._id } }) : null
  ].filter(Boolean));
  campaign.stats.imported = Math.max(Number(campaign.stats.imported || 0) - 1, 0);
  if (queue?.status === 'worked') campaign.stats.worked = Math.max(Number(campaign.stats.worked || 0) - 1, 0);
  campaign.stats.queued = await CampaignQueue.countDocuments({ campaignId });
  await campaign.save();
  return { deleted: true, id: recordId, code: record.code };
}

function performanceDateRange(query = {}) {
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
  const from = query.dateFrom
    ? new Date(`${query.dateFrom}T00:00:00-05:00`)
    : defaultFrom;
  const to = query.dateTo
    ? new Date(`${query.dateTo}T23:59:59.999-05:00`)
    : now;
  return { from, to };
}

function performanceGroup(includeCampaign = false) {
  const id = includeCampaign
    ? { actorId: '$changeHistory.actorId', campaignId: '$campaignId' }
    : { actorId: '$changeHistory.actorId' };
  return {
    $group: {
      _id: id,
      actorName: { $last: '$changeHistory.actorName' },
      prospects: { $addToSet: '$_id' },
      campaigns: { $addToSet: '$campaignId' },
      managements: { $sum: '$changeHistory.managementWeight' },
      calls: { $sum: { $cond: [{ $eq: ['$changeHistory.channel', 'phone'] }, 1, 0] } },
      whatsapp: { $sum: { $cond: [{ $eq: ['$changeHistory.channel', 'whatsapp'] }, 1, 0] } },
      emails: { $sum: { $cond: [{ $eq: ['$changeHistory.channel', 'email'] }, 1, 0] } },
      research: { $sum: { $cond: [{ $in: ['$changeHistory.channel', ['web', 'research']] }, 1, 0] } },
      effectiveContacts: { $sum: { $cond: [{ $in: ['$changeHistory.normalizedResult', ['ready', 'follow_up', 'not_interested']] }, 1, 0] } },
      noAnswer: { $sum: { $cond: [{ $eq: ['$changeHistory.normalizedResult', 'no_answer'] }, 1, 0] } },
      followUps: { $sum: { $cond: [{ $eq: ['$changeHistory.normalizedResult', 'follow_up'] }, 1, 0] } },
      notInterested: { $sum: { $cond: [{ $eq: ['$changeHistory.normalizedResult', 'not_interested'] }, 1, 0] } },
      opportunities: { $sum: { $cond: [{ $eq: ['$changeHistory.normalizedResult', 'ready'] }, 1, 0] } },
      noContactData: { $sum: { $cond: [{ $eq: ['$changeHistory.normalizedResult', 'no_contact'] }, 1, 0] } },
      manualReview: { $sum: { $cond: [{ $eq: ['$changeHistory.normalizedResult', 'manual_review'] }, 1, 0] } },
      lastManagementAt: { $max: '$changeHistory.changedAt' }
    }
  };
}

async function operatorPerformance(query = {}) {
  const { from, to } = performanceDateRange(query);
  const scope = ['all', 'campaigns', 'leads'].includes(query.scope) ? query.scope : 'all';
  const selectedCampaignId = query.campaignId && mongoose.isValidObjectId(query.campaignId)
    ? new mongoose.Types.ObjectId(query.campaignId)
    : null;
  const recordMatch = {};
  if (selectedCampaignId) recordMatch.campaignId = selectedCampaignId;
  const historyMatch = {
    'changeHistory.changedAt': { $gte: from, $lte: to },
    'changeHistory.actorId': { $nin: [null, ''] },
    $or: [
      { 'changeHistory.fieldKey': 'contact_result' },
      { 'changeHistory.fieldKey': 'attention' },
      { 'changeHistory.fieldKey': 'status', 'changeHistory.after': { $in: ['ready', 'no_contact', 'manual_review', 'discarded'] } }
    ]
  };
  const basePipeline = [
    { $match: recordMatch },
    { $unwind: '$changeHistory' },
    { $match: historyMatch },
    {
      $set: {
        'changeHistory.normalizedResult': {
          $cond: [
            { $eq: ['$changeHistory.fieldKey', 'contact_result'] },
            '$changeHistory.result',
            { $cond: [{ $eq: ['$changeHistory.fieldKey', 'status'] }, '$changeHistory.after', 'attention'] }
          ]
        },
        'changeHistory.managementWeight': {
          $cond: [{ $in: ['$changeHistory.fieldKey', ['contact_result', 'status']] }, 1, 0]
        }
      }
    }
  ];

  const campaignQueries = scope === 'leads'
    ? [Promise.resolve([]), Promise.resolve([]), Promise.resolve([])]
    : [
      CampaignRecord.aggregate([
      ...basePipeline,
      performanceGroup(false),
      { $sort: { opportunities: -1, effectiveContacts: -1, managements: -1 } }
      ]),
      CampaignRecord.aggregate([
      ...basePipeline,
      performanceGroup(true),
      { $lookup: { from: 'campaigns', localField: '_id.campaignId', foreignField: '_id', as: 'campaign' } },
      { $unwind: { path: '$campaign', preserveNullAndEmptyArrays: true } },
      { $sort: { managements: -1 } }
      ]),
      CampaignRecord.aggregate([
      ...basePipeline,
      { $sort: { 'changeHistory.changedAt': -1 } },
      { $limit: 1000 },
      { $lookup: { from: 'campaigns', localField: 'campaignId', foreignField: '_id', as: 'campaign' } },
      { $unwind: { path: '$campaign', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          recordId: '$_id',
          recordCode: '$code',
          campaignId: '$campaignId',
          campaignCode: '$campaign.code',
          campaignName: '$campaign.name',
          companyName: '$detectedFields.companyName',
          contactName: '$detectedFields.name',
          actorId: '$changeHistory.actorId',
          actorName: '$changeHistory.actorName',
          channel: '$changeHistory.channel',
          result: '$changeHistory.normalizedResult',
          note: '$changeHistory.note',
          nextAttemptAt: '$changeHistory.nextAttemptAt',
          managedAt: '$changeHistory.changedAt',
          source: { $literal: 'campaign' }
        }
      }
      ])
    ];

  const leadEventMatch = {
    createdAt: { $gte: from, $lte: to },
    'actor.id': { $nin: [null, ''] },
    channel: { $ne: 'system' },
    type: { $nin: ['assignment', 'imported', 'status_change'] },
    outcome: { $not: /^campaign_enrichment/ }
  };
  const leadPipeline = [
    { $match: leadEventMatch },
    { $lookup: { from: 'leads', localField: 'leadId', foreignField: '_id', as: 'lead' } },
    { $unwind: '$lead' },
    ...(selectedCampaignId ? [{ $match: { 'lead.campaignId': selectedCampaignId } }] : [])
  ];
  const opportunityOutcomes = ['interested', 'purchase_completed', 'won', 'quote_created', 'do_created'];
  const effectiveOutcomes = ['contacted', 'interested', 'purchase_completed', 'won', 'meeting_completed', 'visit_completed', 'pickup_completed'];
  const negativeOutcomes = ['no_answer', 'not_contacted', 'busy', 'no_show'];
  const leadQueries = scope === 'campaigns'
    ? [Promise.resolve([]), Promise.resolve([])]
    : [
      LeadEvent.aggregate([
        ...leadPipeline,
        {
          $group: {
            _id: '$actor.id',
            actorName: { $last: '$actor.name' },
            leads: { $addToSet: '$leadId' },
            campaigns: { $addToSet: '$lead.campaignId' },
            managements: { $sum: 1 },
            calls: { $sum: { $cond: [{ $or: [{ $eq: ['$type', 'call'] }, { $eq: ['$channel', 'phone'] }] }, 1, 0] } },
            whatsapp: { $sum: { $cond: [{ $eq: ['$channel', 'whatsapp'] }, 1, 0] } },
            emails: { $sum: { $cond: [{ $eq: ['$channel', 'email'] }, 1, 0] } },
            meetings: { $sum: { $cond: [{ $in: ['$type', ['meeting_created', 'meeting_result']] }, 1, 0] } },
            visits: { $sum: { $cond: [{ $in: ['$type', ['visit_created', 'visit_result']] }, 1, 0] } },
            pickups: { $sum: { $cond: [{ $in: ['$type', ['pickup_created', 'pickup_result']] }, 1, 0] } },
            quotes: { $sum: { $cond: [{ $or: [{ $in: ['$type', ['price_requested', 'price_informed', 'quote_requested']] }, { $eq: ['$outcome', 'quote_created'] }] }, 1, 0] } },
            effectiveContacts: { $sum: { $cond: [{ $or: [{ $in: ['$outcome', effectiveOutcomes] }, { $in: ['$type', ['meeting_result', 'visit_result', 'pickup_result']] }] }, 1, 0] } },
            noAnswer: { $sum: { $cond: [{ $in: ['$outcome', negativeOutcomes] }, 1, 0] } },
            followUps: { $sum: { $cond: [{ $in: ['$type', ['meeting_created', 'visit_created', 'pickup_created']] }, 1, 0] } },
            opportunityLeads: { $addToSet: { $cond: [{ $in: ['$outcome', opportunityOutcomes] }, '$leadId', '$$REMOVE'] } },
            lastManagementAt: { $max: '$createdAt' }
          }
        },
        { $sort: { managements: -1 } }
      ]),
      LeadEvent.aggregate([
        ...leadPipeline,
        { $sort: { createdAt: -1 } },
        { $limit: 1000 },
        {
          $project: {
            _id: 0,
            eventId: '$_id',
            leadId: '$leadId',
            leadCode: '$lead.code',
            companyName: '$lead.companyName',
            contactName: '$lead.name',
            campaignId: '$lead.campaignId',
            actorId: '$actor.id',
            actorName: '$actor.name',
            channel: '$channel',
            result: '$outcome',
            eventType: '$type',
            note: '$notes',
            managedAt: '$createdAt',
            source: { $literal: 'lead' }
          }
        }
      ])
    ];

  const [operatorGroups, campaignGroups, campaignActivity, leadGroups, leadActivity] = await Promise.all([
    ...campaignQueries,
    ...leadQueries
  ]);

  const campaignsByOperator = campaignGroups.reduce((result, item) => {
    const actorId = item._id.actorId;
    if (!result[actorId]) result[actorId] = [];
    result[actorId].push({
      campaignId: item._id.campaignId,
      campaignCode: item.campaign?.code,
      campaignName: item.campaign?.name,
      prospects: item.prospects.length,
      managements: item.managements,
      calls: item.calls,
      effectiveContacts: item.effectiveContacts,
      opportunities: item.opportunities
    });
    return result;
  }, {});

  const operatorsById = new Map();
  const ensureOperator = (actorId, actorName) => {
    if (!operatorsById.has(actorId)) {
      operatorsById.set(actorId, {
        actorId,
        actorName: actorName || actorId,
        prospects: 0,
        leads: 0,
        campaignManagements: 0,
        leadManagements: 0,
        managements: 0,
        calls: 0,
        whatsapp: 0,
        emails: 0,
        research: 0,
        meetings: 0,
        visits: 0,
        pickups: 0,
        quotes: 0,
        effectiveContacts: 0,
        noAnswer: 0,
        followUps: 0,
        notInterested: 0,
        opportunities: 0,
        noContactData: 0,
        manualReview: 0,
        lastManagementAt: null,
        campaignBreakdown: campaignsByOperator[actorId] || [],
        campaignIds: new Set()
      });
    }
    return operatorsById.get(actorId);
  };

  operatorGroups.forEach((item) => {
    const actorId = item._id.actorId;
    const operator = ensureOperator(actorId, item.actorName);
    operator.prospects += item.prospects.length;
    operator.campaignManagements += item.managements;
    operator.managements += item.managements;
    ['calls', 'whatsapp', 'emails', 'research', 'effectiveContacts', 'noAnswer', 'followUps', 'notInterested', 'opportunities', 'noContactData', 'manualReview'].forEach((field) => {
      operator[field] += item[field] || 0;
    });
    item.campaigns.filter(Boolean).forEach((id) => operator.campaignIds.add(String(id)));
    operator.lastManagementAt = item.lastManagementAt;
  });

  leadGroups.forEach((item) => {
    const actorId = item._id;
    const operator = ensureOperator(actorId, item.actorName);
    operator.leads += item.leads.length;
    operator.leadManagements += item.managements;
    operator.managements += item.managements;
    ['calls', 'whatsapp', 'emails', 'meetings', 'visits', 'pickups', 'quotes', 'effectiveContacts', 'noAnswer', 'followUps'].forEach((field) => {
      operator[field] += item[field] || 0;
    });
    operator.opportunities += item.opportunityLeads?.length || 0;
    item.campaigns.filter(Boolean).forEach((id) => operator.campaignIds.add(String(id)));
    if (!operator.lastManagementAt || new Date(item.lastManagementAt) > new Date(operator.lastManagementAt)) {
      operator.lastManagementAt = item.lastManagementAt;
    }
  });

  const operators = [...operatorsById.values()]
    .map((item) => ({
      ...item,
      campaigns: item.campaignIds.size,
      campaignIds: undefined,
      contactRate: item.managements ? Number(((item.effectiveContacts / item.managements) * 100).toFixed(1)) : 0,
      conversionRate: item.effectiveContacts ? Number(((item.opportunities / item.effectiveContacts) * 100).toFixed(1)) : 0
    }))
    .sort((a, b) => b.managements - a.managements);

  const recentActivity = [...campaignActivity, ...leadActivity]
    .sort((a, b) => new Date(b.managedAt) - new Date(a.managedAt))
    .slice(0, 1000);

  return {
    range: { from, to },
    summary: operators.reduce((result, item) => ({
      operators: result.operators + 1,
      prospects: result.prospects + item.prospects,
      leads: result.leads + item.leads,
      managements: result.managements + item.managements,
      campaignManagements: result.campaignManagements + item.campaignManagements,
      leadManagements: result.leadManagements + item.leadManagements,
      calls: result.calls + item.calls,
      effectiveContacts: result.effectiveContacts + item.effectiveContacts,
      opportunities: result.opportunities + item.opportunities
    }), { operators: 0, prospects: 0, leads: 0, managements: 0, campaignManagements: 0, leadManagements: 0, calls: 0, effectiveContacts: 0, opportunities: 0 }),
    scope,
    operators,
    recentActivity
  };
}

async function reopenContact(campaignId, recordId, req) {
  if (!mongoose.isValidObjectId(campaignId) || !mongoose.isValidObjectId(recordId)) {
    throw httpError(400, 'Identificador de campaña o contacto inválido');
  }
  const [campaign, record] = await Promise.all([
    Campaign.findById(campaignId),
    CampaignRecord.findOne({ _id: recordId, campaignId })
  ]);
  if (!campaign || !record) throw httpError(404, 'Contacto de campaña no encontrado');
  if (record.status !== 'manual_review') {
    throw httpError(409, 'Solo se pueden reabrir contactos en revisión manual');
  }

  const queue = await CampaignQueue.findOne({ campaignRecordId: record._id });
  if (!queue) throw httpError(404, 'Cola de atención no encontrada');

  record.changeHistory.push({
    fieldKey: 'attention_reopened',
    before: record.status,
    after: 'pending_enrichment',
    actorId: req.user.id,
    actorName: req.user.name,
    note: 'Revisión manual devuelta a la cola de atención'
  });
  record.status = 'pending_enrichment';
  queue.status = 'available';
  queue.availableAt = new Date();
  queue.lastOutcome = undefined;
  queue.assignedAdvisorId = undefined;
  queue.assignedAdvisorName = undefined;
  queue.lockedBy = undefined;
  queue.lockedAt = undefined;
  queue.lockExpiresAt = undefined;
  campaign.stats.worked = Math.max(Number(campaign.stats.worked || 0) - 1, 0);

  await Promise.all([record.save(), queue.save(), campaign.save()]);
  await auditService.record(req, {
    action: 'campaign.contact.reopen',
    entityType: 'campaignRecord',
    entityId: record._id,
    metadata: { campaignId, code: record.code }
  });
  return { record: record.toObject(), queue: queue.toObject() };
}

async function discardContact(campaignId, recordId, reason, req) {
  if (!mongoose.isValidObjectId(campaignId) || !mongoose.isValidObjectId(recordId)) {
    throw httpError(400, 'Identificador de campaña o contacto inválido');
  }
  const discardReason = cleanString(reason);
  if (!discardReason) throw httpError(400, 'Indica el motivo del descarte');

  const record = await CampaignRecord.findOne({ _id: recordId, campaignId });
  if (!record) throw httpError(404, 'Contacto de campaña no encontrado');
  if (record.status !== 'manual_review') {
    throw httpError(409, 'Solo se pueden descartar contactos en revisión manual');
  }

  const queue = await CampaignQueue.findOne({ campaignRecordId: record._id });
  record.changeHistory.push({
    fieldKey: 'status',
    before: record.status,
    after: 'discarded',
    actorId: req.user.id,
    actorName: req.user.name,
    note: discardReason,
    result: 'discarded'
  });
  record.status = 'discarded';

  if (queue) {
    queue.status = 'closed';
    queue.lastOutcome = 'discarded';
    queue.lockedBy = undefined;
    queue.lockedAt = undefined;
    queue.lockExpiresAt = undefined;
  }

  await Promise.all([record.save(), queue?.save()].filter(Boolean));
  await auditService.record(req, {
    action: 'campaign.contact.discard',
    entityType: 'campaignRecord',
    entityId: record._id,
    metadata: { campaignId, code: record.code, reason: discardReason }
  });
  return { record: record.toObject(), queue: queue?.toObject() || null };
}

function rowHash(row) {
  return crypto.createHash('sha256').update(JSON.stringify(row)).digest('hex');
}

async function parseWorkbook(buffer, sheetName) {
  const rows = await readXlsxFile(buffer, sheetName ? { sheet: sheetName } : undefined);
  if (!rows.length) return [];

  const headers = rows[0].map((header, index) => String(header || `col_${index + 1}`).trim());

  return rows.slice(1).map((row) => {
    const item = {};
    headers.forEach((header, index) => {
      if (!header) return;
      item[header] = row[index] ?? '';
    });
    return item;
  });
}

function parseMapping(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_error) {
    const error = new Error('El mapeo de columnas no es válido');
    error.statusCode = 400;
    throw error;
  }
}

function normalizeHeader(value) {
  return cleanString(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function suggestMapping(headers = []) {
  const patterns = {
    name: [/^nombre$/, /nombre.*contact/, /^contacto$/, /^name$/, /full.*name/],
    companyName: [/empresa/, /compania/, /company/, /razon.*social/],
    country: [/pais/, /country/, /mercado/],
    city: [/ciudad/, /city/, /municipio/, /localidad/],
    priority: [/^prioridad$/, /priority/],
    industry: [/industria.*principal/, /^industria$/, /^sector/],
    probableMaterials: [/residuos.*probables/, /materiales.*probables/, /^residuos$/, /^materiales$/],
    website: [/pagina.*web/, /^web$/, /sitio.*web/, /website/]
  };

  const mapping = Object.entries(patterns).reduce((result, [field, expressions]) => {
    const found = headers.find((header) =>
      expressions.some((expression) => expression.test(normalizeHeader(header))));
    if (found) result[field] = found;
    return result;
  }, {});

  mapping.phones = headers.filter((header) =>
    [/telefono/, /celular/, /phone/, /whats/, /movil/]
      .some((expression) => expression.test(normalizeHeader(header))));
  mapping.emails = headers.filter((header) =>
    [/correo/, /email/, /mail/]
      .some((expression) => expression.test(normalizeHeader(header))));
  return mapping;
}

function mappedDetectedFields(row, mapping = {}) {
  const fallback = inferDetectedFields(row);
  const pick = (field) => {
    const header = cleanString(mapping[field]);
    return header && Object.prototype.hasOwnProperty.call(row, header)
      ? row[header]
      : undefined;
  };

  const mappedHeaders = (pluralField, legacyField) => {
    const configured = mapping[pluralField] ?? mapping[legacyField];
    const values = Array.isArray(configured) ? configured : [configured];
    return [...new Set(values.map(cleanString).filter(Boolean))];
  };
  const valuesFrom = (headers, splitter, normalizer) => {
    const values = headers.flatMap((header) => {
      if (!Object.prototype.hasOwnProperty.call(row, header)) return [];
      return cleanString(row[header]).split(splitter);
    });
    return [...new Set(values.map(normalizer).filter(Boolean))];
  };

  const phoneHeaders = mappedHeaders('phones', 'phone');
  const emailHeaders = mappedHeaders('emails', 'email');
  const phones = valuesFrom(phoneHeaders, /[,;|]+/, normalizePhone);
  const emails = valuesFrom(emailHeaders, /[,;|\s]+/, normalizeEmail);
  const hasPhoneMapping = Object.prototype.hasOwnProperty.call(mapping, 'phones') ||
    Object.prototype.hasOwnProperty.call(mapping, 'phone');
  const hasEmailMapping = Object.prototype.hasOwnProperty.call(mapping, 'emails') ||
    Object.prototype.hasOwnProperty.call(mapping, 'email');
  if (!hasPhoneMapping && !phones.length && fallback.phone) phones.push(fallback.phone);
  if (!hasEmailMapping && !emails.length && fallback.email) emails.push(fallback.email);
  const rawPriority = cleanString(pick('priority')).toUpperCase();
  const rawWebsite = cleanString(pick('website'));
  const website = rawWebsite && !/^https?:\/\//i.test(rawWebsite)
    ? `https://${rawWebsite}`
    : rawWebsite;

  return {
    name: cleanString(pick('name') ?? fallback.name),
    companyName: cleanString(pick('companyName') ?? fallback.companyName),
    phone: phones[0] || '',
    email: emails[0] || '',
    phones,
    emails,
    country: cleanString(pick('country') ?? fallback.country),
    city: cleanString(pick('city')),
    priority: ['A', 'B', 'C'].includes(rawPriority) ? rawPriority : '',
    industry: cleanString(pick('industry')),
    probableMaterials: cleanString(pick('probableMaterials')),
    website,
    contacts: []
  };
}

async function parseContactFile(file, sheetName) {
  const name = cleanString(file?.originalname).toLowerCase();
  let rows = [];
  let sheets = [];

  if (name.endsWith('.csv')) {
    rows = parseCsv(file.buffer, {
      bom: true,
      columns: true,
      delimiter: [',', ';', '\t', '|'],
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true
    });
  } else if (name.endsWith('.xlsx')) {
    sheets = await readSheetNames(file.buffer);
    const selectedSheet = sheetName && sheets.includes(sheetName) ? sheetName : sheets[0];
    rows = await parseWorkbook(file.buffer, selectedSheet);
    sheetName = selectedSheet;
  } else {
    const error = new Error('Formato no permitido. Usa un archivo CSV o XLSX');
    error.statusCode = 400;
    throw error;
  }

  if (!rows.length) {
    const error = new Error('El archivo no contiene contactos');
    error.statusCode = 400;
    throw error;
  }
  if (rows.length > 10000) {
    const error = new Error('El archivo supera el límite de 10.000 contactos');
    error.statusCode = 400;
    throw error;
  }

  const headers = [...new Set(rows.slice(0, 100).flatMap((row) => Object.keys(row || {})))];
  return { headers, rows, sheets, sheetName: sheetName || 'CSV' };
}

async function buildValidationContext(rows, mapping = {}) {
  const detected = rows.map((row) => mappedDetectedFields(row || {}, mapping));
  const phones = [...new Set(detected.flatMap((item) => item.phones || [item.phone]).filter(Boolean))];
  const emails = [...new Set(detected.flatMap((item) => item.emails || [item.email]).filter(Boolean))];
  const contactQuery = [];
  if (phones.length) {
    contactQuery.push({ 'detectedFields.phones': { $in: phones } });
    contactQuery.push({ 'detectedFields.phone': { $in: phones } });
  }
  if (emails.length) {
    contactQuery.push({ 'detectedFields.emails': { $in: emails } });
    contactQuery.push({ 'detectedFields.email': { $in: emails } });
  }
  const leadQuery = [];
  if (phones.length) leadQuery.push({ 'phones.normalized': { $in: phones } });
  if (emails.length) leadQuery.push({ 'emails.normalized': { $in: emails } });

  const [records, leads] = await Promise.all([
    contactQuery.length
      ? CampaignRecord.find({ $or: contactQuery })
        .select('_id detectedFields campaignId')
        .lean()
      : [],
    leadQuery.length
      ? Lead.find({ $or: leadQuery }).select('_id code phones emails').lean()
      : []
  ]);

  const existingPhones = new Map();
  const existingEmails = new Map();
  records.forEach((record) => {
    const recordPhones = record.detectedFields?.phones?.length
      ? record.detectedFields.phones
      : [record.detectedFields?.phone];
    const recordEmails = record.detectedFields?.emails?.length
      ? record.detectedFields.emails
      : [record.detectedFields?.email];
    recordPhones.filter(Boolean).forEach((phone) => existingPhones.set(phone, record));
    recordEmails.filter(Boolean).forEach((email) => existingEmails.set(email, record));
  });
  leads.forEach((lead) => {
    (lead.phones || []).forEach((phone) => {
      if (phone.normalized) existingPhones.set(phone.normalized, { lead });
    });
    (lead.emails || []).forEach((email) => {
      if (email.normalized) existingEmails.set(email.normalized, { lead });
    });
  });

  return { detected, existingPhones, existingEmails };
}

async function validateRows(rows, mapping = {}) {
  const context = await buildValidationContext(rows, mapping);
  const seenPhones = new Set();
  const seenEmails = new Set();

  return rows.map((row, index) => {
    const fields = context.detected[index];
    const phones = fields.phones || (fields.phone ? [fields.phone] : []);
    const emails = fields.emails || (fields.email ? [fields.email] : []);
    const hasIdentity = Boolean(fields.name || fields.companyName);
    const hasContact = Boolean(phones.length || emails.length);
    let status = 'valid';
    let reason = '';
    let duplicateOf = null;

    if (!hasIdentity) {
      status = 'incomplete';
      reason = 'Falta nombre o empresa';
    } else {
      const previous =
        phones.map((phone) => context.existingPhones.get(phone)).find(Boolean) ||
        emails.map((email) => context.existingEmails.get(email)).find(Boolean);
      const repeatedInFile =
        phones.some((phone) => seenPhones.has(phone)) ||
        emails.some((email) => seenEmails.has(email));

      if (previous || repeatedInFile) {
        status = 'duplicate';
        reason = repeatedInFile
          ? 'Repetido dentro del archivo'
          : previous?.lead
            ? `Ya existe como lead ${previous.lead.code || ''}`.trim()
            : 'Ya existe en otra carga de campaña';
        duplicateOf = previous?._id || null;
      }
    }

    phones.forEach((phone) => seenPhones.add(phone));
    emails.forEach((email) => seenEmails.add(email));

    return {
      rowNumber: index + 1,
      status,
      reason,
      duplicateOf,
      detectedFields: fields,
      needsEnrichment: !hasContact,
      rawData: row || {}
    };
  });
}

async function previewRows(campaignId, rows, mappingValue) {
  const campaign = await Campaign.findById(campaignId).select('_id').lean();
  if (!campaign) {
    const error = new Error('Campaña no encontrada');
    error.statusCode = 404;
    throw error;
  }

  const mapping = parseMapping(mappingValue);
  const validation = await validateRows(rows, mapping);
  const summary = validation.reduce((result, row) => {
    result[row.status] += 1;
    return result;
  }, { valid: 0, duplicate: 0, incomplete: 0 });

  return { summary, preview: validation.slice(0, 25) };
}

async function importRows(campaignId, rows, req, fileName = 'json', mapping = {}, options = {}) {
  const campaign = await Campaign.findById(campaignId);
  if (!campaign) {
    const error = new Error('Campana no encontrada');
    error.statusCode = 404;
    throw error;
  }

  const job = await ImportJob.create({
    campaignId,
    status: 'processing',
    fileName,
    sheetName: options.sheetName,
    totalRows: rows.length,
    createdBy: actorFromReq(req)
  });

  let validRows = 0;
  let duplicateRows = 0;
  let incompleteRows = 0;
  const queueCandidates = [];
  const validation = await validateRows(rows, mapping);

  for (let index = 0; index < rows.length; index += 1) {
    const validationRow = validation[index];
    const original = validationRow.rawData;
    const rawData = sanitizeMongoKeys(original, true);
    const detectedFields = validationRow.detectedFields;
    const hash = rowHash(rawData);
    const status = validationRow.status === 'valid'
      ? validationRow.needsEnrichment ? 'pending_enrichment' : 'pending'
      : validationRow.status === 'duplicate'
        ? 'duplicate_candidate'
        : 'incomplete';

    try {
      const sequenced = await Campaign.findByIdAndUpdate(
        campaignId,
        { $inc: { recordSequence: 1 } },
        { new: true }
      ).select('code recordSequence');
      const createdRecord = await CampaignRecord.create({
        code: `${sequenced.code}L${sequenced.recordSequence}`,
        campaignId,
        importJobId: job._id,
        rowNumber: index + 1,
        rowHash: hash,
        rawData,
        detectedFields,
        status,
        duplicateOf: validationRow.duplicateOf || undefined,
        metadata: validationRow.reason ? { validationReason: validationRow.reason } : {}
      });

      if (['pending', 'pending_enrichment'].includes(status)) {
        validRows += 1;
        queueCandidates.push({
          id: createdRecord._id,
          priority: detectedFields.priority === 'A' ? 30 : detectedFields.priority === 'B' ? 20 : 10
        });
      } else if (status === 'duplicate_candidate') {
        duplicateRows += 1;
      } else {
        incompleteRows += 1;
      }
    } catch (error) {
      if (error.code === 11000) {
        duplicateRows += 1;
      } else {
        job.rowErrors.push({ rowNumber: index + 1, message: error.message, rawData });
      }
    }
  }

  job.status = 'completed';
  job.processedRows = rows.length;
  job.validRows = validRows;
  job.duplicateRows = duplicateRows;
  job.incompleteRows = incompleteRows;
  job.completedAt = new Date();
  await job.save();

  campaign.stats.imported += rows.length;
  campaign.stats.duplicated += duplicateRows;
  campaign.stats.incomplete += incompleteRows;
  if (Array.isArray(options.fieldConfiguration)) {
    campaign.fieldConfiguration = options.fieldConfiguration;
  }
  if (campaign.status === 'active' && queueCandidates.length) {
    await CampaignQueue.bulkWrite(queueCandidates.map((record) => ({
      updateOne: {
        filter: { campaignRecordId: record.id },
        update: {
          $setOnInsert: {
            campaignId,
            campaignRecordId: record.id,
            status: 'available',
            priority: record.priority,
            availableAt: new Date()
          }
        },
        upsert: true
      }
    })));
    campaign.stats.queued = await CampaignQueue.countDocuments({ campaignId });
  }
  await campaign.save();

  await auditService.record(req, {
    action: 'campaign.import',
    entityType: 'campaign',
    entityId: campaignId,
    metadata: { rows: rows.length, pending: validRows, duplicateRows, incompleteRows }
  });

  return job.toObject();
}

module.exports = {
  ...crud,
  list,
  parseWorkbook,
  parseContactFile,
  parseMapping,
  suggestMapping,
  previewRows,
  importRows,
  startCampaign,
  pauseCampaign,
  stopCampaign,
  listContacts,
  adminContacts,
  assignContact,
  deleteContact,
  operatorPerformance,
  reopenContact,
  discardContact
};
