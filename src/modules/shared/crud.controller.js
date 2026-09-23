'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const auditService = require('../audit/audit.service');

function buildCrudController(service, entityType) {
  return {
    list: asyncHandler(async (req, res) => {
      const data = await service.list(req.query, { req });
      res.json(data);
    }),

    getById: asyncHandler(async (req, res) => {
      const data = await service.getById(req.params.id, { req });
      res.json(data);
    }),

    create: asyncHandler(async (req, res) => {
      const data = await service.create(req.body, { req });
      await auditService.record(req, {
        action: `${entityType}.create`,
        entityType,
        entityId: data._id,
        after: data
      });
      res.status(201).json(data);
    }),

    update: asyncHandler(async (req, res) => {
      const data = await service.update(req.params.id, req.body, { req });
      await auditService.record(req, {
        action: `${entityType}.update`,
        entityType,
        entityId: data._id,
        after: data
      });
      res.json(data);
    })
  };
}

module.exports = buildCrudController;
