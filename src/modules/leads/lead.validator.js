'use strict';

const { body, param } = require('express-validator');
const { objectIdParam } = require('../shared/validators');
const { BUSINESS_UNITS, SERVICE_LINES, LEAD_STATUSES } = require('../shared/business.constants');

const validateCreate = [
  body('businessUnit').optional().isIn(BUSINESS_UNITS),
  body('serviceLine').optional().isIn(SERVICE_LINES),
  body('status').optional().isString(),
  body('emails').optional().isArray(),
  body('phones').optional().isArray()
];

const validateAssign = [
  objectIdParam(),
  body('assignedAdvisorId').isString().trim().notEmpty(),
  body('assignedAdvisorName').optional().isString().trim(),
  body('note').optional().isString().trim().isLength({ max: 2000 })
];

const validateDiscard = [
  objectIdParam(),
  body('reason')
    .isIn(['not_qualified', 'invalid_data', 'duplicate', 'out_of_scope', 'spam', 'other']),
  body('note').optional().isString().trim().isLength({ max: 2000 })
];

const validateAction = [
  objectIdParam(),
  body('channel').isIn(['phone', 'whatsapp', 'email', 'meeting', 'visit', 'pickup', 'manual']),
  body('outcome').isString().trim().notEmpty().isLength({ max: 120 }),
  body('notes').optional().isString().trim().isLength({ max: 4000 }),
  body('nextStatus').optional().isIn(LEAD_STATUSES),
  body('nextFollowUpAt').optional({ nullable: true, checkFalsy: true }).isISO8601(),
  body('nextStep').optional().isString().trim().isLength({ max: 500 }),
  body('nextActionType').optional().isIn(['none', 'phone', 'whatsapp', 'email', 'meeting', 'visit', 'pickup']),
  body('nextActionAt').optional({ nullable: true, checkFalsy: true }).isISO8601(),
  body('nextActionPurpose').optional().isString().trim().isLength({ max: 500 }),
  body('participants').optional().custom((value) => {
    let participants = value;
    if (typeof participants === 'string') {
      try { participants = JSON.parse(participants); } catch { throw new Error('Los participantes no tienen un formato válido'); }
    }
    if (!Array.isArray(participants) || participants.length > 20) {
      throw new Error('Los participantes deben ser una lista de máximo 20 personas');
    }
    if (!participants.every((item) => item && typeof item === 'object' && String(item.personalId || '').trim())) {
      throw new Error('Cada participante debe corresponder a un id_personal');
    }
    return true;
  }),
  body('quotationId').optional().isString().trim().isLength({ max: 120 }),
  body('quotationNumber').optional().isString().trim().isLength({ max: 120 }),
  body('quotationAction').optional().isIn(['created', 'sent']),
  body('shipmentId').optional().isString().trim().isLength({ max: 120 }),
  body('shipmentNumber').optional().isString().trim().isLength({ max: 120 }),
  body('shipmentAction').optional().isIn(['created']),
  body('closureReason').optional().isString().trim().isLength({ max: 500 }),
  body('followUpId').optional({ nullable: true, checkFalsy: true }).isMongoId(),
  body('activityPerformed').optional().isBoolean(),
  body('meetingMode').optional().isIn(['teams', 'meet', 'phone', 'presential', 'other']),
  body('meetingUrl').optional({ nullable: true, checkFalsy: true }).isURL(),
  body('meetingLocation').optional().isString().trim().isLength({ max: 500 }),
  body('meetingDurationMinutes').optional().isInt({ min: 15, max: 480 })
];

const validateLotOperation = [
  body('lotId').isString().trim().notEmpty().isLength({ max: 120 }),
  body('counterpartyType').isIn(['client', 'provider']),
  body('counterpartyId').isString().trim().notEmpty().isLength({ max: 120 }),
  body('counterpartyName').optional().isString().trim().isLength({ max: 240 }),
  body('lotCreatedAt').optional().isISO8601()
];

const validateAdminUpdate = [
  objectIdParam(),
  body('name').optional().isString().trim().isLength({ max: 240 }),
  body('companyName').optional().isString().trim().isLength({ max: 240 }),
  body('businessUnit').optional().isIn(BUSINESS_UNITS),
  body('serviceLine').optional().isIn(SERVICE_LINES),
  body('accountTypeIntent').optional().isIn(['customer', 'supplier', 'buyer', 'unknown']),
  body('country').optional().isString().trim().isLength({ max: 120 }),
  body('city').optional().isString().trim().isLength({ max: 160 }),
  body('status').optional().isIn(LEAD_STATUSES),
  body('phone').optional().isString().trim().isLength({ max: 80 }),
  body('email').optional({ checkFalsy: true }).isEmail().normalizeEmail(),
  body('companyId').optional().isString().trim().isLength({ max: 160 }),
  body('companyType').optional().isIn(['client', 'provider', 'buyer', 'unknown']),
  body('nextFollowUpAt').optional({ nullable: true, checkFalsy: true }).isISO8601(),
  body('nextStep').optional().isString().trim().isLength({ max: 500 }),
  body('reason').isString().trim().isLength({ min: 5, max: 1000 })
];

const validateAdminDelete = [
  objectIdParam(),
  body('reason').isString().trim().isLength({ min: 5, max: 1000 })
];

const validateAdminEventUpdate = [
  objectIdParam(),
  param('eventId').isMongoId(),
  body('type').optional().isIn([
    'call', 'whatsapp', 'email', 'meeting_created', 'meeting_result',
    'visit_created', 'visit_result', 'pickup_created', 'pickup_result',
    'note', 'price_requested', 'price_informed', 'quote_requested',
    'status_change', 'assignment', 'skip', 'imported', 'external_link'
  ]),
  body('channel').optional().isIn(['phone', 'whatsapp', 'email', 'meeting', 'visit', 'pickup', 'system', 'manual']),
  body('outcome').optional().isString().trim().isLength({ max: 120 }),
  body('notes').optional().isString().trim().isLength({ max: 4000 }),
  body('occurredAt').optional().isISO8601(),
  body('reason').isString().trim().isLength({ min: 5, max: 1000 })
];

module.exports = {
  validateCreate,
  validateAssign,
  validateDiscard,
  validateAction,
  validateLotOperation,
  validateAdminUpdate,
  validateAdminDelete,
  validateAdminEventUpdate,
  validateId: [objectIdParam()]
};
