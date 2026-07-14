// salesForecast.service.linearForecast — pure OLS regression, no I/O, so no
// isolateDb helper needed here (unlike the DB-backed service tests in this
// directory).
import { describe, it, expect } from 'vitest';

const { linearForecast } = require('../src/services/salesForecast.service');

describe('salesForecast.service.linearForecast', () => {
  it('projects a known linear series forward', () => {
    const result = linearForecast([10, 20, 30, 40, 50], 1);

    expect(result.insufficientData).toBe(false);
    expect(result.slope).toBeCloseTo(10);
    expect(result.intercept).toBeCloseTo(10);
    expect(result.r2).toBeCloseTo(1);
    expect(result.projection).toHaveLength(1);
    expect(result.projection[0]).toBeCloseTo(60);
  });

  it('projects multiple steps ahead', () => {
    const result = linearForecast([10, 20, 30, 40, 50], 3);

    expect(result.projection.map((v) => Math.round(v))).toEqual([60, 70, 80]);
  });

  it('projects a flat series as flat', () => {
    const result = linearForecast([5, 5, 5, 5], 2);

    expect(result.slope).toBeCloseTo(0);
    expect(result.intercept).toBeCloseTo(5);
    expect(result.projection[0]).toBeCloseTo(5);
    expect(result.projection[1]).toBeCloseTo(5);
  });

  it('flags insufficient data for fewer than 3 points', () => {
    const result = linearForecast([10, 20], 1);

    expect(result.insufficientData).toBe(true);
    expect(result.projection).toEqual([]);
  });

  it('flags insufficient data for an empty series', () => {
    const result = linearForecast([], 1);

    expect(result.insufficientData).toBe(true);
  });

  it('clamps negative extrapolations to 0', () => {
    const result = linearForecast([30, 20, 10], 3);

    expect(result.slope).toBeCloseTo(-10);
    expect(result.projection.map((v) => Math.round(v))).toEqual([0, 0, 0]);
  });
});
