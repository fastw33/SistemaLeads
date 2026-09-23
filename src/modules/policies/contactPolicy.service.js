'use strict';

const ContactPolicy = require('./contactPolicy.model');
const Lead = require('../leads/lead.model');
const buildCrudService = require('../shared/crud.service');
const { actorFromReq } = require('../shared/schema.helpers');
const { httpError } = require('../shared/errors');
const { isAdminUser } = require('../../middlewares/auth.middleware');

module.exports = buildCrudService(ContactPolicy, {
  buildFilter(query) {
    const filter = {};
    if (query.leadId) filter.leadId = query.leadId;
    if (query.type) filter.type = query.type;
    if (query.active !== undefined) filter.active = query.active === 'true';
    return filter;
  },
  async beforeCreate(payload, { req }) {
    const lead = await Lead.findById(payload.leadId).select('assignedAdvisorId').lean();
    if (!lead) throw httpError(404, 'Lead no encontrado');
    if (!isAdminUser(req.user) && lead.assignedAdvisorId !== req.user.id) {
      throw httpError(403, 'No autorizado para crear politica sobre este lead');
    }
    if (payload.type === 'do_not_contact') {
      await Lead.findByIdAndUpdate(payload.leadId, { status: 'do_not_contact' });
    }
    return { ...payload, createdBy: actorFromReq(req) };
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
