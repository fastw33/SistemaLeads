'use strict';

const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const sharp = require('sharp');

let cachedClient = null;

function cleanString(value) {
  return String(value || '').trim();
}

function isS3Configured() {
  return Boolean(
    cleanString(process.env.S3_BUCKET || process.env.AWS_S3_BUCKET) &&
      cleanString(process.env.AWS_REGION || process.env.S3_REGION)
  );
}

function getS3Client() {
  if (cachedClient) return cachedClient;

  const region = cleanString(process.env.AWS_REGION || process.env.S3_REGION);
  const endpoint = cleanString(process.env.S3_ENDPOINT);
  const forcePathStyle =
    String(process.env.S3_FORCE_PATH_STYLE || '').toLowerCase() === 'true';

  cachedClient = new S3Client({
    region,
    ...(endpoint ? { endpoint } : {}),
    ...(endpoint ? { forcePathStyle } : {}),
  });

  return cachedClient;
}

function sanitizeFileName(filename) {
  const parsed = path.parse(cleanString(filename) || 'archivo');
  const base = parsed.name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80) || 'archivo';
  const ext = parsed.ext.replace(/[^a-zA-Z0-9.]/g, '').slice(0, 12);
  return `${base}${ext}`;
}

function isCompressibleImage(file) {
  return ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(
    cleanString(file?.mimetype).toLowerCase()
  );
}

async function prepareFileForStorage(file) {
  if (!isCompressibleImage(file)) {
    return {
      buffer: file.buffer,
      fileName: sanitizeFileName(file.originalname),
      mimeType: file.mimetype,
      originalSize: file.size,
      optimized: false,
    };
  }

  const maxWidth = Math.max(Number(process.env.LEADS_IMAGE_MAX_WIDTH || 1920), 320);
  const maxHeight = Math.max(Number(process.env.LEADS_IMAGE_MAX_HEIGHT || 1920), 320);
  const quality = Math.min(
    Math.max(Number(process.env.LEADS_IMAGE_WEBP_QUALITY || 78), 45),
    90
  );

  const parsed = path.parse(sanitizeFileName(file.originalname));
  const optimizedBuffer = await sharp(file.buffer, {
    failOn: 'none',
    limitInputPixels: 36_000_000,
  })
    .rotate()
    .resize({
      width: maxWidth,
      height: maxHeight,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality, effort: 4 })
    .toBuffer();

  return {
    buffer: optimizedBuffer,
    fileName: `${parsed.name || 'imagen'}.webp`,
    mimeType: 'image/webp',
    originalSize: file.size,
    optimizedSize: optimizedBuffer.length,
    optimized: true,
    originalFileName: file.originalname,
  };
}

function buildObjectUrl(bucket, key) {
  const publicBase = cleanString(process.env.S3_PUBLIC_BASE_URL);
  if (publicBase) return `${publicBase.replace(/\/+$/, '')}/${key}`;
  return `s3://${bucket}/${key}`;
}

async function uploadLeadFiles({ files = [], leadId, code }) {
  if (!Array.isArray(files) || files.length === 0) return [];

  if (!isS3Configured()) {
    const error = new Error('S3 no esta configurado para recibir adjuntos');
    error.status = 503;
    throw error;
  }

  const bucket = cleanString(process.env.S3_BUCKET || process.env.AWS_S3_BUCKET);
  const prefix = cleanString(process.env.S3_PREFIX || 'commercial-leads');
  const client = getS3Client();

  const uploads = [];

  for (const file of files) {
    const prepared = await prepareFileForStorage(file);
    const safeName = prepared.fileName;
    const key = [
      prefix.replace(/^\/+|\/+$/g, ''),
      String(code || leadId || 'lead'),
      `${Date.now()}-${Math.random().toString(16).slice(2)}-${safeName}`,
    ].join('/');

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: prepared.buffer,
        ContentType: prepared.mimeType,
        Metadata: {
          entity: 'lead',
          leadId: String(leadId || ''),
          originalName: cleanString(file.originalname).slice(0, 250),
          optimized: String(prepared.optimized),
        },
      })
    );

    uploads.push({
      fileName: file.originalname || safeName,
      mimeType: prepared.mimeType,
      size: prepared.buffer.length,
      storage: 's3',
      path: key,
      url: buildObjectUrl(bucket, key),
      metadata: {
        bucket,
        key,
        fieldname: file.fieldname,
        originalFileName: file.originalname,
        originalMimeType: file.mimetype,
        originalSize: prepared.originalSize,
        optimized: prepared.optimized,
        optimizedSize: prepared.optimizedSize || prepared.buffer.length,
      },
    });
  }

  return uploads;
}

module.exports = {
  uploadLeadFiles,
  isS3Configured,
  getS3Client,
};
