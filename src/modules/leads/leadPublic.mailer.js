'use strict';

const nodemailer = require('nodemailer');
const NotificationOutbox = require('../notifications/notificationOutbox.model');

let cachedTransporter = null;

function cleanString(value) {
  return String(value || '').trim();
}

function escapeHtml(value) {
  return cleanString(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function safeJsonParse(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function getTransporter() {
  if (cachedTransporter) return cachedTransporter;

  const host = cleanString(process.env.LEADS_MAIL_HOST || process.env.MAIL_HOST);
  const user = cleanString(process.env.LEADS_MAIL_USER || process.env.MAIL_USER);
  const pass = cleanString(process.env.LEADS_MAIL_PASS || process.env.MAIL_PASS);
  const port = Number(process.env.LEADS_MAIL_PORT || process.env.MAIL_PORT || 465);
  const secure =
    String(process.env.LEADS_MAIL_SECURE || process.env.MAIL_SECURE || 'true')
      .toLowerCase() === 'true';

  if (!host || !user || !pass) return null;

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  return cachedTransporter;
}

function resolveLeadRecipient({ pageUrl = '', referer = '', businessUnit = '' } = {}) {
  const routes = safeJsonParse(process.env.LEADS_EMAIL_ROUTES, {});
  const defaultEmail = cleanString(process.env.LEADS_EMAIL_DEFAULT || process.env.MAIL_TO);
  const haystack = [pageUrl, referer, businessUnit].join(' ').toLowerCase();

  for (const [pattern, email] of Object.entries(routes)) {
    if (haystack.includes(String(pattern).toLowerCase())) return email;
  }

  return defaultEmail;
}

function renderRows(payload = {}) {
  return Object.entries(payload)
    .map(([key, value]) => {
      const displayValue =
        value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');

      return `
        <tr>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-weight:700;color:#334155;">${escapeHtml(key)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#0f172a;">${escapeHtml(displayValue)}</td>
        </tr>
      `;
    })
    .join('');
}

function buildLeadHtml({ lead, payload, files = [], meta = {} }) {
  return `
    <div style="font-family:Arial,sans-serif;background:#f8fafc;padding:24px;color:#0f172a;">
      <div style="max-width:760px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
        <div style="padding:18px 22px;background:#0f172a;color:#ffffff;">
          <h2 style="margin:0;font-size:20px;">Nuevo lead comercial ${escapeHtml(lead.code || '')}</h2>
          <p style="margin:6px 0 0;color:#cbd5e1;font-size:13px;">${escapeHtml(meta.pageUrl || meta.referer || 'Origen no informado')}</p>
        </div>

        <div style="padding:20px 22px;">
          <p style="margin:0 0 14px;color:#334155;">
            <strong>Unidad:</strong> ${escapeHtml(lead.businessUnit)} &nbsp;·&nbsp;
            <strong>Servicio:</strong> ${escapeHtml(lead.serviceLine)}
          </p>

          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            ${renderRows(payload)}
          </table>

          <div style="margin-top:18px;padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;color:#475569;">
            <strong>Origen:</strong> ${escapeHtml(meta.pageUrl || '-')}<br/>
            <strong>Referer:</strong> ${escapeHtml(meta.referer || '-')}<br/>
            <strong>Form ID:</strong> ${escapeHtml(meta.formId || '-')}<br/>
            <strong>IP:</strong> ${escapeHtml(meta.ip || '-')}<br/>
            <strong>Adjuntos:</strong> ${files.length}
          </div>
        </div>
      </div>
    </div>
  `;
}

async function sendLeadNotification({ lead, payload, requestFiles = [], meta = {} }) {
  const transporter = getTransporter();
  const to = resolveLeadRecipient({
    pageUrl: meta.pageUrl,
    referer: meta.referer,
    businessUnit: lead.businessUnit,
  });

  const outbox = await NotificationOutbox.create({
    channel: 'email',
    recipient: { email: to },
    subject: `Nuevo lead comercial ${lead.code || ''}`.trim(),
    body: 'Nuevo lead recibido desde formulario web',
    payload: { leadId: String(lead._id), code: lead.code, meta },
    status: transporter && to ? 'pending' : 'failed',
    attempts: 0,
    lastError: transporter && to ? undefined : 'SMTP o destinatario no configurado',
  });

  if (!transporter || !to) {
    return {
      sent: false,
      to: to || '',
      outboxId: outbox._id,
      error: 'SMTP o destinatario no configurado',
    };
  }

  try {
    const from = cleanString(
      process.env.LEADS_MAIL_FROM || process.env.MAIL_FROM || process.env.LEADS_MAIL_USER || process.env.MAIL_USER
    );
    const attachFiles =
      String(process.env.LEADS_EMAIL_ATTACH_FILES || 'true').toLowerCase() !== 'false';

    await transporter.sendMail({
      from,
      to,
      subject: `Nuevo lead comercial ${lead.code || ''} - ${lead.businessUnit}`,
      html: buildLeadHtml({ lead, payload, files: requestFiles, meta }),
      replyTo: payload.email || payload.correo || undefined,
      attachments: attachFiles
        ? requestFiles.map((file) => ({
            filename: file.originalname,
            content: file.buffer,
            contentType: file.mimetype,
          }))
        : [],
    });

    outbox.status = 'sent';
    outbox.attempts = 1;
    outbox.sentAt = new Date();
    outbox.lastError = undefined;
    await outbox.save();

    return { sent: true, to, outboxId: outbox._id, sentAt: outbox.sentAt };
  } catch (error) {
    outbox.status = 'failed';
    outbox.attempts = 1;
    outbox.lastError = error.message;
    await outbox.save();

    return {
      sent: false,
      to,
      outboxId: outbox._id,
      error: error.message,
    };
  }
}

module.exports = {
  sendLeadNotification,
  resolveLeadRecipient,
};
