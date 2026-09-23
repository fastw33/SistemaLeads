'use strict';

const service = require('./contactPolicy.service');
const buildCrudController = require('../shared/crud.controller');

module.exports = buildCrudController(service, 'contactPolicy');
