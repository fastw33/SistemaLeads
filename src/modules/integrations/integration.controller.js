'use strict';

const asyncHandler = require('../../utils/asyncHandler');
const service = require('./integration.service');

exports.searchWmsClients = asyncHandler(async (req, res) => {
  res.json(await service.searchWmsClients(req.query.q || ''));
});

exports.searchWmsProviders = asyncHandler(async (req, res) => {
  res.json(await service.searchWmsProviders(req.query.q || ''));
});

exports.latestLocalPrices = asyncHandler(async (req, res) => {
  res.json(await service.latestLocalPrices(req));
});

exports.createTareasNotification = asyncHandler(async (req, res) => {
  res.status(201).json(await service.createTareasNotification(req.body, req));
});

exports.createTareasTicket = asyncHandler(async (req, res) => {
  res.status(201).json(await service.createTareasTicket(req.body, req));
});

exports.createLogisticaQuotation = asyncHandler(async (req, res) => {
  res.status(201).json(await service.createLogisticaQuotation(req.body, req));
});
