import { describe, it, expect } from 'vitest';
import { World } from '../world.js';
import { SURF } from '../../sim/heli.js';
import { mulberry32, ValueNoise } from '../noise.js';

const w = new World(4242);

describe('noise', () => {
  it('is deterministic per seed', () => {
    const a = mulberry32(9), b = mulberry32(9);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });
  it('value noise stays in [-1, 1]', () => {
    const n = new ValueNoise(3);
    for (let i = 0; i < 2000; i++) {
      const v = n.fbm(i * 0.37, i * 0.11, 5);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
  });
});

describe('World', () => {
  it('generates the same terrain for the same seed', () => {
    const w2 = new World(4242);
    expect(w2.height(123, -456)).toBe(w.height(123, -456));
    expect(w2.pads.map((p) => p.name)).toEqual(w.pads.map((p) => p.name));
  });
  it('places several towns, each with ground and rooftop pads', () => {
    expect(w.towns.length).toBeGreaterThanOrEqual(5);
    for (const t of w.towns) {
      expect(t.pads.some((p) => p.kind === 'ground')).toBe(true);
    }
    expect(w.pads.some((p) => p.kind === 'roof')).toBe(true);
    expect(w.pads.some((p) => p.kind === 'peak')).toBe(true);
  });
  it('keeps towns well apart', () => {
    for (let i = 0; i < w.towns.length; i++) {
      for (let j = i + 1; j < w.towns.length; j++) {
        expect(Math.hypot(w.towns[i].x - w.towns[j].x, w.towns[i].y - w.towns[j].y)).toBeGreaterThan(600);
      }
    }
  });
  it('ground pads sit on flat, dry ground free of buildings', () => {
    for (const p of w.pads.filter((q) => q.kind !== 'roof')) {
      for (const [dx, dy] of [[0, 0], [5, 0], [0, 5], [-5, -5]]) {
        expect(Math.abs(w.surfaceZ(p.x + dx, p.y + dy) - p.z)).toBeLessThan(0.6);
        expect(w.surfaceKind(p.x + dx, p.y + dy)).toBe(SURF.GROUND);
      }
    }
  });
  it('rooftop pads report PAD surface at roof height', () => {
    const roof = w.pads.find((p) => p.kind === 'roof');
    expect(w.surfaceKind(roof.x, roof.y)).toBe(SURF.PAD);
    expect(w.surfaceZ(roof.x, roof.y)).toBeCloseTo(roof.z, 6);
    expect(roof.z).toBeGreaterThan(w.height(roof.x, roof.y) + 5);
  });
  it('clamps water to sea level and reports WATER', () => {
    let found = false;
    for (let i = 0; i < 4000 && !found; i++) {
      const x = (i % 63) * 60 - 1900, y = Math.floor(i / 63) * 60 - 1900;
      if (w.height(x, y) < -1) {
        expect(w.surfaceZ(x, y)).toBe(0);
        expect(w.surfaceKind(x, y)).toBe(SURF.WATER);
        found = true;
      }
    }
    expect(found).toBe(true);
  });
  it('normals are unit length', () => {
    const n = [0, 0, 0];
    w.normal(300, 200, n);
    expect(Math.hypot(...n)).toBeCloseTo(1, 9);
  });
  it('wind is calm when set calm and scales with height', () => {
    const c = new World(4242, 'calm');
    const o = [0, 0, 0];
    c.wind(0, 0, 100, 5, o);
    expect(Math.hypot(...o)).toBe(0);
    const s = new World(4242, 'strong');
    const lo = [0, 0, 0], hi = [0, 0, 0];
    const t = s.towns[0];
    s.wind(t.x, t.y, t.z + 1, 0, lo);
    s.wind(t.x, t.y, t.z + 150, 0, hi);
    expect(Math.hypot(hi[0], hi[1])).toBeGreaterThan(Math.hypot(lo[0], lo[1]));
  });
  it('height lookups are fast enough for 400 Hz physics', () => {
    const t0 = performance.now();
    let s = 0;
    for (let i = 0; i < 20000; i++) s += w.surfaceZ(i * 0.7 - 5000, i * 0.3);
    expect(Number.isFinite(s)).toBe(true);
    expect(performance.now() - t0).toBeLessThan(250);
  });
});
