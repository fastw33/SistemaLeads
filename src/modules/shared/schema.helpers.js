'use strict';

const mongoose = require('mongoose');

const actorSchema = new mongoose.Schema({
  id: String,
  name: String,
  roles: [String]
}, { _id: false });

const externalRefSchema = new mongoose.Schema({
  system: { type: String, required: true },
  externalId: String,
  code: String,
  url: String,
  snapshot: mongoose.Schema.Types.Mixed,
  syncedAt: Date
}, { _id: false });

const auditFields = {
  createdBy: actorSchema,
  updatedBy: actorSchema
};

function actorFromReq(req) {
  return {
    id: req.user && req.user.id,
    name: req.user && req.user.name,
    roles: req.user && req.user.roles
  };
}

module.exports = {
  actorSchema,
  externalRefSchema,
  auditFields,
  actorFromReq
};
