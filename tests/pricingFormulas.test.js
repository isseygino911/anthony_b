// Pure math — no DB involved. Covers the base-price formula agreed with the
// user: $35 covers the first 12", each additional 12" (rounded up) adds $25,
// and wattage is 4W per 12" (informational — used for power-supply gating
// elsewhere, not priced here).
import { describe, it, expect } from 'vitest';

const { computeBase } = require('../src/services/pricingFormulas');

const LIGHTING_PARAMS = { basePrice: 35, unitSizeInches: 12, pricePerExtraUnit: 25, wattsPerUnit: 4 };

describe('pricingFormulas.linear_per_unit', () => {
  it('charges exactly basePrice at the minimum size', () => {
    const result = computeBase('linear_per_unit', LIGHTING_PARAMS, { sizeInches: 12 });
    expect(result).toEqual({ units: 1, basePrice: 35, totalWatts: 4 });
  });

  it('rounds a partial extra unit up to a full additional charge', () => {
    // 13" -> 2 units (ceil(13/12)) -> $35 + 1*$25 = $60
    const result = computeBase('linear_per_unit', LIGHTING_PARAMS, { sizeInches: 13 });
    expect(result).toEqual({ units: 2, basePrice: 60, totalWatts: 8 });
  });

  it('computes multiple whole units correctly (24")', () => {
    const result = computeBase('linear_per_unit', LIGHTING_PARAMS, { sizeInches: 24 });
    expect(result).toEqual({ units: 2, basePrice: 60, totalWatts: 8 });
  });

  it('computes a larger size (100") matching the worked example', () => {
    // 100" -> ceil(100/12) = 9 units -> $35 + 8*$25 = $235; watts = 9*4 = 36
    const result = computeBase('linear_per_unit', LIGHTING_PARAMS, { sizeInches: 100 });
    expect(result).toEqual({ units: 9, basePrice: 235, totalWatts: 36 });
  });

  it('rejects a size below the 12" minimum', () => {
    expect(() => computeBase('linear_per_unit', LIGHTING_PARAMS, { sizeInches: 6 })).toThrow(/at least 12/);
  });

  it('rejects a zero or negative size', () => {
    expect(() => computeBase('linear_per_unit', LIGHTING_PARAMS, { sizeInches: 0 })).toThrow();
    expect(() => computeBase('linear_per_unit', LIGHTING_PARAMS, { sizeInches: -5 })).toThrow();
  });

  it('throws for an unknown formula_type', () => {
    expect(() => computeBase('made_up_formula', LIGHTING_PARAMS, { sizeInches: 12 })).toThrow(
      /Unknown pricing formula_type/
    );
  });
});

describe('pricingFormulas.flat', () => {
  it('always returns basePrice regardless of input', () => {
    const result = computeBase('flat', { basePrice: 250 }, {});
    expect(result).toEqual({ units: 1, basePrice: 250, totalWatts: 0 });
  });
});
