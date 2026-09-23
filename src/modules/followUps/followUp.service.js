'use strict';

const FollowUp = require('./followUp.model');
const Lead = require('../leads/lead.model');
const Meeting = require('../meetings/meeting.model');
const Campaign = require('../campaigns/campaign.model');
const CampaignRecord = require('../campaigns/campaignRecord.model');
const CampaignQueue = require('../campaignQueue/campaignQueue.model');
const buildCrudService = require('../shared/crud.service');
const { isAdminUser } = require('../../middlewares/auth.middleware');
const { allowedBusinessUnits, hasBusinessUnitAccess } = require('../shared/leadLineAccess');

const baseService = buildCrudService(FollowUp, {
  async buildFilter(query, { req }) {
    const filter = {};
    if (isAdminUser(req.user)) {
      if (query.assignedAdvisorId) {
        filter.$or = [
          { assignedAdvisorId: query.assignedAdvisorId },
          { 'participants.personalId': query.assignedAdvisorId }
        ];
      }
    } else {
      filter.$or = [
        { assignedAdvisorId: req.user.id },
        { 'participants.personalId': req.user.id }
      ];
    }
    if (query.status) filter.status = query.status;
    const allowedLeadIds = await Lead.distinct('_id', {
      businessUnit: { $in: allowedBusinessUnits(req.user) }
    });
    filter.leadId = query.leadId && allowedLeadIds.some((id) => String(id) === String(query.leadId))
      ? query.leadId
      : { $in: query.leadId ? [] : allowedLeadIds };
    return filter;
  },
  async canRead(item, { req }) {
    const lead = await Lead.findById(item.leadId).select('businessUnit').lean();
    return Boolean(lead && hasBusinessUnitAccess(req.user, lead.businessUnit)) && (
      isAdminUser(req.user) ||
      item.assignedAdvisorId === req.user.id ||
      (item.participants || []).some((participant) => participant.personalId === req.user.id)
    );
  },
  async canWrite(item, { req }) {
    const lead = await Lead.findById(item.leadId).select('businessUnit').lean();
    return Boolean(lead && hasBusinessUnitAccess(req.user, lead.businessUnit)) &&
      (isAdminUser(req.user) || item.assignedAdvisorId === req.user.id);
  }
});

function leadBrief(lead) {
  if (!lead) return null;
  return {
    _id: lead._id,
    code: lead.code,
    name: lead.name,
    companyName: lead.companyName,
    businessUnit: lead.businessUnit,
    status: lead.status,
    phones: lead.phones,
    emails: lead.emails
  };
}

async function enrichAgendaItems(items, req) {
  const leadIds = [...new Set(items.map((item) => String(item.leadId || '')).filter(Boolean))];
  const followUpIds = items.map((item) => item._id);
  const [leads, meetings] = await Promise.all([
    Lead.find({ _id: { $in: leadIds } })
      .select('code name companyName businessUnit status phones emails')
      .lean(),
    Meeting.find({ followUpId: { $in: followUpIds } }).lean()
  ]);
  const leadsById = new Map(leads.map((lead) => [String(lead._id), lead]));
  const meetingsByFollowUp = new Map(meetings.map((meeting) => [String(meeting.followUpId), meeting]));

  return items.map((item) => {
    const isOwner = item.assignedAdvisorId === req.user.id;
    return {
      ...item,
      agendaRole: isOwner ? 'owner' : 'participant',
      canManage: isAdminUser(req.user) || isOwner,
      lead: leadBrief(leadsById.get(String(item.leadId))),
      meeting: meetingsByFollowUp.get(String(item._id)) || null
    };
  });
}

