'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createHash, createHmac } = require('node:crypto');
const sharp = require('sharp');
const express = require('express');
const multer = require('multer');
const storage = require('../src/modules/leads/leadPublic.storage');

const secret = 'local-test-secret';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();

// Verify the signature against the actual HTTP header bytes, as an S3 server does.
// Node exposes received headers as Latin-1 strings, whereas the SDK signs UTF-8.
function hasValidSignature(req) {
  const match = req.headers.authorization?.match(/Credential=([^,]+), SignedHeaders=([^,]+), Signature=([a-f0-9]+)/);
  if (!match) return false;
  const [, credential, signedHeaders, signature] = match;
  const [, date, region, service, terminator] = credential.split('/');
  const scope = [date, region, service, terminator].join('/');
  const url = new URL(req.url, 'http://localhost');
  const query = [...url.searchParams].sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
  const headers = signedHeaders.split(';').map(name =>
    Buffer.from(`${name}:${req.headers[name].trim().replace(/\s+/g, ' ')}\n`, 'latin1'));
  const canonical = Buffer.concat([
    Buffer.from(`${req.method}\n${url.pathname}\n${query}\n`),
    ...headers,
    Buffer.from(`\n${signedHeaders}\n${req.headers['x-amz-content-sha256']}`)
  ]);
  const stringToSign = `AWS4-HMAC-SHA256\n${req.headers['x-amz-date']}\n${scope}\n${sha256(canonical)}`;
  const signingKey = [date, region, service, terminator].reduce(hmac, Buffer.from(`AWS4${secret}`));
  return hmac(signingKey, stringToSign).toString('hex') === signature;
}

test('S3 upload signatures survive accented and Unicode attachment names over HTTP', async t => {
  const savedEnv = { ...process.env };
  const received = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const valid = hasValidSignature(req);
    received.push({ headers: req.headers, body: Buffer.concat(chunks), valid });
    res.setHeader('Content-Type', 'application/xml');
    if (!valid) {
      res.writeHead(403);
      res.end('<Error><Code>SignatureDoesNotMatch</Code><Message>The request signature we calculated does not match the signature you provided.</Message></Error>');
      return;
    }
    res.writeHead(200, { ETag: '"local-test-etag"' });
    res.end();
  });
  server.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  Object.assign(process.env, {
    AWS_REGION: 'us-east-1', AWS_ACCESS_KEY_ID: 'local-test-key', AWS_SECRET_ACCESS_KEY: secret,
    S3_BUCKET: 'test-leads', S3_ENDPOINT: `http://127.0.0.1:${server.address().port}`,
    S3_FORCE_PATH_STYLE: 'true', S3_PREFIX: 'commercial-leads'
  });
  delete process.env.AWS_SESSION_TOKEN;
  t.after(async () => {
    storage.getS3Client().destroy();
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const png = await sharp({ create: { width: 20, height: 30, channels: 3, background: 'white' } }).png().toBuffer();

  for (const name of ['resumen.png', 'Resumen de reunión_ alianza industrial.png', 'reunión–compañía📎.png']) {
    await t.test(name, async () => {
      const [file] = await storage.uploadLeadFiles({
        leadId: '507f1f77bcf86cd799439011', code: 'LH-43',
        files: [{ originalname: name, mimetype: 'image/png', size: png.length, buffer: png, fieldname: 'files' }]
      });
      assert.equal(file.fileName, name);
      assert.equal(file.metadata.originalFileName, name);
      assert.equal(file.mimeType, 'image/webp');
      assert.equal((await sharp(received.at(-1).body).metadata()).format, 'webp');
      assert.equal(received.at(-1).valid, true);
      assert.match(received.at(-1).headers['x-amz-meta-originalname'], /^[\x20-\x7e]+$/);
    });
  }

  await t.test('PDF with the reported filename keeps its original name and a valid signature', async () => {
    const name = 'Reunión 13 de noviembre con todo en uno Chile.pdf';
    const buffer = Buffer.from('%PDF-1.4\nDocumento de prueba');
    const [file] = await storage.uploadLeadFiles({
      leadId: '507f1f77bcf86cd799439011', code: 'LG-35',
      files: [{ originalname: name, mimetype: 'application/pdf', size: buffer.length, buffer, fieldname: 'files' }]
    });
    assert.equal(file.fileName, name);
    assert.equal(file.metadata.originalFileName, name);
    assert.equal(file.mimeType, 'application/pdf');
    assert.equal(file.metadata.optimized, false);
    assert.deepEqual(received.at(-1).body, buffer);
    assert.equal(received.at(-1).valid, true);
    assert.match(received.at(-1).headers['x-amz-meta-originalname'], /^[\x20-\x7e]+$/);
  });

  await t.test('browser multipart uploads also produce valid S3 signatures', async () => {
    const app = express();
    app.post('/upload', multer({ storage: multer.memoryStorage() }).array('files'), async (req, res, next) => {
      try { res.json(await storage.uploadLeadFiles({ files: req.files, code: 'LH-43' })); }
      catch (error) { next(error); }
    });
    app.use((_error, _req, res, _next) => res.status(500).json({ error: true }));
    const api = app.listen(0, '127.0.0.1');
    await new Promise(resolve => api.once('listening', resolve));
    try {
      const data = new FormData();
      data.append('files', new Blob([png], { type: 'image/png' }), 'Resumen de reunión_ alianza industrial.png');
      data.append('files', new Blob(['documento'], { type: 'application/pdf' }), 'Cotización–2026.pdf');
      const response = await fetch(`http://127.0.0.1:${api.address().port}/upload`, { method: 'POST', body: data });
      assert.equal(response.status, 200);
      const files = await response.json();
      assert.equal(files.length, 2);
      assert.equal(files[1].mimeType, 'application/pdf');
      assert.equal(received.at(-1).body.toString(), 'documento');
      assert.ok(received.slice(-2).every(file => file.valid));
    } finally {
      api.closeAllConnections();
      await new Promise(resolve => api.close(resolve));
    }
  });
});
