// neonPromptTemplate.service.js — the colour wording that reaches Gemini.
// Two things matter here: the 10 preset labels are hand-tuned and must not
// drift, and a customer-picked "custom:#rrggbb" must be translated into a
// colour *phrase* before it reaches the prompt. A bare hex would be rendered
// as literal text on the sign rather than as the tube colour, which is what
// the instruction's "no text outside the sign itself" clause exists to stop.
// Pure functions — no DB, no Gemini call, no mocking needed.
import { describe, it, expect } from 'vitest';

const { describeColor, describeHex, buildInstruction } = require('../src/services/neonPromptTemplate.service');

// The preset labels are what reaches Gemini for the 10 built-in colours. They
// are hand-tuned wording ("electric blue" renders as neon, "blue" renders as
// paint), so lock them down — the custom-colour work must not perturb them.
describe('describeColor — presets', () => {
  const PRESETS = {
    amber: 'warm amber/gold',
    pink: 'hot pink/magenta',
    blue: 'electric blue',
    white: 'cool white',
    red: 'deep ruby red',
    green: 'vivid emerald green',
    purple: 'rich violet/purple',
    orange: 'bright tangerine orange',
    'ice-blue': 'pale icy blue',
    'warm-white': 'soft warm white',
  };

  for (const [value, label] of Object.entries(PRESETS)) {
    it(`maps ${value} to its existing label`, () => {
      expect(describeColor(value)).toBe(label);
    });
  }

  it('falls back to warm amber/gold for null/undefined', () => {
    expect(describeColor(null)).toBe('warm amber/gold');
    expect(describeColor(undefined)).toBe('warm amber/gold');
  });

  it('degrades to the raw value for an unknown preset rather than throwing', () => {
    expect(describeColor('chartreuse')).toBe('chartreuse');
  });
});

describe('describeColor — custom hex values', () => {
  // The whole point of describeHex: an image model renders "#ff2d95" as literal
  // text on the sign instead of colouring the tubing.
  it('never leaks the hex or the custom: token into the prompt wording', () => {
    const samples = [
      '#ff2d95', '#38bdf8', '#22c55e', '#000000', '#ffffff',
      '#808080', '#00ffcc', '#8b0000', '#fff8e7', '#7f00ff',
    ];
    for (const hex of samples) {
      const described = describeColor(`custom:${hex}`);
      expect(described).toBeTruthy();
      expect(described).not.toContain('#');
      expect(described).not.toContain('custom');
    }
  });

  it('names representative hues', () => {
    expect(describeColor('custom:#ff2d95')).toContain('pink');
    expect(describeColor('custom:#38bdf8')).toContain('blue');
    expect(describeColor('custom:#22c55e')).toContain('green');
    expect(describeColor('custom:#00ffcc')).toMatch(/teal|green/);
    expect(describeColor('custom:#7f00ff')).toMatch(/violet|purple|indigo/);
  });

  it('treats desaturated and very light values as whites, not hues', () => {
    expect(describeHex('ffffff')).toBe('cool white');
    // 100% saturated by the maths, but plainly an off-white to the eye.
    expect(describeHex('fff8e7')).toBe('soft warm white');
    expect(describeHex('808080')).toContain('grey');
  });

  it('qualifies very dark values as deep rather than dropping the hue', () => {
    expect(describeHex('8b0000')).toBe('deep red');
  });

  it('produces wording close to the preset label for the preset swatch hexes', () => {
    // The amber preset swatch is #f5b400; a customer picking it by hand should
    // generate essentially the same sign as picking the preset.
    expect(describeHex('f5b400')).toContain('amber');
  });
});

describe('buildInstruction', () => {
  it('embeds the named colour phrase and no raw hex', () => {
    const instruction = buildInstruction({
      designType: 'text',
      size: 'medium',
      neonColor: 'custom:#00ffcc',
    });
    expect(instruction).toContain(`using ${describeColor('custom:#00ffcc')} neon tubing`);
    expect(instruction).not.toContain('#00ffcc');
    expect(instruction).not.toContain('custom:');
  });

  it('still embeds preset labels unchanged', () => {
    const instruction = buildInstruction({ designType: 'upload', size: 'large', neonColor: 'blue' });
    expect(instruction).toContain('using electric blue neon tubing');
  });
});
