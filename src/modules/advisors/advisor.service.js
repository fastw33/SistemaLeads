'use strict';

const AdvisorProfile = require('./advisorProfile.model');
const buildCrudService = require('../shared/crud.service');

module.exports = buildCrudService(AdvisorProfile, {
  buildFilter(query) {
    const filter = {};
    if (query.active !== undefined) filter.active = query.active === 'true';
    if (query.businessUnit) filter.businessUnits = query.businessUnit;
    if (query.serviceLine) filter.serviceLines = query.serviceLine;
    return filter;
  }
});
