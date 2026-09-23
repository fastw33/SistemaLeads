'use strict';

const express = require('express');
const controller = require('./contactPolicy.controller');
const validator = require('./contactPolicy.validator');
const validate = require('../../middlewares/validate');
const { requireAdmin } = require('../../middlewares/authorization.middleware');

const router = express.Router();

router.get('/', requireAdmin, controller.list);
router.get('/:id', validator.validateId, validate, controller.getById);
router.post('/', validator.validateCreate, validate, controller.create);
router.patch('/:id', validator.validateId, validate, controller.update);

module.exports = router;
