'use strict';

const { requestJson } = require('../httpClient');

const baseUrl = process.env.WMS_API_URL;
const token = process.env.WMS_API_TOKEN;

function searchClients(query, bearerToken) {
  return requestJson({ baseUrl, token, bearerToken, path: `/api/cliente?search=${encodeURIComponent(query || '')}` });
}

function searchProviders(query, bearerToken) {
  return requestJson({ baseUrl, token, bearerToken, path: `/api/proveedor?search=${encodeURIComponent(query || '')}` });
}

module.exports = { searchClients, searchProviders };
