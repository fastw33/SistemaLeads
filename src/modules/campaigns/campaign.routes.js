'use strict';

const express = require('express');
const multer = require('multer');
const controller = require('./campaign.controller');
const validator = require('./campaign.validator');
const validate = require('../../middlewares/validate');
const { requirePermission } = require('../../middlewares/authorization.middleware');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
});

router.get('/', requirePermission('leadsCampanas'), controller.list);
router.get('/performance/operators', requirePermission('leadsRendimientoEquipo'), controller.operatorPerformance);
router.get('/admin/contacts', requirePermission('esAdmin'), controller.adminContacts);
router.post('/:id/contacts/:recordId/reopen', requirePermission('esAdmin'), controller.reopenContact);
router.post('/:id/contacts/:recordId/discard', requirePermission('esAdmin'), controller.discardContact);
router.patch('/:id/contacts/:recordId/assign', requirePermission('esAdmin'), controller.assignContact);
router.delete('/:id/contacts/:recordId', requirePermission('esAdmin'), controller.deleteContact);
router.get('/:id', requirePermission('leadsCampanas'), validator.validateId, validate, controller.getById);
router.post('/', requirePermission('leadsCampanas'), validator.validateCreate, validate, controller.create);
router.patch('/:id', requirePermission('leadsCampanas'), validator.validateId, validate, controller.update);
router.post('/:id/import-json', requirePermission('leadsCampanas'), validator.validateImportJson, validate, controller.importJson);
router.post('/:id/import-excel', requirePermission('leadsCampanas'), validator.validateId, validate, upload.single('file'), controller.importExcel);
router.post('/:id/preview-import', requirePermission('leadsCampanas'), validator.validateId, validate, upload.single('file'), controller.previewImport);
router.post('/:id/import-file', requirePermission('leadsCampanas'), validator.validateId, validate, upload.single('file'), controller.importFile);
router.post('/:id/start', requirePermission('leadsCampanas'), validator.validateId, validate, controller.start);
router.post('/:id/pause', requirePermission('leadsCampanas'), validator.validatePause, validate, controller.pause);
router.post('/:id/stop', requirePermission('leadsCampanas'), validator.validateId, validate, controller.stop);
router.get('/:id/contacts', requirePermission('leadsCampanas'), validator.validateId, validate, controller.contacts);

module.exports = router;
