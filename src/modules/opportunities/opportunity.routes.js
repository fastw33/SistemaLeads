'use strict';

const express = require('express');
const controller = require('./opportunity.controller');
const validator = require('./opportunity.validator');
const validate = require('../../middlewares/validate');

const router = express.Router();

router.get('/', controller.list);
router.get('/:id', validator.validateId, validate, controller.getById);
router.post('/', validator.validateCreate, validate, controller.create);
router.patch('/:id', validator.validateId, validate, controller.update);

module.exports = router;
