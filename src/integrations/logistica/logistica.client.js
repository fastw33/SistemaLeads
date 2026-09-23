'use strict';

const { requestJson } = require('../httpClient');

const baseUrl = process.env.LOGISTICA_API_URL;
const token = process.env.LOGISTICA_API_TOKEN;

function createQuotation(payload, bearerToken) {
  return requestJson({ baseUrl, token, bearerToken, path: '/api/quotations', method: 'POST', body: payload });
}

module.exports = { createQuotation };
