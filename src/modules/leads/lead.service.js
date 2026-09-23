'use strict';

const { DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const mongoose = require('mongoose');
const Lead = require('./lead.model');
const LeadEvent = require('../leadEvents/leadEvent.model');
const Attachment = require('../attachments/attachment.model');
const Campaign = require('../campaigns/campaign.model');
const CampaignRecord = require('../campaigns/campaignRecord.model');
const CampaignQueue = require('../campaignQueue/campaignQueue.model');
const CommercialRequest = require('../commercialRequests/commercialRequest.model');
const FollowUp = require('../followUps/followUp.model');
const Meeting = require('../meetings/meeting.model');
const Opportunity = require('../opportunities/opportunity.model');
const PriceSnapshot = require('../priceSnapshots/priceSnapshot.model');
const ContactPolicy = require('../policies/contactPolicy.model');
const auditService = require('../audit/audit.service');
const buildCrudService = require('../shared/crud.service');
const counterService = require('../counters/counter.service');
const { actorFromReq } = require('../shared/schema.helpers');
const { isAdminUser } = require('../../middlewares/auth.middleware');
const { httpError } = require('../shared/errors');
const { getS3Client, uploadLeadFiles } = require('./leadPublic.storage');
const { sendLeadNotification } = require('./leadPublic.mailer');
const {
  notifyAssignment,
  notifyCancelledFollowUp,
  notifyScheduledFollowUp
} = require('../notifications/leadNotification.service');
const {
  cleanString,
  inferBusinessUnit,
  inferDetectedFields,
  normalizeEmail,
  normalizePhone
} = require('../../utils/normalize');

function normalizeLead(payload, current = {}) {
  const hasPhones = Array.isArray(payload.phones);
  const hasEmails = Array.isArray(payload.emails);
  const phones = hasPhones ? payload.phones : undefined;
  const emails = hasEmails ? payload.emails : undefined;
  const serviceLine =
    normalizeServiceLineText(payload.serviceLine) ||
    current.serviceLine ||
    'consulta_general';
  const requestedUnit =
    lineKeyToBusinessUnit(payload.businessUnit || payload.lineKey) ||
    inferBusinessUnitFromText(payload.businessUnit || current.businessUnit);
  const businessUnit = inferBusinessUnit({
    country: payload.country || current.country,
    requestedUnit: requestedUnit || current.businessUnit,
    serviceLine
  });

  const data = {
    ...payload,
    serviceLine,
    businessUnit
  };

  if (hasPhones) {
    data.phones = phones.map((item) => ({
      ...item,
      normalized: normalizePhone(item.normalized || item.raw || item.value)
    })).filter((item) => item.normalized || item.raw);
  }

  if (hasEmails) {
    data.emails = emails.map((item) => ({
      ...item,
      normalized: normalizeEmail(item.normalized || item.raw || item.value)
    })).filter((item) => item.normalized || item.raw);
  }

  return data;
}

function normalizeKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

function escapeRegex(value) {
  return cleanString(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseRoleList(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return String(value).split(',').map((role) => role.trim()).filter(Boolean);
}

function hasLeadPermission(user = {}, permission) {
  const permisos = user.permisos || {};
  if (permisos && permisos[permission] === true) return true;

  return parseRoleList(user.roles).some((role) => String(role).toLowerCase() === String(permission).toLowerCase());
}

function canManageLeadInbox(user = {}) {
  if (isAdminUser(user)) return true;

  return [
    'leads',
    'leadsGestion',
    'leadsCrearManual',
    'leadsAdmin',
    'hubComercialAdmin',
    'gestionComercial',
    'comercial_admin',
    'leads_admin'
  ].some((permission) => hasLeadPermission(user, permission));
}

function canAdministerLeads(user = {}) {
  if (isAdminUser(user)) return true;

  return [
    'leadsAdmin',
    'hubComercialAdmin',
    'gestionComercialAdmin',
    'comercial_admin',
    'leads_admin'
  ].some((permission) => hasLeadPermission(user, permission));
}

function canAccessOwnManualLead(item, user = {}) {
  return String(item?.customFields?.intakeCreatedBy || '') === String(user?.id || '');
}

function canWriteLead(item, user = {}) {
  return (
    canManageLeadInbox(user) ||
    String(item?.assignedAdvisorId || '') === String(user?.id || '') ||
    canAccessOwnManualLead(item, user)
  );
}

function applyLeadVisibilityFilter(filter, req) {
  const userId = req.user?.id;
  if (!userId) return filter;

  const visibility = {
    $or: [
      { assignedAdvisorId: userId },
      { 'customFields.intakeCreatedBy': userId }
    ]
  };

  if (filter.$or) {
    const searchOr = filter.$or;
    delete filter.$or;
    filter.$and = [
      ...(Array.isArray(filter.$and) ? filter.$and : []),
      { $or: searchOr },
      visibility
    ];
    return filter;
  }

  filter.$and = [
    ...(Array.isArray(filter.$and) ? filter.$and : []),
    visibility
  ];
  return filter;
}

function toPlainItem(item) {
  if (!item) return item;
  return typeof item.toObject === 'function' ? item.toObject() : item;
}

function briefLead(item) {
  const lead = toPlainItem(item);
  const files = lead.attachments || lead.files || [];
  const preferredPhone = (lead.phones || []).find((phone) => phone.preferred) || lead.phones?.[0] || {};
  const preferredEmail = (lead.emails || []).find((email) => email.preferred) || lead.emails?.[0] || {};
  return {
    id: String(lead._id || ''),
    code: lead.code,
    displayId: operatorLeadId(lead),
    name: lead.name,
    companyName: lead.companyName,
    companyId: lead.customFields?.companyId || '',
    phone: preferredPhone.raw || preferredPhone.normalized || '',
    email: preferredEmail.raw || preferredEmail.normalized || '',
    businessUnit: lead.businessUnit,
    serviceLine: lead.serviceLine,
    status: lead.status,
    closedAt: lead.closedAt,
    closedReason: lead.closedReason || '',
    discardReason: lead.customFields?.discardReason || '',
    discardReasonLabel: lead.customFields?.discardReasonLabel || '',
    discardNote: lead.customFields?.discardNote || '',
    discardedByName: lead.customFields?.discardedByName || '',
    assignedAdvisorId: lead.assignedAdvisorId || '',
    assignedAdvisorName: lead.assignedAdvisorName || '',
    source: lead.source,
    sourceChannel: lead.customFields?.sourceChannel || '',
    description: lead.customFields?.description || '',
    attachmentSummary: lead.attachmentSummary || attachmentSummary(files),
    photos: (lead.photos || files.filter(isPhotoAttachment)).map(briefAttachment).slice(0, 8),
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt
  };
}

const OPERATOR_LABELS = {
  new: 'Nuevo',
  queued: 'En bandeja',
  assigned: 'Sin gestionar',
  contact_attempted: 'Intento de contacto',
  contacted: 'Contactado',
  consultation: 'Consulta',
  meeting_required: 'Requiere reunión',
  meeting_scheduled: 'Reunión agendada',
  meeting_completed: 'Reunión realizada',
  meeting_not_completed: 'Reunión no realizada',
  visit_scheduled: 'Visita agendada',
  visit_completed: 'Visita realizada',
  visit_not_completed: 'Visita no realizada',
  pickup_scheduled: 'Recepción en bodega agendada',
  pickup_completed: 'Recepción en bodega realizada',
  pickup_not_completed: 'Recepción en bodega no realizada',
  purchase_completed: 'Compra realizada',
  price_requested: 'Precio solicitado',
  price_informed: 'Precio informado',
  quote_created: 'CT creada',
  quote_sent: 'Cotización enviada',
  do_created: 'DO creado',
  lot_created: 'Lote creado',
  opportunity: 'Oportunidad',
  won: 'Ganado',
  lost: 'Cerrado sin éxito',
  discarded: 'Descartado',
  do_not_contact: 'No contactar',
  incomplete: 'Incompleto',
  call: 'Llamada',
  phone: 'Llamada',
  whatsapp: 'WhatsApp',
  email: 'Correo',
  meeting: 'Reunión',
  visit: 'Visita',
  pickup: 'Recepción en bodega',
  manual: 'Manual',
  meeting_created: 'Reunión creada',
  meeting_result: 'Resultado de reunión',
  visit_created: 'Visita agendada',
  visit_result: 'Resultado de visita',
  pickup_created: 'Recepción en bodega agendada',
  pickup_result: 'Resultado de recepción en bodega',
  note: 'Nota',
  quote_requested: 'Cotización solicitada',
  status_change: 'Cambio de estado',
  assignment: 'Asignación',
  skip: 'Omitido',
  imported: 'Importado',
  external_link: 'Vínculo externo',
  contacted_successfully: 'Contacto efectivo',
  contacted: 'Contactado',
  no_answer: 'No respondió',
  busy: 'Línea ocupada',
  message_sent: 'Mensaje enviado, pendiente',
  email_sent: 'Correo enviado, pendiente',
  invalid_whatsapp: 'No tiene WhatsApp',
  email_bounced: 'Correo rebotado',
  information_sent: 'Información enviada',
  interested: 'Interesado',
  follow_up_required: 'Requiere seguimiento',
  not_interested: 'No está interesado',
  wrong_number: 'Número equivocado',
  agreement_reached: 'Se llegó a un acuerdo',
  no_agreement: 'Se realizó sin acuerdo',
  client_cancelled: 'Canceló el cliente',
  advisor_cancelled: 'Canceló el asesor',
  no_show: 'La persona no se presentó',
  rescheduled: 'Debe reprogramarse',
  crm_started: 'Gestión comercial iniciada',
  lead_manual_recibido: 'Lead manual recibido',
  lead_discarded: 'Lead descartado',
  system: 'Sistema',
  pending: 'Pendiente',
  done: 'Realizado',
  overdue: 'Vencido',
  cancelled: 'Cancelado',
  open: 'Abierto',
  closed: 'Cerrado'
};

function operatorLabel(value) {
  const raw = cleanString(value);
  if (!raw) return '';
  return OPERATOR_LABELS[raw.toLowerCase()] || raw;
}

function operatorDateLabel(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Bogota'
  }).format(date);
}

function parseActionParticipants(value) {
  let rows = value;
  if (typeof rows === 'string') {
    try { rows = JSON.parse(rows); } catch { rows = []; }
  }
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 20).map((item) => ({
    personalId: cleanString(item?.personalId || item?.id_personal || item?.Id_personal),
    name: cleanString(item?.name),
    role: cleanString(item?.role)
  })).filter((item) => item.personalId);
}

function meetingScheduleFromPayload(payload, startsAt) {
  const duration = Math.min(Math.max(Number(payload.meetingDurationMinutes || 60), 15), 480);
  const start = new Date(startsAt);
  return {
    startsAt: start,
    endsAt: new Date(start.getTime() + duration * 60 * 1000),
    channel: cleanString(payload.meetingMode) || 'presential',
    meetingUrl: cleanString(payload.meetingUrl),
    location: cleanString(payload.meetingLocation)
  };
}

