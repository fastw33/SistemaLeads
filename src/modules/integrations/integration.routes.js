'use strict';

const express = require('express');
const controller = require('./integration.controller');
const validator = require('./integration.validator');
const validate = require('../../middlewares/validate');
const { requirePermission } = require('../../middlewares/authorization.middleware');

const router = express.Router();

router.get('/wms/clients', validator.validateWmsSearch, validate, controller.searchWmsClients);
router.get('/wms/providers', validator.validateWmsSearch, validate, controller.searchWmsProviders);
router.get(
  '/prices/local/latest',
  requirePermission('leadsConfiguracionPrecios'),
  requirePermission('leadsHarvest'),
  controller.latestLocalPrices
);
router.post('/tareas/notifications/system', validator.validateTareasNotification, validate, controller.createTareasNotification);
router.post('/tareas/tickets', validator.validateTareasTicket, validate, controller.createTareasTicket);
router.post('/logistica/quotations', validator.validateLogisticaQuotation, validate, controller.createLogisticaQuotation);

module.exports = router;
