'use strict';

function cleanString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeEmail(value) {
  const email = cleanString(value).toLowerCase();
  return email.includes('@') ? email : '';
}

function normalizePhone(value) {
  const raw = cleanString(value);
  const plus = raw.startsWith('+') ? '+' : '';
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return '';
  return `${plus}${digits}`;
}

function normalizeCountry(value) {
  return cleanString(value).toLowerCase();
}

function inferBusinessUnit({ country, requestedUnit, serviceLine }) {
  const unit = cleanString(requestedUnit);
  if (unit) return unit;
  const countryNorm = normalizeCountry(country);
  if (serviceLine === 'logistica') return 'Fastway';
  if (countryNorm === 'colombia' || countryNorm === 'co') return 'Harvest';
  return 'Greenway';
}

function inferDetectedFields(rawData = {}) {
  const entries = Object.entries(rawData);
  const pick = (patterns) => {
    const found = entries.find(([key]) => patterns.some((p) => p.test(String(key))));
    return found ? found[1] : '';
  };

  return {
    name: cleanString(pick([/nombre/i, /contact/i, /name/i])),
    companyName: cleanString(pick([/empresa/i, /compa/i, /company/i, /razon/i])),
    email: normalizeEmail(pick([/correo/i, /email/i, /mail/i])),
    phone: normalizePhone(pick([/telefono/i, /tel/i, /cel/i, /phone/i, /whats/i, /movil/i])),
    country: cleanString(pick([/pais/i, /country/i, /mercado/i]))
  };
}

module.exports = {
  cleanString,
  normalizeEmail,
  normalizePhone,
  normalizeCountry,
  inferBusinessUnit,
  inferDetectedFields
};
