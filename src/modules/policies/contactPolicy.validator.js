'use strict';

const { body } = require('express-validator');
const { objectIdParam } = require('../shared/validators');

const validateCreate = [
  body('leadId').isMongoId(),
  body('type').isIn(['do_not_contact', 'restricted', 'consent_required']),
  body('channel').optional().isIn(['phone', 'whatsapp', 'email', 'all']),
  body('reason').optional().isString().isLength({ max: 500 })
];

module.exports = { validateCreate, validateId: [objectIdParam()] };
