'use strict';

const jwt = require('jsonwebtoken');
const tareasClient = require('../../integrations/tareas/tareas.client');
const logger = require('../../utils/logger');

const CHANNEL_LABELS = {
  phone: 'llamada',
  whatsapp: 'seguimiento por WhatsApp',
  email: 'seguimiento por correo',
  meeting: 'reunión',
  visit: 'visita',
  pickup: 'recogida',
  task: 'seguimiento'
};

function uniqueIds(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function serviceToken() {
  if (process.env.TAREAS_API_TOKEN) return null;
  if (!process.env.JWT_SECRET) return null;

  return jwt.sign({
    id_personal: 'hub-comercial',
    name: 'Hub Comercial',
    roles: ['system']
  }, process.env.JWT_SECRET, { expiresIn: '5m' });
}

function leadTarget(lead, followUp) {
  const leadId = String(lead?._id || followUp?.leadId || '');
  const followUpId = String(followUp?._id || '');
  const params = new URLSearchParams({ leadId });
  if (followUpId) params.set('followUpId', followUpId);

  return {
    type: 'lead',
    params: {
      leadId,
      leadCode: String(lead?.code || ''),
      ...(followUpId ? { followUpId } : {})
    },
    url: `/gestion-comercial/atencion?${params.toString()}`
  };
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'la hora programada';
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date);
}

function followUpRecipients(followUp) {
  return uniqueIds([
    followUp?.assignedAdvisorId,
    ...(followUp?.participants || []).map((participant) => participant?.personalId)
  ]);
}

async function createNotification(payload, bearerToken) {
  return tareasClient.createSystemNotification(
    payload,
    bearerToken || serviceToken() || undefined
  );
}

async function safely(label, work) {
  try {
    return await work();
  } catch (error) {
    logger.warn('lead_notification_failed', {
      operation: label,
      message: error.message,
      statusCode: error.statusCode
    });
    return { created: 0, failed: true, error: error.message };
  }
}

async function notifyAssignment({
  lead,
  actor = {},
  isReassignment = false,
  previousAdvisorId = '',
  bearerToken
}) {
  return safely('assignment', async () => {
    const actorId = String(actor.id || 'hub-comercial');
    const assignmentKey = lead.updatedAt?.getTime?.() || Date.now();
    const assigned = await createNotification({
      actor_id_personal: actorId,
      to_ids: [String(lead.assignedAdvisorId || '')],
      type: 'comercial.asignacion',
      title: isReassignment ? 'LEAD REASIGNADO' : 'NUEVO LEAD ASIGNADO',
      body: `${lead.code || 'Lead'} · ${lead.name || lead.companyName || 'Sin nombre'} · ${lead.businessUnit || 'Gestión comercial'}`,
      target: leadTarget(lead),
      meta: {
        prioridad: 'alta',
        leadId: String(lead._id),
        leadCode: lead.code || '',
        linea: lead.businessUnit || ''
      },
      dedupeKey: `lead:${lead._id}:assignment:${lead.assignedAdvisorId}:${assignmentKey}`,
      dedupeWindowHours: 24
    }, bearerToken);

    let previous = null;
    if (
      isReassignment &&
      previousAdvisorId &&
      String(previousAdvisorId) !== String(lead.assignedAdvisorId)
    ) {
      previous = await createNotification({
        actor_id_personal: actorId,
        to_ids: [String(previousAdvisorId)],
        type: 'comercial.reasignacion',
        title: 'LEAD RETIRADO DE TU CARTERA',
        body: `${lead.code || 'Lead'} · ${lead.name || lead.companyName || 'Sin nombre'} fue reasignado a otro asesor.`,
        target: leadTarget(lead),
        meta: {
          prioridad: 'alta',
          leadId: String(lead._id),
          leadCode: lead.code || '',
          nuevoAsesorId: String(lead.assignedAdvisorId || '')
        },
        dedupeKey: `lead:${lead._id}:removed:${previousAdvisorId}:${assignmentKey}`,
        dedupeWindowHours: 24
      }, bearerToken);
    }

    return { assigned, previous };
  });
}

async function notifyScheduledFollowUp({ lead, followUp, actor = {}, bearerToken }) {
  const channelLabel = CHANNEL_LABELS[followUp.channel] || 'seguimiento';
  const rescheduled = Boolean(followUp.metadata?.isReschedule);

  return safely('scheduled_follow_up', () => createNotification({
    actor_id_personal: String(actor.id || 'hub-comercial'),
    to_ids: followUpRecipients(followUp),
    type: 'comercial.actividad_agendada',
    title: `${channelLabel.toUpperCase()} ${rescheduled ? 'REPROGRAMADA' : 'AGENDADA'}`,
    body: `${lead.code || 'Lead'} · ${lead.name || lead.companyName || 'Sin nombre'} · ${formatDateTime(followUp.dueAt)}${followUp.reason ? ` · ${followUp.reason}` : ''}`,
    target: leadTarget(lead, followUp),
    meta: {
      prioridad: 'normal',
      leadId: String(lead._id),
      leadCode: lead.code || '',
      followUpId: String(followUp._id),
      canal: followUp.channel,
      fechaProgramada: followUp.dueAt
    },
    dedupeKey: `lead:${lead._id}:followup:${followUp._id}:scheduled`,
    dedupeWindowHours: 720
  }, bearerToken));
}

async function notifyCancelledFollowUp({
  lead,
  followUp,
  actor = {},
  notes = '',
  bearerToken
}) {
  const channelLabel = CHANNEL_LABELS[followUp.channel] || 'actividad';

  return safely('cancelled_follow_up', () => createNotification({
    actor_id_personal: String(actor.id || 'hub-comercial'),
    to_ids: followUpRecipients(followUp),
    type: 'comercial.actividad_no_realizada',
    title: `${channelLabel.toUpperCase()} NO REALIZADA`,
    body: `${lead.code || 'Lead'} · ${lead.name || lead.companyName || 'Sin nombre'}${notes ? ` · ${notes}` : ''}`,
    target: leadTarget(lead, followUp),
    meta: {
      prioridad: 'alta',
      leadId: String(lead._id),
      leadCode: lead.code || '',
      followUpId: String(followUp._id),
      canal: followUp.channel,
      fechaProgramada: followUp.dueAt
    },
    dedupeKey: `lead:${lead._id}:followup:${followUp._id}:not-completed`,
    dedupeWindowHours: 720
  }, bearerToken));
}

async function notifyFollowUpReminder({ lead, followUp }) {
  const channelLabel = CHANNEL_LABELS[followUp.channel] || 'seguimiento';

  return createNotification({
    actor_id_personal: 'hub-comercial',
    to_ids: followUpRecipients(followUp),
    type: 'comercial.recordatorio_10_min',
    title: `EN 10 MINUTOS: ${channelLabel.toUpperCase()}`,
    body: `${lead.code || 'Lead'} · ${lead.name || lead.companyName || 'Sin nombre'}${followUp.reason ? ` · ${followUp.reason}` : ''}`,
    target: leadTarget(lead, followUp),
    meta: {
      prioridad: 'urgente',
      requiereAtencion: true,
      leadId: String(lead._id),
      leadCode: lead.code || '',
      followUpId: String(followUp._id),
      canal: followUp.channel,
      fechaProgramada: followUp.dueAt
    },
    dedupeKey: `lead:${lead._id}:followup:${followUp._id}:reminder-10`,
    dedupeWindowHours: 720
  });
}

module.exports = {
  notifyAssignment,
  notifyScheduledFollowUp,
  notifyCancelledFollowUp,
  notifyFollowUpReminder
};
