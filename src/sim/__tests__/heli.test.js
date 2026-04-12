import { describe, it, expect } from 'vitest';
import { Heli, SURF } from '../heli.js';
import { HELI } from '../params.js';
import { makePilot, pilot, airborne } from './pilot.js';

const DT = 0.0025;

function fly(secs, cmd, setup) {
  const h = new Heli();
  h.reset(0, 0, 0, 0);
  airborne(h);
  if (setup) setup(h);
  const st = makePilot();
  for (let i = 0; i < secs / DT; i++) {
    pilot(h, st, DT, typeof cmd === 'function' ? cmd(i * DT) : cmd);
    h.step(DT);
  }
  return h;
}

describe('hover trim', () => {
  const h = fly(25, {});
  it('holds altitude with mid collective', () => {
    expect(Math.abs(h.vel[2])).toBeLessThan(0.1);
    expect(h.controls.collective).toBeGreaterThan(0.3);
    expect(h.controls.collective).toBeLessThan(0.55);
  });
  it('needs 60–92 % torque (light single, sea level, OGE)', () => {
    expect(h.t.torquePct).toBeGreaterThan(0.6);
    expect(h.t.torquePct).toBeLessThan(0.92);
  });
  it('induced velocity equals momentum-theory vh', () => {
    expect(h.t.vi / h.t.vh).toBeGreaterThan(0.95);
    expect(h.t.vi / h.t.vh).toBeLessThan(1.05);
  });
  it('needs left pedal to cancel main-rotor torque', () => {
    expect(h.controls.pedal).toBeLessThan(-0.05);
    expect(h.t.trThrust).toBeGreaterThan(400);
  });
  it('governor holds rotor RPM', () => {
    expect(Math.abs(h.t.nr - 1)).toBeLessThan(0.01);
  });
  it('hovers left-skid-low (tail rotor drift)', () => {
    // roll right-positive: R[7] = body-y (left) world z component
    expect(h.R[7]).toBeLessThan(0.0);
  });
});

describe('anti-torque', () => {
  it('yaws nose-right without pedal when collective is raised', () => {
    const h = new Heli();
    h.reset(0, 0, 0, 0);
    airborne(h);
    h.sas = false;
    for (let i = 0; i < 2 / DT; i++) {
      h.controls.collective = 0.45;
      h.controls.pedal = 0;
      h.step(DT);
    }
    expect(h.w[2]).toBeLessThan(-0.05);
  });
  it('collective pull produces a torque (yaw) transient', () => {
    const st = makePilot();
    const h = new Heli();
    h.reset(0, 0, 0, 0);
    airborne(h);
    for (let i = 0; i < 10 / DT; i++) { pilot(h, st, DT, {}); h.step(DT); }
    const q0 = h.t.qShaft;
    for (let i = 0; i < 0.5 / DT; i++) { pilot(h, st, DT, { collective: 0.7 }); h.step(DT); }
    expect(h.t.qShaft).toBeGreaterThan(q0 * 1.2);
  });
});

describe('forward flight', () => {
  it('needs less power at 30 m/s than in hover (power bucket)', () => {
    const hov = fly(20, {});
    const fwd = fly(45, { vx: 30 });
    expect(fwd.vel[0]).toBeGreaterThan(22);
    expect(fwd.t.powerKw).toBeLessThan(hov.t.powerKw);
  });
});

describe('vortex ring state', () => {
  it('develops in slow vertical descent', () => {
    const h = fly(20, { vz: -6 });
    expect(h.t.vrs).toBeGreaterThan(0.6);
    expect(h.t.vi).toBeGreaterThan(h.t.vh * 1.3);
  });
  it('is absent in descent with forward speed', () => {
    const h = fly(30, { vx: 15, vz: -6 });
    expect(h.t.vrs).toBeLessThan(0.1);
  });
  it('raises power required above a normal descent', () => {
    const vrs = fly(20, { vz: -6 });
    const fwd = fly(30, { vx: 15, vz: -6 });
    expect(vrs.t.powerKw).toBeGreaterThan(fwd.t.powerKw);
  });
});

describe('autorotation', () => {
  const run = (coll) => fly(40, { collective: coll }, (h) => { h.engine.running = false; h.pos[2] = 3000; });
  it('sprag clutch decouples the dead engine', () => {
    const h = run(0.05);
    expect(h.t.engaged).toBe(false);
    expect(h.t.n2).toBeLessThan(0.5);
  });
  it('full-down collective sustains ≥ 100 % rotor RPM', () => {
    expect(run(0).t.nr).toBeGreaterThan(1.0);
  });
  it('raising collective lowers autorotative RPM', () => {
    expect(run(0.2).t.nr).toBeLessThan(run(0.05).t.nr);
  });
  it('settles at a steady descent rate', () => {
    const h = run(0.05);
    expect(h.vel[2]).toBeLessThan(-8);
    expect(h.vel[2]).toBeGreaterThan(-22);
  });
});