async function createMeetingForFollowUp({ lead, followUp, participants, purpose, payload, advisorId, advisorName }) {
  if (!followUp || followUp.channel !== 'meeting') return null;
  const schedule = meetingScheduleFromPayload(payload, followUp.dueAt);
  return Meeting.findOneAndUpdate(
    { followUpId: followUp._id },
    {
      $set: {
        leadId: lead._id,
        followUpId: followUp._id,
        advisorId,
        advisorName,
        title: purpose || 'Reunión comercial',
        ...schedule,
        attendees: participants.map((participant) => ({
          personalId: participant.personalId,
          name: participant.name,
          role: participant.role
        })),
        status: 'scheduled',
        metadata: { source: 'lead_agenda' }
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function closeScheduledMeetings(leadId, details = {}) {
  return Meeting.updateMany(
    { leadId, status: 'scheduled' },
    {
      $set: {
        status: 'cancelled',
        result: {
          outcome: details.outcome || 'cancelled',
          notes: details.notes || '',
          completedAt: details.completedAt || new Date()
        }
      }
    }
  );
}

function deriveManagedLeadStatus({ currentStatus, outcome, nextActionType }) {
  const normalizedOutcome = cleanString(outcome).toLowerCase();
  const terminalOutcomeStatus = {
    not_interested: 'lost',
    purchase_completed: 'won',
    do_created: 'won'
  }[normalizedOutcome];
  if (terminalOutcomeStatus) return terminalOutcomeStatus;

  const scheduledStatus = {
    meeting: 'meeting_scheduled',
    visit: 'visit_scheduled',
    pickup: 'pickup_scheduled'
  }[nextActionType];
  if (scheduledStatus) return scheduledStatus;
  if (
    nextActionType === 'none' &&
    ['meeting_scheduled', 'visit_scheduled', 'pickup_scheduled'].includes(currentStatus)
  ) return currentStatus;

  const outcomeStatus = {
    no_answer: 'contact_attempted',
    busy: 'contact_attempted',
    message_sent: 'contact_attempted',
    email_sent: 'contact_attempted',
    invalid_whatsapp: 'contact_attempted',
    email_bounced: 'contact_attempted',
    wrong_number: 'contact_attempted',
    contacted: 'contacted',
    information_sent: 'contacted',
    follow_up_required: 'contacted',
    interested: 'opportunity',
    not_interested: 'lost',
    purchase_completed: 'won',
    quote_created: 'quote_created',
    quote_sent: 'quote_sent',
    do_created: 'won'
  }[normalizedOutcome];
  return outcomeStatus || currentStatus;
}

function operatorLeadId(lead = {}) {
  const prefixByUnit = {
    fastway: 'LF',
    harvest: 'LH',
    greenway: 'LG'
  };
  const unit = cleanString(lead.businessUnit).toLowerCase();
  const prefix = prefixByUnit[unit] || 'L';
  const raw = cleanString(lead.sequence) || cleanString(lead.code).split('-').filter(Boolean).pop();
  const numeric = Number(String(raw || '').replace(/\D/g, ''));
  return Number.isFinite(numeric) && numeric > 0
    ? `${prefix}-${numeric}`
    : `${prefix}-${raw || '-'}`;
}

function eventLabel(event = {}) {
  return [
    operatorLabel(event.type),
    operatorLabel(event.channel),
    operatorLabel(event.outcome)
  ].filter(Boolean).join(' / ');
}

function priceLabel(price = {}) {
  const amount = price.informedPrice ?? price.suggestedPrice;
  const numericAmount = Number(amount);
  const formattedAmount = Number.isFinite(numericAmount)
    ? `$${numericAmount.toLocaleString('es-CO', { maximumFractionDigits: 2 })}`
    : cleanString(amount);
  const denomination = [
    cleanString(price.currency),
    price.unit ? `/${cleanString(price.unit)}` : ''
  ].filter(Boolean).join('');
  const priceText = [formattedAmount, denomination].filter(Boolean).join(' ');
  return [cleanString(price.material), priceText].filter(Boolean).join(' · ');
}

async function assertCanReadLead(leadId, req) {
  const lead = await Lead.findById(leadId);
  if (!lead) throw httpError(404, 'Lead no encontrado');
  if (!canManageLeadInbox(req.user) && String(lead.assignedAdvisorId || '') !== String(req.user?.id || '') && !canAccessOwnManualLead(lead, req.user)) {
    throw httpError(403, 'No autorizado para ver este lead');
  }
  return lead;
}

function pickValue(payload, aliases) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const aliasSet = new Set(aliases.map(normalizeKey));

  for (const [key, value] of Object.entries(source)) {
    if (aliasSet.has(normalizeKey(key))) return value;
  }

  return '';
}

const FIELD_ALIASES = {
  requestType: ['tipoSolicitud', 'tipo de solicitud', 'service', 'servicio', 'serviceType', 'tipoServicio'],
  material: ['material', 'seleccionaUnMaterial', 'selecciona un material', 'tipoMaterial', 'tipo de material', 'materialType'],
  materialDescription: [
    'describeMaterial',
    'describe el material que deseas vender',
    'descripcionMaterial',
    'descripcion del material',
    'materialDescription'
  ],
  description: ['message', 'mensaje', 'description', 'descripcion', 'details', 'detalle', 'comentarios', 'detalles'],
  cargoDescription: ['descripcionCarga', 'descripcion de la carga', 'cargoDescription', 'carga', 'tipoCarga'],
  lotDetails: ['detallesLote', 'detalles del lote', 'lotDetails', 'detalleLote'],
  estimatedPrice: ['precioEstimado', 'precio estimado', 'estimatedPrice', 'presupuesto'],
  personType: ['personaNaturalOJuridica', 'persona natural o juridica', 'persona natural o jurídica', 'tipoPersona'],
  taxId: ['cedulaNit', 'cedula o nit', 'cédula o nit', 'nit', 'cedula', 'cédula', 'documento'],
  origin: ['origin', 'origen', 'from', 'ciudadOrigen', 'ciudad origen'],
  destination: ['destination', 'destino', 'to', 'ciudadDestino', 'ciudad destino'],
  pickupCity: [
    'ciudadPuntoRecoleccion',
    'ciudad / punto de recoleccion',
    'ciudad / punto de recolección',
    'puntoRecoleccion',
    'punto de recoleccion',
    'pickupCity',
    'city',
    'ciudad'
  ],
  approximateWeight: ['pesoAproximado', 'peso aproximado', 'weight', 'peso', 'approximateWeight'],
  dataConsent: ['tratamientoDatos', 'tratamiento de datos', 'dataConsent', 'privacyAccepted', 'politicaDatos']
};

function pickField(payload, key) {
  return cleanString(pickValue(payload, FIELD_ALIASES[key] || []));
}

function firstValue(...values) {
  return values.map(cleanString).find(Boolean) || '';
}

function buildUniversalDescription(payload = {}) {
  return firstValue(
    pickField(payload, 'description'),
    pickField(payload, 'materialDescription'),
    pickField(payload, 'lotDetails'),
    pickField(payload, 'cargoDescription')
  );
}

function buildUniversalCustomFields(payload = {}, meta = {}) {
  const material = pickField(payload, 'material');
  const materialDescription = pickField(payload, 'materialDescription');
  const cargoDescription = pickField(payload, 'cargoDescription');
  const lotDetails = pickField(payload, 'lotDetails');
  const description = buildUniversalDescription(payload);

  return {
    description,
    requestType: pickField(payload, 'requestType'),
    material,
    materialDescription,
    cargoDescription,
    lotDetails,
    estimatedPrice: pickField(payload, 'estimatedPrice'),
    personType: pickField(payload, 'personType'),
    taxId: pickField(payload, 'taxId'),
    origin: pickField(payload, 'origin'),
    destination: pickField(payload, 'destination'),
    pickupCity: pickField(payload, 'pickupCity'),
    approximateWeight: pickField(payload, 'approximateWeight'),
    dataConsent: pickField(payload, 'dataConsent'),
    pageUrl: cleanString(payload.pageUrl || meta.pageUrl),
    formId: cleanString(payload.formId || meta.formId),
    leadStorage: 's3'
  };
}

function parsePayload(body = {}) {
  const raw = body.payload;
  if (!raw) {
    const { payload, pageUrl, formId, ...rest } = body;
    return rest;
  }
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return { _rawPayload: String(raw) };
  }
}

function inferBusinessUnitFromText(value) {
  const raw = cleanString(value).toLowerCase();
  if (!raw) return '';
  if (raw.includes('fastway') || raw.includes('fastwaysas')) return 'Fastway';
  if (raw.includes('harvest') || raw.includes('metalharvest')) return 'Harvest';
  if (raw.includes('greenway')) return 'Greenway';
  return '';
}

function normalizeServiceLineText(value) {
  const raw = cleanString(value).toLowerCase();
  if (!raw) return '';
  if (
    raw.includes('logistica') ||
    raw.includes('logística') ||
    raw.includes('bodega') ||
    raw.includes('aduana') ||
    raw.includes('transporte')
  ) {
    return 'logistica';
  }
  if (
    raw.includes('metal') ||
    raw.includes('tungsten') ||
    raw.includes('wolfram') ||
    raw.includes('carburo') ||
    raw.includes('material')
  ) {
    return 'metales';
  }
  if (raw.includes('proveedor')) return 'proveedores';
  if (raw.includes('comprador')) return 'compradores';
  if (['logistica', 'metales', 'proveedores', 'compradores', 'consulta_general'].includes(raw)) {
    return raw;
  }
  return '';
}

function inferServiceLineFromPayload(payload, unit) {
  const explicit = cleanString(
    payload.serviceLine ||
      pickValue(payload, ['serviceLine', 'lineaServicio', 'linea_servicio'])
  );
  if (explicit) return normalizeServiceLineText(explicit) || 'consulta_general';

  const raw = cleanString(
    firstValue(
      pickField(payload, 'requestType'),
      pickField(payload, 'description'),
      pickField(payload, 'material'),
      pickField(payload, 'materialDescription'),
      pickField(payload, 'cargoDescription')
    )
  ).toLowerCase();

  if (
    raw.includes('logistica') ||
    raw.includes('logística') ||
    raw.includes('bodega') ||
    raw.includes('aduana') ||
    raw.includes('transporte')
  ) {
    return 'logistica';
  }

  if (
    raw.includes('metal') ||
    raw.includes('tungsten') ||
    raw.includes('wolfram') ||
    raw.includes('carburo') ||
    unit === 'Harvest' ||
    unit === 'Greenway'
  ) {
    return 'metales';
  }

  return 'consulta_general';
}

function buildPhones(payload, detected) {
  const phone =
    cleanString(pickValue(payload, ['phone', 'telefono', 'celular', 'movil', 'whatsapp'])) ||
    detected.phone;

  return phone
    ? [{
        raw: phone,
        normalized: normalizePhone(phone),
        label: 'principal',
        preferred: true
      }]
    : [];
}

function buildEmails(payload, detected) {
  const email =
    cleanString(pickValue(payload, ['email', 'correo', 'mail'])) || detected.email;

  return email
    ? [{
        raw: email,
        normalized: normalizeEmail(email),
        label: 'principal',
        preferred: true
      }]
    : [];
}

function getRequestIp(req) {
  return (
    req.headers['x-forwarded-for']?.toString().split(',')[0].trim() ||
    req.ip ||
    ''
  );
}

function buildSourceMeta(req) {
  return {
    pageUrl: cleanString(req.body?.pageUrl),
    formId: cleanString(req.body?.formId),
    referer: cleanString(req.get('referer')),
    origin: cleanString(req.get('origin')),
    host: cleanString(req.get('host')),
    ip: getRequestIp(req),
    userAgent: cleanString(req.get('user-agent')),
    apiKey: cleanString(req.get('x-api-key'))
  };
}

function buildPublicLeadData({ payload, meta }) {
  const detected = inferDetectedFields(mergedPayload);
  const textForUnit = [
    payload.businessUnit,
    payload.company,
    payload.empresa,
    meta.pageUrl,
    meta.referer,
    meta.origin
  ].join(' ');
  const requestedUnit = inferBusinessUnitFromText(textForUnit) || payload.businessUnit;
  const serviceLine = inferServiceLineFromPayload(payload, requestedUnit);
  const businessUnit = inferBusinessUnit({
    country: payload.country || payload.pais || detected.country,
    requestedUnit,
    serviceLine
  });
  const name =
    cleanString(pickValue(payload, ['name', 'nombre', 'fullName', 'contacto'])) ||
    detected.name;
  const companyName =
    cleanString(pickValue(payload, ['company', 'empresa', 'compania', 'razonSocial'])) ||
    detected.companyName;
  const customFields = buildUniversalCustomFields(payload, meta);

  return {
    name,
    companyName,
    businessUnit,
    serviceLine,
    country: cleanString(payload.country || payload.pais || detected.country),
    accountTypeIntent: businessUnit === 'Fastway' ? 'customer' : 'supplier',
    status: 'new',
    phones: buildPhones(payload, detected),
    emails: buildEmails(payload, detected),
    source: 'web',
    tags: ['web', businessUnit.toLowerCase()].filter(Boolean),
    customFields: {
      ...customFields,
      cargoType: customFields.cargoDescription
    },
    sourcePayload: payload,
    externalRefs: [{
      system: 'web-form',
      externalId: meta.formId,
      url: meta.pageUrl || meta.referer,
      snapshot: meta,
      syncedAt: new Date()
    }]
  };
}

function lineKeyToBusinessUnit(value) {
  const raw = cleanString(value).toLowerCase();
  if (raw === 'fastway') return 'Fastway';
  if (raw === 'harvest') return 'Harvest';
  if (raw === 'greenway') return 'Greenway';
  return '';
}

function normalizeAccountType(value, businessUnit) {
  const raw = cleanString(value).toLowerCase();
  if (['customer', 'supplier', 'buyer', 'unknown'].includes(raw)) return raw;
  if (['cliente', 'client'].includes(raw)) return 'customer';
  if (['proveedor', 'provider'].includes(raw)) return 'supplier';
  if (['comprador', 'buyer_client'].includes(raw)) return 'buyer';
  return businessUnit === 'Fastway' ? 'customer' : 'supplier';
}

function buildManualLeadData(req) {
  const body = req.body || {};
  const payload = parsePayload(body);
  const mergedPayload = {
    ...payload,
    ...body
  };
  const detected = inferDetectedFields(payload);
  const requestedUnit =
    lineKeyToBusinessUnit(body.lineKey || payload.lineKey) ||
    inferBusinessUnitFromText([
      body.businessUnit,
      payload.businessUnit,
      body.company,
      payload.company,
      body.pageUrl,
      payload.pageUrl
    ].join(' '));
  const serviceLine =
    normalizeServiceLineText(body.serviceLine || payload.serviceLine) ||
    inferServiceLineFromPayload(mergedPayload, requestedUnit);
  const businessUnit = inferBusinessUnit({
    country: body.country || payload.country || payload.pais || detected.country,
    requestedUnit,
    serviceLine
  });
  const name =
    cleanString(body.fullName || body.name || payload.fullName || payload.name || payload.nombre) ||
    detected.name;
  const companyName =
    cleanString(body.company || body.companyName || payload.company || payload.empresa || payload.companyName) ||
    detected.companyName;
  const description = cleanString(
    body.description ||
      body.message ||
      payload.description ||
      payload.descripcion ||
      payload.message ||
      payload.mensaje ||
      pickValue(payload, ['details', 'detalle', 'comentarios'])
  );
  const assignedAdvisorId = cleanString(
    body.assignedAdvisorId || payload.assignedAdvisorId || body.commercialId || payload.commercialId || body.commercial
  );
  const assignedAdvisorName = cleanString(
    body.assignedAdvisorName || payload.assignedAdvisorName || body.commercialName || payload.commercialName || body.commercialLabel
  );
  const sourceChannel = cleanString(body.sourceChannel || payload.sourceChannel || body.channel || payload.channel || 'manual');
  const customFields = buildUniversalCustomFields(
    {
      ...mergedPayload,
      description,
      pageUrl: body.pageUrl || payload.pageUrl,
      formId: body.formId || payload.formId
    },
    {}
  );

  return {
    name,
    companyName,
    businessUnit,
    serviceLine,
    country: cleanString(body.country || payload.country || payload.pais || detected.country),
    accountId: cleanString(body.accountId || payload.accountId) || undefined,
    accountTypeIntent: normalizeAccountType(body.companyType || payload.companyType, businessUnit),
    status: assignedAdvisorId ? 'assigned' : 'new',
    assignedAdvisorId: assignedAdvisorId || undefined,
    assignedAdvisorName: assignedAdvisorName || assignedAdvisorId || undefined,
    phones: buildPhones({
      ...payload,
      phone: body.phone || payload.phone,
      telefono: body.telefono || payload.telefono,
      whatsapp: body.whatsapp || payload.whatsapp
    }, detected),
    emails: buildEmails({
      ...payload,
      email: body.email || payload.email,
      correo: body.correo || payload.correo
    }, detected),
    source: 'manual',
    tags: ['manual', sourceChannel, businessUnit.toLowerCase()].filter(Boolean),
    customFields: {
      ...customFields,
      description,
      sourceChannel,
      companyId: cleanString(body.companyId || payload.companyId),
      companyType: cleanString(body.companyType || payload.companyType),
      intakeCreatedBy: req.user?.id || '',
      intakeCreatedByName: req.user?.name || '',
      ...(assignedAdvisorId
        ? {
            crmStartedAt: new Date(),
            crmStartedBy: req.user?.id || '',
            crmStartedByName: req.user?.name || ''
          }
        : {})
    },
    sourcePayload: mergedPayload,
    externalRefs: [{
      system: 'manual-intake',
      externalId: cleanString(body.formId || payload.formId),
      url: cleanString(body.pageUrl || payload.pageUrl),
      snapshot: {
        sourceChannel,
        createdBy: req.user?.id || '',
        createdByName: req.user?.name || ''
      },
      syncedAt: new Date()
    }]
  };
}

function isPhotoAttachment(file = {}) {
  const mime = cleanString(file.mimeType || file.mimetype).toLowerCase();
  if (mime.startsWith('image/')) return true;

  const name = cleanString(file.fileName || file.filename || file.path || file.url).toLowerCase();
  return /\.(jpe?g|png|webp|gif|bmp|heic|heif|tiff?)($|\?)/i.test(name);
}

function attachmentSummary(files = []) {
  const attachments = Array.isArray(files) ? files : [];
  const photos = attachments.filter(isPhotoAttachment);
  const storage = Array.from(new Set(attachments.map((item) => item.storage).filter(Boolean)));

  return {
    total: attachments.length,
    photos: photos.length,
    hasPhotos: photos.length > 0,
    storage
  };
}

function briefAttachment(file = {}) {
  return {
    id: String(file._id || file.id || ''),
    leadId: String(file.entityId || file.leadId || ''),
    fileName: file.fileName || file.filename || 'adjunto',
    mimeType: file.mimeType || '',
    size: file.size || 0,
    storage: file.storage || '',
    createdAt: file.createdAt,
    metadata: file.metadata || {},
    isPhoto: isPhotoAttachment(file)
  };
}

async function withAttachmentSummary(items) {
  const list = Array.isArray(items) ? items : [items].filter(Boolean);
  const ids = list.map((item) => String(item._id || '')).filter(Boolean);
  if (!ids.length) return items;

  const attachments = await Attachment.find({
    entityType: 'lead',
    entityId: { $in: ids }
  }).lean();

  const byLead = attachments.reduce((acc, file) => {
    const key = String(file.entityId || '');
    if (!acc[key]) acc[key] = [];
    acc[key].push(file);
    return acc;
  }, {});

  const enriched = list.map((item) => {
    const files = byLead[String(item._id || '')] || [];
    return {
      ...item,
      attachments: files,
      files,
      attachmentSummary: attachmentSummary(files)
    };
  });

  return Array.isArray(items) ? enriched : enriched[0];
}

function buildRecurrenceFilter(lead = {}) {
  const conditions = [];
  const email = lead.emails?.find((item) => item?.normalized)?.normalized;
  const phone = lead.phones?.find((item) => item?.normalized)?.normalized;
  const companyName = cleanString(lead.companyName);

  if (email) conditions.push({ 'emails.normalized': email });
  if (phone) conditions.push({ 'phones.normalized': phone });
  if (companyName) {
    conditions.push({
      companyName,
      businessUnit: lead.businessUnit
    });
  }

  if (!conditions.length) return null;

  return {
    _id: { $ne: lead._id },
    $or: conditions
  };
}

function hasCommercialReturnSignal(previousLeads = []) {
  const returnStatuses = new Set([
    'price_requested',
    'price_informed',
    'quote_created',
    'quote_sent',
    'meeting_scheduled',
    'meeting_completed',
    'meeting_not_completed',
    'visit_scheduled',
    'visit_completed',
    'visit_not_completed',
    'pickup_scheduled',
    'pickup_completed',
    'pickup_not_completed',
    'opportunity',
    'won',
    'lost'
  ]);

  return previousLeads.some((item) => returnStatuses.has(item.status));
}

async function withCommercialClassification(items) {
  const list = Array.isArray(items) ? items : [items].filter(Boolean);
  if (!list.length) return items;

  const enriched = await Promise.all(
    list.map(async (item) => {
      const explicitType = cleanString(item?.customFields?.leadType || item?.customFields?.commercialType);
      if (explicitType) {
        return {
          ...item,
          commercialClassification: {
            type: explicitType,
            label: explicitType,
            repeatedCount: 0,
            source: 'customFields'
          }
        };
      }

      const filter = buildRecurrenceFilter(item);
      if (!filter) {
        return {
          ...item,
          commercialClassification: {
            type: 'new',
            label: 'Nuevo',
            repeatedCount: 0,
            source: 'identity'
          }
        };
      }

      const previous = await Lead.find(filter)
        .select('status createdAt')
        .sort({ createdAt: -1 })
        .limit(10)
        .lean();
      const repeatedCount = previous.length;
      const type = repeatedCount ? 'recurrent' : 'new';
      const label = repeatedCount
        ? hasCommercialReturnSignal(previous)
          ? 'Recurrente'
          : 'Ya registrado'
        : 'Nuevo';

      return {
        ...item,
        commercialClassification: {
          type,
          label,
          repeatedCount,
          source: 'identity'
        }
      };
    })
  );

  return Array.isArray(items) ? enriched : enriched[0];
}

async function enrichLeadData(data) {
  const enriched = await withCommercialClassification(await withAttachmentSummary(data));
  const addDisplayId = item => item ? { ...item, displayId: operatorLeadId(item) } : item;
  return Array.isArray(enriched) ? enriched.map(addDisplayId) : addDisplayId(enriched);
}

const leadCrudService = buildCrudService(Lead, {
  async buildFilter(query, { req }) {
    const filter = {};
    if (query.status) {
      const statuses = String(query.status)
        .split(',')
        .map((status) => status.trim())
        .filter(Boolean);
      filter.status = statuses.length > 1 ? { $in: statuses } : statuses[0];
    }
    if (query.businessUnit) filter.businessUnit = query.businessUnit;
    if (query.serviceLine) filter.serviceLine = query.serviceLine;
    if (query.campaignId) filter.campaignId = query.campaignId;
    if (query.q) {
      const search = escapeRegex(query.q);
      filter.$or = [
        { code: { $regex: search, $options: 'i' } },
        { name: { $regex: search, $options: 'i' } },
        { companyName: { $regex: search, $options: 'i' } },
        { 'phones.normalized': { $regex: search, $options: 'i' } },
        { 'emails.normalized': { $regex: search, $options: 'i' } }
      ];
    }

    if (query.scope === 'mine') {
      if (!req.user?.id) throw httpError(401, 'Usuario sin id_personal');
      filter.assignedAdvisorId = String(req.user.id);
    } else if (canManageLeadInbox(req.user)) {
      if (query.assignedAdvisorId) filter.assignedAdvisorId = query.assignedAdvisorId;
    } else {
      applyLeadVisibilityFilter(filter, req);
    }

    return filter;
  },

  async beforeCreate(payload, { req }) {
    const data = normalizeLead(payload);
    data.code = await counterService.nextLeadCode(data.businessUnit);
    if (!data.assignedAdvisorId && req.user) {
      data.assignedAdvisorId = req.user.id;
      data.assignedAdvisorName = req.user.name;
    }
    return data;
  },

  beforeUpdate(payload, current) {
    return normalizeLead(payload, current);
  },

  async canRead(item, { req }) {
    return canManageLeadInbox(req.user) || item.assignedAdvisorId === req.user.id || canAccessOwnManualLead(item, req.user);
  },

  async canWrite(item, { req }) {
    return canWriteLead(item, req.user);
  }
});

module.exports = {
  ...leadCrudService,

  async list(query = {}, context = {}) {
    const data = await leadCrudService.list(query, context);
    return {
      ...data,
      items: await enrichLeadData(data.items)
    };
  },

  async getById(id, context = {}) {
    return enrichLeadData(await leadCrudService.getById(id, context));
  }
};

module.exports.contactIntelligence = async function contactIntelligence(query = {}, req) {
  const requestedLeadId = cleanString(query.leadId || '');
  const hasRequestedLeadId = mongoose.isValidObjectId(requestedLeadId);
  const phone = normalizePhone(query.phone || query.telefono || query.whatsapp || '');
  const email = normalizeEmail(query.email || query.correo || '');
  const referenceId = cleanString(query.referenceId || query.companyId || query.accountId || query.id || '');

  if (!hasRequestedLeadId && !phone && !email && !referenceId) {
    return {
      query: { leadId: requestedLeadId, phone, email, referenceId },
      summary: {
        leads: 0,
        openLeads: 0,
        discardedLeads: 0,
        contacts: 0,
        prices: 0,
        informedPrices: 0,
        campaigns: 0,
        attachments: 0,
        photos: 0,
        wonLeads: 0,
        wonOpportunities: 0,
        sold: false,
        meetings: 0,
        opportunities: 0,
        followUps: 0
      },
      leads: [],
      attachments: [],
      photos: [],
      timeline: [],
      warnings: []
    };
  }

  const leadMatch = [];
  if (hasRequestedLeadId) leadMatch.push({ _id: requestedLeadId });
  if (phone) leadMatch.push({ 'phones.normalized': phone });
  if (email) leadMatch.push({ 'emails.normalized': email });
  if (referenceId) {
    if (mongoose.isValidObjectId(referenceId)) {
      leadMatch.push({ accountId: referenceId });
    }

    leadMatch.push(
      { 'customFields.companyId': referenceId },
      { 'sourcePayload.companyId': referenceId },
      { 'sourcePayload.accountId': referenceId }
    );
  }

  let leads = await Lead.find({ $or: leadMatch })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();

  if (!canManageLeadInbox(req.user)) {
    leads = leads.filter((lead) =>
      String(lead.assignedAdvisorId || '') === String(req.user?.id || '') ||
      canAccessOwnManualLead(lead, req.user)
    );
  }

  const leadIds = leads.map((lead) => lead._id);
  const leadIdStrings = leads.map((lead) => String(lead._id));

  const [
    events,
    priceSnapshots,
    campaignRecords,
    campaignQueues,
    commercialRequests,
    opportunities,
    followUps,
    meetings,
    attachments
  ] = await Promise.all([
    leadIds.length ? LeadEvent.find({ leadId: { $in: leadIds } }).sort({ createdAt: -1 }).limit(40).lean() : [],
    leadIds.length ? PriceSnapshot.find({ leadId: { $in: leadIds } }).sort({ createdAt: -1 }).limit(20).lean() : [],
    CampaignRecord.find({
      $or: [
        ...(leadIds.length ? [{ leadId: { $in: leadIds } }] : []),
        ...(phone ? [{ 'detectedFields.phone': phone }] : []),
        ...(email ? [{ 'detectedFields.email': email }] : [])
      ]
    }).sort({ createdAt: -1 }).limit(20).lean(),
    leadIds.length ? CampaignQueue.find({ leadId: { $in: leadIds } }).sort({ createdAt: -1 }).limit(20).lean() : [],
    leadIds.length ? CommercialRequest.find({ leadId: { $in: leadIds } }).sort({ createdAt: -1 }).limit(20).lean() : [],
    leadIds.length ? Opportunity.find({ leadId: { $in: leadIds } }).sort({ createdAt: -1 }).limit(20).lean() : [],
    leadIds.length ? FollowUp.find({ leadId: { $in: leadIds } }).sort({ createdAt: -1 }).limit(20).lean() : [],
    leadIds.length ? Meeting.find({ leadId: { $in: leadIds } }).sort({ startsAt: -1 }).limit(20).lean() : [],
    leadIdStrings.length ? Attachment.find({ entityType: 'lead', entityId: { $in: leadIdStrings } }).sort({ createdAt: -1 }).limit(80).lean() : []
  ]);

  const attachmentsByLead = attachments.reduce((acc, file) => {
    const key = String(file.entityId || '');
    if (!acc[key]) acc[key] = [];
    acc[key].push(file);
    return acc;
  }, {});
  leads = leads.map((lead) => {
    const files = attachmentsByLead[String(lead._id || '')] || [];
    return {
      ...lead,
      attachments: files,
      files,
      photos: files.filter(isPhotoAttachment),
      attachmentSummary: attachmentSummary(files)
    };
  });

  const photoAttachments = attachments.filter(isPhotoAttachment);
  const wonOpportunities = opportunities.filter((item) =>
    ['won', 'ganado', 'closed_won', 'closed won'].includes(cleanString(item.stage).toLowerCase())
  );

  const campaignIds = Array.from(new Set([
    ...campaignRecords.map((item) => String(item.campaignId || '')).filter(Boolean),
    ...campaignQueues.map((item) => String(item.campaignId || '')).filter(Boolean)
  ]));
  const campaigns = campaignIds.length
    ? await Campaign.find({ _id: { $in: campaignIds } }).select('name code status businessUnit serviceLine').lean()
    : [];
  const campaignById = campaigns.reduce((acc, item) => {
    acc[String(item._id)] = item;
    return acc;
  }, {});
  const leadById = leads.reduce((acc, item) => {
    acc[String(item._id || '')] = item;
    return acc;
  }, {});

  const replacedFollowUpEventIds = new Set(
    followUps
      .filter((followUp) => followUp.metadata?.replacedBySchedule)
      .map((followUp) => cleanString(followUp.metadata?.resolvedByEventId))
      .filter(Boolean)
  );
  const leadsWithPriceSnapshots = new Set(
    priceSnapshots.map((price) => String(price.leadId || '')).filter(Boolean)
  );
  const timeline = [
    ...leads.map((lead) => ({
      type: 'lead',
      title: `${operatorLeadId(lead)} creado`,
      detail: `${lead.name || '-'} · ${lead.companyName || '-'} · ${operatorLabel(lead.status) || '-'}`,
      leadId: String(lead._id),
      at: lead.createdAt
    })),
    ...events
      .filter((event) => !(
        event.type === 'price_informed' &&
        leadsWithPriceSnapshots.has(String(event.leadId || ''))
      ))
      .map((event) => {
      const eventLead = leadById[String(event.leadId || '')] || {};
      const advisorName = cleanString(event.metadata?.assignedAdvisorName || eventLead.assignedAdvisorName);
      const advisorId = cleanString(event.metadata?.assignedAdvisorId || eventLead.assignedAdvisorId);
      const isAssignment = event.type === 'assignment';
      const physicalChannels = ['meeting', 'visit', 'pickup'];
      const nextActionType = cleanString(event.metadata?.nextAction?.type).toLowerCase();
      const isReschedule = event.outcome === 'rescheduled' && physicalChannels.includes(nextActionType);
      const negativeOutcomes = ['no_answer', 'wrong_number', 'invalid_whatsapp', 'email_bounced', 'not_interested', 'no_agreement', 'client_cancelled', 'advisor_cancelled', 'no_show'];
      const positiveOutcomes = ['contacted', 'information_sent', 'interested', 'agreement_reached', 'purchase_completed', 'quote_created', 'quote_sent', 'do_created', 'lot_created'];
      const isQuotationAction = ['quote_created', 'quote_sent'].includes(event.outcome);
      const quotationLabel = cleanString(event.metadata?.quotation?.number) || 'CT';
      const isOperationClose = event.outcome === 'do_created';
      const shipmentLabel = cleanString(event.metadata?.shipment?.number) || 'DO';
      const isLotClose = event.outcome === 'lot_created';
      const lotLabel = cleanString(event.metadata?.lot?.id) || 'Lote';
      const movementCategory = negativeOutcomes.includes(event.outcome)
        ? 'negative'
        : physicalChannels.includes(event.channel) || isReschedule
          ? 'activity'
          : positiveOutcomes.includes(event.outcome)
            ? 'positive'
            : 'contact';
      return {
        type: 'contact',
        title: event.outcome === 'lead_discarded'
          ? 'Lead descartado'
          : isAssignment
            ? `Asignado a ${advisorName || 'asesor sin nombre'}`
            : isReschedule
              ? `${operatorLabel(nextActionType)} reprogramada`
              : isLotClose
                ? `${lotLabel} creado · Compra realizada`
              : isOperationClose
                ? `${shipmentLabel} creado · Lead cerrado`
              : isQuotationAction
                ? event.outcome === 'quote_created'
                  ? `${quotationLabel} creada`
                  : `${quotationLabel} enviada al cliente`
              : eventLabel(event) || 'Contacto',
        detail: isAssignment
          ? [advisorId ? `Identificación ${advisorId}` : '', event.notes || ''].filter(Boolean).join(' · ')
          : [event.notes || '', isReschedule ? `Nueva fecha: ${operatorDateLabel(event.metadata?.nextAction?.at)}` : ''].filter(Boolean).join(' · '),
        movementCategory,
        channel: event.channel,
        outcome: event.outcome,
        nextAction: event.metadata?.nextAction || null,
        leadId: String(event.leadId || ''),
        at: event.createdAt
      };
    }),
    ...priceSnapshots.map((price) => ({
      type: 'price',
      title: price.informed ? 'Precio informado' : 'Precio registrado',
      detail: priceLabel(price),
      note: cleanString(price.notes),
      leadId: String(price.leadId || ''),
      at: price.informedAt || price.createdAt
    })),
    ...campaignRecords.map((record) => {
      const campaign = campaignById[String(record.campaignId || '')] || {};
      return {
        type: 'campaign',
        title: campaign.name || campaign.code || 'Campaña',
        detail: `${operatorLabel(record.status) || '-'} · intentos: ${record.attempts || 0}`,
        leadId: String(record.leadId || ''),
        at: record.createdAt
      };
    }),
    ...commercialRequests.map((request) => ({
      type: 'request',
      title: request.subject || request.type || 'Solicitud comercial',
      detail: `${operatorLabel(request.status) || '-'} · ${request.description || ''}`,
      leadId: String(request.leadId || ''),
      at: request.createdAt
    })),
    ...opportunities.map((opportunity) => ({
      type: 'opportunity',
      title: `Oportunidad ${operatorLabel(opportunity.stage)}`.trim(),
      detail: [opportunity.expectedValue, opportunity.currency, opportunity.nextStep].filter(Boolean).join(' · '),
      leadId: String(opportunity.leadId || ''),
      at: opportunity.createdAt
    })),
    ...followUps.map((followUp) => {
      const physical = ['meeting', 'visit', 'pickup'].includes(followUp.channel);
      const isReprogrammed = Boolean(
        followUp.metadata?.isReschedule ||
        replacedFollowUpEventIds.has(cleanString(followUp.metadata?.eventId))
      );
      const physicalStatusLabel = {
        pending: isReprogrammed ? 'reprogramada' : 'agendada',
        overdue: 'vencida',
        done: 'realizada',
        cancelled: 'cancelada'
      }[followUp.status];
      return {
        type: 'follow_up',
        title: physical
          ? `${operatorLabel(followUp.channel)} ${physicalStatusLabel || operatorLabel(followUp.status)}`
          : `Seguimiento ${operatorLabel(followUp.status)}`.trim(),
        detail: operatorLabel(followUp.reason),
        followUpId: String(followUp._id || ''),
        status: followUp.status,
        channel: followUp.channel,
        movementCategory: physical
          ? followUp.status === 'cancelled' ? 'negative' : 'activity'
          : 'contact',
        participants: followUp.participants || [],
        leadId: String(followUp.leadId || ''),
        at: followUp.dueAt || followUp.createdAt
      };
    }),
    ...meetings.map((meeting) => ({
      type: 'meeting',
      title: meeting.title || 'Reunión',
      detail: `${operatorLabel(meeting.status) || '-'} · ${operatorLabel(meeting.channel) || '-'}`,
      leadId: String(meeting.leadId || ''),
      at: meeting.startsAt || meeting.createdAt
    }))
  ]
    .filter((item) => !item.leadId || leadIdStrings.includes(String(item.leadId)))
    .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0))
    .slice(0, 30);

  const openStatuses = new Set(['new', 'queued', 'incomplete', 'assigned', 'contact_attempted', 'contacted', 'consultation', 'meeting_required', 'meeting_scheduled', 'meeting_completed', 'meeting_not_completed', 'visit_scheduled', 'visit_completed', 'visit_not_completed', 'pickup_scheduled', 'pickup_completed', 'pickup_not_completed', 'price_requested', 'price_informed', 'quote_created', 'quote_sent', 'opportunity']);
  const wonLeads = leads.filter((lead) => cleanString(lead.status).toLowerCase() === 'won');
  const discardedLeads = leads.filter((lead) => cleanString(lead.status).toLowerCase() === 'discarded');
  const warnings = [];
  if (leads.some((lead) => openStatuses.has(lead.status))) {
    warnings.push('Este contacto ya tiene al menos un lead abierto.');
  }
  if (priceSnapshots.some((price) => price.informed)) {
    warnings.push('A este contacto ya se le informó precio anteriormente.');
  }
  if (campaignRecords.length) {
    warnings.push('Este contacto aparece en campañas/importaciones previas.');
  }
  if (discardedLeads.length) {
    warnings.push(`Este contacto tiene ${discardedLeads.length} lead(s) descartado(s) anteriormente.`);
  }

  return {
    query: { leadId: requestedLeadId, phone, email, referenceId },
    summary: {
      leads: leads.length,
      openLeads: leads.filter((lead) => openStatuses.has(lead.status)).length,
      discardedLeads: discardedLeads.length,
      contacts: events.filter((event) => ['call', 'whatsapp', 'email', 'phone'].includes(event.type) || ['phone', 'whatsapp', 'email'].includes(event.channel)).length,
      activities: events.filter((event) => ['meeting_created', 'meeting_result', 'visit_created', 'visit_result', 'pickup_created', 'pickup_result'].includes(event.type) || ['meeting', 'visit', 'pickup'].includes(event.channel)).length,
      prices: priceSnapshots.length,
      informedPrices: priceSnapshots.filter((price) => price.informed).length,
      campaigns: campaignRecords.length,
      attachments: attachments.length,
      photos: photoAttachments.length,
      wonLeads: wonLeads.length,
      wonOpportunities: wonOpportunities.length,
      sold: Boolean(wonLeads.length || wonOpportunities.length),
      meetings: meetings.length,
      opportunities: opportunities.length,
      followUps: followUps.length
    },
    leads: leads.map(briefLead),
    attachments: attachments.map(briefAttachment),
    photos: photoAttachments.map(briefAttachment),
    campaigns: campaignRecords.map((record) => ({
      id: String(record._id),
      status: record.status,
      attempts: record.attempts || 0,
      campaign: campaignById[String(record.campaignId || '')] || null,
      createdAt: record.createdAt
    })),
    prices: priceSnapshots.map((price) => ({
      id: String(price._id),
      leadId: String(price.leadId || ''),
      source: price.source,
      materialId: price.materialId,
      priceHistoryId: price.priceHistoryId,
      material: price.material,
      section: price.section,
      observedAt: price.observedAt,
      suggestedPrice: price.suggestedPrice,
      informedPrice: price.informedPrice,
      currency: price.currency,
      unit: price.unit,
      notes: price.notes,
      informed: price.informed,
      informedAt: price.informedAt,
      createdAt: price.createdAt
    })),
    timeline,
    warnings
  };
};

