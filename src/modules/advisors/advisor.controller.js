'use strict';

const service = require('./advisor.service');
const buildCrudController = require('../shared/crud.controller');

module.exports = buildCrudController(service, 'advisorProfile');
