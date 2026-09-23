'use strict';

const BUSINESS_UNITS = ['Fastway', 'Harvest', 'Greenway'];

const SERVICE_LINES = [
  'logistica',
  'metales',
  'proveedores',
  'compradores',
  'consulta_general'
];

const ACCOUNT_TYPES = ['customer', 'supplier', 'buyer', 'mixed'];

const BUSINESS_MODELS = {
  Fastway: {
    defaultAccountType: 'customer',
    supplierStrategy: 'fixed_providers',
    description: 'Venta de servicios logisticos a clientes; proveedores normalmente fijos.'
  },
  Harvest: {
    defaultAccountType: 'supplier',
    supplierStrategy: 'active_sourcing',
    territory: 'Colombia',
    description: 'Busqueda constante de proveedores clasificados; maneja algunos clientes compradores.'
  },
  Greenway: {
    defaultAccountType: 'supplier',
    supplierStrategy: 'active_sourcing',
    territory: 'Internacional',
    description: 'Busqueda constante de proveedores clasificados fuera de Colombia; maneja algunos clientes compradores.'
  }
};

const LEAD_STATUSES = [
  'new',
  'queued',
  'assigned',
  'contact_attempted',
  'contacted',
  'consultation',
  'meeting_required',
  'meeting_scheduled',
  'meeting_completed',
  'meeting_not_completed',
  'visit_scheduled',
  'visit_completed',
  'visit_not_completed',
  'pickup_scheduled',
  'pickup_completed',
  'pickup_not_completed',
  'price_requested',
  'price_informed',
  'quote_created',
  'quote_sent',
  'opportunity',
  'purchase_completed',
  'won',
  'lost',
  'discarded',
  'do_not_contact',
  'incomplete'
];

const QUEUE_STATUSES = [
  'available',
  'locked',
  'assigned',
  'rescheduled',
  'worked',
  'skipped',
  'closed',
  'blocked',
  'incomplete'
];

const EVENT_TYPES = [
  'call',
  'whatsapp',
  'email',
  'meeting_created',
  'meeting_result',
  'visit_created',
  'visit_result',
  'pickup_created',
  'pickup_result',
  'note',
  'price_requested',
  'price_informed',
  'quote_requested',
  'status_change',
  'assignment',
  'skip',
  'imported',
  'external_link'
];

module.exports = {
  BUSINESS_UNITS,
  SERVICE_LINES,
  ACCOUNT_TYPES,
  BUSINESS_MODELS,
  LEAD_STATUSES,
  QUEUE_STATUSES,
  EVENT_TYPES
};