module.exports.downloadAttachment = async function downloadAttachment(attachmentId, req) {
  const attachment = await Attachment.findById(attachmentId).lean();
  if (!attachment) throw httpError(404, 'Adjunto no encontrado');
  if (attachment.entityType !== 'lead') throw httpError(400, 'Adjunto no pertenece a un lead');

  await assertCanReadLead(attachment.entityId, req);

  if (attachment.storage !== 's3') {
    throw httpError(400, 'El adjunto no esta almacenado en S3');
  }

  const bucket = cleanString(attachment.metadata?.bucket || process.env.S3_BUCKET || process.env.AWS_S3_BUCKET);
  const key = cleanString(attachment.metadata?.key || attachment.path);
  if (!bucket || !key) throw httpError(404, 'Adjunto S3 sin bucket/key');

  const result = await getS3Client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return {
    stream: result.Body,
    fileName: attachment.fileName || 'adjunto',
    mimeType: attachment.mimeType || result.ContentType || 'application/octet-stream',
    size: attachment.size || result.ContentLength
  };
};

module.exports.createEvent = async function createEvent(leadId, payload, req) {
  const event = await LeadEvent.create({
    leadId,
    ...payload,
    actor: actorFromReq(req)
  });

  await Lead.findByIdAndUpdate(leadId, {
    lastContactAt: ['call', 'whatsapp', 'email'].includes(payload.type) ? new Date() : undefined,
    status: payload.nextStatus || undefined
  });

  return event.toObject();
};

