'use strict';

const service = require('./catalog.service');
const buildCrudController = require('../shared/crud.controller');

module.exports = buildCrudController(service, 'catalog');
