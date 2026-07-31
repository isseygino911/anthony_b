// Pure validation — no DB involved. Guards products.pricing_config at save
// time. Before this existed the column was written straight through, so a
// nonsense param only surfaced later as an error on a customer's price request.
import { describe, it, expect } from 'vitest';

const { validatePricingConfig } = require('../src/services/pricingFormulas/validateConfig');

const GROUPS = [
  {
    key: 'power_supply',
    choices: [
      { key: '100w', extra: { wattageCapacity: 100 } },
      { key: '150w', extra: { wattageCapacity: 150 } },
    ],
  },
  { key: 'controller', choices: [{ key: 'none', extra: null }] },
];

const CUSTOM = {
  formulaType: 'custom',
  params: { constants: { setupFee: 15 }, minSizeInches: 12 },
  formula: { price: 'setupFee + ceil(sizeInches / 12) * 25', watts: 'ceil(sizeInches / 12) * 4' },
};

describe('validatePricingConfig — legacy registry types', () => {
  it('accepts null (a plain, non-configurable product)', () => {
    expect(() => validatePricingConfig(null)).not.toThrow();
    expect(() => validatePricingConfig(undefined)).not.toThrow();
  });

  it('accepts a well-formed flat config', () => {
    expect(() => validatePricingConfig({ formulaType: 'flat', params: { basePrice: 250 } })).not.toThrow();
  });

  it('accepts a well-formed linear_per_unit config', () => {
    const config = {
      formulaType: 'linear_per_unit',
      params: { basePrice: 35, unitSizeInches: 12, pricePerExtraUnit: 25, wattsPerUnit: 4 },
    };
    expect(() => validatePricingConfig(config)).not.toThrow();
  });

  // The gap this validator was written to close.
  it('rejects unitSizeInches of 0, which would divide by zero', () => {
    const config = {
      formulaType: 'linear_per_unit',
      params: { basePrice: 35, unitSizeInches: 0, pricePerExtraUnit: 25, wattsPerUnit: 4 },
    };
    expect(() => validatePricingConfig(config)).toThrow(/greater than 0/);
  });

  it('rejects a missing or non-numeric param', () => {
    expect(() => validatePricingConfig({ formulaType: 'flat', params: {} })).toThrow(/must be a number/);
    expect(() => validatePricingConfig({ formulaType: 'flat', params: { basePrice: 'abc' } })).toThrow(
      /must be a number/
    );
  });

  it('rejects an unknown formulaType', () => {
    expect(() => validatePricingConfig({ formulaType: 'made_up', params: {} })).toThrow(/Unknown pricing formulaType/);
  });

  it('rejects a non-object config', () => {
    expect(() => validatePricingConfig('nope')).toThrow(/must be an object/);
    expect(() => validatePricingConfig([])).toThrow(/must be an object/);
  });
});

describe('validatePricingConfig — custom formulas', () => {
  it('accepts a valid custom formula', () => {
    expect(() => validatePricingConfig(CUSTOM, GROUPS)).not.toThrow();
  });

  it('accepts a formula referencing a group key and a choice attribute', () => {
    const config = {
      ...CUSTOM,
      formula: { price: 'power_supply + power_supply_wattageCapacity * 0.5 + controller' },
    };
    expect(() => validatePricingConfig(config, GROUPS)).not.toThrow();
  });

  it('rejects a syntax error', () => {
    expect(() => validatePricingConfig({ ...CUSTOM, formula: { price: '2 + * 3' } }, GROUPS)).toThrow(
      /Price formula:/
    );
  });

  it('rejects an unknown variable', () => {
    expect(() => validatePricingConfig({ ...CUSTOM, formula: { price: 'mystery + 1' } }, GROUPS)).toThrow(
      /Unknown variable: mystery/
    );
  });

  it('rejects a bad watts formula', () => {
    const config = { ...CUSTOM, formula: { price: 'sizeInches', watts: 'nonsense * 2' } };
    expect(() => validatePricingConfig(config, GROUPS)).toThrow(/Watts formula:/);
  });

  it('requires a price expression', () => {
    expect(() => validatePricingConfig({ ...CUSTOM, formula: {} }, GROUPS)).toThrow(/non-empty string/);
    expect(() => validatePricingConfig({ ...CUSTOM, formula: undefined }, GROUPS)).toThrow(/requires a formula.price/);
  });

  it('allows watts to be omitted', () => {
    const config = { ...CUSTOM, formula: { price: 'sizeInches * 2' } };
    expect(() => validatePricingConfig(config, GROUPS)).not.toThrow();
  });

  it('rejects a non-numeric constant', () => {
    const config = { ...CUSTOM, params: { constants: { setupFee: 'free' } } };
    expect(() => validatePricingConfig(config, GROUPS)).toThrow(/Constant "setupFee" must be a number/);
  });

  it('rejects a constant or group key that shadows a built-in', () => {
    const shadowConst = { ...CUSTOM, params: { constants: { sizeInches: 5 } } };
    expect(() => validatePricingConfig(shadowConst, GROUPS)).toThrow(/collides with a built-in/);

    const shadowGroup = [{ key: 'optionsTotal', choices: [] }];
    expect(() => validatePricingConfig({ ...CUSTOM, formula: { price: '1' } }, shadowGroup)).toThrow(
      /collides with a built-in/
    );
  });

  it('rejects minSizeInches of 0', () => {
    const config = { ...CUSTOM, params: { ...CUSTOM.params, minSizeInches: 0 } };
    expect(() => validatePricingConfig(config, GROUPS)).toThrow(/minSizeInches/);
  });

  // A brand-new product saves its groups after the product row exists, so
  // group-derived names cannot be checked on that first save.
  it('defers group-name checks when no groups are persisted yet', () => {
    const config = { ...CUSTOM, formula: { price: 'sizeInches + 1' } };
    expect(() => validatePricingConfig(config, [])).not.toThrow();
  });
});

describe('validatePricingConfig — auto-quantity (phase 2)', () => {
  it('accepts an auto-quantity expression using watts', () => {
    const config = {
      ...CUSTOM,
      params: { ...CUSTOM.params, autoQuantity: { power_supply: 'ceil(watts / power_supply_wattageCapacity)' } },
    };
    expect(() => validatePricingConfig(config, GROUPS)).not.toThrow();
  });

  it('rejects auto-quantity for an unknown group', () => {
    const config = { ...CUSTOM, params: { ...CUSTOM.params, autoQuantity: { ghost_group: 'ceil(watts / 100)' } } };
    expect(() => validatePricingConfig(config, GROUPS)).toThrow(/unknown option group "ghost_group"/);
  });

  it('rejects watts used in a price formula, where it is not available', () => {
    expect(() => validatePricingConfig({ ...CUSTOM, formula: { price: 'watts * 2' } }, GROUPS)).toThrow(
      /Unknown variable: watts/
    );
  });
});
