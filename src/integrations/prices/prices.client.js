'use strict';

const { requestJson } = require('../httpClient');

function latestLocalPrices(query = '', bearerToken = '') {
  return requestJson({
    baseUrl: process.env.PRECIOS_LOCALES_API_URL,
    path: `/api/prices/latest${query ? `?${query}` : ''}`,
    bearerToken
  });
}

function lmePrices(query = '') {
  return requestJson({
    baseUrl: process.env.LME_API_URL,
    path: query ? `/?${query}` : '/'
  });
}

function tungstenoPrices(query = '') {
  return requestJson({
    baseUrl: process.env.TUNGSTENO_API_URL,
    path: query ? `/?${query}` : '/'
  });
}

module.exports = { latestLocalPrices, lmePrices, tungstenoPrices };
