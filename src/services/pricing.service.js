const pricingFormulas = require('./pricingFormulas');
const expression = require('./pricingFormulas/expression');
const productOptionsService = require('./productOptions.service');
const ApiError = require('../utils/apiError');

function parseJsonColumn(value) {
  if (value == null) return null;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function isConfigurable(product) {
  return Boolean(parseJsonColumn(product.pricing_config));
}

// Variables an admin-authored formula can read. Every option group contributes
// its selected choice's priceDelta under the group key, plus one variable per
// numeric attribute on that choice (e.g. power_supply_wattageCapacity). An
// unanswered group resolves to 0 — matching the "no selection, $0" rule below.
function buildScope(params, groups, resolvedByGroupKey) {
  const scope = { ...(params.constants || {}) };

  groups.forEach((group) => {
    const resolved = resolvedByGroupKey[group.key];
    scope[group.key] = resolved ? resolved.priceDelta : 0;
    // Every attribute name any choice in the group defines is exposed, so a
    // formula still resolves (to 0) when a choice lacking it is selected.
    group.choices.forEach((choice) => {
      Object.entries(choice.extra || {}).forEach(([attr, value]) => {
        if (typeof value !== 'number') return;
        const selected = typeof resolved?.extra?.[attr] === 'number' ? resolved.extra[attr] : 0;
        scope[`${group.key}_${attr}`] = selected;
      });
    });
  });

  return scope;
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

  const { formulaType, params = {}, formula } = pricingConfig;
  const isCustom = formulaType === 'custom';

  // Groups are resolved before the base price because a custom formula reads
  // the selected choices as variables. The registry path does not need them
  // first, but one order keeps a single code path for both.
  const groups = await productOptionsService.getOptionsForProduct(product.id);

  let unitPriceDelta = 0;
  let flatFeeDelta = 0;
  const resolvedChoices = [];
  const resolvedByGroupKey = {};

  const choiceKeysByGroupKey = selections.choiceKeysByGroupKey || {};
  // eslint-disable-next-line no-restricted-syntax
  for (const group of groups) {
    const chosenKey = choiceKeysByGroupKey[group.key];
    if (chosenKey === undefined) continue; // group not answered — treated as "no selection", $0
    const choice = group.choices.find((c) => c.key === chosenKey);
    if (!choice) {
      throw ApiError.badRequest(`Invalid choice "${chosenKey}" for option group "${group.key}"`);
    }
    if (choice.extra?.isFlatFee) {
      flatFeeDelta += choice.priceDelta;
    } else {
      unitPriceDelta += choice.priceDelta;
    }
    const resolved = {
      groupKey: group.key,
      groupLabel: group.label,
      choiceKey: choice.key,
      choiceLabel: choice.label,
      priceDelta: choice.priceDelta,
      isFlatFee: Boolean(choice.extra?.isFlatFee),
    };
    resolvedChoices.push(resolved);
    resolvedByGroupKey[group.key] = { priceDelta: choice.priceDelta, extra: choice.extra || {} };
  }

  let units;
  let basePrice;
  let totalWatts;

  if (isCustom) {
    const sizeInches = Number(selections.sizeInches);
    const minSizeInches = params.minSizeInches != null ? Number(params.minSizeInches) : null;
    if (minSizeInches != null) {
      if (!(sizeInches > 0)) throw ApiError.badRequest('Size is required for this product');
      if (sizeInches < minSizeInches) {
        throw ApiError.badRequest(`Size must be at least ${minSizeInches} inches`);
      }
    }

    const scope = buildScope(params, groups, resolvedByGroupKey);
    scope.sizeInches = Number.isFinite(sizeInches) ? sizeInches : 0;
    scope.optionsTotal = unitPriceDelta;

    totalWatts = formula?.watts ? expression.evaluate(formula.watts, scope) : 0;
    basePrice = expression.evaluate(formula.price, scope);
    units = 1;
  } else {
    ({ units, basePrice, totalWatts } = pricingFormulas.computeBase(formulaType, params, {
      sizeInches: selections.sizeInches,
    }));
  }

  // Wattage gating is its own pass: a custom formula cannot know totalWatts
  // until every choice above has been resolved, so gating cannot live in the
  // resolution loop the way it used to.
  resolvedChoices.forEach((resolved) => {
    const capacity = resolvedByGroupKey[resolved.groupKey].extra?.wattageCapacity;
    if (capacity != null && capacity < totalWatts) {
      throw ApiError.badRequest(
        `Choice "${resolved.choiceLabel}" (${capacity}W) cannot support the calculated load of ${totalWatts}W — pick a higher-capacity option`
      );
    }
  });

  // A formula may legitimately produce a negative intermediate value, but a
  // negative price must never reach a charge.
  const unitPrice = Math.max(0, Math.round((basePrice + unitPriceDelta) * 100) / 100);

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
