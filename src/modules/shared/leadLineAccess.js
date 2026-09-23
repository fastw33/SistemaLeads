'use strict';

const { httpError } = require('./errors');

const BUSINESS_UNITS = ['Fastway', 'Harvest', 'Greenway'];
const PERMISSION_BY_UNIT = {
  Fastway: 'leadsFastway',
  Harvest: 'leadsHarvest',
  Greenway: 'leadsGreenway'
};

function allowedBusinessUnits(user = {}) {
  const permissions = user.permisos || {};
  if (permissions.esAdmin === true) return [...BUSINESS_UNITS];
  return BUSINESS_UNITS.filter((unit) => permissions[PERMISSION_BY_UNIT[unit]] === true);
}

function hasBusinessUnitAccess(user, businessUnit) {
  return allowedBusinessUnits(user).includes(String(businessUnit || '').trim());
}

function assertBusinessUnitAccess(user, businessUnit) {
  if (!hasBusinessUnitAccess(user, businessUnit)) {
    throw httpError(403, 'No autorizado para acceder a esta linea comercial');
  }
}

function applyBusinessUnitFilter(filter, user, requestedUnit) {
  const allowed = allowedBusinessUnits(user);
  const requested = String(requestedUnit || '').trim();

  if (requested) {
    assertBusinessUnitAccess(user, requested);
    filter.businessUnit = requested;
    return filter;
  }

  filter.businessUnit = { $in: allowed };
  return filter;
}

module.exports = {
  BUSINESS_UNITS,
  allowedBusinessUnits,
  hasBusinessUnitAccess,
  assertBusinessUnitAccess,
  applyBusinessUnitFilter
};
