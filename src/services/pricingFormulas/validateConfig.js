const ApiError = require('../../utils/apiError');
const expression = require('./expression');

// Shape-checks products.pricing_config before it is persisted. Previously
// nothing validated this column at all — a typo'd unitSizeInches: 0 saved fine
// and only surfaced as an error on a customer's price request. Admin-authored
// formulas raise the stakes, so both the legacy registry params and custom
// expressions are checked here at save time.

// Variables every formula can use regardless of how the product is configured.
const BUILT_IN_VARS = ['sizeInches', 'optionsTotal'];
// autoQuantity expressions additionally see the computed load (phase 2).
const AUTO_QUANTITY_VARS = ['watts'];

const REQUIRED_PARAMS = {
  flat: ['basePrice'],
  linear_per_unit: ['basePrice', 'unitSizeInches', 'pricePerExtraUnit', 'wattsPerUnit'],
};

// Positive-only params: a zero here is a divide-by-zero or a nonsense minimum.
const MUST_BE_POSITIVE = new Set(['unitSizeInches']);

function assertNumericParams(formulaType, params) {
  REQUIRED_PARAMS[formulaType].forEach((key) => {
    const value = Number(params[key]);
    if (!Number.isFinite(value)) {
      throw ApiError.badRequest(`Pricing param "${key}" must be a number`);
    }
    if (MUST_BE_POSITIVE.has(key) ? !(value > 0) : value < 0) {
      throw ApiError.badRequest(
        `Pricing param "${key}" must be ${MUST_BE_POSITIVE.has(key) ? 'greater than 0' : '0 or greater'}`
      );
    }
  });
}

// Every name a custom formula may reference for this product: built-ins, admin
// constants, one variable per option group (its selected choice's priceDelta)
// and one per numeric attribute on that group's choices.
function allowedVariablesFor(params, optionGroups = []) {
  const names = [...BUILT_IN_VARS, ...Object.keys(params.constants || {})];
  optionGroups.forEach((group) => {
    names.push(group.key);
    (group.choices || []).forEach((choice) => {
      Object.entries(choice.extra || {}).forEach(([attr, value]) => {
        if (typeof value === 'number') names.push(`${group.key}_${attr}`);
      });
    });
  });
  return [...new Set(names)];
}

function assertNoCollisions(params, optionGroups) {
  const constants = Object.keys(params.constants || {});
  constants.forEach((name) => {
    if (BUILT_IN_VARS.includes(name) || AUTO_QUANTITY_VARS.includes(name)) {
      throw ApiError.badRequest(`Constant "${name}" collides with a built-in variable`);
    }
  });
  optionGroups.forEach((group) => {
    if (BUILT_IN_VARS.includes(group.key) || AUTO_QUANTITY_VARS.includes(group.key)) {
      throw ApiError.badRequest(`Option group key "${group.key}" collides with a built-in variable`);
    }
    if (constants.includes(group.key)) {
      throw ApiError.badRequest(`Option group key "${group.key}" collides with a constant of the same name`);
    }
  });
}

function checkExpression(source, label, allowed) {
  if (typeof source !== 'string' || source.trim() === '') {
    throw ApiError.badRequest(`${label} formula must be a non-empty string`);
  }
  const result = expression.validate(source, allowed);
  if (!result.ok) throw ApiError.badRequest(`${label} formula: ${result.message}`);
}

// optionGroups is what the product currently has persisted. For a brand-new
// product the groups are saved after the product row exists, so callers pass
// an empty list and group-derived names are re-checked on the next save.
function validatePricingConfig(pricingConfig, optionGroups = []) {
  if (pricingConfig == null) return; // plain, non-configurable product

  if (typeof pricingConfig !== 'object' || Array.isArray(pricingConfig)) {
    throw ApiError.badRequest('pricing_config must be an object');
  }

  const { formulaType, params = {}, formula } = pricingConfig;
  if (!['flat', 'linear_per_unit', 'custom'].includes(formulaType)) {
    throw ApiError.badRequest(`Unknown pricing formulaType "${formulaType}"`);
  }

  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    throw ApiError.badRequest('pricing_config.params must be an object');
  }

  if (formulaType !== 'custom') {
    assertNumericParams(formulaType, params);
    return;
  }

  Object.entries(params.constants || {}).forEach(([name, value]) => {
    if (!Number.isFinite(Number(value))) {
      throw ApiError.badRequest(`Constant "${name}" must be a number`);
    }
  });

  assertNoCollisions(params, optionGroups);

  if (!formula || typeof formula !== 'object') {
    throw ApiError.badRequest('A custom formula requires a formula.price expression');
  }

  const allowed = allowedVariablesFor(params, optionGroups);
  checkExpression(formula.price, 'Price', allowed);
  if (formula.watts != null) checkExpression(formula.watts, 'Watts', allowed);

  if (params.minSizeInches != null && !(Number(params.minSizeInches) > 0)) {
    throw ApiError.badRequest('Pricing param "minSizeInches" must be greater than 0');
  }

  // Phase 2: one auto-quantity expression per option group key.
  Object.entries(params.autoQuantity || {}).forEach(([groupKey, source]) => {
    if (optionGroups.length > 0 && !optionGroups.some((g) => g.key === groupKey)) {
      throw ApiError.badRequest(`Auto-quantity refers to unknown option group "${groupKey}"`);
    }
    checkExpression(source, `Auto-quantity for "${groupKey}"`, [...allowed, ...AUTO_QUANTITY_VARS]);
  });
}

module.exports = { validatePricingConfig, allowedVariablesFor, BUILT_IN_VARS, AUTO_QUANTITY_VARS };
