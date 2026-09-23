'use strict';

const service = require('./meeting.service');
const buildCrudController = require('../shared/crud.controller');

module.exports = buildCrudController(service, 'meeting');
