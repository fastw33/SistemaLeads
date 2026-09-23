'use strict';

require('dotenv').config();

const app = require('./app');
const connectDb = require('./config/db');
const logger = require('./utils/logger');
const { startLeadReminderWorker } = require('./modules/notifications/leadReminder.worker');

const PORT = Number(process.env.PORT || 4085);

process.on('uncaughtException', (error) => {
  logger.error('uncaught_exception', { message: error.message, stack: error.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('unhandled_rejection', { reason });
});

async function bootstrap() {
  await connectDb();
  startLeadReminderWorker();

  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Hub Comercial API escuchando en puerto ${PORT}`);
  });
}

bootstrap().catch((error) => {
  logger.error('bootstrap_error', { message: error.message, stack: error.stack });
  process.exit(1);
});
