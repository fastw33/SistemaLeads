'use strict';

const service = require('./opportunity.service');
const buildCrudController = require('../shared/crud.controller');

module.exports = buildCrudController(service, 'opportunity');
