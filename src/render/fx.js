/**
 * Air made visible. Everything here reacts to the rotor so the world never
 * "ignores" the pilot:
 *   motes   — ambient air specks advected by wind + the rotor's induced flow
 *             field (inflow, contracting wake, ground outwash, VRS torus)
 *   rings   — tip-vortex rings shed per blade passage, convected by the wake;
 *             in VRS they stall around the disc and turn red
 *   vapour  — blade-tip condensation helices under high blade loading / g
 *   puffs   — dust / grass / snow / spray / smoke / fire sprites
 *   ripples — rotor wash on water
 *   decals  — flattened-grass rings, skid marks, scorch (persisted in cache)
 * Fixed-capacity typed arrays; no per-frame allocation in hot paths.
 */

import { SE } from './view.js';
import { SURF } from '../sim/heli.js';
import { TER } from '../world/world.js';

const MOTES = 420;
const PUFFS = 1400;
const RINGS = 44;
const TRAIL = 56;
const RIPPLES = 60;

const K = { DUST: 0, GRASS: 1, SNOW: 2, SPRAY: 3, SMOKE: 4, BLACK: 5, FIRE: 6, DEBRIS: 7, HEAT: 8, GREY: 9 };

function sprite(r, g, b, soft = 1) {
  const s = 64;
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(s, s) : Object.assign(document.createElement('canvas'), { width: s, height: s });
  const ctx = c.getContext('2d');
  const gr = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, `rgba(${r},${g},${b},1)`);
  gr.addColorStop(0.45 * soft, `rgba(${r},${g},${b},0.55)`);
  gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, s, s);
  return c;
}

