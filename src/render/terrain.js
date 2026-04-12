/**
 * Terrain chunk cache. Each 64 m chunk (terrain quads, streets, pads,
 * buildings, trees) is painted once into an offscreen bitmap at the current
 * zoom; per frame we only blit. Persistent decals (rotor-wash flattening,
 * skid marks, scorch) are painted straight into the bitmaps and replayed
 * when a chunk is regenerated.
 */

import { RX, RY, FX, FY, SE, CE, depth } from './view.js';
import { TER, WATER_Z } from '../world/world.js';
import { mulberry32 } from '../world/noise.js';

const C = 64;
const CELL = 2;
const N = C / CELL;
const MAX_CHUNKS = 64;
const MAX_DECALS = 1800;

// Light from screen upper-left
const L = (() => {
  const x = -RX * 0.55 + FX * 0.35, y = -RY * 0.55 + FY * 0.35, z = 0.78;
  const n = Math.hypot(x, y, z);
  return [x / n, y / n, z / n];
})();
export const LIGHT = L;

const BASE = {
  [TER.SAND]: [196, 182, 134],
  [TER.GRASS]: [92, 128, 64],
  [TER.DIRT]: [132, 112, 80],
  [TER.ROCK]: [124, 118, 112],
  [TER.SNOW]: [236, 240, 245],
  [TER.WATER]: [40, 92, 128],
  [TER.TOWN]: [128, 126, 116],
};

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function rgb(r, g, b) {
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

// Painter's order for cells: far (large x·F) first
const CELL_ORDER = (() => {
  const idx = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) idx.push([i, j, i * FX + j * FY]);
  idx.sort((a, b) => b[2] - a[2]);
  return idx.map((e) => e[1] * N + e[0]);
})();

export class TerrainCache {
  constructor(world, view) {
    this.world = world;
    this.view = view;
    this.chunks = new Map();
    this.decals = [];
    this.S = view.S;
    this.frame = 0;
    this.visible = [];
    this.pending = 0;
    this._pt = [0, 0];
    this._townsByChunk = null;
  }

  invalidate() {
    this.chunks.clear();
    this.S = this.view.S;
  }

  key(i, j) { return ((i + 512) << 10) | (j + 512); }

