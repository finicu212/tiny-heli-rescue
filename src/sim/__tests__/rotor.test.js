import { describe, it, expect } from 'vitest';
import {
  axialInflowRatio, glauertInflow, vrsIndex, groundEffectFactor,
  inflowTarget, stallCap, thrustCoeff,
} from '../rotor.js';

describe('axial inflow', () => {
  it('equals vh in hover', () => {
    expect(axialInflowRatio(0)).toBeCloseTo(1, 6);
  });
  it('is continuous between the empirical fit and windmill branch at x = -2', () => {
    expect(Math.abs(axialInflowRatio(-2.0001) - axialInflowRatio(-1.9999))).toBeLessThan(0.05);
  });
  it('rises above hover inflow through the vortex-ring region', () => {
    expect(axialInflowRatio(-0.9)).toBeGreaterThan(1.4);
  });
  it('reaches ideal autorotation (Vc + vi ≈ 0) near x = -1.75', () => {
    expect(Math.abs(-1.75 + axialInflowRatio(-1.75))).toBeLessThan(0.1);
  });
  it('matches momentum theory in climb', () => {
    const x = 1.5;
    expect(axialInflowRatio(x)).toBeCloseTo(-x / 2 + Math.sqrt(x * x / 4 + 1), 9);
  });
});

describe('glauert', () => {
  it('reduces induced velocity with forward speed (translational lift)', () => {
    const vh = 7.7;
    const hover = glauertInflow(vh, 0, 0, vh);
    const fwd = glauertInflow(vh, 0, 20, vh);
    expect(hover).toBeCloseTo(vh, 1);
    expect(fwd).toBeLessThan(hover * 0.5);
  });
});

describe('vrsIndex', () => {
  it('is zero in hover and climb', () => {
    expect(vrsIndex(7.7, 0, 0)).toBe(0);
    expect(vrsIndex(7.7, 3, 0)).toBe(0);
  });
  it('peaks in slow vertical descent', () => {
    expect(vrsIndex(7.7, -7, 0)).toBeGreaterThan(0.9);
  });
  it('vanishes with forward speed', () => {
    expect(vrsIndex(7.7, -7, 12)).toBeLessThan(0.05);
  });
  it('vanishes in fast descent (windmill brake)', () => {
    expect(vrsIndex(7.7, -15, 0)).toBe(0);
  });
});

describe('ground effect', () => {
  it('cuts induced velocity close to the ground', () => {
    expect(groundEffectFactor(5, 2.9, 0, 7.7)).toBeLessThan(0.85);
  });
  it('is negligible above one diameter', () => {
    expect(groundEffectFactor(5, 12, 0, 7.7)).toBeGreaterThan(0.98);
  });
  it('fades with forward speed', () => {
    expect(groundEffectFactor(5, 2.9, 15, 7.7)).toBeGreaterThan(0.95);
  });
});

describe('inflowTarget', () => {
  it('is antisymmetric in thrust', () => {
    const a = inflowTarget(600, 0, 0, 1.225, 2, 0, 1);
    const b = inflowTarget(-600, 0, 0, 1.225, 2, 0, 1);
    expect(a).toBeCloseTo(-b, 9);
  });
  it('returns finite values across the descent envelope', () => {
    for (let vc = -30; vc <= 10; vc += 0.5) {
      for (let vip = 0; vip <= 30; vip += 2.5) {
        expect(Number.isFinite(inflowTarget(12000, vc, vip, 1.225, 81, 7, 1))).toBe(true);
      }
    }
  });
});

describe('blade element', () => {
  it('stall cap saturates below the limit and passes low loading unchanged', () => {
    expect(stallCap(0.05, 0.13, 0)).toBe(0.05);
    expect(stallCap(0.5, 0.13, 0)).toBeLessThan(0.13);
    expect(stallCap(-0.5, 0.13, 0)).toBeGreaterThan(-0.13);
  });
  it('thrust falls as inflow rises', () => {
    expect(thrustCoeff(0.12, 0.02, 0, 0.04, 5.7)).toBeGreaterThan(thrustCoeff(0.12, 0.05, 0, 0.04, 5.7));
  });
});
