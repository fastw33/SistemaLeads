'use strict';

const service = require('./lead.service');
const buildCrudController = require('../shared/crud.controller');
const asyncHandler = require('../../utils/asyncHandler');

module.exports = {
  ...buildCrudController(service, 'lead'),

  tracking: asyncHandler(async (req, res) => res.json(await service.tracking(req.query, req))),
  pendingReviews: asyncHandler(async (req, res) => res.json(await service.pendingReviews(req.query, req))),
  listReviews: asyncHandler(async (req, res) => res.json(await service.listReviews(req.params.id, req))),
  createReview: asyncHandler(async (req, res) => res.status(201).json(await service.createReview(req.params.id, req.body, req))),
  addReviewAttachments: asyncHandler(async (req, res) => res.status(201).json(await service.addReviewAttachments(req.params.id, req.params.reviewId, req))),
  closeBySupervision: asyncHandler(async (req, res) => res.json(await service.closeBySupervision(req.params.id, req.body, req))),
  resolveReview: asyncHandler(async (req, res) => res.json(await service.resolveReview(req.params.id, req.params.reviewId, req.body, req))),

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

  addEventAttachments: asyncHandler(async (req, res) => {
    const data = await service.addEventAttachments(req.params.id, req.params.eventId, req);
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
