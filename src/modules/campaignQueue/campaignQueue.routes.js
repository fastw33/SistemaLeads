'use strict';

const express = require('express');
const controller = require('./campaignQueue.controller');
const validator = require('./campaignQueue.validator');
const validate = require('../../middlewares/validate');
const { requirePermission } = require('../../middlewares/authorization.middleware');

const router = express.Router();

router.use(requirePermission('gestionComercialAtencion'));

router.get('/current', controller.current);
router.post('/next', validator.validateNext, validate, controller.next);
router.patch('/:id/enrich', validator.validateEnrich, validate, controller.enrich);
router.post('/:id/finish-enrichment', validator.validateFinishEnrichment, validate, controller.finishEnrichment);
router.post('/:id/resolve-follow-up', validator.validateResolveFollowUp, validate, controller.resolveFollowUp);
router.post('/:id/complete', validator.validateComplete, validate, controller.complete);

module.exports = router;
