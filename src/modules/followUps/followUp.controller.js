'use strict';

const service = require('./followUp.service');
const buildCrudController = require('../shared/crud.controller');

module.exports = buildCrudController(service, 'followUp');
