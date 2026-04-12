import { describe, it, expect } from 'vitest';
import { framedAltitude, speedZoom } from '../game.js';

describe('camera framing', () => {
  it('frames true altitude up to 75 m', () => {
    expect(framedAltitude(40)).toBe(40);
    expect(framedAltitude(75)).toBe(75);
  });
  it('soft-limits logarithmically above 75 m, continuous and monotonic', () => {
    expect(framedAltitude(75.001)).toBeCloseTo(75, 2);
    expect(framedAltitude(300)).toBeGreaterThan(framedAltitude(150));
    expect(framedAltitude(300)).toBeLessThan(170);
    expect(framedAltitude(1000)).toBeLessThan(230);
  });
  it('zooms out only slightly with speed', () => {
    expect(speedZoom(0)).toBe(1);
    expect(speedZoom(50)).toBeGreaterThan(0.85);
    expect(speedZoom(50)).toBeLessThan(speedZoom(20));
  });
});
