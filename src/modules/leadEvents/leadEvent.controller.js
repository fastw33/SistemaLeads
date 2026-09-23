'use strict';

const service = require('./leadEvent.service');
const buildCrudController = require('../shared/crud.controller');

module.exports = buildCrudController(service, 'leadEvent');
