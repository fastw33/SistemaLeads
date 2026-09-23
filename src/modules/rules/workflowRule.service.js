'use strict';

const WorkflowRule = require('./workflowRule.model');
const buildCrudService = require('../shared/crud.service');

module.exports = buildCrudService(WorkflowRule, {
  buildFilter(query) {
    const filter = {};
    if (query.type) filter.type = query.type;
    if (query.businessUnit) filter.businessUnit = query.businessUnit;
    if (query.serviceLine) filter.serviceLine = query.serviceLine;
    if (query.active !== undefined) filter.active = query.active === 'true';
    return filter;
  }
});