module.exports.registerAction = async function registerAction(leadId, payload = {}, req) {
  const lead = await Lead.findById(leadId);
  if (!lead) throw httpError(404, 'Lead no encontrado');
  if (!canWriteLead(lead, req.user)) {
    throw httpError(403, 'No autorizado para gestionar este lead');
  }

  const channel = cleanString(payload.channel).toLowerCase();
  const physicalChannels = ['meeting', 'visit', 'pickup'];
  const isPhysicalActivity = physicalChannels.includes(channel);
  const outcome = cleanString(payload.outcome);
  const notes = cleanString(payload.notes);
  const shipmentId = cleanString(payload.shipmentId);
  const previousOperation = lead.customFields?.lastOperation || {};
  if (
    outcome === 'do_created' &&
    shipmentId &&
    cleanString(previousOperation.shipmentId) === shipmentId &&
    lead.status === 'won'
  ) {
    return {
      lead: await enrichLeadData(lead.toObject()),
      event: null,
      attachments: [],
      followUp: null,
      completedFollowUps: 0,
      alreadyProcessed: true
    };
  }
  const requestedActionType = cleanString(payload.nextActionType).toLowerCase();
  let nextActionAt = cleanString(payload.nextActionAt || payload.nextFollowUpAt);
  let nextActionType = requestedActionType || (nextActionAt ? channel : 'none');
  let nextActionPurpose = cleanString(payload.nextActionPurpose || payload.nextStep);
  let participants = parseActionParticipants(payload.participants);
  const derivedStatus = deriveManagedLeadStatus({ currentStatus: lead.status, outcome, nextActionType });
  const terminalOutcome = ['not_interested', 'purchase_completed', 'do_created'].includes(outcome.toLowerCase());
  const nextStatus = terminalOutcome
    ? derivedStatus
    : requestedActionType
      ? derivedStatus
      : cleanString(payload.nextStatus) || derivedStatus;
  const isTerminalStatus = ['won', 'lost', 'discarded', 'do_not_contact', 'purchase_completed'].includes(nextStatus);
  if (isTerminalStatus) {
    nextActionAt = '';
    nextActionType = 'none';
    nextActionPurpose = '';
    participants = [];
  }
  const followUpId = cleanString(payload.followUpId);
  const sourceFollowUp = followUpId
    ? await FollowUp.findOne({
      _id: followUpId,
      leadId: lead._id,
      status: { $in: ['pending', 'overdue'] }
    }).lean()
    : null;
  const hasActivityPerformed = Object.prototype.hasOwnProperty.call(payload, 'activityPerformed');
  const activityPerformed = hasActivityPerformed
    ? String(payload.activityPerformed).toLowerCase() === 'true'
    : null;
  const managedAt = new Date();
  const isScheduledActivity =
    (nextActionType === 'meeting' && nextStatus === 'meeting_scheduled') ||
    (nextActionType === 'visit' && nextStatus === 'visit_scheduled') ||
    (nextActionType === 'pickup' && nextStatus === 'pickup_scheduled');
  if (nextActionType !== 'none' && !nextActionAt) {
    throw httpError(400, 'Selecciona la fecha y hora de la próxima acción');
  }
  const isClosingPhysicalActivity = isPhysicalActivity && hasActivityPerformed;
  const eventType = channel === 'phone'
    ? 'call'
    : channel === 'meeting'
      ? (isClosingPhysicalActivity ? 'meeting_result' : isScheduledActivity ? 'meeting_created' : 'meeting_result')
      : channel === 'visit'
        ? (isClosingPhysicalActivity ? 'visit_result' : isScheduledActivity ? 'visit_created' : 'visit_result')
        : channel === 'pickup'
          ? (isClosingPhysicalActivity ? 'pickup_result' : isScheduledActivity ? 'pickup_created' : 'pickup_result')
          : channel === 'manual'
            ? 'note'
            : channel;

  const uploadedFiles = await uploadLeadFiles({
    files: req.files || [],
    leadId: lead._id,
    code: lead.code
  });

  const event = await LeadEvent.create({
    leadId: lead._id,
    type: eventType,
    channel,
    outcome,
    notes,
    actor: actorFromReq(req),
    metadata: {
      previousStatus: lead.status,
      nextStatus,
      nextFollowUpAt: nextActionAt || null,
      nextStep: nextActionPurpose,
      nextAction: {
        type: nextActionType,
        at: nextActionAt || null,
        purpose: nextActionPurpose,
        participants
      },
      quotation: {
        id: cleanString(payload.quotationId),
        number: cleanString(payload.quotationNumber),
        action: cleanString(payload.quotationAction)
      },
      shipment: {
        id: cleanString(payload.shipmentId),
        number: cleanString(payload.shipmentNumber),
        action: cleanString(payload.shipmentAction)
      },
      attachmentCount: uploadedFiles.length,
      activityPerformed
    }
  });

  const attachments = uploadedFiles.length
    ? await Attachment.insertMany(uploadedFiles.map((file) => ({
      entityType: 'lead',
      entityId: String(lead._id),
      fileName: file.fileName,
      mimeType: file.mimeType,
      size: file.size,
      storage: file.storage,
      path: file.path,
      url: file.url,
      uploadedBy: actorFromReq(req),
      metadata: {
        ...(file.metadata || {}),
        eventId: String(event._id),
        activityType: channel,
        outcome
      }
    })))
    : [];

  let completedFollowUps = 0;
  const replacesActiveFollowUp =
    ['phone', 'whatsapp', 'email', ...physicalChannels].includes(channel) ||
    Boolean(nextActionAt) ||
    isTerminalStatus;
  if (replacesActiveFollowUp) {
    const followUpFilter = {
      leadId: lead._id,
      status: { $in: ['pending', 'overdue'] }
    };
    if (isTerminalStatus) {
      // El cierre comercial resuelve toda la agenda pendiente del lead.
    } else if (followUpId) {
      followUpFilter._id = followUpId;
    } else if (physicalChannels.includes(channel)) {
      followUpFilter.channel = { $in: physicalChannels };
    } else {
      followUpFilter.channel = { $nin: physicalChannels };
    }
    const completed = await FollowUp.updateMany(
      followUpFilter,
      {
        $set: {
          status: isTerminalStatus || (isPhysicalActivity && isScheduledActivity) || activityPerformed === false ? 'cancelled' : 'done',
          completedAt: managedAt,
          'metadata.resolvedByEventId': String(event._id),
          'metadata.resolvedByAction': true,
          'metadata.replacedBySchedule': isScheduledActivity,
          'metadata.activityPerformed': activityPerformed,
          'metadata.result': outcome,
          'metadata.comment': notes,
          'metadata.resultAttachmentCount': uploadedFiles.length
        }
      }
    );
    completedFollowUps = Number(completed.modifiedCount || 0);
  }

  if (nextActionType !== 'none' && nextActionAt) {
    const replacedFollowUps = await FollowUp.updateMany(
      {
        leadId: lead._id,
        status: { $in: ['pending', 'overdue'] }
      },
      {
        $set: {
          status: 'cancelled',
          completedAt: managedAt,
          'metadata.resolvedByEventId': String(event._id),
          'metadata.resolvedByAction': true,
          'metadata.replacedBySchedule': true
        }
      }
    );
    completedFollowUps += Number(replacedFollowUps.modifiedCount || 0);
  }

  if (sourceFollowUp?.channel === 'meeting' && isClosingPhysicalActivity) {
    await Meeting.updateOne(
      { followUpId: sourceFollowUp._id, status: 'scheduled' },
      {
        $set: {
          status: activityPerformed ? 'completed' : 'cancelled',
          result: { outcome, notes, completedAt: managedAt }
        }
      }
    );
  }
  if (isTerminalStatus || (nextActionType !== 'none' && nextActionAt)) {
    await closeScheduledMeetings(lead._id, {
      outcome: isTerminalStatus ? 'commercial_process_closed' : 'replaced_by_new_schedule',
      notes: isTerminalStatus ? (notes || operatorLabel(nextStatus)) : 'Compromiso reemplazado por una nueva programación',
      completedAt: managedAt
    });
  }

  lead.status = nextStatus;
  if (isTerminalStatus) {
    lead.nextFollowUpAt = null;
    lead.closedAt = managedAt;
    lead.closedReason = cleanString(payload.closureReason) || notes || operatorLabel(nextStatus);
  }
  if (['phone', 'whatsapp', 'email'].includes(channel)) {
    lead.lastContactAt = managedAt;
  }
  if (
    Object.prototype.hasOwnProperty.call(payload, 'nextFollowUpAt') ||
    Object.prototype.hasOwnProperty.call(payload, 'nextActionAt') ||
    requestedActionType
  ) {
    const remainingFollowUp = await FollowUp.findOne({
      leadId: lead._id,
      status: { $in: ['pending', 'overdue'] }
    }).sort({ dueAt: 1 }).lean();
    const dueDates = [
      nextActionAt ? new Date(nextActionAt) : null,
      remainingFollowUp?.dueAt || null
    ].filter((value) => value && !Number.isNaN(new Date(value).getTime()));
    lead.nextFollowUpAt = dueDates.length
      ? new Date(Math.min(...dueDates.map((value) => new Date(value).getTime())))
      : null;
  }
  const preserveScheduledAction =
    !isPhysicalActivity &&
    nextActionType === 'none' &&
    ['meeting_scheduled', 'visit_scheduled', 'pickup_scheduled'].includes(lead.status);
  const managementFields = {
    ...(lead.customFields || {}),
    lastManagedAt: managedAt,
    lastManagedBy: req.user?.id || '',
    lastManagedByName: req.user?.name || '',
    nextStep: preserveScheduledAction ? lead.customFields?.nextStep || '' : nextActionPurpose,
    nextAction: preserveScheduledAction ? lead.customFields?.nextAction || {} : {
      type: nextActionType,
      at: nextActionAt || null,
      purpose: nextActionPurpose,
      participants
    }
  };
  if (payload.quotationId || payload.quotationNumber) {
    managementFields.lastQuotation = {
      id: cleanString(payload.quotationId),
      number: cleanString(payload.quotationNumber),
      action: cleanString(payload.quotationAction),
      at: managedAt
    };
  }
  if (payload.shipmentId || payload.shipmentNumber) {
    managementFields.lastOperation = {
      shipmentId: cleanString(payload.shipmentId),
      shipmentNumber: cleanString(payload.shipmentNumber),
      action: cleanString(payload.shipmentAction),
      at: managedAt
    };
  }
  if (isPhysicalActivity) {
    Object.assign(managementFields, {
      lastActivityType: channel,
      lastActivityOutcome: outcome,
      lastActivityNote: notes,
      lastActivityAt: managedAt
    });
  } else {
    Object.assign(managementFields, {
      lastNote: notes,
      lastContactChannel: channel,
      lastContactOutcome: outcome
    });
  }
  lead.customFields = managementFields;
  lead.markModified('customFields');
  await lead.save();

  let followUp = null;
  if (nextActionType !== 'none' && nextActionAt) {
    followUp = await FollowUp.create({
      leadId: lead._id,
      assignedAdvisorId: String(lead.assignedAdvisorId || req.user?.id || ''),
      dueAt: new Date(nextActionAt),
      channel: ['phone', 'whatsapp', 'email', 'meeting', 'visit', 'pickup'].includes(nextActionType) ? nextActionType : 'task',
      reason: nextActionPurpose || outcome,
      participants,
      metadata: {
        eventId: String(event._id),
        scheduledNote: notes,
        scheduledAttachmentCount: uploadedFiles.length,
        activityType: nextActionType,
        isReschedule: outcome === 'rescheduled' && physicalChannels.includes(nextActionType),
        rescheduledFromFollowUpId: outcome === 'rescheduled' ? followUpId || null : null,
        participants
      }
    });

    await createMeetingForFollowUp({
      lead,
      followUp,
      participants,
      purpose: nextActionPurpose,
      payload,
      advisorId: String(lead.assignedAdvisorId || req.user?.id || ''),
      advisorName: cleanString(lead.assignedAdvisorName || req.user?.name)
    });

    await notifyScheduledFollowUp({
      lead,
      followUp,
      actor: actorFromReq(req),
      bearerToken: req.user?.token
    });
  }

  if (
    sourceFollowUp &&
    isClosingPhysicalActivity &&
    activityPerformed === false &&
    nextActionType === 'none'
  ) {
    await notifyCancelledFollowUp({
      lead,
      followUp: sourceFollowUp,
      actor: actorFromReq(req),
      notes,
      bearerToken: req.user?.token
    });
  }

  await auditService.record(req, {
    action: 'lead.manage',
    entityType: 'lead',
    entityId: lead._id,
    after: {
      status: lead.status,
      lastContactAt: lead.lastContactAt,
      nextFollowUpAt: lead.nextFollowUpAt,
      channel,
      outcome
    }
  });

  return {
    lead: await enrichLeadData(lead.toObject()),
    event: event.toObject(),
    attachments: attachments.map(briefAttachment),
    followUp: followUp ? followUp.toObject() : null,
    completedFollowUps
  };
};

