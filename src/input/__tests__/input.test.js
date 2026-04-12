import { describe, it, expect } from 'vitest';
import { approach, expo } from '../input.js';

describe('input shaping', () => {
  it('approach moves at a bounded rate and lands exactly on target', () => {
    expect(approach(0, 1, 2, 0.1)).toBeCloseTo(0.2, 9);
    expect(approach(0.95, 1, 2, 0.1)).toBe(1);
    expect(approach(0, -1, 2, 0.1)).toBeCloseTo(-0.2, 9);
  });
  it('expo keeps sign, endpoints and softens the centre', () => {
    expect(expo(1)).toBe(1);
    expect(expo(-1)).toBe(-1);
    expect(Math.abs(expo(0.3))).toBeLessThan(0.3);
    expect(expo(-0.3)).toBeLessThan(0);
  });
});
