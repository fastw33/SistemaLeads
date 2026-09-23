'use strict';

const Catalog = require('./catalog.model');
const buildCrudService = require('../shared/crud.service');
const { httpError } = require('../shared/errors');
const {
  allowedBusinessUnits,
  assertBusinessUnitAccess,
  hasBusinessUnitAccess
} = require('../shared/leadLineAccess');

function assertGlobalWriteAccess(user) {
  if (user?.permisos?.esAdmin !== true) {
    throw httpError(403, 'Solo Es admin puede modificar catalogos globales');
  }
}

module.exports = buildCrudService(Catalog, {
  buildFilter(query, { req }) {
    const filter = {};
    if (query.type) filter.type = query.type;
    if (query.businessUnit) {
      assertBusinessUnitAccess(req.user, query.businessUnit);
      filter.businessUnit = query.businessUnit;
    } else {
      filter.$or = [
        { businessUnit: { $in: allowedBusinessUnits(req.user) } },
        { businessUnit: { $exists: false } },
        { businessUnit: null }
      ];
    }
    if (query.active !== undefined) filter.active = query.active === 'true';
    return filter;
  },
  beforeCreate(payload, { req }) {
    if (payload.businessUnit) {
      assertBusinessUnitAccess(req.user, payload.businessUnit);
    } else {
      assertGlobalWriteAccess(req.user);
    }
    return {
      ...payload,
      code: String(payload.code || '').trim().toLowerCase()
    };
  },
  beforeUpdate(payload, current, { req }) {
    if (current.businessUnit) {
      assertBusinessUnitAccess(req.user, current.businessUnit);
    } else {
      assertGlobalWriteAccess(req.user);
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'businessUnit')) {
      if (payload.businessUnit) {
        assertBusinessUnitAccess(req.user, payload.businessUnit);
      } else {
        assertGlobalWriteAccess(req.user);
      }
    }
    return {
      ...payload,
      code: payload.code === undefined
        ? current.code
        : String(payload.code || '').trim().toLowerCase()
    };
  },
  canRead(item, { req }) {
    return !item.businessUnit || hasBusinessUnitAccess(req.user, item.businessUnit);
  },
  canWrite(item, { req }) {
    return item.businessUnit
      ? hasBusinessUnitAccess(req.user, item.businessUnit)
      : req.user?.permisos?.esAdmin === true;
  }
});
