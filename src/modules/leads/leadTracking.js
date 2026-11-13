'use strict';

const { httpError } = require('../shared/errors');
const { LEAD_STATUSES } = require('../shared/business.constants');

const INTAKE_STATUSES = ['new', 'queued', 'incomplete'];
const WON_STATUSES = ['won', 'purchase_completed'];
const LOST_STATUSES = ['lost', 'do_not_contact'];
const CLOSED_STATUSES = [...WON_STATUSES, ...LOST_STATUSES, 'discarded'];
const VIEW_STATUSES = { won: WON_STATUSES, lost: LOST_STATUSES, discarded: ['discarded'], closures: CLOSED_STATUSES, intake: INTAKE_STATUSES };
const ACTIVE_STATUSES = LEAD_STATUSES.filter(status => ![...INTAKE_STATUSES, ...CLOSED_STATUSES].includes(status));
const DATE_FIELDS = { created: '$createdAt', assigned: '$tracking.assignedAt', managed: '$tracking.lastManagedAt', next: '$tracking.nextAt', closed: '$closedAt' };
const STATUS_LABELS = {
  new: 'Nuevo', queued: 'En bandeja', assigned: 'Asignado', contact_attempted: 'Intento contacto',
  contacted: 'Contactado', consultation: 'Consulta', meeting_required: 'Requiere reunión',
  meeting_scheduled: 'Reunión agendada', meeting_completed: 'Reunión realizada', meeting_not_completed: 'Reunión no realizada',
  visit_scheduled: 'Visita agendada', visit_completed: 'Visita realizada', visit_not_completed: 'Visita no realizada',
  pickup_scheduled: 'Recepción en bodega agendada', pickup_completed: 'Recepción en bodega realizada', pickup_not_completed: 'Recepción en bodega no realizada',
  price_requested: 'Precio solicitado', price_informed: 'Precio informado', quote_created: 'CT creada', quote_sent: 'Cotización enviada',
  opportunity: 'Oportunidad', won: 'Ganado', purchase_completed: 'Ganado', lost: 'Cerrado sin éxito',
  do_not_contact: 'Cerrado sin éxito', discarded: 'Descartado', incomplete: 'Incompleto'
};

function trackingSort(query) {
  if (!query.sortBy) return [];
  const text = expression => ({ $toLower: { $trim: { input: expression } } });
  const date = expression => ({ $convert: { input: expression, to: 'date', onError: null, onNull: null } });
  const operation = { $ifNull: ['$customFields.lastOperation.operationId', { $ifNull: ['$customFields.lastOperation.shipmentNumber', '$customFields.lastOperation.shipmentId'] }] };
  const reason = { $ifNull: ['$closedReason', { $ifNull: ['$customFields.lastNote', ''] }] };
  const idSource = { $convert: { input: { $ifNull: ['$sequence', '$code'] }, to: 'string', onError: '', onNull: '' } };
  const displayId = { $let: {
    vars: { supplied: { $regexFind: { input: { $toUpper: { $ifNull: ['$displayId', idSource] } }, regex: '^(LF|LH|LG|L)-[0-9]+$' } }, suffix: { $regexFind: { input: idSource, regex: '[0-9]+$' } } },
    in: { $ifNull: ['$$supplied.match', { $concat: [
      { $switch: { branches: [{ case: { $eq: ['$businessUnit', 'Fastway'] }, then: 'LF-' }, { case: { $eq: ['$businessUnit', 'Harvest'] }, then: 'LH-' }, { case: { $eq: ['$businessUnit', 'Greenway'] }, then: 'LG-' }], default: 'L-' } },
      '$$suffix.match'
    ] }] }
  } };
  const fields = {
    id: displayId,
    lead: { $ifNull: ['$name', ''] },
    advisor: { $ifNull: ['$assignedAdvisorName', 'Sin asesor'] },
    status: { $switch: { branches: Object.entries(STATUS_LABELS).map(([status, label]) => ({ case: { $eq: ['$status', status] }, then: label })), default: '$status' } },
    managedAt: date('$tracking.lastManagedAt'),
    closedAt: date({ $ifNull: ['$closedAt', '$updatedAt'] }),
    nextStep: { $ifNull: ['$tracking.nextStep', ''] },
    closureDetail: { $cond: [
      { $and: [{ $ne: [{ $ifNull: [operation, ''] }, ''] }, { $ne: [operation, null] }] },
      { $concat: [{ $cond: [{ $eq: ['$customFields.lastOperation.operationType', 'lot'] }, 'Lote ', 'DO '] }, { $convert: { input: operation, to: 'string', onError: '', onNull: '' } }, ' · ', reason] },
      reason
    ] }
  };
  if (!Object.hasOwn(fields, query.sortBy)) throw httpError(400, 'Columna de orden inválida');
  if (query.sortDirection && !['asc', 'desc'].includes(query.sortDirection)) throw httpError(400, 'Dirección de orden inválida');
  const expression = ['managedAt', 'closedAt'].includes(query.sortBy) ? fields[query.sortBy] : text(fields[query.sortBy]);
  return [
    { $set: { _sortValue: expression } },
    { $set: { _sortMissing: { $cond: [{ $in: [{ $ifNull: ['$_sortValue', null] }, [null, '']] }, 1, 0] } } },
    { $sort: { _sortMissing: 1, _sortValue: query.sortDirection === 'desc' ? -1 : 1, _id: 1 } }
  ];
}

