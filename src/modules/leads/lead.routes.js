'use strict';

const express = require('express');
const multer = require('multer');
const controller = require('./lead.controller');
const validator = require('./lead.validator');
const validate = require('../../middlewares/validate');
const { requirePermission } = require('../../middlewares/authorization.middleware');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Number(process.env.LEADS_MAX_FILE_SIZE_MB || 20) * 1024 * 1024,
    files: Number(process.env.LEADS_MAX_FILES || 10)
  }
});

function parseApiKeys() {
  return String(
    process.env.LEADS_PUBLIC_API_KEYS ||
      process.env.LEADS_PUBLIC_API_KEY ||
      process.env.API_KEYS ||
      ''
  )
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
}

function publicApiKeyAuth(req, res, next) {
  const keys = parseApiKeys();
  const incoming = String(req.headers['x-api-key'] || '').trim();

  if (!keys.length) {
    return res.status(503).json({
      error: true,
      message: 'API publica de leads no configurada'
    });
  }

  if (!incoming || !keys.includes(incoming)) {
    return res.status(401).json({
      error: true,
      message: 'API key invalida'
    });
  }

  return next();
}

router.get('/public/ping', (_req, res) => {
  res.json({ ok: true, module: 'leads-public' });
});

router.post(
  '/public/ingest',
  publicApiKeyAuth,
  upload.any(),
  controller.ingestPublic
);

router.get('/', controller.list);
router.get('/intelligence', controller.contactIntelligence);
router.get('/attachments/:attachmentId/download', controller.downloadAttachment);
router.post('/manual', upload.any(), controller.createManual);
router.post('/operations/lot-created', validator.validateLotOperation, validate, controller.registerLotOperation);
router.get('/:id/admin/events', requirePermission('esAdmin'), validator.validateId, validate, controller.adminEvents);
router.patch('/:id/admin/events/:eventId', requirePermission('esAdmin'), validator.validateAdminEventUpdate, validate, controller.adminUpdateEvent);
router.patch('/:id/admin', requirePermission('esAdmin'), validator.validateAdminUpdate, validate, controller.adminUpdate);
router.delete('/:id/admin', requirePermission('esAdmin'), validator.validateAdminDelete, validate, controller.adminDelete);
router.post('/:id/assign', validator.validateAssign, validate, controller.assign);
router.post('/:id/discard', validator.validateDiscard, validate, controller.discard);
router.post('/:id/actions', upload.any(), validator.validateAction, validate, controller.registerAction);
router.get('/:id', validator.validateId, validate, controller.getById);
router.post('/', validator.validateCreate, validate, controller.create);
router.patch('/:id', validator.validateId, validate, controller.update);

module.exports = router;