module.exports.registerLotOperation = async function registerLotOperation(payload = {}, req) {
  const allowed = canManageLeadInbox(req.user) || [
    'gestionBodega',
    'lotesCliente',
    'lotesProveedor'
  ].some((permission) => hasLeadPermission(req.user, permission));
  if (!allowed) throw httpError(403, 'No autorizado para registrar compras desde WMS');

  const lotId = cleanString(payload.lotId);
  const counterpartyType = cleanString(payload.counterpartyType).toLowerCase();
  const counterpartyId = cleanString(payload.counterpartyId);
  const counterpartyName = cleanString(payload.counterpartyName);
  const parsedOperationAt = payload.lotCreatedAt ? new Date(payload.lotCreatedAt) : new Date();
  const operationAt = Number.isNaN(parsedOperationAt.getTime()) ? new Date() : parsedOperationAt;
  const referenceConditions = [
    { 'customFields.companyId': counterpartyId },
    { 'sourcePayload.companyId': counterpartyId },
    { 'sourcePayload.accountId': counterpartyId }
  ];
  if (counterpartyName) {
    const exactName = new RegExp(`^${escapeRegex(counterpartyName)}$`, 'i');
    referenceConditions.push(
      { companyName: exactName },
      { 'sourcePayload.company': exactName }
    );
  }
  if (mongoose.isValidObjectId(counterpartyId)) {
    referenceConditions.push({ accountId: counterpartyId });
  }
  const counterpartyConditions = counterpartyType === 'provider'
    ? [
        { 'customFields.companyType': 'provider' },
        { 'sourcePayload.companyType': 'provider' },
        { accountTypeIntent: 'supplier' }
      ]
    : [
        { 'customFields.companyType': 'client' },
        { 'sourcePayload.companyType': 'client' },
        { accountTypeIntent: 'customer' }
      ];

  const existing = await Lead.findOne({
    businessUnit: { $in: ['Harvest', 'Greenway'] },
    status: 'won',
    'customFields.lastOperation.operationType': 'lot',
    'customFields.lastOperation.operationId': lotId,
    $and: [
      { $or: referenceConditions },
      { $or: counterpartyConditions }
    ]
  }).sort({ closedAt: -1 });
  if (existing) {
    return {
      matched: true,
      alreadyProcessed: true,
      lead: await enrichLeadData(existing.toObject())
    };
  }

  const managedStatuses = [
    'assigned', 'contact_attempted', 'contacted', 'consultation',
    'meeting_required', 'meeting_scheduled', 'meeting_completed', 'meeting_not_completed',
    'visit_scheduled', 'visit_completed', 'visit_not_completed', 'pickup_scheduled',
    'pickup_completed', 'pickup_not_completed', 'price_requested', 'price_informed',
    'quote_created', 'quote_sent', 'opportunity'
  ];
  const lead = await Lead.findOne({
    businessUnit: { $in: ['Harvest', 'Greenway'] },
    status: { $in: managedStatuses },
    assignedAdvisorId: { $exists: true, $nin: ['', null] },
    'customFields.crmStartedAt': { $exists: true, $ne: null, $lte: operationAt },
    $and: [
      { $or: referenceConditions },
      { $or: counterpartyConditions }
    ]
  }).sort({ updatedAt: -1, createdAt: -1 });

  if (!lead) {
    const unstartedLead = await Lead.exists({
      businessUnit: { $in: ['Harvest', 'Greenway'] },
      status: { $in: ['new', 'queued', 'incomplete', ...managedStatuses] },
      $and: [
        { $or: referenceConditions },
        { $or: counterpartyConditions }
      ]
    });
    return {
      matched: false,
      alreadyProcessed: false,
      reason: unstartedLead ? 'commercial_management_not_started' : 'lead_not_found',
      lead: null
    };
  }

  const closedAt = operationAt;
  const previousStatus = lead.status;
  const counterpartyLabel = counterpartyType === 'provider' ? 'proveedor' : 'cliente';
  const notes = `${lotId} creado en WMS para el ${counterpartyLabel} ${counterpartyId}. Compra realizada.`;
  const event = await LeadEvent.create({
    leadId: lead._id,
    type: 'note',
    channel: 'system',
    outcome: 'lot_created',
    notes,
    actor: actorFromReq(req),
    createdAt: closedAt,
    updatedAt: closedAt,
    metadata: {
      previousStatus,
      nextStatus: 'won',
      occurredAt: closedAt,
      lot: {
        id: lotId,
        action: 'created',
        counterpartyType,
        counterpartyId
      },
      nextAction: { type: 'none', at: null, purpose: '', participants: [] }
    }
  });

  const completed = await FollowUp.updateMany(
    { leadId: lead._id, status: { $in: ['pending', 'overdue'] } },
    {
      $set: {
        status: 'cancelled',
        completedAt: closedAt,
        'metadata.resolvedByEventId': String(event._id),
        'metadata.resolvedByAction': true,
        'metadata.closedByOperation': 'lot'
      }
    }
  );
  await closeScheduledMeetings(lead._id, {
    outcome: 'commercial_process_closed',
    notes,
    completedAt: closedAt
  });

  lead.status = 'won';
  lead.nextFollowUpAt = null;
  lead.closedAt = closedAt;
  lead.closedReason = `Compra realizada: ${lotId} creado en WMS`;
  lead.customFields = {
    ...(lead.customFields || {}),
    lastManagedAt: closedAt,
    lastManagedBy: req.user?.id || '',
    lastManagedByName: req.user?.name || '',
    lastContactChannel: 'system',
    lastContactOutcome: 'lot_created',
    lastNote: notes,
    companyId: counterpartyId,
    companyType: counterpartyType,
    nextStep: '',
    nextAction: { type: 'none', at: null, purpose: '', participants: [] },
    lastOperation: {
      operationType: 'lot',
      operationId: lotId,
      counterpartyType,
      counterpartyId,
      at: closedAt
    }
  };
  lead.markModified('customFields');
  await lead.save();

  await auditService.record(req, {
    action: 'lead.close_from_wms_lot',
    entityType: 'lead',
    entityId: lead._id,
    before: { status: previousStatus },
    after: { status: 'won', lotId, counterpartyType, counterpartyId }
  });

  return {
    matched: true,
    alreadyProcessed: false,
    lead: await enrichLeadData(lead.toObject()),
    event: event.toObject(),
    completedFollowUps: Number(completed.modifiedCount || 0)
  };
};

