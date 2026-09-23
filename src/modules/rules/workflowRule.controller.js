'use strict';

const service = require('./workflowRule.service');
const buildCrudController = require('../shared/crud.controller');

module.exports = buildCrudController(service, 'workflowRule');
