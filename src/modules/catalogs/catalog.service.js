'use strict';

const Catalog = require('./catalog.model');
const buildCrudService = require('../shared/crud.service');

module.exports = buildCrudService(Catalog, {
  buildFilter(query) {
    const filter = {};
    if (query.type) filter.type = query.type;
    if (query.businessUnit) filter.businessUnit = query.businessUnit;
    if (query.active !== undefined) filter.active = query.active === 'true';
    return filter;
  },
  beforeCreate(payload) {
    return {
      ...payload,
      code: String(payload.code || '').trim().toLowerCase()
    };
  }
});
