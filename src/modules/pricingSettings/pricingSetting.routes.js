'use strict';

const express = require('express');
const controller = require('./pricingSetting.controller');
const validator = require('./pricingSetting.validator');
const validate = require('../../middlewares/validate');
const { requireAdmin } = require('../../middlewares/authorization.middleware');

const router = express.Router();

router.get('/harvest', requireAdmin, controller.getHarvest);
router.patch('/harvest', requireAdmin, validator.validateHarvestUpdate, validate, controller.updateHarvest);

module.exports = router;
