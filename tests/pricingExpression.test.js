// Pure math — no DB involved. Covers the safe expression parser/evaluator that
// backs admin-authored pricing formulas. The equivalence block at the bottom is
// load-bearing: it proves a converted formula reproduces linear_per_unit exactly,
// which is what makes the admin "Convert to custom formula" button safe to use
// on a live product.
import { describe, it, expect } from 'vitest';

const { tokenize, evaluate, validate, MAX_LENGTH } = require('../src/services/pricingFormulas/expression');

describe('expression.tokenize', () => {
  it('handles decimals and multi-character identifiers', () => {
    const tokens = tokenize('1.5 * sizeInches');
    expect(tokens.map((t) => t.type)).toEqual(['number', 'op', 'ident']);
    expect(tokens[0].value).toBe(1.5);
    expect(tokens[2].value).toBe('sizeInches');
  });

  it('tokenizes without whitespace', () => {
    expect(tokenize('2*(3+4)').map((t) => t.value)).toEqual([2, '*', '(', 3, '+', 4, ')']);
  });

  it('rejects characters outside the arithmetic grammar', () => {
    expect(() => tokenize('2 @ 3')).toThrow(/Unexpected character "@"/);
    expect(() => tokenize('2 ^ 3')).toThrow(/Unexpected character "\^"/);
    expect(() => tokenize('a = 3')).toThrow(/Unexpected character "="/);
  });

  it('rejects a malformed number', () => {
    expect(() => tokenize('1.2.3')).toThrow(/Invalid number/);
  });

  it('rejects input beyond the length cap', () => {
    expect(() => tokenize('1+'.repeat(MAX_LENGTH))).toThrow(/too long/);
  });
});

describe('expression.evaluate — precedence and associativity', () => {
  it('gives * higher precedence than +', () => {
    expect(evaluate('2 + 3 * 4')).toBe(14);
  });

  it('honours parentheses', () => {
    expect(evaluate('(2 + 3) * 4')).toBe(20);
  });

  it('evaluates - and / left-associatively', () => {
    expect(evaluate('10 - 3 - 2')).toBe(5);
    expect(evaluate('100 / 5 / 2')).toBe(10);
  });

  it('binds unary minus tighter than *', () => {
    expect(evaluate('-2 * 3')).toBe(-6);
  });

  it('handles a negative right operand', () => {
    expect(evaluate('2 - -3')).toBe(5);
  });

  it('handles nested parentheses', () => {
    expect(evaluate('((2 + 3) * (4 - 1)) / 5')).toBe(3);
  });

  it('resolves variables from scope', () => {
    expect(evaluate('basePrice + sizeInches * 2', { basePrice: 35, sizeInches: 10 })).toBe(55);
  });
});

describe('expression.evaluate — functions', () => {
  it('rounds up with ceil', () => {
    expect(evaluate('ceil(13 / 12)')).toBe(2);
    expect(evaluate('ceil(24 / 12)')).toBe(2);
  });

  it('supports floor, round and abs', () => {
    expect(evaluate('floor(2.9)')).toBe(2);
    expect(evaluate('round(2.5)')).toBe(3);
    expect(evaluate('abs(0 - 7)')).toBe(7);
  });

  it('supports variadic min and max', () => {
    expect(evaluate('min(3, 5, 1)')).toBe(1);
    expect(evaluate('max(3, 5, 1)')).toBe(5);
  });

  it('rejects wrong arity', () => {
    expect(() => evaluate('ceil(1, 2)')).toThrow(/takes 1 argument/);
    expect(() => evaluate('min()')).toThrow(/at least 1 argument/);
  });

  it('rejects an unknown function', () => {
    expect(() => evaluate('sqrt(4)')).toThrow(/Unknown function "sqrt"/);
  });
});

describe('expression.evaluate — errors', () => {
  it('rejects unbalanced parentheses in both directions', () => {
    expect(() => evaluate('(2 + 3')).toThrow(/Expected "\)"/);
    expect(() => evaluate('2 + 3)')).toThrow(/Unexpected "\)"/);
  });

  it('rejects a trailing or doubled operator', () => {
    expect(() => evaluate('2 +')).toThrow(/ended unexpectedly/);
    expect(() => evaluate('2 + * 3')).toThrow(/Unexpected "\*"/);
  });

  it('rejects an empty formula', () => {
    expect(() => evaluate('')).toThrow(/empty/);
    expect(() => evaluate('   ')).toThrow(/empty/);
  });

  // The most important case: Infinity must never reach a price.
  it('throws on division by zero rather than returning Infinity', () => {
    expect(() => evaluate('10 / 0')).toThrow(/division by zero/);
    expect(() => evaluate('10 / capacity', { capacity: 0 })).toThrow(/division by zero/);
  });

  it('rejects an unknown variable', () => {
    expect(() => evaluate('mystery + 1', { basePrice: 10 })).toThrow(/Unknown variable "mystery"/);
  });

  it('rejects a non-numeric variable value', () => {
    expect(() => evaluate('a + 1', { a: 'abc' })).toThrow(/is not a number/);
  });
});

describe('expression.validate', () => {
  it('accepts a formula whose variables are all allowed', () => {
    expect(validate('basePrice + sizeInches', ['basePrice', 'sizeInches'])).toEqual({
      ok: true,
      ast: expect.anything(),
    });
  });

  it('reports unknown variables without throwing', () => {
    const result = validate('basePrice + mystery', ['basePrice']);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Unknown variable: mystery/);
  });

  it('reports a syntax error without throwing', () => {
    const result = validate('2 + * 3', []);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Unexpected/);
  });

  it('does not treat function names as variables', () => {
    expect(validate('ceil(sizeInches / 12)', ['sizeInches']).ok).toBe(true);
  });
});

// Proves the Convert-to-custom-formula button is safe: these expressions must
// produce the exact numbers asserted in pricingFormulas.test.js for the same
// sizes. If this block ever fails, converting a live product would silently
// change what customers are charged.
describe('equivalence with linear_per_unit', () => {
  const PRICE = 'basePrice + max(0, ceil(sizeInches / unitSizeInches) - 1) * pricePerExtraUnit';
  const WATTS = 'ceil(sizeInches / unitSizeInches) * wattsPerUnit';
  const PARAMS = { basePrice: 35, unitSizeInches: 12, pricePerExtraUnit: 25, wattsPerUnit: 4 };

  it.each([
    [12, 35, 4],
    [13, 60, 8],
    [24, 60, 8],
    [100, 235, 36],
  ])('size %i" -> $%i, %iW', (sizeInches, expectedPrice, expectedWatts) => {
    const scope = { ...PARAMS, sizeInches };
    expect(evaluate(PRICE, scope)).toBe(expectedPrice);
    expect(evaluate(WATTS, scope)).toBe(expectedWatts);
  });
});
