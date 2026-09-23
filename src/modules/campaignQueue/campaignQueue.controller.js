'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const service = require('./campaignQueue.service');

exports.next = asyncHandler(async (req, res) => {
  const data = await service.nextForAdvisor(req, req.query);
  res.json(data);
});

exports.current = asyncHandler(async (req, res) => {
  res.json(await service.currentForAdvisor(req));
});

exports.enrich = asyncHandler(async (req, res) => {
  res.json(await service.enrich(req.params.id, req.body, req));
});

exports.finishEnrichment = asyncHandler(async (req, res) => {
  res.json(await service.finishEnrichment(req.params.id, req.body, req));
});

exports.resolveFollowUp = asyncHandler(async (req, res) => {
  res.json(await service.resolveFollowUp(req.params.id, req.body, req));
});

exports.complete = asyncHandler(async (req, res) => {
  const data = await service.complete(req.params.id, req.body, req);
  res.json(data);
});
