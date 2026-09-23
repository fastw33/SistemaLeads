'use strict';

const express = require('express');
const controller = require('./account.controller');
const validator = require('./account.validator');
const validate = require('../../middlewares/validate');
const { requireAdmin } = require('../../middlewares/authorization.middleware');

const router = express.Router();

router.get('/', requireAdmin, controller.list);
router.get('/:id', requireAdmin, validator.validateId, validate, controller.getById);
router.post('/', requireAdmin, validator.validateCreate, validate, controller.create);
router.patch('/:id', requireAdmin, validator.validateId, validate, controller.update);

module.exports = router;
