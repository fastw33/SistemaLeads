'use strict';

const Opportunity = require('./opportunity.model');
const Lead = require('../leads/lead.model');
const LeadEvent = require('../leadEvents/leadEvent.model');
const buildCrudService = require('../shared/crud.service');
const counterService = require('../counters/counter.service');
const { actorFromReq } = require('../shared/schema.helpers');
const { httpError } = require('../shared/errors');
const { isAdminUser } = require('../../middlewares/auth.middleware');
const {
  applyBusinessUnitFilter,
  assertBusinessUnitAccess,
  hasBusinessUnitAccess
} = require('../shared/leadLineAccess');

module.exports = buildCrudService(Opportunity, {
  buildFilter(query, { req }) {
    const filter = {};
    if (query.stage) filter.stage = query.stage;
    applyBusinessUnitFilter(filter, req.user, query.businessUnit);
    if (query.leadId) filter.leadId = query.leadId;
    if (isAdminUser(req.user)) {
      if (query.assignedAdvisorId) filter.assignedAdvisorId = query.assignedAdvisorId;
    } else {
      filter.assignedAdvisorId = req.user.id;
    }
    return filter;
  },
  async beforeCreate(payload, { req }) {
    const lead = await Lead.findById(payload.leadId).lean();
    if (!lead) throw httpError(404, 'Lead no encontrado');
    assertBusinessUnitAccess(req.user, lead.businessUnit);
    if (!isAdminUser(req.user) && lead.assignedAdvisorId !== req.user.id) {
      throw httpError(403, 'No autorizado para crear oportunidad sobre este lead');
    }
    const code = payload.code || await counterService.nextCode('HC-OPP');
    await Lead.findByIdAndUpdate(payload.leadId, { status: 'opportunity' });
    await LeadEvent.create({
      leadId: payload.leadId,
      type: 'status_change',
      channel: 'system',
      outcome: 'opportunity',
      notes: payload.nextStep,
      actor: actorFromReq(req),
      metadata: { opportunityCode: code }
    });
    return {
      ...payload,
      code,
      businessUnit: lead.businessUnit,
      serviceLine: lead.serviceLine,
      assignedAdvisorId: payload.assignedAdvisorId || req.user.id
    };
  },
  beforeUpdate(payload, current, { req }) {
    assertBusinessUnitAccess(req.user, current.businessUnit);
    return {
      ...payload,
      leadId: current.leadId,
      businessUnit: current.businessUnit,
      serviceLine: current.serviceLine
    };
  },
  async canRead(item, { req }) {
    return hasBusinessUnitAccess(req.user, item.businessUnit) &&
      (isAdminUser(req.user) || item.assignedAdvisorId === req.user.id);
  },
  async canWrite(item, { req }) {
    return hasBusinessUnitAccess(req.user, item.businessUnit) &&
      (isAdminUser(req.user) || item.assignedAdvisorId === req.user.id);
  }
});
