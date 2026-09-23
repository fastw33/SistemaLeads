'use strict';

async function requestJson({ baseUrl, token, bearerToken, path, method = 'GET', body }) {
  if (!baseUrl) {
    const error = new Error('Base URL de integracion no configurada');
    error.statusCode = 503;
    throw error;
  }

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}),
      ...(!bearerToken && token ? { authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = new Error(data?.message || data?.detail || data?.error || `Integracion fallo con estado ${response.status}`);
    error.statusCode = response.status;
    error.response = data;
    throw error;
  }

  return data;
}

module.exports = { requestJson };
