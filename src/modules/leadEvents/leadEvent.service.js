'use strict';

const LeadEvent = require('./leadEvent.model');
const Lead = require('../leads/lead.model');
const buildCrudService = require('../shared/crud.service');
const { actorFromReq } = require('../shared/schema.helpers');
const { httpError } = require('../shared/errors');
const { isAdminUser } = require('../../middlewares/auth.middleware');

module.exports = buildCrudService(LeadEvent, {
  async buildFilter(query, { req }) {
    const filter = {};
    if (query.leadId) filter.leadId = query.leadId;
    if (query.type) filter.type = query.type;

    if (!isAdminUser(req.user)) {
      const allowedLeads = await Lead.find({ assignedAdvisorId: req.user.id }).select('_id').lean();
      filter.leadId = { $in: allowedLeads.map((lead) => lead._id) };
    }

    return filter;
  },
  async beforeCreate(payload, { req }) {
    const lead = await Lead.findById(payload.leadId).lean();
    if (!lead) throw httpError(404, 'Lead no encontrado');
    if (!isAdminUser(req.user) && lead.assignedAdvisorId !== req.user.id) {
      throw httpError(403, 'No autorizado para gestionar este lead');
    }
    return { ...payload, actor: actorFromReq(req) };
  },
  async canRead(item, { req }) {
    const lead = await Lead.findById(item.leadId).select('assignedAdvisorId').lean();
    return isAdminUser(req.user) || (lead && lead.assignedAdvisorId === req.user.id);
  },
  async canWrite(item, { req }) {
    const lead = await Lead.findById(item.leadId).select('assignedAdvisorId').lean();
    return isAdminUser(req.user) || (lead && lead.assignedAdvisorId === req.user.id);
  }
});
