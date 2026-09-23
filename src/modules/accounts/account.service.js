'use strict';

const Account = require('./account.model');
const buildCrudService = require('../shared/crud.service');
const { cleanString } = require('../../utils/normalize');
const {
  applyBusinessUnitFilter,
  assertBusinessUnitAccess,
  hasBusinessUnitAccess
} = require('../shared/leadLineAccess');

function normalizeAccount(payload, current) {
  const name = cleanString(payload.name || current?.name);
  const businessUnit = payload.businessUnit;
  const type = payload.type;
  const data = {
    ...payload,
    name,
    normalizedName: name.toLowerCase()
  };

  if (businessUnit === 'Fastway' && type === 'supplier' && data.fixedProvider === undefined) {
    data.fixedProvider = true;
  }

  if (['Harvest', 'Greenway'].includes(businessUnit) && type === 'supplier' && !data.supplierClassification) {
    data.supplierClassification = { code: 'unclassified', label: 'Sin clasificar' };
  }

  return data;
}

module.exports = buildCrudService(Account, {
  buildFilter(query, { req }) {
    const filter = {};
    applyBusinessUnitFilter(filter, req.user, query.businessUnit);
    if (query.type) filter.type = query.type;
    if (query.country) filter.country = query.country;
    if (query.q) filter.name = { $regex: query.q, $options: 'i' };
    return filter;
  },
  beforeCreate(payload, { req }) {
    assertBusinessUnitAccess(req.user, payload.businessUnit);
    return normalizeAccount(payload);
  },
  beforeUpdate(payload, current, { req }) {
    assertBusinessUnitAccess(req.user, current.businessUnit);
    assertBusinessUnitAccess(req.user, payload.businessUnit || current.businessUnit);
    return normalizeAccount(payload, current);
  },
  canRead(item, { req }) {
    return hasBusinessUnitAccess(req.user, item.businessUnit);
  },
  canWrite(item, { req }) {
    return hasBusinessUnitAccess(req.user, item.businessUnit);
  }
});
