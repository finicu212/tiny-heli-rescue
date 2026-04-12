/**
 * Pad-to-pad taxi missions. Land on the target pad (skids down, settled,
 * inside the circle) and hold for HOLD_S seconds to score. Touchdown sink
 * rate, centering and time are all graded; a streak multiplier rewards
 * consecutive clean deliveries.
 */

import { mulberry32 } from '../world/noise.js';

export const HOLD_S = 1.5;

export function gradeTouchdown(sink) {
  if (sink < 0.35) return { label: 'BUTTER', bonus: 400 };
  if (sink < 0.8) return { label: 'SMOOTH', bonus: 250 };
  if (sink < 1.6) return { label: 'FIRM', bonus: 100 };
  return { label: 'HARD', bonus: 0 };
}

export function scoreLanding({ distance, elapsed, sink, offset, radius, streak }) {
  const par = 20 + distance / 25;
  const g = gradeTouchdown(sink);
  const center = Math.round(Math.max(0, 1 - offset / radius) * 250);
  const time = Math.round(Math.max(0, par - elapsed) * 12);
  const base = 300 + Math.round(distance / 4);
  const mult = 1 + Math.min(streak, 5) * 0.25;
  return {
    grade: g.label,
    center,
    time,
    base,
    touchdown: g.bonus,
    mult,
    total: Math.round((base + center + time + g.bonus) * mult),
  };
}

export class Mission {
  constructor(world, seed = 7) {
    this.world = world;
    this.rand = mulberry32(seed ^ 0x77);
    this.score = 0;
    this.streak = 0;
    this.deliveries = 0;
    this.best = 0;
    this.target = null;
    this.origin = null;
    this.elapsed = 0;
    this.hold = 0;
    this.touchSink = 0;
    this.lastResult = null;
    this.resultAge = 99;
  }

  /** Pick a new target at least 300 m from the pad we are on. */
  next(fromPad) {
    const pads = this.world.pads;
    this.origin = fromPad;
    const cands = pads.filter((p) => p !== fromPad && (!fromPad || Math.hypot(p.x - fromPad.x, p.y - fromPad.y) > 300));
    const list = cands.length ? cands : pads.filter((p) => p !== fromPad);
    this.target = list[Math.floor(this.rand() * list.length)] || null;
    this.distance = this.target && fromPad ? Math.hypot(this.target.x - fromPad.x, this.target.y - fromPad.y) : 0;
    this.elapsed = 0;
    this.hold = 0;
    this.touchSink = 0;
  }

  padUnder(heli) {
    for (const p of this.world.pads) {
      const d = Math.hypot(heli.pos[0] - p.x, heli.pos[1] - p.y);
      if (d < p.r + 1.5 && Math.abs(heli.pos[2] - 1.25 - p.z) < 2) return { pad: p, d };
    }
    return null;
  }

  onCrash() {
    this.streak = 0;
    this.hold = 0;
  }

  update(dt, heli) {
    this.resultAge += dt;
    if (!this.target || heli.crashed) return;
    this.elapsed += dt;
    if (heli.impactEvent > 0) {
      this.touchSink = heli.impactEvent;
    }
    const t = this.target;
    const d = Math.hypot(heli.pos[0] - t.x, heli.pos[1] - t.y);
    const settled = heli.contacts >= 3 && Math.hypot(heli.vel[0], heli.vel[1], heli.vel[2]) < 0.6;
    const onPad = d < t.r + 1.0 && Math.abs(heli.pos[2] - 1.25 - t.z) < 1.5;
    if (settled && onPad) {
      this.hold += dt;
      if (this.hold >= HOLD_S) {
        const r = scoreLanding({
          distance: this.distance, elapsed: this.elapsed, sink: this.touchSink,
          offset: d, radius: t.r, streak: this.streak,
        });
        this.score += r.total;
        this.best = Math.max(this.best, this.score);
        this.streak++;
        this.deliveries++;
        this.lastResult = { ...r, pad: t.name, sink: this.touchSink };
        this.resultAge = 0;
        this.next(t);
      }
    } else {
      this.hold = 0;
      if (heli.contacts === 0) this.touchSink = 0;
    }
  }
}