function dateBounds(from, to) {
  const parse = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw httpError(400, 'La fecha debe tener formato AAAA-MM-DD');
    const day = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== value) throw httpError(400, 'Fecha inválida');
    // Colombia uses UTC-05:00 throughout the year. Include the entire final day.
    return new Date(day.getTime() + 5 * 60 * 60 * 1000);
  };
  const start = from ? parse(from) : null;
  const end = to ? parse(to) : null;
  if (start && end && start > end) throw httpError(400, 'La fecha inicial no puede ser posterior a la final');
  return { ...(start ? { $gte: start } : {}), ...(end ? { $lt: new Date(end.getTime() + 86400000) } : {}) };
}

function pagination(query, defaultLimit = 25) {
  const integer = (value, fallback) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
  return { page: integer(query.page, 1), limit: Math.min(integer(query.limit, defaultLimit), 100) };
}

function trackingPipeline(baseFilter, query, now = new Date()) {
  const { page, limit } = pagination(query);
  const sort = trackingSort(query);
  const view = query.view || 'active';
  if (!['active', 'closures', 'won', 'lost', 'discarded', 'intake', 'all'].includes(view)) throw httpError(400, 'Vista de seguimiento inválida');
  const dateField = query.dateField || 'created';
  if (!DATE_FIELDS[dateField]) throw httpError(400, 'Tipo de fecha inválido');
  const bounds = dateBounds(query.from, query.to);
  const statusSet = view === 'active' ? ACTIVE_STATUSES : VIEW_STATUSES[view] || LEAD_STATUSES;
  const detailFilter = { status: { $in: statusSet } };
  if (query.status && query.status !== 'all') detailFilter.status = { $in: String(query.status).split(',').filter(status => statusSet.includes(status)) };
  if (query.assignedAdvisorId === 'unassigned') detailFilter.$or = [{ assignedAdvisorId: null }, { assignedAdvisorId: '' }];
  else if (query.assignedAdvisorId && query.assignedAdvisorId !== 'all') detailFilter.assignedAdvisorId = query.assignedAdvisorId;
  const attentionKeys = ['unmanaged', 'overdue', 'scheduled', 'no_next', 'repeated', 'closed', 'review'];
  if (query.attention && query.attention !== 'all') {
    if (!attentionKeys.includes(query.attention)) throw httpError(400, 'Filtro de atención inválido');
    if (query.attention === 'repeated') detailFilter['tracking.failedAttempts'] = { $gte: 3 };
    else if (query.attention === 'review') detailFilter['tracking.pendingReviews'] = { $gt: 0 };
    else detailFilter['tracking.attention'] = query.attention;
  }
  const count = match => [{ $match: match }, { $count: 'total' }];
  return [
    { $match: baseFilter },
    { $lookup: { from: 'leadevents', let: { lead: '$_id' }, pipeline: [
      { $match: { $expr: { $eq: ['$leadId', '$$lead'] }, type: { $nin: ['assignment', 'imported'] }, 'metadata.supervision': { $ne: true } } },
      { $sort: { createdAt: -1, _id: -1 } }, { $limit: 3 }
    ], as: '_trackingEvents' } },
    { $lookup: { from: 'followups', let: { lead: '$_id' }, pipeline: [
      { $match: { $expr: { $eq: ['$leadId', '$$lead'] }, status: { $in: ['pending', 'overdue'] } } },
      { $sort: { dueAt: 1, _id: 1 } }, { $limit: 1 }
    ], as: '_trackingNext' } },
    { $lookup: { from: 'leadreviews', let: { lead: '$_id' }, pipeline: [
      { $match: { $expr: { $eq: ['$leadId', '$$lead'] }, status: 'pending' } },
      { $group: { _id: null, pending: { $sum: 1 }, overdue: { $sum: { $cond: [{ $lt: ['$dueAt', now] }, 1, 0] } } } }
    ], as: '_trackingReviews' } },
    { $set: { tracking: {
      assignedAt: { $convert: { input: { $ifNull: ['$customFields.lastReassignedAt', '$customFields.crmStartedAt'] }, to: 'date', onError: null, onNull: null } },
      pendingReviews: { $ifNull: [{ $arrayElemAt: ['$_trackingReviews.pending', 0] }, 0] },
      overdueReviews: { $ifNull: [{ $arrayElemAt: ['$_trackingReviews.overdue', 0] }, 0] },
      lastEvent: { $ifNull: [{ $arrayElemAt: ['$_trackingEvents', 0] }, null] },
      lastManagedAt: { $max: [
        { $convert: { input: '$customFields.lastManagedAt', to: 'date', onError: null, onNull: null } },
        '$lastContactAt', { $arrayElemAt: ['$_trackingEvents.createdAt', 0] }
      ] },
      nextAt: { $ifNull: [{ $arrayElemAt: ['$_trackingNext.dueAt', 0] }, '$nextFollowUpAt'] },
      nextStep: { $ifNull: [{ $arrayElemAt: ['$_trackingNext.reason', 0] }, '$customFields.nextStep'] },
      failedAttempts: { $size: { $filter: { input: '$_trackingEvents', as: 'event', cond: { $in: ['$$event.outcome', ['no_answer', 'busy', 'wrong_number', 'invalid_whatsapp', 'email_bounced']] } } } }
    } } },
    { $set: { 'tracking.attention': { $switch: { branches: [
      { case: { $in: ['$status', CLOSED_STATUSES] }, then: 'closed' },
      { case: { $and: [{ $ne: [{ $ifNull: ['$tracking.nextAt', null] }, null] }, { $lt: ['$tracking.nextAt', now] }] }, then: 'overdue' },
      { case: { $ne: [{ $ifNull: ['$tracking.nextAt', null] }, null] }, then: 'scheduled' },
      { case: { $eq: ['$tracking.lastManagedAt', null] }, then: 'unmanaged' }
    ], default: 'no_next' } } } },
    ...(Object.keys(bounds).length ? [{ $match: { [DATE_FIELDS[dateField].slice(1)]: bounds } }] : []),
    { $facet: {
      items: [ { $match: detailFilter },
        { $set: { _attentionOrder: { $switch: { branches: [
          { case: { $eq: ['$tracking.attention', 'overdue'] }, then: 0 },
          { case: { $eq: ['$tracking.attention', 'unmanaged'] }, then: 1 },
          { case: { $eq: ['$tracking.attention', 'no_next'] }, then: 2 }
        ], default: 3 } } } },
        ...(sort.length ? sort : [{ $sort: { _attentionOrder: 1, 'tracking.nextAt': 1, 'tracking.lastManagedAt': 1, createdAt: -1, _id: 1 } }]),
        { $skip: (page - 1) * limit }, { $limit: limit }, { $unset: ['_trackingEvents', '_trackingNext', '_trackingReviews', '_attentionOrder', '_sortValue', '_sortMissing'] }
      ],
      total: count(detailFilter),
      views: [{ $group: { _id: { $switch: { branches: [
        { case: { $in: ['$status', INTAKE_STATUSES] }, then: 'intake' },
        { case: { $in: ['$status', WON_STATUSES] }, then: 'won' },
        { case: { $in: ['$status', LOST_STATUSES] }, then: 'lost' },
        { case: { $eq: ['$status', 'discarded'] }, then: 'discarded' }
      ], default: 'active' } }, total: { $sum: 1 } } }],
      advisors: [{ $match: { status: { $in: statusSet } } }, { $group: { _id: { $ifNull: ['$assignedAdvisorId', ''] }, name: { $max: '$assignedAdvisorName' } } }, { $sort: { name: 1, _id: 1 } }],
      metrics: [{ $match: detailFilter }, { $group: { _id: '$tracking.attention', total: { $sum: 1 } } }],
      closures: [{ $match: detailFilter }, { $group: { _id: null,
        won: { $sum: { $cond: [{ $in: ['$status', WON_STATUSES] }, 1, 0] } },
        unsuccessful: { $sum: { $cond: [{ $in: ['$status', LOST_STATUSES] }, 1, 0] } },
        discarded: { $sum: { $cond: [{ $eq: ['$status', 'discarded'] }, 1, 0] } },
        operations: { $sum: { $cond: [{ $ne: [{ $ifNull: ['$customFields.lastOperation', null] }, null] }, 1, 0] } }
      } }]
    } }
  ];
}

module.exports = { ACTIVE_STATUSES, CLOSED_STATUSES, INTAKE_STATUSES, dateBounds, pagination, trackingPipeline };
