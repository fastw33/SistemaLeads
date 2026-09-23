'use strict';

const { sanitizeMongoKeys } = require('../utils/mongoSafe');

module.exports = function sanitizeRequest(req, _res, next) {
  req.body = sanitizeMongoKeys(req.body);
  Object.defineProperty(req, 'query', {
    value: sanitizeMongoKeys(req.query),
    configurable: true,
    enumerable: true,
    writable: true
  });
  req.params = sanitizeMongoKeys(req.params);
  next();
};
