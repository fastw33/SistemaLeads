'use strict';

const AdvisorProfile = require('./advisorProfile.model');
const buildCrudService = require('../shared/crud.service');
const {
  allowedBusinessUnits,
  assertBusinessUnitAccess
} = require('../shared/leadLineAccess');

function assertAdvisorBusinessUnits(user, businessUnits = []) {
  businessUnits.forEach((businessUnit) => assertBusinessUnitAccess(user, businessUnit));
}

module.exports = buildCrudService(AdvisorProfile, {
  buildFilter(query, { req }) {
    const filter = { businessUnits: { $in: allowedBusinessUnits(req.user) } };
    if (query.active !== undefined) filter.active = query.active === 'true';
    if (query.businessUnit) {
      assertBusinessUnitAccess(req.user, query.businessUnit);
      filter.businessUnits = query.businessUnit;
    }
    if (query.serviceLine) filter.serviceLines = query.serviceLine;
    return filter;
  },
  beforeCreate(payload, { req }) {
    assertAdvisorBusinessUnits(req.user, payload.businessUnits);
    return payload;
  },
  beforeUpdate(payload, current, { req }) {
    assertAdvisorBusinessUnits(req.user, current.businessUnits);
    assertAdvisorBusinessUnits(req.user, payload.businessUnits || current.businessUnits);
    return payload;
  },
  canRead(item, { req }) {
    const allowed = new Set(allowedBusinessUnits(req.user));
    return (item.businessUnits || []).every((unit) => allowed.has(unit));
  },
  canWrite(item, { req }) {
    const allowed = new Set(allowedBusinessUnits(req.user));
    return (item.businessUnits || []).every((unit) => allowed.has(unit));
  }
});