module.exports.adminUpdateLead = async function adminUpdateLead(leadId, payload = {}, req) {
  if (!canAdministerLeads(req.user)) {
    throw httpError(403, 'No autorizado para administrar leads');
  }

  const lead = await Lead.findById(leadId);
  if (!lead) throw httpError(404, 'Lead no encontrado');

  const before = lead.toObject();
  const previousStatus = lead.status;
  const reason = cleanString(payload.reason);
  const directFields = [
    'name',
    'companyName',
    'businessUnit',
    'serviceLine',
    'accountTypeIntent',
    'country',
    'city',
    'status'
  ];

  directFields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      lead[field] = cleanString(payload[field]);
    }
  });

  if (Object.prototype.hasOwnProperty.call(payload, 'phone')) {
    const phone = cleanString(payload.phone);
    lead.phones = phone
      ? [{ raw: phone, normalized: normalizePhone(phone), label: 'Principal', preferred: true }]
      : [];
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'email')) {
    const email = cleanString(payload.email);
    lead.emails = email
      ? [{ raw: email, normalized: normalizeEmail(email), label: 'Principal', preferred: true }]
      : [];
  }

  const customFields = { ...(lead.customFields || {}) };
  if (Object.prototype.hasOwnProperty.call(payload, 'companyId')) {
    customFields.companyId = cleanString(payload.companyId);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'companyType')) {
    customFields.companyType = cleanString(payload.companyType);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'nextStep')) {
    customFields.nextStep = cleanString(payload.nextStep);
  }
  customFields.lastAdminNote = reason;
  customFields.lastAdminAt = new Date();
  customFields.lastAdminBy = req.user?.id || '';
  customFields.lastAdminByName = req.user?.name || '';
  lead.customFields = customFields;
  lead.markModified('customFields');

  if (Object.prototype.hasOwnProperty.call(payload, 'nextFollowUpAt')) {
    lead.nextFollowUpAt = payload.nextFollowUpAt ? new Date(payload.nextFollowUpAt) : null;
  }

  const terminalStatuses = new Set(['won', 'lost', 'discarded', 'do_not_contact']);
  const statusChanged = previousStatus !== lead.status;
  if (terminalStatuses.has(lead.status)) {
    lead.closedAt = statusChanged || !lead.closedAt ? new Date() : lead.closedAt;
    lead.closedReason = reason;
    lead.nextFollowUpAt = null;
    customFields.nextStep = '';
    await FollowUp.updateMany(
      { leadId: lead._id, status: { $in: ['pending', 'overdue'] } },
      {
        $set: {
          status: 'cancelled',
          completedAt: new Date(),
          'metadata.resolvedByAction': true,
          'metadata.closedByAdmin': String(req.user?.id || '')
        }
      }
    );
    await closeScheduledMeetings(lead._id, {
      outcome: 'commercial_process_closed_by_admin',
      notes: reason,
      completedAt: new Date()
    });
  } else if (statusChanged && terminalStatuses.has(previousStatus)) {
    lead.closedAt = null;
    lead.closedReason = '';
  }

  await lead.save();

  await LeadEvent.create({
    leadId: lead._id,
    type: statusChanged ? 'status_change' : 'note',
    channel: 'system',
    outcome: statusChanged ? 'admin_status_changed' : 'admin_edited',
    notes: reason,
    actor: actorFromReq(req),
    metadata: {
      previousStatus,
      nextStatus: lead.status,
      changedByAdmin: true
    }
  });

  await auditService.record(req, {
    action: statusChanged ? 'lead.admin_status_change' : 'lead.admin_update',
    entityType: 'lead',
    entityId: lead._id,
    before,
    after: lead.toObject(),
    metadata: { reason }
  });

  return enrichLeadData(lead.toObject());
};

