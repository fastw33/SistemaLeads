'use strict';

const express = require('express');
const controller = require('./pricingSetting.controller');
const validator = require('./pricingSetting.validator');
const validate = require('../../middlewares/validate');
const { requirePermission } = require('../../middlewares/authorization.middleware');

const router = express.Router();

router.get('/harvest', requirePermission('leadsConfiguracionPrecios'), requirePermission('leadsHarvest'), controller.getHarvest);
router.patch('/harvest', requirePermission('leadsConfiguracionPrecios'), requirePermission('leadsHarvest'), validator.validateHarvestUpdate, validate, controller.updateHarvest);

module.exports = router;
