'use strict';

const { httpError } = require('./errors');

function buildCrudService(Model, options = {}) {
  const defaultSort = options.defaultSort || { createdAt: -1 };

  async function list(query = {}, context = {}) {
    const page = Math.max(Number(query.page || 1), 1);
    const limit = Math.min(Math.max(Number(query.limit || 25), 1), 100);
    const filter = options.buildFilter ? await options.buildFilter(query, context) : {};
    const [items, total] = await Promise.all([
      Model.find(filter).sort(defaultSort).skip((page - 1) * limit).limit(limit).lean(),
      Model.countDocuments(filter)
    ]);

    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async function getById(id, context = {}) {
    const item = await Model.findById(id).lean();
    if (!item) throw httpError(404, 'Registro no encontrado');
    if (options.canRead && !await options.canRead(item, context)) {
      throw httpError(403, 'No autorizado para ver este registro');
    }
    return item;
  }

  async function create(payload, context = {}) {
    const data = options.beforeCreate ? await options.beforeCreate(payload, context) : payload;
    const item = await Model.create(data);
    return item.toObject();
  }

  async function update(id, payload, context = {}) {
    const current = await Model.findById(id);
    if (!current) throw httpError(404, 'Registro no encontrado');
    if (options.canWrite && !await options.canWrite(current, context)) {
      throw httpError(403, 'No autorizado para modificar este registro');
    }
    const data = options.beforeUpdate ? await options.beforeUpdate(payload, current, context) : payload;
    Object.assign(current, data);
    await current.save();
    return current.toObject();
  }

  return { list, getById, create, update };
}

module.exports = buildCrudService;
