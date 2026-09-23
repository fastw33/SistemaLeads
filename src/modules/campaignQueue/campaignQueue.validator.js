'use strict';

const { body, query } = require('express-validator');
const { objectIdParam } = require('../shared/validators');

const validateNext = [
  query('campaignId').optional().isMongoId().withMessage('campaignId invalido')
];

const validateComplete = [
  objectIdParam(),
  body('outcome').isString().notEmpty(),
  body('channel').optional().isIn(['phone', 'whatsapp', 'email', 'meeting', 'task'])
];

const validateEnrich = [
  objectIdParam(),
  body('fields').optional().isObject(),
  body('note').optional().isString().trim().isLength({ max: 1000 })
];

const validateFinishEnrichment = [
  objectIdParam(),
  body('result').isIn(['ready', 'no_answer', 'follow_up', 'not_interested', 'no_contact', 'manual_review']),
  body('channel').isIn(['phone', 'whatsapp', 'email', 'web', 'research']),
  body('note').isString().trim().notEmpty().isLength({ max: 1000 }),
  body('nextAttemptAt').optional({ nullable: true, checkFalsy: true }).isISO8601()
];

const validateResolveFollowUp = [
  objectIdParam(),
  body('performed').isBoolean(),
  body('note').isString().trim().notEmpty().isLength({ max: 1000 }),
  body('channel').optional().isIn(['phone', 'whatsapp', 'email', 'task'])
];

module.exports = { validateNext, validateComplete, validateEnrich, validateFinishEnrichment, validateResolveFollowUp };
