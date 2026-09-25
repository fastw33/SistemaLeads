'use strict';

const PriceSnapshot = require('./priceSnapshot.model');
const Lead = require('../leads/lead.model');
const LeadEvent = require('../leadEvents/leadEvent.model');
const buildCrudService = require('../shared/crud.service');
const { actorFromReq } = require('../shared/schema.helpers');
const { httpError } = require('../shared/errors');
const { isAdminUser } = require('../../middlewares/auth.middleware');
const { allowedBusinessUnits, hasBusinessUnitAccess } = require('../shared/leadLineAccess');

module.exports = buildCrudService(PriceSnapshot, {
  async buildFilter(query, { req }) {
    const filter = {};
    if (query.requestId) filter.requestId = query.requestId;
    if (query.source) filter.source = query.source;
    const leadFilter = { businessUnit: { $in: allowedBusinessUnits(req.user) } };
    if (!isAdminUser(req.user)) leadFilter.assignedAdvisorId = req.user.id;
    const allowedLeadIds = await Lead.distinct('_id', leadFilter);
    filter.leadId = query.leadId && allowedLeadIds.some((id) => String(id) === String(query.leadId))
      ? query.leadId
      : { $in: query.leadId ? [] : allowedLeadIds };
    return filter;
  },
  async beforeCreate(payload, { req }) {
    const lead = await Lead.findById(payload.leadId);
    if (!lead) throw httpError(404, 'Lead no encontrado');
    if (!hasBusinessUnitAccess(req.user, lead.businessUnit)) {
      throw httpError(403, 'No autorizado para gestionar esta linea comercial');
    }
    if (!isAdminUser(req.user) && lead.assignedAdvisorId !== req.user.id) {
      throw httpError(403, 'No autorizado para registrar precio sobre este lead');
    }

    const hasInformedPrice = payload.informedPrice !== undefined && payload.informedPrice !== null;
    const informedAt = hasInformedPrice || payload.informed === true ? new Date() : undefined;
    const actor = actorFromReq(req);
    const data = {
      ...payload,
      actor,
      informed: hasInformedPrice || payload.informed === true,
      informedAt
    };

    if (data.informed) {
      const amount = data.informedPrice ?? data.suggestedPrice ?? '';
      const material = String(data.material || '').trim();
      lead.status = 'price_informed';
      lead.customFields = {
        ...(lead.customFields || {}),
        lastManagedAt: informedAt,
        lastManagedBy: req.user?.id || '',
        lastManagedByName: req.user?.name || '',
        lastPrice: {
          outcome: 'price_informed',
          channel: 'price',
          note: String(data.notes || '').trim(),
          material,
          amount,
          currency: data.currency || '',
          unit: data.unit || '',
          at: informedAt
        }
      };
      lead.markModified('customFields');
      await lead.save();

      const priceText = [amount, data.currency, data.unit ? `por ${data.unit}` : '']
        .filter((value) => value !== undefined && value !== null && value !== '')
        .join(' ');
      await LeadEvent.create({
        leadId: data.leadId,
        type: 'price_informed',
        channel: 'system',
        outcome: data.source,
        notes: `Precio informado${material ? ` para ${material}` : ''}: ${priceText}`.trim(),
        actor,
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
