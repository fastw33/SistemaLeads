'use strict';

const ContactPolicy = require('./contactPolicy.model');
const Lead = require('../leads/lead.model');
const buildCrudService = require('../shared/crud.service');
const { actorFromReq } = require('../shared/schema.helpers');
const { httpError } = require('../shared/errors');
const { isAdminUser } = require('../../middlewares/auth.middleware');
const { allowedBusinessUnits, hasBusinessUnitAccess } = require('../shared/leadLineAccess');

module.exports = buildCrudService(ContactPolicy, {
  async buildFilter(query, { req }) {
    const filter = {};
    if (query.type) filter.type = query.type;
    if (query.active !== undefined) filter.active = query.active === 'true';
    const leadFilter = { businessUnit: { $in: allowedBusinessUnits(req.user) } };
    if (!isAdminUser(req.user)) leadFilter.assignedAdvisorId = req.user.id;
    const allowedLeadIds = await Lead.distinct('_id', leadFilter);
    filter.leadId = query.leadId && allowedLeadIds.some((id) => String(id) === String(query.leadId))
      ? query.leadId
      : { $in: query.leadId ? [] : allowedLeadIds };
    return filter;
  },
  async beforeCreate(payload, { req }) {
    const lead = await Lead.findById(payload.leadId).select('assignedAdvisorId businessUnit').lean();
    if (!lead) throw httpError(404, 'Lead no encontrado');
    if (!hasBusinessUnitAccess(req.user, lead.businessUnit)) {
      throw httpError(403, 'No autorizado para gestionar esta linea comercial');
    }
    if (!isAdminUser(req.user) && lead.assignedAdvisorId !== req.user.id) {
      throw httpError(403, 'No autorizado para crear politica sobre este lead');
    }
    if (payload.type === 'do_not_contact') {
      await Lead.findByIdAndUpdate(payload.leadId, { status: 'do_not_contact' });
    }
    return { ...payload, createdBy: actorFromReq(req) };
  },
  async canRead(item, { req }) {
    const lead = await Lead.findById(item.leadId).select('assignedAdvisorId businessUnit').lean();
    return Boolean(lead && hasBusinessUnitAccess(req.user, lead.businessUnit)) &&
      (isAdminUser(req.user) || lead.assignedAdvisorId === req.user.id);
  },
  async canWrite(item, { req }) {
    const lead = await Lead.findById(item.leadId).select('assignedAdvisorId businessUnit').lean();
    return Boolean(lead && hasBusinessUnitAccess(req.user, lead.businessUnit)) &&
      (isAdminUser(req.user) || lead.assignedAdvisorId === req.user.id);
  }
});
