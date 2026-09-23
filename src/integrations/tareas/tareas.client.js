'use strict';

const { requestJson } = require('../httpClient');

const baseUrl = process.env.TAREAS_API_URL;
const token = process.env.TAREAS_API_TOKEN;

function pathWithPrefix(path) {
  const cleanBase = String(path || '').startsWith('/') ? path : `/${path}`;
  return `/tikets${cleanBase}`;
}

function createSystemNotification(payload, bearerToken) {
  return requestJson({
    baseUrl,
    token,
    bearerToken,
    path: pathWithPrefix('/notifications/system'),
    method: 'POST',
    body: payload
  });
}

function createTicket(payload, bearerToken) {
  return requestJson({
    baseUrl,
    token,
    bearerToken,
    path: pathWithPrefix('/tickets'),
    method: 'POST',
    body: payload
  });
}

module.exports = { createSystemNotification, createTicket };