  /** Visible chunks this frame; generates missing ones within a time budget. */
  update(budgetMs = 3) {
    const v = this.view;
    if (v.S !== this.S) this.invalidate();
    this.frame++;
    const pt = this._pt;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const z of [-10, 360]) {
      for (const [px, py] of [[0, 0], [v.W, 0], [0, v.H], [v.W, v.H]]) {
        v.unproject(px, py, z, pt);
        x0 = Math.min(x0, pt[0]); x1 = Math.max(x1, pt[0]);
        y0 = Math.min(y0, pt[1]); y1 = Math.max(y1, pt[1]);
      }
    }
    const i0 = Math.floor(x0 / C) - 1, i1 = Math.floor(x1 / C) + 1;
    const j0 = Math.floor(y0 / C) - 1, j1 = Math.floor(y1 / C) + 1;
    const vis = this.visible;
    vis.length = 0;
    const want = [];
    const cxw = v.camR * RX + ((v.camU) / SE) * FX;
    const cyw = v.camR * RY + ((v.camU) / SE) * FY;
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = this.key(i, j);
        const ch = this.chunks.get(k);
        if (ch) {
          if (this._onScreen(ch)) { ch.used = this.frame; vis.push(ch); }
        } else if (this._maybeVisible(i, j)) {
          const cx = (i + 0.5) * C, cy = (j + 0.5) * C;
          want.push([i, j, (cx - cxw) ** 2 + (cy - cyw) ** 2]);
        }
      }
    }
    want.sort((a, b) => a[2] - b[2]);
    this.pending = want.length;
    const t0 = performance.now();
    for (let n = 0; n < want.length; n++) {
      if (n > 0 && performance.now() - t0 > budgetMs) break;
      const ch = this._build(want[n][0], want[n][1]);
      this.chunks.set(this.key(ch.i, ch.j), ch);
      ch.used = this.frame;
      if (this._onScreen(ch)) vis.push(ch);
      this.pending--;
    }
    vis.sort((a, b) => b.order - a.order);
    if (this.chunks.size > MAX_CHUNKS) this._evict();
  }

  draw(ctx) {
    const v = this.view;
    for (const ch of this.visible) {
      const dx = Math.round(v.W * 0.5 + (ch.rmin - v.camR) * v.S - ch.pad + v.shakeX);
      const dy = Math.round(v.H * 0.5 - (ch.umax - v.camU) * v.S - ch.pad + v.shakeY);
      ctx.drawImage(ch.canvas, dx, dy);
    }
  }

  _onScreen(ch) {
    const v = this.view;
    const x = v.W * 0.5 + (ch.rmin - v.camR) * v.S - ch.pad;
    const y = v.H * 0.5 - (ch.umax - v.camU) * v.S - ch.pad;
    return x < v.W && y < v.H && x + ch.w > 0 && y + ch.h > 0;
  }

  _maybeVisible(i, j) {
    const v = this.view, w = this.world;
    let zlo = Infinity, zhi = -Infinity;
    for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]]) {
      const h = Math.max(WATER_Z, w.height((i + a) * C, (j + b) * C));
      zlo = Math.min(zlo, h); zhi = Math.max(zhi, h);
    }
    zlo -= 30; zhi += 90;
    let rmin = Infinity, rmax = -Infinity, umin = Infinity, umax = -Infinity;
    for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const x = (i + a) * C, y = (j + b) * C;
      const r = x * RX + y * RY, f = (x * FX + y * FY) * SE;
      rmin = Math.min(rmin, r); rmax = Math.max(rmax, r);
      umin = Math.min(umin, f + zlo * CE); umax = Math.max(umax, f + zhi * CE);
    }
    const sx0 = v.W * 0.5 + (rmin - v.camR) * v.S, sx1 = v.W * 0.5 + (rmax - v.camR) * v.S;
    const sy0 = v.H * 0.5 - (umax - v.camU) * v.S, sy1 = v.H * 0.5 - (umin - v.camU) * v.S;
    return sx0 < v.W + 64 && sx1 > -64 && sy0 < v.H + 64 && sy1 > -64;
  }

  _evict() {
    const arr = [...this.chunks.values()].sort((a, b) => a.used - b.used);
    const drop = arr.length - MAX_CHUNKS;
    for (let k = 0; k < drop; k++) {
      if (arr[k].used === this.frame) break;
      this.chunks.delete(this.key(arr[k].i, arr[k].j));
    }
  }

  // ── chunk construction ──
  _build(i, j) {
    const w = this.world, S = this.S;
    const x0 = i * C, y0 = j * C;
    const G = N + 3; // heights with 1-cell border for normals
    const H = new Float32Array(G * G);
    for (let b = 0; b < G; b++) {
      for (let a = 0; a < G; a++) {
        H[b * G + a] = w.height(x0 + (a - 1) * CELL, y0 + (b - 1) * CELL);
      }
    }
    const hAt = (a, b) => H[(b + 1) * G + (a + 1)];

    // Town membership for streets
    const towns = w.towns.filter((t) => Math.abs(t.x - (x0 + C / 2)) < t.r + C && Math.abs(t.y - (y0 + C / 2)) < t.r + C);
    const buildings = [];
    for (const b of w.buildings) {
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      if (cx >= x0 && cx < x0 + C && cy >= y0 && cy < y0 + C) buildings.push(b);
    }
    const pads = w.pads.filter((p) => p.kind !== 'roof' && p.x >= x0 && p.x < x0 + C && p.y >= y0 && p.y < y0 + C);
    const trees = this._trees(i, j, hAt, towns);

    // Projected bounds
    let rmin = Infinity, rmax = -Infinity, umin = Infinity, umax = -Infinity;
    const acc = (x, y, z) => {
      const r = x * RX + y * RY, u = (x * FX + y * FY) * SE + z * CE;
      if (r < rmin) rmin = r; if (r > rmax) rmax = r;
      if (u < umin) umin = u; if (u > umax) umax = u;
    };
    for (let b = 0; b <= N; b++) {
      for (let a = 0; a <= N; a++) acc(x0 + a * CELL, y0 + b * CELL, Math.max(WATER_Z, hAt(a, b)));
    }
    for (const b of buildings) { acc(b.x0, b.y0, b.z1 + 3); acc(b.x1, b.y1, b.z1 + 3); acc(b.x0, b.y1, b.z1 + 3); acc(b.x1, b.y0, b.z0); }
    for (const t of trees) { acc(t.x, t.y, t.z + t.h + t.r); acc(t.x - t.r, t.y, t.z); acc(t.x + t.r, t.y, t.z); }
    rmin = Math.floor(rmin * S) / S;
    umax = Math.ceil(umax * S) / S;
    const pad = 4;
    const cw = Math.min(4096, Math.ceil((rmax - rmin) * S) + pad * 2);
    const chh = Math.min(4096, Math.ceil((umax - umin) * S) + pad * 2);
    const canvas = makeCanvas(cw, chh);
    const ctx = canvas.getContext('2d');
    const ch = {
      i, j, canvas, ctx, rmin, umax, pad, w: cw, h: chh, used: 0,
      order: (i + 0.5) * FX + (j + 0.5) * FY,
      x0, y0,
    };
    const px = (x, y) => (x * RX + y * RY - rmin) * S + pad;
    const py = (x, y, z) => (umax - ((x * FX + y * FY) * SE + z * CE)) * S + pad;

    // Terrain quads
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1;
    const rnd = mulberry32(((i * 73856093) ^ (j * 19349663) ^ w.seed) >>> 0);
    const jitter = new Float32Array(N * N);
    for (let k = 0; k < N * N; k++) jitter[k] = rnd();
    for (const k of CELL_ORDER) {
      const a = k % N, b = (k / N) | 0;
      const xa = x0 + a * CELL, ya = y0 + b * CELL;
      const h00 = hAt(a, b), h10 = hAt(a + 1, b), h01 = hAt(a, b + 1), h11 = hAt(a + 1, b + 1);
      const hm = (h00 + h10 + h01 + h11) * 0.25;
      const water = hm < WATER_Z;
      const z00 = water ? WATER_Z : Math.max(WATER_Z, h00);
      const z10 = water ? WATER_Z : Math.max(WATER_Z, h10);
      const z01 = water ? WATER_Z : Math.max(WATER_Z, h01);
      const z11 = water ? WATER_Z : Math.max(WATER_Z, h11);
      const color = this._cellColor(xa + CELL / 2, ya + CELL / 2, hm, a, b, hAt, towns, jitter[k], water);
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(px(xa, ya), py(xa, ya, z00));
      ctx.lineTo(px(xa + CELL, ya), py(xa + CELL, ya, z10));
      ctx.lineTo(px(xa + CELL, ya + CELL), py(xa + CELL, ya + CELL, z11));
      ctx.lineTo(px(xa, ya + CELL), py(xa, ya + CELL, z01));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    for (const p of pads) this._drawPad(ctx, px, py, p, S);

    // Replay decals, then objects on top
    ch.px = px; ch.py = py;
    for (const d of this.decals) {
      if (d.x > x0 - 20 && d.x < x0 + C + 20 && d.y > y0 - 20 && d.y < y0 + C + 20) this._paintDecal(ch, d);
    }

    const objs = [];
    for (const b of buildings) objs.push({ d: depth((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, 0), b });
    for (const t of trees) objs.push({ d: depth(t.x, t.y, 0), t });
    objs.sort((a, b) => b.d - a.d);
    for (const o of objs) {
      if (o.b) this._drawBuilding(ctx, px, py, o.b, S);
      else this._drawTree(ctx, px, py, o.t, S);
    }
    return ch;
  }

  _cellColor(x, y, h, a, b, hAt, towns, jit, water) {
    const w = this.world;
    if (water) {
      const d = Math.min(1, -h / 25);
      const r = 62 - 34 * d, g = 120 - 46 * d, bb = 150 - 30 * d;
      const k = 0.96 + jit * 0.06;
      return rgb(r * k, g * k, bb * k);
    }
    // Normal from grid
    const nx = -(hAt(a + 1, b) - hAt(a - 1, b) + hAt(a + 2, b + 1) - hAt(a, b + 1)) / (4 * CELL);
    const ny = -(hAt(a, b + 1) - hAt(a, b - 1) + hAt(a + 1, b + 2) - hAt(a + 1, b)) / (4 * CELL);
    const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
    const lit = Math.max(0, (nx * L[0] + ny * L[1] + L[2]) * inv);
    const slope = Math.sqrt(nx * nx + ny * ny);

    let type;
    let street = false, inTown = false;
    for (const t of towns) {
      const d = Math.hypot(x - t.x, y - t.y);
      if (d < t.r + 6) {
        inTown = true;
        const lx = ((x - t.x) % 26 + 39) % 26, ly = ((y - t.y) % 26 + 39) % 26;
        if (d < 38) street = true;
        else street = lx < 4 || lx > 22 || ly < 4 || ly > 22;
      }
    }
    if (inTown) type = street ? TER.TOWN : TER.GRASS;
    else if (h < 2.2) type = TER.SAND;
    else {
      const snowLine = 205 + w.n.noise(x * 0.01, y * 0.01) * 20;
      if (h > snowLine && slope < 0.9) type = TER.SNOW;
      else if (slope > 0.75 || h > 175) type = TER.ROCK;
      else if (w.n2.noise(x * 0.012, y * 0.012) > 0.45) type = TER.DIRT;
      else type = TER.GRASS;
    }
    const base = BASE[type];
    let r = base[0], g = base[1], bl = base[2];
    if (type === TER.GRASS) {
      const m = w.n.noise(x * 0.03, y * 0.03);
      r += m * 14; g += m * 16 + (h > 90 ? -10 : 0); bl += m * 6;
      if (inTown) { r += 8; g += 6; }
    } else if (type === TER.TOWN) {
      const plaza = towns.some((t) => Math.hypot(x - t.x, y - t.y) < 36);
      if (plaza) { r = 150; g = 146; bl = 136; } else { r = 78; g = 80; bl = 86; }
    }
    const shade = 0.55 + 0.62 * lit;
    const k = shade * (0.97 + jit * 0.06);
    return rgb(Math.min(255, r * k), Math.min(255, g * k), Math.min(255, bl * k));
  }

  _trees(i, j, hAt, towns) {
    const w = this.world;
    const out = [];
    const rnd = mulberry32(((i * 92821) ^ (j * 68917) ^ (w.seed * 31)) >>> 0);
    const step = 6;
    for (let b = 0; b < C / step; b++) {
      for (let a = 0; a < C / step; a++) {
        const x = i * C + (a + rnd()) * step, y = j * C + (b + rnd()) * step;
        const s = rnd(), sz = rnd();
        const dens = w.n2.fbm(x * 0.004 + 40, y * 0.004 - 12, 3);
        if (dens < 0.08 || s > (dens - 0.08) * 2.8) continue;
        const ga = Math.min(N - 1, Math.max(0, Math.floor((x - i * C) / CELL)));
        const gb = Math.min(N - 1, Math.max(0, Math.floor((y - j * C) / CELL)));
        const h = hAt(ga, gb);
        if (h < 3 || h > 180) continue;
        const slope = Math.abs(hAt(ga + 1, gb) - hAt(ga, gb)) + Math.abs(hAt(ga, gb + 1) - hAt(ga, gb));
        if (slope > 2.4) continue;
        if (towns.some((t) => Math.hypot(x - t.x, y - t.y) < t.r + 25)) continue;
        if (w.pads.some((p) => Math.hypot(x - p.x, y - p.y) < 30)) continue;
        if (w.n2.noise(x * 0.012, y * 0.012) > 0.45) continue;
        const conifer = h > 85 || sz > 0.7;
        out.push({ x, y, z: h, r: 1.6 + sz * 1.8, h: conifer ? 2 + sz * 2 : 1.5 + sz, conifer, v: rnd() });
      }
    }
    return out;
  }

  _drawTree(ctx, px, py, t, S) {
    const x = px(t.x, t.y), yb = py(t.x, t.y, t.z);
    const top = py(t.x, t.y, t.z + t.h);
    const r = t.r * S;
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(x + r * 0.35, yb + r * 0.1, r * 1.05, r * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4a3a2a';
    ctx.fillRect(x - Math.max(1, S * 0.18), top, Math.max(2, S * 0.36), yb - top);
    const g0 = t.v * 18;
    if (t.conifer) {
      const ht = (t.r * 2.6) * S;
      for (let k = 0; k < 2; k++) {
        const yy = top - k * ht * 0.35;
        const rr = r * (1 - k * 0.3);
        ctx.fillStyle = rgb(38 + g0 * 0.4, 72 + g0, 44);
        ctx.beginPath();
        ctx.moveTo(x, yy - ht * 0.7);
        ctx.lineTo(x + rr, yy + rr * 0.25);
        ctx.lineTo(x - rr, yy + rr * 0.25);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = rgb(62 + g0 * 0.5, 104 + g0, 60);
        ctx.beginPath();
        ctx.moveTo(x, yy - ht * 0.7);
        ctx.lineTo(x - rr, yy + rr * 0.25);
        ctx.lineTo(x - rr * 0.1, yy + rr * 0.1);
        ctx.closePath();
        ctx.fill();
      }
    } else {
      const cy = top - r * 0.6;
      ctx.fillStyle = rgb(46 + g0 * 0.5, 84 + g0, 40);
      ctx.beginPath();
      ctx.arc(x, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgb(78 + g0 * 0.5, 122 + g0, 58);
      ctx.beginPath();
      ctx.arc(x - r * 0.3, cy - r * 0.3, r * 0.58, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawBuilding(ctx, px, py, b, S) {
    const { x0, x1, y0, y1, z0, z1 } = b;
    const quad = (ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, fill) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(px(ax, ay), py(ax, ay, az));
      ctx.lineTo(px(bx, by), py(bx, by, bz));
      ctx.lineTo(px(cx, cy), py(cx, cy, cz));
      ctx.lineTo(px(dx, dy), py(dx, dy, dz));
      ctx.closePath();
      ctx.fill();
    };
    const shadeHex = (hex, k) => {
      const n = parseInt(hex.slice(1), 16);
      return rgb(Math.min(255, ((n >> 16) & 255) * k), Math.min(255, ((n >> 8) & 255) * k), Math.min(255, (n & 255) * k));
    };
    // Ground shadow toward screen right/down
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    const sh = (z1 - z0) * 0.35;
    quad(x0, y0, z0 + 1, x1, y0, z0 + 1, x1 + sh * -L[0] * 2, y0 + sh * -L[1] * 2, z0 + 1, x0 + sh * -L[0] * 2, y0 + sh * -L[1] * 2, z0 + 1, 'rgba(0,0,0,0.22)');
    // Visible walls: south (y0) and west (x0)
    const southK = 0.62 + 0.38 * Math.max(0, -L[1]);
    const westK = 0.62 + 0.38 * Math.max(0, -L[0]);
    quad(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1, shadeHex(b.wall, southK));
    quad(x0, y0, z0, x0, y1, z0, x0, y1, z1, x0, y0, z1, shadeHex(b.wall, westK));

    // Windows
    const floors = Math.floor((z1 - z0 - 2) / 3.2);
    const rnd = mulberry32(b.seed);
    const winLit = 'rgba(255,226,150,0.85)', winDark = 'rgba(28,36,48,0.8)';
    for (let f = 0; f < floors; f++) {
      const za = z0 + 2 + f * 3.2, zb = za + 1.6;
      for (let x = x0 + 1.2; x < x1 - 1.2; x += 2.6) {
        quad(x, y0 - 0.01, za, x + 1.3, y0 - 0.01, za, x + 1.3, y0 - 0.01, zb, x, y0 - 0.01, zb, rnd() < 0.18 ? winLit : winDark);
      }
      for (let y = y0 + 1.2; y < y1 - 1.2; y += 2.6) {
        quad(x0 - 0.01, y, za, x0 - 0.01, y + 1.3, za, x0 - 0.01, y + 1.3, zb, x0 - 0.01, y, zb, rnd() < 0.18 ? winLit : winDark);
      }
    }
    // Roof + parapet
    quad(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, shadeHex(b.roof, 0.8 + 0.3 * L[2]));
    ctx.strokeStyle = shadeHex(b.roof, 0.6);
    ctx.lineWidth = Math.max(1, S * 0.3);
    ctx.beginPath();
    ctx.moveTo(px(x0, y0), py(x0, y0, z1));
    ctx.lineTo(px(x1, y0), py(x1, y0, z1));
    ctx.lineTo(px(x1, y1), py(x1, y1, z1));
    ctx.lineTo(px(x0, y1), py(x0, y1, z1));
    ctx.closePath();
    ctx.stroke();
    if (b.pad) {
      this._drawPad(ctx, px, py, b.pad, S);
    } else if (x1 - x0 > 10) {
      // HVAC box
      const ux = x0 + (x1 - x0) * 0.25, uy = y0 + (y1 - y0) * 0.5;
      quad(ux, uy, z1, ux + 3, uy, z1, ux + 3, uy, z1 + 1.4, ux, uy, z1 + 1.4, shadeHex(b.wall, 0.7));
      quad(ux, uy, z1 + 1.4, ux + 3, uy, z1 + 1.4, ux + 3, uy + 2, z1 + 1.4, ux, uy + 2, z1 + 1.4, shadeHex(b.roof, 1.0));
    }
  }

  _drawPad(ctx, px, py, p, S) {
    const cx = px(p.x, p.y), cy = py(p.x, p.y, p.z);
    const r = p.r * S;
    ctx.fillStyle = p.kind === 'roof' ? '#3b3f46' : '#5a5d62';
    ctx.beginPath();
    ctx.ellipse(cx, cy, (p.r + 2) * S, (p.r + 2) * S * SE, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#f2d23a';
    ctx.lineWidth = Math.max(1.5, S * 0.35);
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * SE, 0, 0, Math.PI * 2);
    ctx.stroke();
    // "H" aligned to world north
    ctx.strokeStyle = '#f4f4f4';
    ctx.lineWidth = Math.max(1.5, S * 0.55);
    const seg = (ax, ay, bx, by) => {
      ctx.moveTo(px(p.x + ax, p.y + ay), py(p.x + ax, p.y + ay, p.z));
      ctx.lineTo(px(p.x + bx, p.y + by), py(p.x + bx, p.y + by, p.z));
    };
    ctx.beginPath();
    seg(-1.6, -2.4, -1.6, 2.4);
    seg(1.6, -2.4, 1.6, 2.4);
    seg(-1.6, 0, 1.6, 0);
    ctx.stroke();
  }

  // ── decals ──
  addDecal(d) {
    this.decals.push(d);
    if (this.decals.length > MAX_DECALS) this.decals.splice(0, this.decals.length - MAX_DECALS);
    const i0 = Math.floor((d.x - 12) / C), i1 = Math.floor((d.x + 12) / C);
    const j0 = Math.floor((d.y - 12) / C), j1 = Math.floor((d.y + 12) / C);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const ch = this.chunks.get(this.key(i, j));
        if (ch) this._paintDecal(ch, d);
      }
    }
  }

  _paintDecal(ch, d) {
    const ctx = ch.ctx, S = this.S;
    const x = ch.px(d.x, d.y), y = ch.py(d.x, d.y, d.z);
    ctx.save();
    if (d.type === 'wash') {
      ctx.globalAlpha = d.a;
      ctx.strokeStyle = d.color;
      ctx.lineWidth = Math.max(1, d.w * S);
      ctx.beginPath();
      ctx.ellipse(x, y, d.r * S, d.r * S * SE, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (d.type === 'skid') {
      ctx.globalAlpha = d.a;
      ctx.strokeStyle = d.color;
      ctx.lineWidth = Math.max(1, 0.28 * S);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(ch.px(d.x2, d.y2), ch.py(d.x2, d.y2, d.z));
      ctx.stroke();
    } else if (d.type === 'scorch') {
      const g = ctx.createRadialGradient(x, y, 0, x, y, d.r * S);
      g.addColorStop(0, 'rgba(12,10,8,0.85)');
      g.addColorStop(0.6, 'rgba(25,20,15,0.5)');
      g.addColorStop(1, 'rgba(25,20,15,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, d.r * S, d.r * S * SE, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
