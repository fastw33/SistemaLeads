'use strict';

const PriceSnapshot = require('./priceSnapshot.model');
const Lead = require('../leads/lead.model');
const LeadEvent = require('../leadEvents/leadEvent.model');
const buildCrudService = require('../shared/crud.service');
const { actorFromReq } = require('../shared/schema.helpers');
const { httpError } = require('../shared/errors');
const { isAdminUser } = require('../../middlewares/auth.middleware');

module.exports = buildCrudService(PriceSnapshot, {
  async buildFilter(query, { req }) {
    const filter = {};
    if (query.leadId) filter.leadId = query.leadId;
    if (query.requestId) filter.requestId = query.requestId;
    if (query.source) filter.source = query.source;
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
      throw httpError(403, 'No autorizado para registrar precio sobre este lead');
    }

    const hasInformedPrice = payload.informedPrice !== undefined && payload.informedPrice !== null;
    const data = {
      ...payload,
      actor: actorFromReq(req),
      informed: hasInformedPrice || payload.informed === true,
      informedAt: hasInformedPrice || payload.informed === true ? new Date() : undefined
    };

    if (data.informed) {
      await Lead.findByIdAndUpdate(data.leadId, { status: 'price_informed' });
      const amount = data.informedPrice ?? data.suggestedPrice ?? '';
      const material = String(data.material || '').trim();
      const priceText = [amount, data.currency, data.unit ? `por ${data.unit}` : '']
        .filter((value) => value !== undefined && value !== null && value !== '')
        .join(' ');
      await LeadEvent.create({
        leadId: data.leadId,
        type: 'price_informed',
        channel: 'system',
        outcome: data.source,
        notes: `Precio informado${material ? ` para ${material}` : ''}: ${priceText}`.trim(),
        actor: actorFromReq(req),
        metadata: {
          requestId: data.requestId,
          materialId: data.materialId,
          priceHistoryId: data.priceHistoryId,
          material: data.material,
          section: data.section,
          suggestedPrice: data.suggestedPrice,
          informedPrice: data.informedPrice,
          currency: data.currency,
          unit: data.unit,
          observedAt: data.observedAt
        }
      });
    }

    return data;
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