describe('ground', () => {
  it('rests stably on skids at flat pitch', () => {
    const h = new Heli();
    h.reset(0, 0, 0, 0);
    for (let i = 0; i < 10 / DT; i++) h.step(DT);
    expect(h.crashed).toBe(false);
    expect(h.contacts).toBe(4);
    expect(Math.hypot(...h.vel)).toBeLessThan(0.05);
  });
  it('gains thrust in ground effect at fixed collective', () => {
    const measure = (z) => {
      const h = new Heli();
      h.reset(0, 0, 0, 0);
      airborne(h, z);
      for (let i = 0; i < 1 / DT; i++) { h.controls.collective = 0.38; h.pos[2] = z; h.vel.fill(0); h.step(DT); }
      return h.t.thrust;
    };
    expect(measure(2)).toBeGreaterThan(measure(60) * 1.08);
  });
  it('crashes on hard vertical impact', () => {
    const h = new Heli();
    h.reset(0, 0, 0, 0);
    airborne(h, 3);
    h.vel[2] = -8;
    for (let i = 0; i < 1 / DT; i++) h.step(DT);
    expect(h.crashed).toBe(true);
    expect(h.crashReason).toBe('HARD LANDING');
  });
  it('survives a firm but normal touchdown', () => {
    const h = new Heli();
    h.reset(0, 0, 0, 0);
    airborne(h, 1.4);
    h.vel[2] = -1.5;
    for (let i = 0; i < 2 / DT; i++) { h.controls.collective = 0.3; h.step(DT); }
    expect(h.crashed).toBe(false);
    expect(h.impactEvent).toBeGreaterThan(1);
  });
  it('ditches on water', () => {
    const env = {
      surfaceZ: () => 0, surfaceKind: () => SURF.WATER,
      normal: (x, y, o) => { o[0] = 0; o[1] = 0; o[2] = 1; },
      wind: (x, y, z, t, o) => { o[0] = 0; o[1] = 0; o[2] = 0; },
    };
    const h = new Heli(env);
    h.reset(0, 0, 0, 0);
    h.step(DT);
    expect(h.crashReason).toBe('DITCHED');
  });
  it('rotor strike when the disc hits terrain', () => {
    const env = {
      surfaceZ: (x) => (x > 3 ? 10 : 0), surfaceKind: () => SURF.GROUND,
      normal: (x, y, o) => { o[0] = 0; o[1] = 0; o[2] = 1; },
      wind: (x, y, z, t, o) => { o[0] = 0; o[1] = 0; o[2] = 0; },
    };
    const h = new Heli(env);
    h.reset(0, 0, 0, 0);
    h.step(DT);
    expect(h.crashReason).toBe('ROTOR STRIKE');
  });
});

describe('finite-state guard', () => {
  it('recovers from NaN state injection', () => {
    const h = fly(2, {});
    h.vel[0] = NaN;
    h.step(DT);
    expect(Number.isFinite(h.vel[0])).toBe(true);
    expect(h.t.nanRecoveries).toBe(1);
  });
});

describe('wind', () => {
  it('headwind hover shows airspeed without ground speed', () => {
    const env = {
      surfaceZ: () => 0, surfaceKind: () => SURF.GROUND,
      normal: (x, y, o) => { o[0] = 0; o[1] = 0; o[2] = 1; },
      wind: (x, y, z, t, o) => { o[0] = -10; o[1] = 0; o[2] = 0; },
    };
    const h = new Heli(env);
    h.reset(0, 0, 0, 0);
    airborne(h);
    const st = makePilot();
    for (let i = 0; i < 30 / DT; i++) { pilot(h, st, DT, {}); h.step(DT); }
    expect(Math.hypot(h.vel[0], h.vel[1])).toBeLessThan(3);
    expect(h.t.airspeed).toBeGreaterThan(8);
  });
});

describe('params', () => {
  it('hover blade loading is in a realistic band', () => {
    const h = fly(15, {});
    expect(h.t.cts).toBeGreaterThan(0.05);
    expect(h.t.cts).toBeLessThan(0.09);
    expect(HELI.mainRotor.omegaNom * HELI.mainRotor.R).toBeGreaterThan(190);
  });
});
