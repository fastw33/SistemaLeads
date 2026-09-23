'use strict';

const { body, query } = require('express-validator');

const validateWmsSearch = [
  query('q')
    .isString()
    .trim()
    .isLength({ min: 3, max: 80 })
    .withMessage('q debe tener entre 3 y 80 caracteres')
];


const validateTareasNotification = [
  body('to_ids').isArray({ min: 1 }),
  body('type').isString().trim().notEmpty(),
  body('title').isString().trim().notEmpty(),
  body('body').isString().trim().notEmpty(),
  body('target.type').isIn(['ticket', 'chat', 'terceros', 'lead'])
];

const validateTareasTicket = [
  body('orgId').isString().trim().notEmpty(),
  body('tipo').isIn(['tarea', 'proyecto', 'operacion']),
  body('titulo').isString().trim().notEmpty(),
  body('descripcion').isString().trim().notEmpty(),
  body('categoria_id').isMongoId(),
  body('prioridad_id').isMongoId(),
  body('estado_id').isMongoId(),
  body('creado_por').isString().trim().notEmpty(),
  body('asignado_a.tipo').isIn(['area', 'team', 'personal']),
  body('asignado_a.id').exists()
];

const validateLogisticaQuotation = [
  body('subject').optional().isString().trim().isLength({ max: 200 }),
  body('lead_external_id').optional().isString().trim().isLength({ max: 120 }),
  body('customer_id').optional().isString().trim().isLength({ max: 120 }),
  body('transport_mode').optional().isString().trim().isLength({ max: 80 }),
  body('origin').optional().isObject(),
  body('destination').optional().isObject()
];

module.exports = {
  validateWmsSearch,
  validateTareasNotification,
  validateTareasTicket,
  validateLogisticaQuotation
};