function smooth(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export class FX {
  constructor(world, view, terrain) {
    this.world = world;
    this.view = view;
    this.terrain = terrain;
    this.enabled = true;

    this.m = { x: new Float32Array(MOTES), y: new Float32Array(MOTES), z: new Float32Array(MOTES), vx: new Float32Array(MOTES), vy: new Float32Array(MOTES), vz: new Float32Array(MOTES), f: new Float32Array(MOTES) };
    this.moteInit = false;

    const P = PUFFS;
    this.p = {
      x: new Float32Array(P), y: new Float32Array(P), z: new Float32Array(P),
      vx: new Float32Array(P), vy: new Float32Array(P), vz: new Float32Array(P),
      life: new Float32Array(P), max: new Float32Array(P), size: new Float32Array(P), grow: new Float32Array(P),
      a: new Float32Array(P), k: new Uint8Array(P), n: 0,
    };
    this.pHead = 0;

    this.rings = [];
    for (let i = 0; i < RINGS; i++) this.rings.push({ on: false, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 1, ex: 1, ey: 0, ez: 0, r: 0, age: 0, s: 0, vrs: 0 });
    this.ringNext = 0;
    this.lastPass = 0;

    this.trail = new Float32Array(2 * TRAIL * 3);
    this.trailA = new Float32Array(2 * TRAIL);
    this.trailHead = 0;

    this.ripples = [];
    for (let i = 0; i < RIPPLES; i++) this.ripples.push({ on: false, x: 0, y: 0, r: 0, age: 0, a: 0 });
    this.ripNext = 0;

    this.sprites = [];
    this.sprites[K.DUST] = sprite(160, 132, 96);
    this.sprites[K.GRASS] = sprite(150, 170, 110);
    this.sprites[K.SNOW] = sprite(245, 248, 255);
    this.sprites[K.SPRAY] = sprite(225, 238, 250);
    this.sprites[K.SMOKE] = sprite(120, 120, 124);
    this.sprites[K.BLACK] = sprite(28, 26, 26);
    this.sprites[K.FIRE] = sprite(255, 150, 40, 0.8);
    this.sprites[K.DEBRIS] = sprite(40, 36, 32, 0.4);
    this.sprites[K.HEAT] = sprite(200, 200, 205);
    this.sprites[K.GREY] = sprite(150, 148, 142);

    this.washTimer = 0;
    this.smokeTimer = 0;
    this.skidPrev = null;
    this.crashDone = false;
    this.washLevel = 0;
    this.surfaceType = TER.GRASS;
    this._f = new Float64Array(3);
    this._tips = new Float64Array(6);
    this.stats = { puffs: 0, rings: 0 };
  }

  reset() {
    this.p.life.fill(0);
    for (const r of this.rings) r.on = false;
    for (const r of this.ripples) r.on = false;
    this.trailA.fill(0);
    this.crashDone = false;
    this.skidPrev = null;
    this.moteInit = false;
  }

  // ── rotor-induced flow field at a world point ──
  _frame(h) {
    const R = h.R, p = h.pos, mr = h.p.mainRotor;
    let nx = h.aLon, ny = h.aLat;
    const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
    nx *= inv; ny *= inv; const nz = inv;
    this.nwx = R[0] * nx + R[1] * ny + R[2] * nz;
    this.nwy = R[3] * nx + R[4] * ny + R[5] * nz;
    this.nwz = R[6] * nx + R[7] * ny + R[8] * nz;
    this.hx = p[0] + R[2] * mr.hubHeight;
    this.hy = p[1] + R[5] * mr.hubHeight;
    this.hz = p[2] + R[8] * mr.hubHeight;
    this.Rr = mr.R;
    this.vi = h.t.vi * Math.min(1, h.t.nr * 1.2);
    this.vrs = h.t.vrs;
    this.hubAgl = h.t.hubAgl;
    this.zg = this.hz - this.hubAgl;
  }

  field(x, y, z, out) {
    const Rr = this.Rr, vi = this.vi;
    out[0] = 0; out[1] = 0; out[2] = 0;
    if (Math.abs(vi) < 0.2) return out;
    const dx = x - this.hx, dy = y - this.hy, dz = z - this.hz;
    const nx = this.nwx, ny = this.nwy, nz = this.nwz;
    const hgt = dx * nx + dy * ny + dz * nz;
    const rx = dx - hgt * nx, ry = dy - hgt * ny, rz = dz - hgt * nz;
    const r = Math.sqrt(rx * rx + ry * ry + rz * rz);
    if (r < Rr * 1.35) {
      const w = 1 - smooth(Rr * 0.75, Rr * 1.35, r);
      let s = 0;
      if (hgt < 0 && hgt > -7 * Rr) s = vi * (1 + Math.tanh(-hgt / Rr)) * (1 - 0.85 * this.vrs) * (1 - smooth(4 * Rr, 7 * Rr, -hgt));
      else if (hgt >= 0 && hgt < 2.5 * Rr) s = vi * (1 - hgt / (2.5 * Rr));
      s *= w;
      out[0] -= nx * s; out[1] -= ny * s; out[2] -= nz * s;
    } else if (hgt > -Rr && hgt < 1.5 * Rr && r < 3 * Rr) {
      // entrainment toward the disc
      const s = (vi * 0.25 * Rr) / r;
      out[0] -= (rx / r) * s; out[1] -= (ry / r) * s; out[2] -= (rz / r) * s;
    }
    // VRS: toroidal recirculation around the tip path
    if (this.vrs > 0.05 && r > 0.01) {
      const orr = r - Rr, oh = hgt;
      const d2 = orr * orr + oh * oh;
      const core = 0.45 * Rr;
      const k = this.vrs * Math.abs(vi) * 1.8 * Math.exp(-d2 / (core * core));
      const dd = Math.sqrt(d2) + 0.3;
      const tr = -oh / dd, tn = orr / dd;
      out[0] += (rx / r * tr + nx * tn) * k;
      out[1] += (ry / r * tr + ny * tn) * k;
      out[2] += (rz / r * tr + nz * tn) * k;
    }
    // Ground outwash
    if (this.hubAgl < 3.2 * Rr) {
      const gx = x - this.hx, gy = y - this.hy;
      const rh = Math.sqrt(gx * gx + gy * gy);
      const above = z - this.zg;
      if (rh > 0.5 && rh < 6 * Rr && above < 4) {
        const st = Math.abs(vi) * 1.7 * (1 - this.hubAgl / (3.2 * Rr)) * Math.min(1.4, Rr / Math.max(rh, 0.7 * Rr)) * Math.exp(-Math.max(0, above) / 1.6);
        out[0] += (gx / rh) * st; out[1] += (gy / rh) * st;
        out[2] += st * 0.12;
      }
    }
    return out;
  }

  spawn(kind, x, y, z, vx, vy, vz, life, size, grow, a) {
    const p = this.p;
    const i = this.pHead;
    this.pHead = (i + 1) % PUFFS;
    p.x[i] = x; p.y[i] = y; p.z[i] = z;
    p.vx[i] = vx; p.vy[i] = vy; p.vz[i] = vz;
    p.life[i] = life; p.max[i] = life; p.size[i] = size; p.grow[i] = grow; p.a[i] = a; p.k[i] = kind;
  }

  update(dt, h, wind) {
    this._frame(h);
    const t = h.t, Rr = this.Rr;
    const f = this._f;
    const world = this.world;

    // ── motes ──
    const m = this.m;
    const cx = h.pos[0], cy = h.pos[1], cz = h.pos[2];
    const HALF = 70;
    const rnd = Math.random;
    if (!this.moteInit) {
      for (let i = 0; i < MOTES; i++) this._respawnMote(i, cx, cy, cz, HALF, true);
      this.moteInit = true;
    }
    for (let i = 0; i < MOTES; i++) {
      let x = m.x[i], y = m.y[i], z = m.z[i];
      this.field(x, y, z, f);
      const vx = wind[0] + f[0], vy = wind[1] + f[1], vz = wind[2] + f[2];
      x += vx * dt; y += vy * dt; z += vz * dt;
      m.vx[i] = vx; m.vy[i] = vy; m.vz[i] = vz;
      m.f[i] = Math.min(1, Math.sqrt(f[0] * f[0] + f[1] * f[1] + f[2] * f[2]) / 12);
      if ((i & 7) === (this.frameParity & 7)) {
        const zg = world.surfaceZ(x, y);
        if (z < zg + 0.15) { z = zg + 0.15; }
      }
      m.x[i] = x; m.y[i] = y; m.z[i] = z;
      if (Math.abs(x - cx) > HALF || Math.abs(y - cy) > HALF || Math.abs(z - cz) > 45) this._respawnMote(i, cx, cy, cz, HALF, false);
    }
    this.frameParity = (this.frameParity || 0) + 1;

    // ── surface under the rotor ──
    const underKind = world.surfaceKind(this.hx, this.hy);
    let ter = TER.TOWN;
    if (underKind === SURF.WATER) ter = TER.WATER;
    else if (underKind === SURF.GROUND) ter = world.terrainType(this.hx, this.hy);
    this.surfaceType = ter;

    // ── ground wash: dust / spray / grass ──
    const wash = Math.abs(this.vi) > 1 ? Math.max(0, 1 - this.hubAgl / (2.6 * Rr)) * Math.min(1.6, Math.abs(this.vi) / 7) : 0;
    this.washLevel = wash;
    if (wash > 0.02 && !h.crashed) {
      const rate = wash * (ter === TER.WATER ? 260 : ter === TER.GRASS ? 110 : ter === TER.TOWN ? 70 : 220);
      let n = rate * dt;
      while (n > 0) {
        if (n < 1 && rnd() > n) break;
        n -= 1;
        const ang = rnd() * Math.PI * 2;
        const rr = Rr * (0.4 + rnd() * 0.9);
        const x = this.hx + Math.cos(ang) * rr, y = this.hy + Math.sin(ang) * rr;
        const sp = Math.abs(this.vi) * (0.8 + rnd() * 1.1);
        const vx = Math.cos(ang) * sp + wind[0], vy = Math.sin(ang) * sp + wind[1];
        const zg = this.zg;
        if (ter === TER.WATER) {
          this.spawn(K.SPRAY, x, y, zg + 0.2, vx, vy, 1 + rnd() * 3, 0.9 + rnd() * 0.8, 1.0, 2.2, 0.35 * wash);
          if (rnd() < 0.08) this._ripple(x, y, 0.5);
        } else if (ter === TER.SNOW) {
          this.spawn(K.SNOW, x, y, zg + 0.2, vx, vy, 0.5 + rnd() * 2.5, 1.4 + rnd(), 1.4, 3.5, 0.45 * wash);
        } else if (ter === TER.GRASS) {
          this.spawn(K.GRASS, x, y, zg + 0.1, vx * 0.7, vy * 0.7, 0.3 + rnd(), 0.5 + rnd() * 0.4, 0.35, 0.4, 0.8);
          if (rnd() < 0.25) this.spawn(K.DUST, x, y, zg + 0.2, vx, vy, 0.3 + rnd(), 1.0 + rnd(), 1.0, 2.5, 0.12 * wash);
        } else if (ter === TER.TOWN) {
          this.spawn(K.GREY, x, y, zg + 0.2, vx, vy, 0.3 + rnd(), 0.9 + rnd(), 0.9, 2.2, 0.16 * wash);
        } else {
          this.spawn(K.DUST, x, y, zg + 0.2, vx, vy, 0.4 + rnd() * 1.8, 1.4 + rnd() * 1.2, 1.3, 3.8, 0.34 * wash);
        }
      }
      if (ter === TER.WATER && rnd() < wash * 0.5) this._ripple(this.hx, this.hy, Rr * 0.6);
      // Persistent flattening ring
      this.washTimer -= dt;
      if (this.washTimer <= 0 && ter !== TER.WATER && wash > 0.25) {
        this.washTimer = 0.35;
        const col = ter === TER.GRASS ? 'rgb(186,206,130)' : ter === TER.SNOW ? 'rgb(170,182,200)' : ter === TER.TOWN ? 'rgb(190,186,176)' : 'rgb(96,78,56)';
        this.terrain.addDecal({ type: 'wash', x: this.hx, y: this.hy, z: this.zg, r: Rr * (0.55 + rnd() * 0.6), w: 0.6 + rnd() * 0.8, color: col, a: 0.045 * wash });
      }
    }

    // ── tip-vortex rings ──
    const passes = h.azimuthCount || 0;
    if (passes !== this.lastPass) {
      this.lastPass = passes;
      if (t.nr > 0.4 && Math.abs(t.thrust) > 2500 && !h.crashed) this._shedRing(h);
    }
    let nr = 0;
    for (const r of this.rings) {
      if (!r.on) continue;
      nr++;
      r.age += dt;
      const life = 2.6;
      if (r.age > life) { r.on = false; continue; }
      // Convect: wind + wake descent; trapped with the heli in VRS
      const trap = r.vrs;
      const sink = this.vi * (0.9 + Math.min(1, r.age * 1.6)) * (1 - trap);
      let vx = wind[0] - r.nx * sink, vy = wind[1] - r.ny * sink, vz = wind[2] - r.nz * sink;
      vx = vx * (1 - trap) + h.vel[0] * trap;
      vy = vy * (1 - trap) + h.vel[1] * trap;
      vz = vz * (1 - trap) + (h.vel[2] + Math.sin(r.age * 9) * 1.5) * trap;
      r.x += vx * dt; r.y += vy * dt; r.z += vz * dt;
      if (r.age < 0.35) r.r += (Rr * 0.78 - r.r) * Math.min(1, dt * 6);
      const zg = this.world.surfaceZ(r.x, r.y);
      if (r.z - zg < 1.2) {
        r.z = zg + 1.2;
        r.r += Math.abs(this.vi) * 1.4 * dt;
        r.nx *= 0.9; r.ny *= 0.9; r.nz = Math.sqrt(Math.max(0, 1 - r.nx * r.nx - r.ny * r.ny));
      }
      r.r += dt * 0.6 * r.age;
    }
    this.stats.rings = nr;

    // ── tip vapour ──
    const vap = Math.min(1, Math.max(0, (t.stall - 0.72) * 3.5 + (t.loadFactor - 1.45) * 1.8 + (this.vrs - 0.5) * 0.8));
    const tips = h.tipsWorld;
    if (tips) {
      const hd = this.trailHead;
      for (let b = 0; b < 2; b++) {
        const k = (b * TRAIL + hd) * 3;
        this.trail[k] = tips[b * 3]; this.trail[k + 1] = tips[b * 3 + 1]; this.trail[k + 2] = tips[b * 3 + 2];
        this.trailA[b * TRAIL + hd] = h.crashed ? 0 : vap;
      }
      this.trailHead = (hd + 1) % TRAIL;
      for (let i = 0; i < 2 * TRAIL; i++) {
        if (this.trailA[i] <= 0) continue;
        this.trail[i * 3] += wind[0] * dt;
        this.trail[i * 3 + 1] += wind[1] * dt;
        this.trail[i * 3 + 2] -= this.vi * 0.5 * dt;
      }
    }

    // ── exhaust ──
    this.smokeTimer -= dt;
    if (this.smokeTimer <= 0) {
      this.smokeTimer = 0.07;
      const R = h.R;
      const ex = h.pos[0] + R[0] * -1.45 + R[2] * 1.3, ey = h.pos[1] + R[3] * -1.45 + R[5] * 1.3, ez = h.pos[2] + R[6] * -1.45 + R[8] * 1.3;
      if (h.crashed) {
        for (let k = 0; k < 3; k++) this.spawn(K.BLACK, h.pos[0] + (rnd() - 0.5) * 3, h.pos[1] + (rnd() - 0.5) * 3, h.pos[2], wind[0] * 0.5, wind[1] * 0.5, 3 + rnd() * 2, 5 + rnd() * 3, 2, 6, 0.5);
        if (rnd() < 0.6) this.spawn(K.FIRE, h.pos[0] + (rnd() - 0.5) * 2, h.pos[1] + (rnd() - 0.5) * 2, h.pos[2], 0, 0, 2 + rnd() * 2, 0.6 + rnd() * 0.5, 1.8, 0.5, 0.8);
      } else if (t.engineOn || t.n1 > 0.3) {
        const heat = Math.min(1, t.powerKw / 220);
        this.spawn(K.HEAT, ex, ey, ez, wind[0] - R[0] * 3, wind[1] - R[3] * 3, 1.5, 0.8, 0.4, 1.4, 0.05 + 0.08 * heat);
        if (t.torquePct > 1.05) this.spawn(K.BLACK, ex, ey, ez, wind[0], wind[1], 1.5, 1.2, 0.5, 1.6, 0.25);
      } else if (t.n1 > 0.02) {
        this.spawn(K.SMOKE, ex, ey, ez, wind[0], wind[1], 1, 2, 0.5, 2, 0.2);
      }
    }

    // ── skid marks ──
    if (h.contacts > 0 && h.scrape > 0.25 && !h.crashed) {
      const cur = this._skidPos(h);
      if (this.skidPrev) {
        for (let s = 0; s < 2; s++) {
          const a = this.skidPrev[s], b = cur[s];
          if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.4) {
            this.terrain.addDecal({ type: 'skid', x: a[0], y: a[1], z: a[2], x2: b[0], y2: b[1], color: 'rgb(34,28,22)', a: Math.min(0.5, 0.15 + h.scrape * 0.12) });
            this.skidPrev[s] = b;
          }
        }
      } else this.skidPrev = cur;
    } else this.skidPrev = null;

    // ── touchdown puff ──
    if (h.impactEvent > 0.8 && !h.crashed) {
      const n = Math.min(60, h.impactEvent * 18);
      for (let k = 0; k < n; k++) {
        const ang = rnd() * Math.PI * 2, sp = 1 + rnd() * h.impactEvent * 2;
        this.spawn(ter === TER.WATER ? K.SPRAY : ter === TER.SNOW ? K.SNOW : ter === TER.TOWN ? K.GREY : K.DUST,
          h.pos[0] + Math.cos(ang) * 1.5, h.pos[1] + Math.sin(ang) * 1.5, this.zg + 0.2,
          Math.cos(ang) * sp, Math.sin(ang) * sp, rnd() * 1.5, 1 + rnd(), 0.8, 2, 0.4);
      }
      if (h.impactEvent > 2) this.terrain.addDecal({ type: 'scorch', x: h.pos[0], y: h.pos[1], z: this.zg, r: 2.2 });
    }

    // ── crash explosion ──
    if (h.crashed && !this.crashDone) {
      this.crashDone = true;
      const water = h.crashReason === 'DITCHED';
      for (let k = 0; k < 160; k++) {
        const ang = rnd() * Math.PI * 2, el = rnd() * 1.2, sp = 4 + rnd() * 16;
        const vx = Math.cos(ang) * Math.cos(el) * sp, vy = Math.sin(ang) * Math.cos(el) * sp, vz = Math.sin(el) * sp;
        if (water) this.spawn(K.SPRAY, h.pos[0], h.pos[1], h.pos[2], vx, vy, vz + 4, 1.5 + rnd(), 1.4, 3, 0.7);
        else if (k < 70) this.spawn(K.FIRE, h.pos[0], h.pos[1], h.pos[2], vx * 0.6, vy * 0.6, vz * 0.6, 0.6 + rnd() * 0.8, 2.5, 3.5, 0.9);
        else if (k < 120) this.spawn(K.BLACK, h.pos[0], h.pos[1], h.pos[2], vx * 0.3, vy * 0.3, vz * 0.3 + 2, 3 + rnd() * 3, 2.5, 4, 0.6);
        else this.spawn(K.DEBRIS, h.pos[0], h.pos[1], h.pos[2], vx, vy, vz + 5, 2.5 + rnd(), 0.5, 0, 1);
      }
      if (water) for (let k = 0; k < 8; k++) this._ripple(h.pos[0], h.pos[1], k * 1.5);
      else this.terrain.addDecal({ type: 'scorch', x: h.pos[0], y: h.pos[1], z: this.zg, r: 8 });
    }

    // ── puffs integrate ──
    const p = this.p;
    let alive = 0;
    for (let i = 0; i < PUFFS; i++) {
      if (p.life[i] <= 0) continue;
      alive++;
      p.life[i] -= dt;
      const k = p.k[i];
      let g = 0, drag = 1.2;
      if (k === K.SPRAY || k === K.DEBRIS) { g = -9.81; drag = 0.4; }
      else if (k === K.GRASS) { g = -3; drag = 2; }
      else if (k === K.FIRE || k === K.BLACK || k === K.SMOKE || k === K.HEAT) { g = 1.5; drag = 0.8; }
      else g = -0.4;
      // Rotor flow keeps pushing loose material (every other particle per frame)
      if ((i & 1) === (this.frameParity & 1)) {
        this.field(p.x[i], p.y[i], p.z[i], f);
        p.vx[i] += (wind[0] + f[0] - p.vx[i]) * drag * dt * 2;
        p.vy[i] += (wind[1] + f[1] - p.vy[i]) * drag * dt * 2;
        p.vz[i] += (f[2] - p.vz[i]) * drag * 0.5 * dt * 2;
      }
      p.vz[i] += g * dt;
      p.x[i] += p.vx[i] * dt; p.y[i] += p.vy[i] * dt; p.z[i] += p.vz[i] * dt;
      p.size[i] += p.grow[i] * dt;
      if ((k === K.SPRAY || k === K.DEBRIS || k === K.GRASS) && (i & 3) === 0) {
        const zg = this.world.surfaceZ(p.x[i], p.y[i]);
        if (p.z[i] < zg) { p.z[i] = zg; p.vz[i] = 0; p.vx[i] *= 0.5; p.vy[i] *= 0.5; if (k === K.SPRAY) p.life[i] = Math.min(p.life[i], 0.1); }
      }
    }
    this.stats.puffs = alive;

    for (const r of this.ripples) {
      if (!r.on) continue;
      r.age += dt;
      r.r += dt * 3.5;
      if (r.age > 2.2) r.on = false;
    }
  }

  _respawnMote(i, cx, cy, cz, HALF, anywhere) {
    const m = this.m, rnd = Math.random;
    let x, y;
    if (anywhere) {
      x = cx + (rnd() * 2 - 1) * HALF; y = cy + (rnd() * 2 - 1) * HALF;
    } else {
      // Re-enter from the side opposite to where it left
      x = m.x[i]; y = m.y[i];
      if (x - cx > HALF) x = cx - HALF + rnd() * 4; else if (cx - x > HALF) x = cx + HALF - rnd() * 4; else x = cx + (rnd() * 2 - 1) * HALF;
      if (y - cy > HALF) y = cy - HALF + rnd() * 4; else if (cy - y > HALF) y = cy + HALF - rnd() * 4; else y = cy + (rnd() * 2 - 1) * HALF;
    }
    const zg = this.world.surfaceZ(x, y);
    m.x[i] = x; m.y[i] = y;
    m.z[i] = Math.max(zg + 0.3, cz + (rnd() * 2 - 1) * 30);
  }

  _shedRing(h) {
    const r = this.rings[this.ringNext];
    this.ringNext = (this.ringNext + 1) % RINGS;
    r.on = true;
    r.x = this.hx; r.y = this.hy; r.z = this.hz;
    r.nx = this.nwx; r.ny = this.nwy; r.nz = this.nwz;
    r.r = this.Rr * 0.97;
    r.age = 0;
    r.s = Math.min(1.3, Math.abs(h.t.cts) / 0.07);
    r.vrs = this.vrs;
  }

  _ripple(x, y, r0) {
    const r = this.ripples[this.ripNext];
    this.ripNext = (this.ripNext + 1) % RIPPLES;
    r.on = true; r.x = x; r.y = y; r.r = r0; r.age = 0;
  }

  _skidPos(h) {
    const R = h.R, p = h.pos;
    const out = [];
    for (const side of [1.1, -1.1]) {
      const bx = 0, by = side, bz = -1.25;
      out.push([p[0] + R[0] * bx + R[1] * by + R[2] * bz, p[1] + R[3] * bx + R[4] * by + R[5] * bz, p[2] + R[6] * bx + R[7] * by + R[8] * bz]);
    }
    return out;
  }

  // ── drawing ──
  drawGround(ctx) {
    const v = this.view, S = v.S;
    ctx.lineWidth = Math.max(1, S * 0.12);
    for (const r of this.ripples) {
      if (!r.on) continue;
      const a = (1 - r.age / 2.2) * 0.45;
      ctx.strokeStyle = `rgba(220,236,250,${a})`;
      ctx.beginPath();
      ctx.ellipse(v.sx(r.x, r.y), v.sy(r.x, r.y, 0.02), r.r * S, r.r * S * SE, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  drawAir(ctx, h) {
    const v = this.view, S = v.S;
    // Motes: streak = motion relative to the following camera
    const m = this.m;
    const hvx = h.vel[0], hvy = h.vel[1], hvz = h.vel[2];
    const streak = 0.07;
    for (let pass = 0; pass < 3; pass++) {
      ctx.strokeStyle = pass === 0 ? 'rgba(255,255,255,0.16)' : pass === 1 ? 'rgba(235,245,255,0.34)' : 'rgba(215,235,255,0.62)';
      ctx.lineWidth = pass === 2 ? Math.max(1.2, S * 0.1) : Math.max(1, S * 0.07);
      ctx.beginPath();
      for (let i = 0; i < MOTES; i++) {
        const fl = m.f[i];
        const bucket = fl < 0.12 ? 0 : fl < 0.45 ? 1 : 2;
        if (bucket !== pass) continue;
        const x = m.x[i], y = m.y[i], z = m.z[i];
        const k = streak * (1 + fl * 2);
        const x2 = x - (m.vx[i] - hvx) * k, y2 = y - (m.vy[i] - hvy) * k, z2 = z - (m.vz[i] - hvz) * k;
        const a0 = v.sx(x, y), b0 = v.sy(x, y, z);
        if (a0 < -20 || a0 > v.W + 20 || b0 < -20 || b0 > v.H + 20) continue;
        ctx.moveTo(a0, b0);
        ctx.lineTo(v.sx(x2, y2) + 0.5, v.sy(x2, y2, z2) + 0.5);
      }
      ctx.stroke();
    }

    // Puffs (sprites)
    const p = this.p;
    for (let i = 0; i < PUFFS; i++) {
      if (p.life[i] <= 0) continue;
      const x = v.sx(p.x[i], p.y[i]), y = v.sy(p.x[i], p.y[i], p.z[i]);
      const s = p.size[i] * S;
      if (x + s < 0 || x - s > v.W || y + s < 0 || y - s > v.H) continue;
      const lf = p.life[i] / p.max[i];
      const k = p.k[i];
      let a = p.a[i] * (k === K.FIRE ? lf : Math.min(1, lf * 2.2) * Math.min(1, (1 - lf) * 6 + 0.25));
      if (a <= 0.01) continue;
      ctx.globalAlpha = a > 1 ? 1 : a;
      if (k === K.GRASS || k === K.DEBRIS) {
        ctx.drawImage(this.sprites[k], x - s * 0.5, y - s * 0.5, s, s);
      } else {
        ctx.drawImage(this.sprites[k], x - s, y - s, s * 2, s * 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  drawRings(ctx) {
    const v = this.view, S = v.S;
    ctx.lineWidth = Math.max(1, S * 0.13);
    for (const r of this.rings) {
      if (!r.on) continue;
      const life = 2.6;
      const fade = (1 - r.age / life);
      const a = Math.min(0.55, r.s * 0.38 * fade * fade + r.vrs * 0.25 * fade);
      if (a < 0.02) continue;
      // Basis in ring plane
      let ex = 1 - r.nx * r.nx, ey = -r.nx * r.ny, ez = -r.nx * r.nz;
      let el = Math.hypot(ex, ey, ez);
      if (el < 0.1) { ex = -r.ny * r.nx; ey = 1 - r.ny * r.ny; ez = -r.ny * r.nz; el = Math.hypot(ex, ey, ez); }
      ex /= el; ey /= el; ez /= el;
      const fx = r.ny * ez - r.nz * ey, fy = r.nz * ex - r.nx * ez, fz = r.nx * ey - r.ny * ex;
      const red = r.vrs;
      ctx.strokeStyle = `rgba(${235 + 20 * red | 0},${240 - 170 * red | 0},${250 - 190 * red | 0},${a})`;
      ctx.beginPath();
      const segs = 22;
      const wob = red * 0.12;
      for (let k = 0; k <= segs; k++) {
        const t = (k / segs) * Math.PI * 2;
        const rr = r.r * (1 + wob * Math.sin(t * 3 + r.age * 12));
        const c = Math.cos(t) * rr, s = Math.sin(t) * rr;
        const x = r.x + ex * c + fx * s, y = r.y + ey * c + fy * s, z = r.z + ez * c + fz * s;
        const sx = v.sx(x, y), sy = v.sy(x, y, z);
        if (k === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }
  }

  drawVapour(ctx) {
    const v = this.view;
    const maxSeg2 = (this.Rr * 0.9 * v.S) ** 2;
    ctx.lineCap = 'round';
    for (let b = 0; b < 2; b++) {
      let prevX = 0, prevY = 0, has = false;
      for (let n = 1; n < TRAIL; n++) {
        const idx = (this.trailHead - n + TRAIL) % TRAIL;
        const a = this.trailA[b * TRAIL + idx];
        const k = (b * TRAIL + idx) * 3;
        const x = v.sx(this.trail[k], this.trail[k + 1]), y = v.sy(this.trail[k], this.trail[k + 1], this.trail[k + 2]);
        // Tip moves ~Ω·R·dt per sample; at low frame rates skip chords that would cut across the disc
        const far = (x - prevX) * (x - prevX) + (y - prevY) * (y - prevY) > maxSeg2;
        if (a > 0.02 && has && !far) {
          ctx.strokeStyle = `rgba(250,252,255,${a * 0.75 * (1 - n / TRAIL)})`;
          ctx.lineWidth = Math.max(1, v.S * 0.18 * (1 + n / TRAIL * 2));
          ctx.beginPath();
          ctx.moveTo(prevX, prevY);
          ctx.lineTo(x, y);
          ctx.stroke();
        }
        prevX = x; prevY = y; has = true;
      }
    }
  }
}
