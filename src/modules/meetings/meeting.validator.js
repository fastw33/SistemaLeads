'use strict';

const { body } = require('express-validator');
const { objectIdParam } = require('../shared/validators');

const validateCreate = [
  body('leadId').isMongoId(),
  body('title').isString().notEmpty(),
  body('startsAt').isISO8601(),
  body('endsAt').optional({ nullable: true, checkFalsy: true }).isISO8601(),
  body('channel').optional().isIn(['teams', 'meet', 'phone', 'presential', 'other']),
  body('meetingUrl').optional({ nullable: true, checkFalsy: true }).isURL(),
  body('location').optional().isString().trim().isLength({ max: 500 }),
  body('attendees').optional().isArray({ max: 20 })
];

module.exports = { validateCreate, validateId: [objectIdParam()] };
