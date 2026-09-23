'use strict';

const service = require('./priceSnapshot.service');
const buildCrudController = require('../shared/crud.controller');

module.exports = buildCrudController(service, 'priceSnapshot');
