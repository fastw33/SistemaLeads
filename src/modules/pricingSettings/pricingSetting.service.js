'use strict';

const PricingSetting = require('./pricingSetting.model');
const { actorFromReq } = require('../shared/schema.helpers');

const HARVEST_KEY = 'harvest_local_prices';

function normalizePercent(value) {
  const percent = Number(value);
  return Number.isFinite(percent) ? Math.min(Math.max(percent, 0), 100) : 0;
}

function calculateHarvestPurchasePrice(value, discountPercent) {
  const basePrice = Number(value || 0);
  const multiplier = 1 - normalizePercent(discountPercent) / 100;
  return Math.round(basePrice * multiplier);
}

function publicSetting(setting) {
  return {
    key: HARVEST_KEY,
    discountPercent: normalizePercent(setting?.discountPercent ?? setting?.markupPercent),
    updatedAt: setting?.updatedAt || null,
    updatedBy: setting?.updatedBy || null
  };
}

async function getHarvestSetting() {
  const setting = await PricingSetting.findOne({ key: HARVEST_KEY }).lean();
  return publicSetting(setting);
}

async function updateHarvestSetting(payload, req) {
  const setting = await PricingSetting.findOneAndUpdate(
    { key: HARVEST_KEY },
    {
      $set: {
        discountPercent: normalizePercent(payload.discountPercent),
        updatedBy: actorFromReq(req)
      },
      $unset: { markupPercent: 1 },
      $setOnInsert: { key: HARVEST_KEY }
    },
    { new: true, upsert: true, runValidators: true }
  ).lean();
  return publicSetting(setting);
}

async function applyHarvestDiscount(rows = []) {
  const setting = await getHarvestSetting();
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    ...row,
    price_value: calculateHarvestPurchasePrice(row.price_value, setting.discountPercent)
  }));
}

module.exports = {
  getHarvestSetting,
  updateHarvestSetting,
  applyHarvestDiscount,
  calculateHarvestPurchasePrice
};
