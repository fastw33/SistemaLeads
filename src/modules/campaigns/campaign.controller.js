'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const service = require('./campaign.service');
const buildCrudController = require('../shared/crud.controller');

const base = buildCrudController(service, 'campaign');

base.importJson = asyncHandler(async (req, res) => {
  const rows = Array.isArray(req.body.records) ? req.body.records : [];
  const data = await service.importRows(req.params.id, rows, req, 'json-payload');
  res.status(201).json(data);
});

base.importExcel = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: true, message: 'Archivo requerido' });
  }
  const rows = await service.parseWorkbook(req.file.buffer);
  const data = await service.importRows(req.params.id, rows, req, req.file.originalname);
  return res.status(201).json(data);
});

base.previewImport = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: true, message: 'Archivo requerido' });
  }
  const parsed = await service.parseContactFile(req.file, req.body.sheetName);
  const requestedMapping = service.parseMapping(req.body.mapping);
  const suggestedMapping = service.suggestMapping(parsed.headers);
  const effectiveMapping = Object.keys(requestedMapping).length
    ? requestedMapping
    : suggestedMapping;
  const data = await service.previewRows(req.params.id, parsed.rows, effectiveMapping);
  return res.json({
    fileName: req.file.originalname,
    headers: parsed.headers,
    totalRows: parsed.rows.length,
    sheets: parsed.sheets,
    sheetName: parsed.sheetName,
    suggestedMapping,
    ...data
  });
});

base.importFile = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: true, message: 'Archivo requerido' });
  }
  const parsed = await service.parseContactFile(req.file, req.body.sheetName);
  const mapping = service.parseMapping(req.body.mapping);
  const fieldConfiguration = service.parseMapping(req.body.fieldConfiguration);
  const data = await service.importRows(
    req.params.id,
    parsed.rows,
    req,
    req.file.originalname,
    mapping,
    { sheetName: parsed.sheetName, fieldConfiguration }
  );
  return res.status(201).json(data);
});

base.start = asyncHandler(async (req, res) => {
  res.json(await service.startCampaign(req.params.id, req));
});

base.pause = asyncHandler(async (req, res) => {
  res.json(await service.pauseCampaign(req.params.id, req.body.pausedUntil, req));
});

base.stop = asyncHandler(async (req, res) => {
  res.json(await service.stopCampaign(req.params.id, req));
});

base.contacts = asyncHandler(async (req, res) => {
  res.json(await service.listContacts(req.params.id, req.query));
});

base.operatorPerformance = asyncHandler(async (req, res) => {
  res.json(await service.operatorPerformance(req.query));
});

base.adminContacts = asyncHandler(async (req, res) => {
  res.json(await service.adminContacts(req.query));
});

base.assignContact = asyncHandler(async (req, res) => {
  res.json(await service.assignContact(req.params.id, req.params.recordId, req.body, req));
});

base.deleteContact = asyncHandler(async (req, res) => {
  res.json(await service.deleteContact(req.params.id, req.params.recordId, req.body.reason, req));
});

base.reopenContact = asyncHandler(async (req, res) => {
  res.json(await service.reopenContact(req.params.id, req.params.recordId, req));
});

base.discardContact = asyncHandler(async (req, res) => {
  res.json(await service.discardContact(req.params.id, req.params.recordId, req.body.reason, req));
});

module.exports = base;
