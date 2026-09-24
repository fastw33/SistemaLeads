'use strict';

const IntegrationLog = require('./integrationLog.model');
const wmsClient = require('../../integrations/wms/wms.client');
const priceClient = require('../../integrations/prices/prices.client');
const tareasClient = require('../../integrations/tareas/tareas.client');
const logisticaClient = require('../../integrations/logistica/logistica.client');
const pricingSettingService = require('../pricingSettings/pricingSetting.service');
const { httpError } = require('../shared/errors');

async function tracked(system, operation, relatedEntity, fn) {
  try {
    const response = await fn();
    await IntegrationLog.create({ system, operation, relatedEntity, status: 'success', response });
    return response;
  } catch (error) {
    await IntegrationLog.create({
      system,
      operation,
      relatedEntity,
      status: 'failed',
      statusCode: error.statusCode,
      errorMessage: error.message,
      response: error.response
    });
    throw error;
  }
}

function searchWmsClients(q, req) {
  return tracked('wms', 'search_clients', null, () =>
    wmsClient.searchClients(q, req.user?.token));
}

function searchWmsProviders(q, req) {
  return tracked('wms', 'search_providers', null, () =>
    wmsClient.searchProviders(q, req.user?.token));
}

async function latestLocalPrices(req) {
  const personalId = String(req.user?.idPersonal || req.user?.id || '').trim();
  if (!personalId) throw httpError(400, 'No fue posible identificar el id_personal de la sesion');

  const query = new URLSearchParams({ id_personal: personalId }).toString();
  const rows = await tracked('precios_locales', 'latest_prices', null, () =>
    priceClient.latestLocalPrices(query, req.user?.token)
  );
  return pricingSettingService.applyHarvestDiscount(rows);
}

function createTareasNotification(payload, req) {
  return tracked('tareas', 'create_system_notification', null, () =>
    tareasClient.createSystemNotification(payload, req.user && req.user.token));
}

function createTareasTicket(payload, req) {
  return tracked('tareas', 'create_ticket', null, () =>
    tareasClient.createTicket(payload, req.user && req.user.token));
}

function createLogisticaQuotation(payload, req) {
  return tracked('logistica', 'create_quotation', null, () =>
    logisticaClient.createQuotation(payload, req.user && req.user.token));
}

module.exports = {
  searchWmsClients,
  searchWmsProviders,
  latestLocalPrices,
  createTareasNotification,
  createTareasTicket,
  createLogisticaQuotation
};
