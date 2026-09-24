'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveLeadRecipient } = require('../src/modules/leads/leadPublic.mailer');

function withEmailEnvironment(values, callback) {
  const previousRoutes = process.env.LEADS_EMAIL_ROUTES;
  const previousDefault = process.env.LEADS_EMAIL_DEFAULT;

  try {
    process.env.LEADS_EMAIL_ROUTES = values.routes;
    process.env.LEADS_EMAIL_DEFAULT = values.defaultEmail;
    callback();
  } finally {
    if (previousRoutes === undefined) delete process.env.LEADS_EMAIL_ROUTES;
    else process.env.LEADS_EMAIL_ROUTES = previousRoutes;

    if (previousDefault === undefined) delete process.env.LEADS_EMAIL_DEFAULT;
    else process.env.LEADS_EMAIL_DEFAULT = previousDefault;
  }
}

test('normaliza una lista de destinatarios configurada por dominio', () => {
  withEmailEnvironment(
    {
      routes: JSON.stringify({
        'fastwaysas.com': [
          '[tech@fastwaysas.com](mailto:tech@fastwaysas.com)',
          'insales2@fastwaysas.com',
        ],
      }),
      defaultEmail: 'proyectos@fastwaysas.com',
    },
    () => {
      assert.equal(
        resolveLeadRecipient({ pageUrl: 'https://www.fastwaysas.com/contacto' }),
        'tech@fastwaysas.com, insales2@fastwaysas.com'
      );
    }
  );
});

test('normaliza varios destinatarios predeterminados', () => {
  withEmailEnvironment(
    {
      routes: '{}',
      defaultEmail: 'tech@fastwaysas.com; proyectos@fastwaysas.com',
    },
    () => {
      assert.equal(
        resolveLeadRecipient({ businessUnit: 'Fastway' }),
        'tech@fastwaysas.com, proyectos@fastwaysas.com'
      );
    }
  );
});
