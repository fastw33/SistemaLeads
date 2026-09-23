'use strict';

const jwt = require('jsonwebtoken');

function parseRoles(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return String(value).split(',').map((role) => role.trim()).filter(Boolean);
}

function parsePermissions(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch (_error) {
      return {};
    }
  }

  return {};
}

function truePermissionKeys(permisos = {}) {
  if (!permisos || typeof permisos !== 'object') return [];
  return Object.entries(permisos)
    .filter(([, value]) => value === true)
    .map(([key]) => key);
}

function buildUserFromPayload(payload, token) {
  const permisos = parsePermissions(payload.permisos);
  const personal = payload.personal || {};
  const roles = [
    ...parseRoles(payload.roles || payload.role || payload.Roles),
    ...truePermissionKeys(permisos)
  ];

  return {
    id: payload.id_personal || personal.id_personal || payload.id || payload.sub || payload.Id_personal || payload.userId,
    idPersonal: payload.id_personal || personal.id_personal || payload.Id_personal,
    idUsuario: payload.id_usuario || payload.idUsuario,
    username: payload.username,
    name: [personal.nombre, personal.apellido].filter(Boolean).join(' ') || payload.name || payload.Nombre || payload.username,
    roles,
    permisos,
    personal,
    token,
    raw: payload,
    source: 'jwt'
  };
}

function buildDevUser() {
  return {
    id: process.env.DEV_USER_ID || 'dev-admin',
    name: process.env.DEV_USER_NAME || 'Admin Desarrollo',
    roles: parseRoles(process.env.DEV_USER_ROLES || 'comercial_admin,admin'),
    source: 'dev'
  };
}

module.exports = function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token && process.env.ALLOW_DEV_AUTH === 'true') {
    req.user = buildDevUser();
    return next();
  }

  if (!token) {
    return res.status(401).json({ error: true, message: 'Token requerido' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = buildUserFromPayload(payload, token);
    return next();
  } catch (_error) {
    return res.status(401).json({ error: true, message: 'Token invalido' });
  }
};

module.exports.isAdminUser = function isAdminUser(user = {}) {
  const permisos = user.permisos || {};
  if (permisos.esAdmin === true || permisos.perfilAdmin === true || permisos.leadsAdmin === true || permisos.hubComercialAdmin === true) {
    return true;
  }

  return parseRoles(user.roles).some((role) => [
    'admin',
    'superadmin',
    'comercial_admin',
    'leads_admin',
    'perfiladmin',
    'leadsadmin',
    'hubcomercialadmin'
  ].includes(String(role).toLowerCase()));
};
