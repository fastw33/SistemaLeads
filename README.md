# Hub Comercial API

Backend independiente para el sistema de leads comercial de Genika.

## Stack

- Node.js
- Express
- MongoDB
- Mongoose

## Arquitectura

Sigue el estilo usado en `wmsBack`:

```text
src/
  app.js
  server.js
  config/
  middlewares/
  utils/
  integrations/
  modules/
    modulo/
      modulo.model.js
      modulo.routes.js
      modulo.controller.js
      modulo.service.js
      modulo.validator.js
```

## Flujos iniciales

- Campanas con importacion Excel/JSON.
- Filas originales guardadas en `campaignRecords.rawData`.
- Cola atomica para asesores.
- Leads con historial en `leadEvents`.
- Cuentas flexibles para clientes, proveedores y compradores.
- Integraciones iniciales con WMS clientes/proveedores y precios locales.

## Seguridad

- JWT del ecosistema Genika/WMS.
- Modo dev opcional con `ALLOW_DEV_AUTH=true`.
- Asesores no listan base completa.
- Acciones sensibles en `auditLogs`.
- Catálogos, campañas, reglas y auditoría protegidos para admin.
