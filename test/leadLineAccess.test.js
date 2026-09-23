'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BUSINESS_UNITS,
  allowedBusinessUnits,
  hasBusinessUnitAccess,
  assertBusinessUnitAccess,
  applyBusinessUnitFilter
} = require('../src/modules/shared/leadLineAccess');

test('an explicit admin can access every lead line', () => {
  assert.deepEqual(allowedBusinessUnits({ permisos: { esAdmin: true } }), BUSINESS_UNITS);
});

test('a non-admin only receives explicitly assigned lead lines', () => {
  const user = { permisos: { leadsFastway: true, leadsGreenway: true } };

  assert.deepEqual(allowedBusinessUnits(user), ['Fastway', 'Greenway']);
  assert.equal(hasBusinessUnitAccess(user, 'Fastway'), true);
  assert.equal(hasBusinessUnitAccess(user, 'Harvest'), false);
});

test('legacy administrative roles do not bypass line permissions', () => {
  const user = {
    roles: ['admin', 'leads_admin'],
    permisos: { perfilAdmin: true }
  };

  assert.deepEqual(allowedBusinessUnits(user), []);
  assert.throws(
    () => assertBusinessUnitAccess(user, 'Harvest'),
    (error) => error.statusCode === 403
  );
});

test('filters use the allowed lines when no line is requested', () => {
  const filter = { status: 'new' };

  assert.deepEqual(
    applyBusinessUnitFilter(filter, { permisos: { leadsHarvest: true } }),
    { status: 'new', businessUnit: { $in: ['Harvest'] } }
  );
});

test('requesting an unauthorized line is rejected', () => {
  assert.throws(
    () => applyBusinessUnitFilter({}, { permisos: { leadsFastway: true } }, 'Greenway'),
    (error) => error.statusCode === 403
  );
});
