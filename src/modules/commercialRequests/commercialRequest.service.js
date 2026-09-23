'use strict';

const CommercialRequest = require('./commercialRequest.model');
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

function canAccessAssigned(item, req) {
  return hasBusinessUnitAccess(req.user, item.businessUnit) &&
    (isAdminUser(req.user) || item.assignedAdvisorId === req.user.id);
}

module.exports = buildCrudService(CommercialRequest, {
  async buildFilter(query, { req }) {
    const filter = {};
    if (query.leadId) filter.leadId = query.leadId;
    if (query.status) filter.status = query.status;
    if (query.type) filter.type = query.type;
    applyBusinessUnitFilter(filter, req.user, query.businessUnit);
    if (!isAdminUser(req.user)) filter.assignedAdvisorId = req.user.id;
    return filter;
  },
  async beforeCreate(payload, { req }) {
    const lead = await Lead.findById(payload.leadId).lean();
    if (!lead) throw httpError(404, 'Lead no encontrado');
    assertBusinessUnitAccess(req.user, lead.businessUnit);
    if (!isAdminUser(req.user) && lead.assignedAdvisorId !== req.user.id) {
      throw httpError(403, 'No autorizado para crear solicitud sobre este lead');
    }
    const data = {
      ...payload,
      code: payload.code || await counterService.nextCode('HC-REQ'),
      accountId: payload.accountId || lead.accountId,
      businessUnit: lead.businessUnit,
      serviceLine: payload.serviceLine || lead.serviceLine,
      assignedAdvisorId: payload.assignedAdvisorId || lead.assignedAdvisorId || req.user.id
    };

    if (data.type === 'price_inquiry' && data.requiresMeeting) {
      data.status = 'pending_meeting';
    }

    await LeadEvent.create({
      leadId: lead._id,
      type: data.type === 'logistics_quote' ? 'quote_requested' : 'note',
      channel: 'system',
      outcome: data.type,
      notes: data.subject || data.description,
      actor: actorFromReq(req),
      metadata: { requestCode: data.code }
    });

    return data;
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
    return canAccessAssigned(item, req);
  },
  async canWrite(item, { req }) {
    return canAccessAssigned(item, req);
  }
});
