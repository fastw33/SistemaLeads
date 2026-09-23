'use strict';

const service = require('./lead.service');
const buildCrudController = require('../shared/crud.controller');
const asyncHandler = require('../../utils/asyncHandler');

module.exports = {
  ...buildCrudController(service, 'lead'),

  ingestPublic: asyncHandler(async (req, res) => {
    const data = await service.ingestPublicLead(req);
    res.status(201).json(data);
  }),

  createManual: asyncHandler(async (req, res) => {
    const data = await service.createManualLead(req);
    res.status(201).json(data);
  }),

  contactIntelligence: asyncHandler(async (req, res) => {
    const data = await service.contactIntelligence(req.query, req);
    res.json(data);
  }),

  downloadAttachment: asyncHandler(async (req, res) => {
    const data = await service.downloadAttachment(req.params.attachmentId, req);

    res.setHeader('Content-Type', data.mimeType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(data.fileName)}"`
    );
    if (data.size) res.setHeader('Content-Length', String(data.size));

    data.stream.pipe(res);
  }),

  assign: asyncHandler(async (req, res) => {
    const data = await service.assignLead(req.params.id, req.body, req);
    res.json(data);
  }),

  discard: asyncHandler(async (req, res) => {
    const data = await service.discardLead(req.params.id, req.body, req);
    res.json(data);
  }),

  registerAction: asyncHandler(async (req, res) => {
    const data = await service.registerAction(req.params.id, req.body, req);
    res.status(201).json(data);
  }),

  registerLotOperation: asyncHandler(async (req, res) => {
    const data = await service.registerLotOperation(req.body, req);
    res.json(data);
  }),

  adminUpdate: asyncHandler(async (req, res) => {
    const data = await service.adminUpdateLead(req.params.id, req.body, req);
    res.json(data);
  }),

  adminDelete: asyncHandler(async (req, res) => {
    const data = await service.adminDeleteLead(req.params.id, req.body, req);
    res.json(data);
  }),

  adminEvents: asyncHandler(async (req, res) => {
    const data = await service.listAdminLeadEvents(req.params.id, req);
    res.json(data);
  }),

  adminUpdateEvent: asyncHandler(async (req, res) => {
    const data = await service.adminUpdateLeadEvent(
      req.params.id,
      req.params.eventId,
      req.body,
      req
    );
    res.json(data);
  })
};
