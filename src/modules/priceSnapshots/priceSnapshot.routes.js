'use strict';

const express = require('express');
const controller = require('./priceSnapshot.controller');
const validator = require('./priceSnapshot.validator');
const validate = require('../../middlewares/validate');

const router = express.Router();

router.get('/', controller.list);
router.get('/:id', validator.validateId, validate, controller.getById);
router.post('/', validator.validateCreate, validate, controller.create);
router.patch('/:id', validator.validateId, validate, controller.update);

module.exports = router;
