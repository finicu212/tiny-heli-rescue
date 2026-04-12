/**
 * Procedural world: fBm terrain with ridged mountains and lakes, flattened
 * town sites with box buildings, and landing pads (town square, rooftop,
 * remote). Implements the physics env interface (surfaceZ / surfaceKind /
 * normal / wind).
 */

import { ValueNoise, mulberry32 } from './noise.js';
import { SURF } from '../sim/heli.js';

export const WORLD_HALF = 2048;
export const WATER_Z = 0;
export const TER = { SAND: 0, GRASS: 1, DIRT: 2, ROCK: 3, SNOW: 4, WATER: 5, TOWN: 6 };

const BCELL = 32;

const SYL_A = ['Ash', 'Bran', 'Cor', 'Dun', 'El', 'Fen', 'Glen', 'Har', 'Kel', 'Lin', 'Mar', 'Nor', 'Ost', 'Pel', 'Rav', 'Stor', 'Tal', 'Vin', 'Wyr', 'Yar'];
const SYL_B = ['ford', 'mere', 'wick', 'holm', 'by', 'stead', 'ton', 'vale', 'crest', 'moor', 'haven', 'field', 'burg', 'rock'];

function smooth(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export class World {
  constructor(seed = 1, windSetting = 'light') {
    this.seed = seed >>> 0;
    this.n = new ValueNoise(this.seed);
    this.n2 = new ValueNoise(this.seed ^ 0x9e3779b9);
    this.towns = [];
    this.flats = [];          // {x, y, z, r, blend}
    this.buildings = [];
    this.pads = [];
    this.bgrid = new Map();
    this.setWind(windSetting);
    this._generate();
  }

  setWind(setting) {
    this.windSetting = setting;
    const rand = mulberry32(this.seed ^ 0x51f15e);
    const dir = rand() * Math.PI * 2;
    const speed = { calm: 0, light: 3.5, strong: 8, gusty: 6 }[setting] ?? 3.5;
    this.windBase = [Math.cos(dir) * speed, Math.sin(dir) * speed];
    this.gust = setting === 'gusty' ? 0.6 : setting === 'strong' ? 0.25 : 0.12;
  }

  /** Natural terrain before flattening. */
  rawHeight(x, y) {
    const n = this.n;
    const base = 35 + 70 * n.fbm(x * 0.0011, y * 0.0011, 5);
    const m = n.ridge(x * 0.0007 + 13.1, y * 0.0007 - 7.7, 4);
    const mask = smooth(0.05, 0.45, this.n2.fbm(x * 0.0005 + 3, y * 0.0005 + 9, 3));
    const lake = smooth(0.15, 0.5, this.n2.fbm(x * 0.0014 - 21, y * 0.0014 + 5, 3)) * 70;
    const edge = Math.max(Math.abs(x), Math.abs(y)) - WORLD_HALF + 300;
    const rim = edge > 0 ? edge * edge * 0.0015 : 0;
    return base + mask * m * m * 330 - lake + rim;
  }

  height(x, y) {
    let h = this.rawHeight(x, y);
    const f = this.flats;
    for (let i = 0; i < f.length; i++) {
      const s = f[i];
      const dx = x - s.x, dy = y - s.y;
      const lim = s.r + s.blend;
      if (dx > lim || dx < -lim || dy > lim || dy < -lim) continue;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= lim) continue;
      const w = 1 - smooth(s.r, lim, d);
      h += (s.z - h) * w;
    }
    return h;
  }

  buildingAt(x, y) {
    const key = ((Math.floor(x / BCELL) + 512) << 10) | (Math.floor(y / BCELL) + 512);
    const list = this.bgrid.get(key);
    if (!list) return null;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return b;
    }
    return null;
  }

  // ── physics env interface ──
  surfaceZ = (x, y) => {
    const b = this.buildingAt(x, y);
    if (b) return b.z1;
    const h = this.height(x, y);
    return h < WATER_Z ? WATER_Z : h;
  };

  surfaceKind = (x, y) => {
    const b = this.buildingAt(x, y);
    if (b) return b.pad ? SURF.PAD : SURF.ROOF;
    return this.height(x, y) < WATER_Z ? SURF.WATER : SURF.GROUND;
  };

  normal = (x, y, out) => {
    if (this.buildingAt(x, y)) { out[0] = 0; out[1] = 0; out[2] = 1; return; }
    const e = 1.0;
    const hx = this.height(x + e, y) - this.height(x - e, y);
    const hy = this.height(x, y + e) - this.height(x, y - e);
    let nx = -hx / (2 * e), ny = -hy / (2 * e);
    if (this.height(x, y) < WATER_Z) { nx = 0; ny = 0; }
    const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
    out[0] = nx * inv; out[1] = ny * inv; out[2] = inv;
  };

  wind = (x, y, z, t, out) => {
    const g = this.gust;
    const gx = Math.sin(t * 0.37 + x * 0.004) * 0.6 + Math.sin(t * 1.13 + y * 0.006 + 1.7) * 0.4;
    const gy = Math.sin(t * 0.29 + y * 0.005 + 0.3) * 0.6 + Math.sin(t * 0.97 + x * 0.007 + 2.2) * 0.4;
    const agl = Math.max(0.2, z - this.surfaceZ(x, y));
    const prof = Math.min(1.25, Math.max(0.25, Math.log(agl / 0.1) / Math.log(300)));
    const bx = this.windBase[0], by = this.windBase[1];
    const sp = Math.hypot(bx, by);
    out[0] = (bx * (1 + g * gx) + g * sp * 0.4 * gy) * prof;
    out[1] = (by * (1 + g * gx) - g * sp * 0.4 * gx) * prof;
    out[2] = g * sp * 0.15 * Math.sin(t * 1.7 + x * 0.01);
  };

  /** Terrain class for colouring and FX. */
  terrainType(x, y, h = this.height(x, y)) {
    if (h < WATER_Z) return TER.WATER;
    if (h < 2.2) return TER.SAND;
    const e = 2;
    const sx = this.height(x + e, y) - this.height(x - e, y);
    const sy = this.height(x, y + e) - this.height(x, y - e);
    const slope = Math.sqrt(sx * sx + sy * sy) / (2 * e);
    const snowLine = 205 + this.n.noise(x * 0.01, y * 0.01) * 20;
    if (h > snowLine && slope < 0.9) return TER.SNOW;
    if (slope > 0.75 || h > 175) return TER.ROCK;
    if (this.n2.noise(x * 0.012, y * 0.012) > 0.45) return TER.DIRT;
    return TER.GRASS;
  }

  // ── generation ──
  _generate() {
    const rand = mulberry32(this.seed ^ 0xa5a5);
    const usedNames = new Set();
    const name = () => {
      for (let k = 0; k < 50; k++) {
        const s = SYL_A[Math.floor(rand() * SYL_A.length)] + SYL_B[Math.floor(rand() * SYL_B.length)];
        if (!usedNames.has(s)) { usedNames.add(s); return s; }
      }
      return 'Site ' + usedNames.size;
    };

    // Town sites on moderate ground, spread out
    const want = 8;
    for (let tries = 0; tries < 900 && this.towns.length < want; tries++) {
      const x = (rand() * 2 - 1) * (WORLD_HALF - 450);
      const y = (rand() * 2 - 1) * (WORLD_HALF - 450);
      const h = this.rawHeight(x, y);
      if (h < 6 || h > 110) continue;
      let ok = true;
      for (const t of this.towns) if (Math.hypot(t.x - x, t.y - y) < 620) { ok = false; break; }
      if (!ok) continue;
      const r = 70 + rand() * 70;
      // Reject sites straddling lakes or cliffs
      let lo = Infinity, hi = -Infinity;
      for (let a = 0; a < 8; a++) {
        const hh = this.rawHeight(x + Math.cos(a) * r, y + Math.sin(a) * r);
        lo = Math.min(lo, hh); hi = Math.max(hi, hh);
      }
      if (lo < 2 || hi - lo > 60) continue;
      const z = Math.max(4, h);
      const town = { name: name(), x, y, z, r, pads: [] };
      this.towns.push(town);
      this.flats.push({ x, y, z, r: r + 10, blend: 110 });
    }

    // Downtown buildings on a street grid
    for (const t of this.towns) this._buildTown(t, rand);

    // Remote pads: mountain top, lakeside, ridge
    this._remotePads(rand, name);

    for (let i = 0; i < this.pads.length; i++) this.pads[i].id = i;

    for (const b of this.buildings) {
      const cx0 = Math.floor(b.x0 / BCELL), cx1 = Math.floor(b.x1 / BCELL);
      const cy0 = Math.floor(b.y0 / BCELL), cy1 = Math.floor(b.y1 / BCELL);
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          const key = ((cx + 512) << 10) | (cy + 512);
          let l = this.bgrid.get(key);
          if (!l) { l = []; this.bgrid.set(key, l); }
          l.push(b);
        }
      }
    }
  }

  _buildTown(t, rand) {
    const block = 26;
    const n = Math.ceil(t.r / block);
    const palette = [
      ['#b9a58c', '#8f7c66'], ['#c9c2b4', '#9b958a'], ['#a8887a', '#7d6358'],
      ['#9aa5ad', '#727d86'], ['#d0b88f', '#a08c68'], ['#8b939c', '#636b73'],
    ];
    let tallest = null;
    for (let i = -n; i <= n; i++) {
      for (let j = -n; j <= n; j++) {
        const cx = t.x + i * block, cy = t.y + j * block;
        const d = Math.hypot(cx - t.x, cy - t.y);
        if (d > t.r) continue;
        if (d < 40) continue;                        // central plaza for the ground pad
        if (rand() < 0.18) continue;                 // parks / lots
        const core = 1 - d / t.r;
        const w = 9 + rand() * 9, dd = 9 + rand() * 9;
        const hgt = 5 + rand() * 7 + core * core * (16 + rand() * 30);
        const c = palette[Math.floor(rand() * palette.length)];
        const b = {
          x0: cx - w / 2, x1: cx + w / 2, y0: cy - dd / 2, y1: cy + dd / 2,
          z0: t.z - 1, z1: t.z + hgt, roof: c[0], wall: c[1], pad: null, seed: Math.floor(rand() * 1e9),
        };
        this.buildings.push(b);
        if (!tallest || hgt > tallest.z1 - tallest.z0) tallest = b;
      }
    }
    const ground = { name: `${t.name} Square`, x: t.x, y: t.y, z: t.z, r: 7, kind: 'ground', town: t.name };
    this.pads.push(ground);
    t.pads.push(ground);
    if (tallest) {
      // Enlarge the tallest roof to take a 16 m pad
      const cx = (tallest.x0 + tallest.x1) / 2, cy = (tallest.y0 + tallest.y1) / 2;
      tallest.x0 = cx - 9; tallest.x1 = cx + 9; tallest.y0 = cy - 9; tallest.y1 = cy + 9;
      const roof = { name: `${t.name} Tower`, x: cx, y: cy, z: tallest.z1, r: 6, kind: 'roof', town: t.name };
      tallest.pad = roof;
      this.pads.push(roof);
      t.pads.push(roof);
    }
  }

  _remotePads(rand, name) {
    // Highest reachable peak
    let best = null;
    for (let k = 0; k < 1500; k++) {
      const x = (rand() * 2 - 1) * (WORLD_HALF - 500);
      const y = (rand() * 2 - 1) * (WORLD_HALF - 500);
      const h = this.rawHeight(x, y);
      if (!best || h > best.z) best = { x, y, z: h };
    }
    const add = (x, y, label, kind) => {
      const z = Math.max(3, this.height(x, y));
      this.flats.push({ x, y, z, r: 10, blend: 28 });
      this.pads.push({ name: label, x, y, z, r: 6, kind, town: null });
    };
    if (best) add(best.x, best.y, `${name()} Summit`, 'peak');

    // Lake shores and ridges
    let shore = 0, ridge = 0;
    for (let k = 0; k < 4000 && (shore < 2 || ridge < 2); k++) {
      const x = (rand() * 2 - 1) * (WORLD_HALF - 400);
      const y = (rand() * 2 - 1) * (WORLD_HALF - 400);
      if (this.towns.some((t) => Math.hypot(t.x - x, t.y - y) < t.r + 250)) continue;
      if (this.pads.some((p) => Math.hypot(p.x - x, p.y - y) < 400)) continue;
      const h = this.rawHeight(x, y);
      if (shore < 2 && h > 3 && h < 6 && this.rawHeight(x + 40, y) < 0) {
        add(x, y, `${name()} Landing`, 'shore'); shore++;
      } else if (ridge < 2 && h > 120 && h < 190) {
        add(x, y, `${name()} Ridge`, 'ridge'); ridge++;
      }
    }
  }
}
