'use strict';
const { httpError } = require('./errors');

function assertFutureDate(value, now = Date.now()) {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime()) || date.getTime() <= Number(now)) {
    throw httpError(400, 'Selecciona una fecha y hora futuras. No se permiten fechas ni horas pasadas.');
  }
  return date;
}

function validateFutureDate(value) {
  assertFutureDate(value);
  return true;
}

module.exports = { assertFutureDate, validateFutureDate };
