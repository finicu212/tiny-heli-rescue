import { describe, it, expect } from 'vitest';
import { Engine } from '../engine.js';
import { HELI } from '../params.js';

describe('Engine', () => {
  it('produces no power below N1 zero-power point', () => {
    const e = new Engine();
    e.n1 = HELI.engine.n1Zero - 0.01;
    expect(e.power()).toBe(0);
  });
  it('governor raises N1 when N2 droops', () => {
    const e = new Engine();
    e.n1 = 0.8;
    e.omegaE = HELI.mainRotor.omegaNom * 0.95;
    const before = e.n1;
    for (let i = 0; i < 100; i++) e.updateN1(0.01, 0.4);
    expect(e.n1).toBeGreaterThan(before);
  });
  it('N1 acceleration is rate-limited', () => {
    const e = new Engine();
    e.n1 = 0.65;
    e.omegaE = HELI.mainRotor.omegaNom * 0.8;
    e.updateN1(0.1, 1);
    expect(e.n1 - 0.65).toBeLessThanOrEqual(HELI.engine.accelLimit * 0.1 + 1e-9);
  });
  it('spools down when shut off and relights to idle on the starter', () => {
    const e = new Engine();
    e.running = false;
    for (let i = 0; i < 1000; i++) e.updateN1(0.01, 0);
    expect(e.n1).toBe(0);
    e.running = true;
    for (let i = 0; i < 1000; i++) e.updateN1(0.01, 0);
    expect(e.n1).toBeGreaterThanOrEqual(HELI.engine.n1Idle - 0.011);
  });
  it('torque rises as power-turbine speed droops (free-turbine characteristic)', () => {
    const e = new Engine();
    e.n1 = 0.9;
    e.omegaE = HELI.mainRotor.omegaNom;
    const nom = e.torque();
    e.omegaE *= 0.9;
    expect(e.torque()).toBeGreaterThan(nom);
  });
});
