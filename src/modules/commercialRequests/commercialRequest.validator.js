'use strict';

const { body } = require('express-validator');
const { objectIdParam } = require('../shared/validators');

const validateCreate = [
  body('leadId').isMongoId(),
  body('type').isIn(['general_query', 'price_inquiry', 'logistics_quote', 'supplier_classification', 'buyer_interest', 'meeting_request'])
];

module.exports = { validateCreate, validateId: [objectIdParam()] };
