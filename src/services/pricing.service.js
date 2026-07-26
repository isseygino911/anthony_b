const pricingFormulas = require('./pricingFormulas');
const productOptionsService = require('./productOptions.service');
const ApiError = require('../utils/apiError');

function parseJsonColumn(value) {
  if (value == null) return null;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function isConfigurable(product) {
  return Boolean(parseJsonColumn(product.pricing_config));
}

// Single source of truth for configured-product pricing (mirrors
// order.service.js's "totals computed in exactly one place" rule). Given a
// product row and the customer's selections, returns the per-unit price plus
// enough detail to snapshot onto a cart/order line.
//
// selections shape: { sizeInches?, choiceKeysByGroupKey: { [groupKey]: choiceKey } }
async function computePrice(product, selections) {
  const pricingConfig = parseJsonColumn(product.pricing_config);
  if (!pricingConfig) throw ApiError.badRequest('Product is not configurable');

  const { formulaType, params } = pricingConfig;
  const { units, basePrice, totalWatts } = pricingFormulas.computeBase(formulaType, params, {
    sizeInches: selections.sizeInches,
  });

  const groups = await productOptionsService.getOptionsForProduct(product.id);

  let unitPriceDelta = 0;
  let flatFeeDelta = 0;
  const resolvedChoices = [];

  const choiceKeysByGroupKey = selections.choiceKeysByGroupKey || {};
  // eslint-disable-next-line no-restricted-syntax
  for (const group of groups) {
    const chosenKey = choiceKeysByGroupKey[group.key];
    if (chosenKey === undefined) continue; // group not answered — treated as "no selection", $0
    const choice = group.choices.find((c) => c.key === chosenKey);
    if (!choice) {
      throw ApiError.badRequest(`Invalid choice "${chosenKey}" for option group "${group.key}"`);
    }
    if (choice.extra?.wattageCapacity != null && choice.extra.wattageCapacity < totalWatts) {
      throw ApiError.badRequest(
        `Choice "${choice.label}" (${choice.extra.wattageCapacity}W) cannot support the calculated load of ${totalWatts}W — pick a higher-capacity option`
      );
    }
    if (choice.extra?.isFlatFee) {
      flatFeeDelta += choice.priceDelta;
    } else {
      unitPriceDelta += choice.priceDelta;
    }
    resolvedChoices.push({
      groupKey: group.key,
      groupLabel: group.label,
      choiceKey: choice.key,
      choiceLabel: choice.label,
      priceDelta: choice.priceDelta,
      isFlatFee: Boolean(choice.extra?.isFlatFee),
    });
  }

  const unitPrice = Math.round((basePrice + unitPriceDelta) * 100) / 100;

  return {
    units,
    totalWatts,
    unitPrice,
    flatFeeDelta,
    resolvedChoices,
    selectedOptionsSnapshot: {
      sizeInches: selections.sizeInches ?? null,
      totalWatts,
      choices: resolvedChoices,
      flatFeeDelta,
    },
  };
}

module.exports = { isConfigurable, computePrice };
