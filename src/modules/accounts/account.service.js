'use strict';

const Account = require('./account.model');
const buildCrudService = require('../shared/crud.service');
const { cleanString } = require('../../utils/normalize');

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
  buildFilter(query) {
    const filter = {};
    if (query.businessUnit) filter.businessUnit = query.businessUnit;
    if (query.type) filter.type = query.type;
    if (query.country) filter.country = query.country;
    if (query.q) filter.name = { $regex: query.q, $options: 'i' };
    return filter;
  },
  beforeCreate: normalizeAccount,
  beforeUpdate: normalizeAccount
});
