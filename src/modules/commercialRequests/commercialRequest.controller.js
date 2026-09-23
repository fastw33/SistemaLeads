'use strict';

const service = require('./commercialRequest.service');
const buildCrudController = require('../shared/crud.controller');

module.exports = buildCrudController(service, 'commercialRequest');
