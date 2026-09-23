'use strict';

const express = require('express');
const multer = require('multer');
const controller = require('./campaign.controller');
const validator = require('./campaign.validator');
const validate = require('../../middlewares/validate');
const { requireAdmin } = require('../../middlewares/authorization.middleware');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

router.get('/', requireAdmin, controller.list);
router.get('/performance/operators', requireAdmin, controller.operatorPerformance);
router.get('/admin/contacts', requireAdmin, controller.adminContacts);
router.post('/:id/contacts/:recordId/reopen', requireAdmin, controller.reopenContact);
router.post('/:id/contacts/:recordId/discard', requireAdmin, controller.discardContact);
router.patch('/:id/contacts/:recordId/assign', requireAdmin, controller.assignContact);
router.delete('/:id/contacts/:recordId', requireAdmin, controller.deleteContact);
router.get('/:id', requireAdmin, validator.validateId, validate, controller.getById);
router.post('/', requireAdmin, validator.validateCreate, validate, controller.create);
router.patch('/:id', requireAdmin, validator.validateId, validate, controller.update);
router.post('/:id/import-json', requireAdmin, validator.validateImportJson, validate, controller.importJson);
router.post('/:id/import-excel', requireAdmin, validator.validateId, validate, upload.single('file'), controller.importExcel);
router.post('/:id/preview-import', requireAdmin, validator.validateId, validate, upload.single('file'), controller.previewImport);
router.post('/:id/import-file', requireAdmin, validator.validateId, validate, upload.single('file'), controller.importFile);
router.post('/:id/start', requireAdmin, validator.validateId, validate, controller.start);
router.post('/:id/pause', requireAdmin, validator.validatePause, validate, controller.pause);
router.post('/:id/stop', requireAdmin, validator.validateId, validate, controller.stop);
router.get('/:id/contacts', requireAdmin, validator.validateId, validate, controller.contacts);

module.exports = router;
