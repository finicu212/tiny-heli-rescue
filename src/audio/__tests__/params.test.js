import { describe, it, expect } from 'vitest';
import { audioParams } from '../params.js';
import { Heli } from '../../sim/heli.js';

function heli() {
  const h = new Heli();
  h.reset(0, 0, 0, 0);
  h.step(0.0025);
  return h;
}

describe('audioParams', () => {
  it('blade-passage frequency is Ω·blades/2π (~13 Hz at 100 %)', () => {
    const p = audioParams(heli());
    expect(p.bpf).toBeGreaterThan(12.5);
    expect(p.bpf).toBeLessThan(13.8);
    expect(p.trbpf).toBeGreaterThan(p.bpf * 5);
  });
  it('raises the VRS alarm and slap in vortex ring state', () => {
    const h = heli();
    h.t.vrs = 0.8; h.t.vc = -6; h.t.vh = 7.7;
    const p = audioParams(h);
    expect(p.vrsAlarm).toBe(1);
    expect(p.bvi).toBeGreaterThan(0.8);
  });
  it('sounds the low-rotor horn below 95 % NR', () => {
    const h = heli();
    h.t.nr = 0.9;
    expect(audioParams(h).lowRpm).toBe(1);
    h.t.nr = 1.0;
    expect(audioParams(h).lowRpm).toBe(0);
  });
  it('engine-out warning follows engine state', () => {
    const h = heli();
    h.t.engineOn = false;
    expect(audioParams(h).engineOut).toBe(1);
  });
  it('mutes to zero master', () => {
    expect(audioParams(heli(), 0).master).toBe(0);
  });
  it('outputs only finite numbers', () => {
    for (const v of Object.values(audioParams(heli()))) expect(Number.isFinite(v)).toBe(true);
  });
});
