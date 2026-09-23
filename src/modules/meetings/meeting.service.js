'use strict';

const Meeting = require('./meeting.model');
const LeadEvent = require('../leadEvents/leadEvent.model');
const FollowUp = require('../followUps/followUp.model');
const Lead = require('../leads/lead.model');
const buildCrudService = require('../shared/crud.service');
const { actorFromReq } = require('../shared/schema.helpers');
const { httpError } = require('../shared/errors');
const { isAdminUser } = require('../../middlewares/auth.middleware');

module.exports = buildCrudService(Meeting, {
  buildFilter(query, { req }) {
    const filter = {};
    if (query.leadId) filter.leadId = query.leadId;
    if (query.status) filter.status = query.status;
    if (isAdminUser(req.user)) {
      if (query.advisorId) {
        filter.$or = [
          { advisorId: query.advisorId },
          { 'attendees.personalId': query.advisorId }
        ];
      }
    } else {
      filter.$or = [
        { advisorId: req.user.id },
        { 'attendees.personalId': req.user.id }
      ];
    }
    return filter;
  },
  async beforeCreate(payload, { req }) {
    const lead = await Lead.findById(payload.leadId).lean();
    if (!lead) throw httpError(404, 'Lead no encontrado');
    if (!isAdminUser(req.user) && lead.assignedAdvisorId !== req.user.id) {
      throw httpError(403, 'No autorizado para agendar reunion sobre este lead');
    }

    await LeadEvent.create({
      leadId: payload.leadId,
      type: 'meeting_created',
      channel: 'meeting',
      outcome: payload.channel || 'teams',
      notes: payload.title,
      actor: actorFromReq(req)
    });

    const participants = (payload.attendees || [])
      .filter((attendee) => attendee.personalId && attendee.personalId !== (payload.advisorId || req.user.id))
      .map((attendee) => ({ personalId: attendee.personalId, name: attendee.name, role: attendee.role }));
    const followUp = await FollowUp.create({
      leadId: payload.leadId,
      requestId: payload.requestId,
      assignedAdvisorId: payload.advisorId || req.user.id,
      dueAt: new Date(payload.startsAt),
      channel: 'meeting',
      reason: payload.title,
      participants,
      priority: 5
    });

    return {
      ...payload,
      followUpId: followUp._id,
      advisorId: payload.advisorId || req.user.id,
      advisorName: payload.advisorName || req.user.name
    };
  },
  async canRead(item, { req }) {
    return isAdminUser(req.user) ||
      item.advisorId === req.user.id ||
      (item.attendees || []).some((attendee) => attendee.personalId === req.user.id);
  },
  async canWrite(item, { req }) {
    return isAdminUser(req.user) || item.advisorId === req.user.id;
  }
});
