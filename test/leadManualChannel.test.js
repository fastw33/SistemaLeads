'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeLeadEventChannel } = require('../src/modules/leads/lead.service');

test('normaliza canal presencial de lead manual a un enum valido de LeadEvent', () => {
  assert.equal(normalizeLeadEventChannel('presencial'), 'meeting');
  assert.equal(normalizeLeadEventChannel('Presencial'), 'meeting');
});

test('conserva canales validos y envia valores libres a manual', () => {
  assert.equal(normalizeLeadEventChannel('whatsapp'), 'whatsapp');
  assert.equal(normalizeLeadEventChannel('feria comercial'), 'manual');
  assert.equal(normalizeLeadEventChannel(''), 'manual');
});
