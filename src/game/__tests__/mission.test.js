import { describe, it, expect } from 'vitest';
import { Mission, gradeTouchdown, scoreLanding, HOLD_S } from '../mission.js';
import { World } from '../../world/world.js';
import { Heli } from '../../sim/heli.js';

describe('grading', () => {
  it('grades touchdowns by sink rate', () => {
    expect(gradeTouchdown(0.2).label).toBe('BUTTER');
    expect(gradeTouchdown(0.6).label).toBe('SMOOTH');
    expect(gradeTouchdown(1.2).label).toBe('FIRM');
    expect(gradeTouchdown(3).label).toBe('HARD');
  });
  it('rewards centring, speed and streaks', () => {
    const base = { distance: 1000, elapsed: 30, sink: 0.5, offset: 0, radius: 6, streak: 0 };
    const off = scoreLanding({ ...base, offset: 5 });
    const slow = scoreLanding({ ...base, elapsed: 300 });
    const streak = scoreLanding({ ...base, streak: 3 });
    const ref = scoreLanding(base);
    expect(off.total).toBeLessThan(ref.total);
    expect(slow.total).toBeLessThan(ref.total);
    expect(streak.total).toBeGreaterThan(ref.total);
  });
});

describe('Mission', () => {
  const world = new World(4242);
  it('picks a target at least 300 m away', () => {
    const m = new Mission(world, 1);
    const from = world.pads[0];
    for (let i = 0; i < 20; i++) {
      m.next(from);
      expect(m.target).not.toBe(from);
      expect(Math.hypot(m.target.x - from.x, m.target.y - from.y)).toBeGreaterThan(300);
    }
  });
  it('scores after settling on the target for the hold time', () => {
    const m = new Mission(world, 1);
    m.next(world.pads[0]);
    const t = m.target;
    const h = new Heli(world);
    h.reset(t.x, t.y, t.z, 0);
    for (let i = 0; i < 400; i++) h.step(0.0025);    // settle on skids
    const dt = 1 / 60;
    for (let k = 0; k < Math.ceil(HOLD_S / dt) + 2; k++) m.update(dt, h);
    expect(m.deliveries).toBe(1);
    expect(m.score).toBeGreaterThan(0);
    expect(m.streak).toBe(1);
    expect(m.target).not.toBe(t);
  });
  it('does not score off-pad and resets streak on crash', () => {
    const m = new Mission(world, 1);
    m.next(world.pads[0]);
    m.streak = 3;
    const h = new Heli(world);
    const t = m.target;
    h.reset(t.x + 60, t.y, world.surfaceZ(t.x + 60, t.y), 0);
    for (let k = 0; k < 200; k++) m.update(1 / 60, h);
    expect(m.deliveries).toBe(0);
    m.onCrash();
    expect(m.streak).toBe(0);
  });
});