async function campaignAgendaItems(query, req) {
  if (query.leadId) return [];
  const advisorId = isAdminUser(req.user)
    ? String(query.assignedAdvisorId || '')
    : String(req.user.id || '');
  if (!advisorId) return [];

  const allowedCampaignIds = await Campaign.distinct('_id', {
    businessUnit: { $in: allowedBusinessUnits(req.user) }
  });

  const queueItems = await CampaignQueue.find({
    assignedAdvisorId: advisorId,
    campaignId: { $in: allowedCampaignIds },
    $or: [
      { status: 'rescheduled', availableAt: { $ne: null } },
      { status: 'worked', lastOutcome: { $in: ['follow_up_completed', 'follow_up_cancelled'] } }
    ]
  }).sort({ availableAt: 1, updatedAt: -1 }).limit(100).lean();
  if (!queueItems.length) return [];

  const recordIds = queueItems.map((item) => item.campaignRecordId);
  const campaignIds = queueItems.map((item) => item.campaignId);
  const [records, campaigns] = await Promise.all([
    CampaignRecord.find({ _id: { $in: recordIds } }).lean(),
    Campaign.find({ _id: { $in: campaignIds } }).select('code name businessUnit status').lean()
  ]);
  const recordsById = new Map(records.map((record) => [String(record._id), record]));
  const campaignsById = new Map(campaigns.map((campaign) => [String(campaign._id), campaign]));
  const now = Date.now();

  return queueItems.map((item) => {
    const record = recordsById.get(String(item.campaignRecordId));
    const campaign = campaignsById.get(String(item.campaignId));
    const history = [...(record?.changeHistory || [])].reverse();
    const scheduleEvent = history.find((event) => event.nextAttemptAt);
    const resolutionEvent = history.find((event) => event.fieldKey === 'follow_up_result');
    const resolved = ['follow_up_completed', 'follow_up_cancelled'].includes(item.lastOutcome);
    const status = item.lastOutcome === 'follow_up_completed'
      ? 'done'
      : item.lastOutcome === 'follow_up_cancelled'
        ? 'cancelled'
        : new Date(item.availableAt).getTime() < now ? 'overdue' : 'pending';
    const dueAt = item.availableAt || scheduleEvent?.nextAttemptAt || resolutionEvent?.changedAt || item.updatedAt;
    return {
      _id: `campaign-${item._id}`,
      agendaEntity: 'campaign',
      campaignQueueId: item._id,
      assignedAdvisorId: item.assignedAdvisorId,
      dueAt,
      channel: scheduleEvent?.channel || 'phone',
      reason: scheduleEvent?.note || 'Volver a contactar prospecto de campaña',
      participants: [],
      priority: item.priority || 0,
      status,
      completedAt: resolved ? resolutionEvent?.changedAt || item.updatedAt : null,
      metadata: {
        scheduledNote: scheduleEvent?.note || '',
        campaignCode: campaign?.code || '',
        campaignName: campaign?.name || '',
        campaignRecordCode: record?.code || '',
        result: resolved ? item.lastOutcome : '',
        comment: resolutionEvent?.note || '',
        activityPerformed: item.lastOutcome === 'follow_up_completed'
      },
      agendaRole: 'owner',
      canManage: true,
      lead: null,
      meeting: null,
      campaignAgenda: { item, record, campaign }
    };
  }).filter((item) => !query.status || item.status === query.status);
}

module.exports = {
  ...baseService,
  async list(query = {}, context = {}) {
    await FollowUp.updateMany(
      { status: 'pending', dueAt: { $lt: new Date() } },
      { $set: { status: 'overdue' } }
    );
    const result = await baseService.list(query, context);
    const [leadItems, campaignItems] = await Promise.all([
      enrichAgendaItems(result.items, context.req),
      campaignAgendaItems(query, context.req)
    ]);
    const items = [...leadItems, ...campaignItems]
      .sort((left, right) => new Date(left.dueAt) - new Date(right.dueAt));
    return { ...result, items, total: result.total + campaignItems.length };
  },
  async getById(id, context = {}) {
    const item = await baseService.getById(id, context);
    return (await enrichAgendaItems([item], context.req))[0];
  }
};
