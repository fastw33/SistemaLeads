'use strict';

const express = require('express');
const controller = require('./audit.controller');
const { requirePermission } = require('../../middlewares/authorization.middleware');

const router = express.Router();

router.get('/', requirePermission('esAdmin'), controller.list);

module.exports = router;
