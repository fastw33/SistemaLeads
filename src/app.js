'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const corsOptions = require('./config/cors');
const authMiddleware = require('./middlewares/auth.middleware');
const sanitizeRequest = require('./middlewares/sanitizeRequest');
const errorHandler = require('./middlewares/errorHandler');
const notFound = require('./middlewares/notFound');
const routes = require('./modules');

const app = express();

app.set('trust proxy', 1);
app.use(helmet({ frameguard: false }));
app.use(cors(corsOptions));
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(sanitizeRequest);

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  standardHeaders: true,
  legacyHeaders: false
}));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'hub-comercial-api', timestamp: new Date().toISOString() });
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api/leads/public')) return next();
  return authMiddleware(req, res, next);
});

for (const route of routes) {
  app.use(route.path, route.router);
}

app.use(notFound);
app.use(errorHandler);

module.exports = app;
