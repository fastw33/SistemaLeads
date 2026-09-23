'use strict';

const express = require('express');
const controller = require('./leadEvent.controller');
const validator = require('./leadEvent.validator');
const validate = require('../../middlewares/validate');

const router = express.Router();

router.get('/', controller.list);
router.get('/:id', validator.validateId, validate, controller.getById);
router.post('/', validator.validateCreate, validate, controller.create);

module.exports = router;