module.exports.listAdminLeadEvents = async function listAdminLeadEvents(leadId, req) {
  if (!canAdministerLeads(req.user)) {
    throw httpError(403, 'No autorizado para administrar el historial de leads');
  }

  const lead = await Lead.findById(leadId).select('_id code name companyName').lean();
  if (!lead) throw httpError(404, 'Lead no encontrado');

  const items = await LeadEvent.find({ leadId: lead._id })
    .sort({ createdAt: -1 })
    .lean();

  return { lead, items, total: items.length };
};

module.exports.adminUpdateLeadEvent = async function adminUpdateLeadEvent(
  leadId,
  eventId,
  payload = {},
  req
) {
  if (!canAdministerLeads(req.user)) {
    throw httpError(403, 'No autorizado para corregir el historial de leads');
  }

  const lead = await Lead.findById(leadId).select('_id code').lean();
  if (!lead) throw httpError(404, 'Lead no encontrado');

  const event = await LeadEvent.findOne({ _id: eventId, leadId: lead._id });
  if (!event) throw httpError(404, 'Movimiento de historial no encontrado');

  const before = event.toObject();
  const reason = cleanString(payload.reason);
  const correctedAt = new Date();
  const corrections = Array.isArray(event.metadata?.adminCorrections)
    ? event.metadata.adminCorrections.slice(-9)
    : [];

  corrections.push({
    at: correctedAt,
    by: actorFromReq(req),
    reason,
    before: {
      type: before.type,
      channel: before.channel,
      outcome: before.outcome,
      notes: before.notes,
      occurredAt: before.createdAt
    }
  });

  ['type', 'channel', 'outcome', 'notes'].forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      event[field] = cleanString(payload[field]);
    }
  });
  event.metadata = {
    ...(event.metadata || {}),
    adminCorrections: corrections,
    lastCorrectedAt: correctedAt,
    lastCorrectedBy: actorFromReq(req),
    lastCorrectionReason: reason
  };
  event.markModified('metadata');
  await event.save();

  if (payload.occurredAt) {
    const occurredAt = new Date(payload.occurredAt);
    await LeadEvent.collection.updateOne(
      { _id: event._id },
      { $set: { createdAt: occurredAt } }
    );
  }

  const updated = await LeadEvent.findById(event._id).lean();
  await auditService.record(req, {
    action: 'lead.event_admin_update',
    entityType: 'leadEvent',
    entityId: event._id,
    before,
    after: updated,
    metadata: { leadId: String(lead._id), leadCode: lead.code, reason }
  });

  return updated;
};

