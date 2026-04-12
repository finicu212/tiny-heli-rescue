import { describe, it, expect } from 'vitest';
import { framedAltitude, speedZoom } from '../game.js';

describe('camera framing', () => {
  it('frames true altitude up to 35 m', () => {
    expect(framedAltitude(20)).toBe(20);
    expect(framedAltitude(35)).toBe(35);
  });
  it('soft-limits logarithmically above 35 m, continuous and monotonic', () => {
    expect(framedAltitude(35.001)).toBeCloseTo(35, 2);
    expect(framedAltitude(300)).toBeGreaterThan(framedAltitude(150));
    expect(framedAltitude(300)).toBeLessThan(95);
    expect(framedAltitude(1000)).toBeLessThan(120);
  });
  it('zooms out only slightly with speed', () => {
    expect(speedZoom(0)).toBe(1);
    expect(speedZoom(50)).toBeGreaterThan(0.85);
    expect(speedZoom(50)).toBeLessThan(speedZoom(20));
  });
});
