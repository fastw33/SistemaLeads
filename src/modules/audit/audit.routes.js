'use strict';

const express = require('express');
const controller = require('./audit.controller');
const { requireAdmin } = require('../../middlewares/authorization.middleware');

const router = express.Router();

router.get('/', requireAdmin, controller.list);

module.exports = router;