module.exports.adminDeleteLead = async function adminDeleteLead(leadId, payload = {}, req) {
  if (!canAdministerLeads(req.user)) {
    throw httpError(403, 'No autorizado para eliminar leads');
  }

  const lead = await Lead.findById(leadId).lean();
  if (!lead) throw httpError(404, 'Lead no encontrado');

  const reason = cleanString(payload.reason);
  const attachments = await Attachment.find({
    entityType: 'lead',
    entityId: String(lead._id)
  }).lean();
  const storageWarnings = [];

  for (const attachment of attachments) {
    if (attachment.storage !== 's3' || !attachment.path) continue;
    const bucket = cleanString(
      attachment.metadata?.bucket || process.env.S3_BUCKET || process.env.AWS_S3_BUCKET
    );
    if (!bucket) continue;
    try {
      await getS3Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: attachment.path }));
    } catch (error) {
      storageWarnings.push(`${attachment.fileName}: ${error.message}`);
    }
  }

  await auditService.record(req, {
    action: 'lead.admin_delete',
    entityType: 'lead',
    entityId: lead._id,
    before: lead,
    metadata: { reason, storageWarnings }
  });

  const [events, followUps, meetings, opportunities, prices, requests, policies, queue, files] =
    await Promise.all([
      LeadEvent.deleteMany({ leadId: lead._id }),
      FollowUp.deleteMany({ leadId: lead._id }),
      Meeting.deleteMany({ leadId: lead._id }),
      Opportunity.deleteMany({ leadId: lead._id }),
      PriceSnapshot.deleteMany({ leadId: lead._id }),
      CommercialRequest.deleteMany({ leadId: lead._id }),
      ContactPolicy.deleteMany({ leadId: lead._id }),
      CampaignQueue.deleteMany({ leadId: lead._id }),
      Attachment.deleteMany({ entityType: 'lead', entityId: String(lead._id) })
    ]);

  await CampaignRecord.updateMany({ leadId: lead._id }, { $unset: { leadId: 1 } });
  await Lead.deleteOne({ _id: lead._id });

  return {
    deleted: true,
    leadId: String(lead._id),
    code: lead.code,
    relatedDeleted: {
      events: events.deletedCount,
      followUps: followUps.deletedCount,
      meetings: meetings.deletedCount,
      opportunities: opportunities.deletedCount,
      prices: prices.deletedCount,
      requests: requests.deletedCount,
      policies: policies.deletedCount,
      queue: queue.deletedCount,
      attachments: files.deletedCount
    },
    storageWarnings
  };
};

module.exports.assignLead = async function assignLead(leadId, payload = {}, req) {
  const lead = await Lead.findById(leadId);
  if (!lead) throw httpError(404, 'Lead no encontrado');
  if (!canWriteLead(lead, req.user)) {
    throw httpError(403, 'No autorizado para asignar este lead');
  }

  const assignedAdvisorId = cleanString(payload.assignedAdvisorId);
  const assignedAdvisorName = cleanString(payload.assignedAdvisorName) || assignedAdvisorId;
  if (!assignedAdvisorId) throw httpError(400, 'assignedAdvisorId es requerido');

  const previousAdvisorId = lead.assignedAdvisorId || '';
  const previousAdvisorName = lead.assignedAdvisorName || '';

  const isReassignment = Boolean(previousAdvisorId && previousAdvisorId !== assignedAdvisorId);
  const startsCommercialManagement = ['new', 'queued', 'incomplete'].includes(lead.status);

  lead.assignedAdvisorId = assignedAdvisorId;
  lead.assignedAdvisorName = assignedAdvisorName;
  if (startsCommercialManagement) lead.status = 'assigned';
  lead.customFields = {
    ...(lead.customFields || {}),
    crmStartedAt: lead.customFields?.crmStartedAt || new Date(),
    crmStartedBy: lead.customFields?.crmStartedBy || req.user?.id || '',
    crmStartedByName: lead.customFields?.crmStartedByName || req.user?.name || '',
    lastReassignedAt: isReassignment ? new Date() : lead.customFields?.lastReassignedAt,
    lastReassignedBy: isReassignment ? req.user?.id || '' : lead.customFields?.lastReassignedBy
  };

  await lead.save();

  await LeadEvent.create({
    leadId: lead._id,
    type: 'assignment',
    channel: 'system',
    outcome: isReassignment ? 'lead_reassigned' : 'crm_started',
    notes: cleanString(payload.note) || (isReassignment
      ? 'Lead reasignado administrativamente'
      : 'Lead asignado desde bandeja de recepcion'),
    actor: actorFromReq(req),
    metadata: {
      previousAdvisorId,
      previousAdvisorName,
      assignedAdvisorId,
      assignedAdvisorName
    }
  });

  await FollowUp.updateMany(
    { leadId: lead._id, status: { $in: ['pending', 'overdue'] } },
    { $set: { assignedAdvisorId } }
  );
  await Meeting.updateMany(
    { leadId: lead._id, status: 'scheduled' },
    { $set: { advisorId: assignedAdvisorId, advisorName: assignedAdvisorName } }
  );

  await notifyAssignment({
    lead,
    actor: actorFromReq(req),
    isReassignment,
    previousAdvisorId,
    bearerToken: req.user?.token
  });

  return enrichLeadData(lead.toObject());
};

module.exports.discardLead = async function discardLead(leadId, payload = {}, req) {
  const lead = await Lead.findById(leadId);
  if (!lead) throw httpError(404, 'Lead no encontrado');
  if (!canWriteLead(lead, req.user)) {
    throw httpError(403, 'No autorizado para descartar este lead');
  }

  const discardableStatuses = new Set(['new', 'queued', 'incomplete']);
  if (!discardableStatuses.has(lead.status)) {
    throw httpError(409, 'Solo se pueden descartar leads pendientes de la bandeja administrativa');
  }

  const reason = cleanString(payload.reason);
  const note = cleanString(payload.note);
  const reasonLabels = {
    not_qualified: 'No califica como lead',
    invalid_data: 'Datos invalidos o insuficientes',
    duplicate: 'Registro duplicado',
    out_of_scope: 'Fuera del alcance comercial',
    spam: 'Spam o solicitud irrelevante',
    other: 'Otro motivo'
  };
  const reasonLabel = reasonLabels[reason];
  if (!reasonLabel) throw httpError(400, 'Motivo de descarte invalido');
  if (reason === 'other' && note.length < 5) {
    throw httpError(400, 'Describe el motivo del descarte');
  }

  const before = lead.toObject();
  const discardedAt = new Date();
  lead.status = 'discarded';
  lead.closedAt = discardedAt;
  lead.closedReason = note ? `${reasonLabel}: ${note}` : reasonLabel;
  lead.customFields = {
    ...(lead.customFields || {}),
    discardReason: reason,
    discardReasonLabel: reasonLabel,
    discardNote: note,
    discardedAt,
    discardedBy: req.user?.id || '',
    discardedByName: req.user?.name || ''
  };
  await lead.save();

  await LeadEvent.create({
    leadId: lead._id,
    type: 'status_change',
    channel: 'system',
    outcome: 'lead_discarded',
    notes: lead.closedReason,
    actor: actorFromReq(req),
    metadata: {
      previousStatus: before.status,
      nextStatus: 'discarded',
      reason,
      reasonLabel,
      note
    }
  });

  await auditService.record(req, {
    action: 'lead.discard',
    entityType: 'lead',
    entityId: lead._id,
    before: { status: before.status },
    after: {
      status: lead.status,
      closedAt: lead.closedAt,
      closedReason: lead.closedReason
    },
    metadata: { reason, reasonLabel, note }
  });

  return enrichLeadData(lead.toObject());
};

module.exports.ingestPublicLead = async function ingestPublicLead(req) {
  const payload = parsePayload(req.body);
  const meta = buildSourceMeta(req);
  const data = buildPublicLeadData({ payload, meta });

  data.code = await counterService.nextLeadCode(data.businessUnit);

  const uploadedFiles = await uploadLeadFiles({
    files: req.files,
    code: data.code
  });

  const lead = await Lead.create(data);

  let attachments = [];
  if (uploadedFiles.length) {
    attachments = await Attachment.insertMany(
      uploadedFiles.map((file) => ({
        entityType: 'lead',
        entityId: String(lead._id),
        fileName: file.fileName,
        mimeType: file.mimeType,
        size: file.size,
        storage: file.storage,
        path: file.path,
        url: file.url,
        metadata: file.metadata
      }))
    );
  }

  const notification = await sendLeadNotification({
    lead: lead.toObject(),
    payload,
    requestFiles: req.files || [],
    meta
  });

  await LeadEvent.create({
    leadId: lead._id,
    type: 'imported',
    channel: 'system',
    outcome: 'lead_web_recibido',
    notes: 'Lead recibido desde formulario web',
    metadata: {
      pageUrl: meta.pageUrl,
      formId: meta.formId,
      notification,
      attachmentCount: attachments.length
    }
  });

  lead.customFields = {
    ...(lead.customFields || {}),
    notification,
    attachmentCount: attachments.length
  };
  await lead.save();

  return {
    ok: true,
    leadId: String(lead._id),
    code: lead.code,
    attachments: attachments.map((item) => item.toObject()),
    notification
  };
};

module.exports.createManualLead = async function createManualLead(req) {
  const data = buildManualLeadData(req);

  data.code = await counterService.nextLeadCode(data.businessUnit);

  const uploadedFiles = await uploadLeadFiles({
    files: req.files,
    code: data.code
  });

  const lead = await Lead.create(data);

  let attachments = [];
  if (uploadedFiles.length) {
    attachments = await Attachment.insertMany(
      uploadedFiles.map((file) => ({
        entityType: 'lead',
        entityId: String(lead._id),
        fileName: file.fileName,
        mimeType: file.mimeType,
        size: file.size,
        storage: file.storage,
        path: file.path,
        url: file.url,
        uploadedBy: actorFromReq(req),
        metadata: file.metadata
      }))
    );
  }

  await LeadEvent.create({
    leadId: lead._id,
    type: data.assignedAdvisorId ? 'assignment' : 'imported',
    channel: data.customFields.sourceChannel || 'manual',
    outcome: data.assignedAdvisorId ? 'lead_manual_asignado' : 'lead_manual_recibido',
    notes: data.customFields.description || 'Lead creado manualmente desde recepcion',
    actor: actorFromReq(req),
    metadata: {
      attachmentCount: attachments.length,
      sourceChannel: data.customFields.sourceChannel,
      assignedAdvisorId: data.assignedAdvisorId || '',
      assignedAdvisorName: data.assignedAdvisorName || ''
    }
  });

  lead.customFields = {
    ...(lead.customFields || {}),
    attachmentCount: attachments.length
  };
  await lead.save();

  if (data.assignedAdvisorId) {
    await notifyAssignment({
      lead,
      actor: actorFromReq(req),
      isReassignment: false,
      bearerToken: req.user?.token
    });
  }

  return enrichLeadData({
    ...lead.toObject(),
    attachments: attachments.map((item) => item.toObject()),
    files: attachments.map((item) => item.toObject())
  });
};
