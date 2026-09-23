'use strict';

const mongoose = require('mongoose');
const logger = require('../utils/logger');

module.exports = async function connectDb() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI no esta configurado');
  }

  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, {
    autoIndex: process.env.NODE_ENV !== 'production'
  });

  logger.info('MongoDB conectado para Hub Comercial');
};
