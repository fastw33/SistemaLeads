'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const auditService = require('../audit/audit.service');
const service = require('./pricingSetting.service');

exports.getHarvest = asyncHandler(async (_req, res) => {
  res.json(await service.getHarvestSetting());
});

exports.updateHarvest = asyncHandler(async (req, res) => {
  const before = await service.getHarvestSetting();
  const after = await service.updateHarvestSetting(req.body, req);
  await auditService.record(req, {
    action: 'pricing_setting.harvest_update',
    entityType: 'pricing_setting',
    entityId: after.key,
    before,
    after,
    metadata: { reason: req.body.reason }
  });
  res.json(after);
});
