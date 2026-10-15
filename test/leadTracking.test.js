'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { dateBounds, pagination, trackingPipeline } = require('../src/modules/leads/leadTracking');

test('date range includes the entire final Colombia day regardless of host timezone', () => {
  const range = dateBounds('2026-10-15', '2026-10-15');
  assert.equal(range.$gte.toISOString(), '2026-10-15T05:00:00.000Z');
  assert.equal(range.$lt.toISOString(), '2026-10-16T05:00:00.000Z');
  assert.deepEqual(dateBounds(), {});
  assert.throws(() => dateBounds('2026-02-30'), /inválida/);
  assert.throws(() => dateBounds('2026-10-16', '2026-10-15'), /posterior/);
  assert.throws(() => dateBounds('15-10-2026'), /formato/);
});

test('pagination caps page size without silently skipping additional pages', () => {
  assert.deepEqual(pagination({ page: 2, limit: 200 }), { page: 2, limit: 100 });
  assert.deepEqual(pagination({ page: 'bad', limit: -10 }), { page: 1, limit: 25 });
  assert.deepEqual(pagination({ page: .5, limit: .5 }), { page: 1, limit: 25 });
  const pipeline = trackingPipeline({ businessUnit: 'Harvest' }, { page: 2, limit: 25, from: '2026-10-15', dateField: 'managed', assignedAdvisorId: 'advisor-2' });
  assert.deepEqual(pipeline[0], { $match: { businessUnit: 'Harvest' } });
  const facet = pipeline.at(-1).$facet;
  assert.equal(facet.items.find(stage => '$skip' in stage).$skip, 25);
  assert.equal(facet.items[0].$match.assignedAdvisorId, 'advisor-2');
  assert.deepEqual(facet.total[0].$match, facet.items[0].$match);
  assert.ok(pipeline.find(stage => stage.$match?.['tracking.lastManagedAt']));
});
