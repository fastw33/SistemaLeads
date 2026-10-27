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

## Evidencias por gestión

- `POST /api/leads/:id/actions`: admite `multipart/form-data` con varios archivos en `files`, junto a los campos de la gestión. Los participantes se envían como JSON.
- `POST /api/leads/:id/events/:eventId/attachments`: agrega archivos a una gestión existente usando `multipart/form-data` con `files`. Conserva los comentarios, el resultado y el estado del lead.
- Requiere acceso a la línea comercial y permiso para gestionar el lead. La gestión debe pertenecer al lead indicado. Los archivos se descargan mediante el endpoint autenticado existente.
- Almacenamiento: utiliza la configuración S3 existente. Cada archivo conserva `metadata.eventId` y el usuario que lo adjuntó; las cargas posteriores quedan en auditoría.
- Límites por envío: `LEADS_MAX_FILES` (10) y `LEADS_MAX_FILE_SIZE_MB` (20 MB por archivo). Si se cambian, configurar también `VITE_LEADS_MAX_FILES` y `VITE_LEADS_MAX_FILE_SIZE_MB` en FrontWms.
- En Mis leads, usar **Registrar gestión** para adjuntar fotos y documentos al guardar, o **Historial → Agregar evidencias** para completar una gestión anterior. También se admiten adjuntos al registrar resultados de actividades en Agenda.

## Supervisión del asesor

- `GET /api/leads/reviews/pending?page=1&limit=10`: devuelve las indicaciones pendientes del usuario autenticado, con paginación y total. Solo incluye sus leads actuales y sus líneas autorizadas.
- Las indicaciones existentes y sus respuestas aparecen en `/api/leads/intelligence` como movimientos de supervisión, conservando fecha, autor y texto original. No cuentan como una gestión comercial del operador.
- Al crear una indicación se avisa al responsable mediante la integración de notificaciones existente (`TAREAS_API_URL`). Si esta integración falla, la indicación permanece guardada y visible en Atención.
- Atención muestra una campana con todas las pendientes y el expediente muestra un aviso para responder. Se actualizan cada 30 segundos mientras la página está visible, al volver a la ventana y al registrar una respuesta. Leer una indicación no la marca como resuelta.
