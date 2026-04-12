/**
 * Low-poly helicopter mesh, projected through the fixed 2.5D camera each
 * frame. Flat Lambert shading with quantised colour strings (no per-frame
 * string building), back-face culling, painter's sort. Main rotor drawn as
 * a translucent tilted/coned disc with blades at the real azimuth, so disc
 * tilt from cyclic and flapback is directly visible.
 */

import { TO_CAM, SE } from './view.js';
import { LIGHT } from './terrain.js';

const SHADES = 24;

function shadeTable(hex, alpha = 1) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const out = [];
  for (let i = 0; i < SHADES; i++) {
    const k = 0.35 + (i / (SHADES - 1)) * 0.85;
    const c = `${Math.min(255, r * k) | 0},${Math.min(255, g * k) | 0},${Math.min(255, b * k) | 0}`;
    out.push(alpha < 1 ? `rgba(${c},${alpha})` : `rgb(${c})`);
  }
  return out;
}

const COL = {
  body: shadeTable('#d8452e'),
  stripe: shadeTable('#f1efe8'),
  glass: shadeTable('#3f6f8e', 0.92),
  dark: shadeTable('#2a2d33'),
  boom: shadeTable('#e1e0da'),
};

// Cross-sections: x, half-width, z-bottom, z-top
const SECTIONS = [
  [2.35, 0.25, -0.5, -0.05],
  [1.9, 0.62, -0.82, 0.35],
  [1.2, 0.8, -0.92, 0.92],
  [-0.4, 0.82, -0.92, 0.98],
  [-1.5, 0.7, -0.78, 0.9],
  [-2.1, 0.32, -0.15, 0.5],
];

function buildMesh() {
  const V = [];
  const F = [];
  const ring = (x, hw, zb, zt) => {
    const h = zt - zb, mid = zb + h * 0.55;
    const base = V.length;
    V.push([x, 0.55 * hw, zt], [x, hw, mid], [x, 0.8 * hw, zb], [x, -0.8 * hw, zb], [x, -hw, mid], [x, -0.55 * hw, zt]);
    return base;
  };
  const rings = SECTIONS.map((s) => ring(...s));
  for (let s = 0; s < rings.length - 1; s++) {
    const a = rings[s], b = rings[s + 1];
    const glassy = s <= 1;
    for (let k = 0; k < 6; k++) {
      const k2 = (k + 1) % 6;
      let col = COL.body;
      if (k === 5) col = s === 0 ? COL.glass : COL.body;           // top
      if ((k === 0 || k === 4) && (glassy || s === 2)) col = COL.glass; // upper sides / windows
      if (k === 2) col = COL.dark;                                  // belly
      if ((k === 1 || k === 3) && s >= 2) col = COL.stripe;
      // Outward winding: a→b ordering reversed for proper normals
      F.push({ v: [a + k, a + k2, b + k2, b + k], col });
    }
  }
  const first = rings[0], last = rings[rings.length - 1];
  F.push({ v: [first + 5, first + 4, first + 3, first + 2, first + 1, first], col: COL.glass });
  F.push({ v: [last, last + 1, last + 2, last + 3, last + 4, last + 5], col: COL.body });

  // Engine doghouse (box)
  const box = (x0, x1, y0, y1, z0, z1, col) => {
    const b = V.length;
    V.push([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
    F.push({ v: [b + 4, b + 5, b + 6, b + 7], col });           // top
    F.push({ v: [b, b + 3, b + 2, b + 1], col });               // bottom
    F.push({ v: [b, b + 1, b + 5, b + 4], col });               // y0 side
    F.push({ v: [b + 2, b + 3, b + 7, b + 6], col });           // y1 side
    F.push({ v: [b + 1, b + 2, b + 6, b + 5], col });           // x1 front
    F.push({ v: [b, b + 4, b + 7, b + 3], col });               // x0 rear
  };
  box(-1.5, 0.5, -0.45, 0.45, 0.9, 1.35, COL.boom);
  box(-0.12, 0.12, -0.12, 0.12, 1.35, 1.6, COL.dark);          // mast
  // Tail boom (tapered box)
  {
    const b = V.length;
    V.push([-2.0, -0.28, -0.05], [-2.0, 0.28, -0.05], [-2.0, 0.28, 0.45], [-2.0, -0.28, 0.45]);
    V.push([-6.1, -0.1, 0.22], [-6.1, 0.1, 0.22], [-6.1, 0.1, 0.42], [-6.1, -0.1, 0.42]);
    F.push({ v: [b + 3, b + 2, b + 6, b + 7], col: COL.boom });
    F.push({ v: [b, b + 4, b + 5, b + 1], col: COL.boom });
    F.push({ v: [b, b + 3, b + 7, b + 4], col: COL.body });
    F.push({ v: [b + 1, b + 5, b + 6, b + 2], col: COL.body });
    F.push({ v: [b + 4, b + 7, b + 6, b + 5], col: COL.boom });
  }
  // Horizontal stabiliser (double-sided thin box)
  box(-4.55, -4.05, -1.05, 1.05, 0.14, 0.2, COL.body);
  // Vertical fin
  box(-6.25, -5.55, -0.04, 0.04, 0.3, 1.45, COL.body);
  box(-6.1, -5.75, -0.04, 0.04, -0.35, 0.25, COL.body);
  return { V, F };
}

const MESH = buildMesh();

// Face normals in body frame (Newell's method)
for (const f of MESH.F) {
  let nx = 0, ny = 0, nz = 0;
  const n = f.v.length;
  for (let i = 0; i < n; i++) {
    const a = MESH.V[f.v[i]], b = MESH.V[f.v[(i + 1) % n]];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const l = Math.hypot(nx, ny, nz) || 1;
  f.n = [nx / l, ny / l, nz / l];
}

// Skid geometry (lines), body frame
const SKIDS = [
  [[-1.7, 1.1, -1.25], [1.7, 1.1, -1.25], [2.05, 1.1, -1.05]],
  [[-1.7, -1.1, -1.25], [1.7, -1.1, -1.25], [2.05, -1.1, -1.05]],
  [[0.95, 1.1, -1.25], [0.9, 0.7, -0.85], [0.9, -0.7, -0.85], [0.95, -1.1, -1.25]],
  [[-0.95, 1.1, -1.25], [-0.95, 0.7, -0.8], [-0.95, -0.7, -0.8], [-0.95, -1.1, -1.25]],
];

const NV = MESH.V.length;

export class HeliRenderer {
  constructor(view) {
    this.view = view;
    this.sx = new Float32Array(NV);
    this.sy = new Float32Array(NV);
    this.wz = new Float32Array(NV);
    this.wd = new Float32Array(NV);
    this.order = MESH.F.map((f, i) => ({ i, d: 0, vis: true, shade: 0 }));
    this.azimuth = 0;
    this.trAzimuth = 0;
  }

  /** Body → world → screen for a body point. */
  _proj(h, bx, by, bz, out) {
    const R = h.R, p = h.pos, v = this.view;
    const x = p[0] + R[0] * bx + R[1] * by + R[2] * bz;
    const y = p[1] + R[3] * bx + R[4] * by + R[5] * bz;
    const z = p[2] + R[6] * bx + R[7] * by + R[8] * bz;
    out[0] = v.sx(x, y);
    out[1] = v.sy(x, y, z);
    out[2] = x; out[3] = y; out[4] = z;
    return out;
  }

  advance(dt, h) {
    this.azimuth = (this.azimuth + h.omega * dt) % (Math.PI * 2);
    this.trAzimuth = (this.trAzimuth + h.omega * h.p.tailRotor.gear * dt) % (Math.PI * 2);
  }

  /** Ground shadow: fuselage silhouette + rotor disc on the plane z = zg. */
  drawShadow(ctx, h, zg) {
    const v = this.view, R = h.R, p = h.pos;
    const agl = Math.max(0, p[2] - zg);
    const a = Math.max(0.06, 0.34 - agl * 0.004);
    const lx = -LIGHT[0] / LIGHT[2], ly = -LIGHT[1] / LIGHT[2];
    const proj = (bx, by, bz) => {
      const x = p[0] + R[0] * bx + R[1] * by + R[2] * bz;
      const y = p[1] + R[3] * bx + R[4] * by + R[5] * bz;
      const z = p[2] + R[6] * bx + R[7] * by + R[8] * bz;
      const d = z - zg;
      return [v.sx(x + lx * d, y + ly * d), v.sy(x + lx * d, y + ly * d, zg)];
    };
    ctx.fillStyle = `rgba(0,0,0,${a})`;
    ctx.beginPath();
    for (const f of MESH.F) {
      const c = R[6] * f.n[0] + R[7] * f.n[1] + R[8] * f.n[2];
      if (c > -0.2) continue;
      for (let k = 0; k < f.v.length; k++) {
        const q = MESH.V[f.v[k]];
        const s = proj(q[0], q[1], q[2]);
        if (k === 0) ctx.moveTo(s[0], s[1]); else ctx.lineTo(s[0], s[1]);
      }
      ctx.closePath();
    }
    ctx.fill();
    // Rotor disc + blades
    const Rr = h.p.mainRotor.R, hh = h.p.mainRotor.hubHeight;
    const disc = proj(0, 0, hh);
    const S = v.S;
    ctx.fillStyle = `rgba(0,0,0,${a * 0.28 * Math.min(1, h.t.nr)})`;
    ctx.beginPath();
    ctx.ellipse(disc[0], disc[1], Rr * S, Rr * S * SE, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(0,0,0,${a * 0.9})`;
    ctx.lineWidth = Math.max(1, S * 0.22);
    ctx.beginPath();
    for (let b = 0; b < 2; b++) {
      const ps = this.azimuth + b * Math.PI;
      const t = proj(Math.cos(ps) * Rr, Math.sin(ps) * Rr, hh);
      ctx.moveTo(disc[0], disc[1]);
      ctx.lineTo(t[0], t[1]);
    }
    ctx.stroke();
  }

  draw(ctx, h) {
    const v = this.view, R = h.R, p = h.pos, S = v.S;
    const sx = this.sx, sy = this.sy;
    for (let i = 0; i < NV; i++) {
      const q = MESH.V[i];
      const x = p[0] + R[0] * q[0] + R[1] * q[1] + R[2] * q[2];
      const y = p[1] + R[3] * q[0] + R[4] * q[1] + R[5] * q[2];
      const z = p[2] + R[6] * q[0] + R[7] * q[1] + R[8] * q[2];
      sx[i] = v.sx(x, y);
      sy[i] = v.sy(x, y, z);
      this.wd[i] = -(x * TO_CAM[0] + y * TO_CAM[1] + z * TO_CAM[2]);
    }
    const ord = this.order;
    for (const o of ord) {
      const f = MESH.F[o.i];
      const nx = R[0] * f.n[0] + R[1] * f.n[1] + R[2] * f.n[2];
      const ny = R[3] * f.n[0] + R[4] * f.n[1] + R[5] * f.n[2];
      const nz = R[6] * f.n[0] + R[7] * f.n[1] + R[8] * f.n[2];
      o.vis = nx * TO_CAM[0] + ny * TO_CAM[1] + nz * TO_CAM[2] > 0;
      let d = 0;
      for (const k of f.v) d += this.wd[k];
      o.d = d / f.v.length;
      const lit = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
      o.shade = Math.min(SHADES - 1, Math.round((0.25 + 0.75 * lit) * (SHADES - 1)));
    }
    ord.sort((a, b) => b.d - a.d);

    // Skids first (they sit below the fuselage)
    const tmp = [0, 0, 0, 0, 0];
    ctx.strokeStyle = '#2b2b2e';
    ctx.lineWidth = Math.max(1.2, S * 0.14);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const line of SKIDS) {
      for (let k = 0; k < line.length; k++) {
        this._proj(h, line[k][0], line[k][1], line[k][2], tmp);
        if (k === 0) ctx.moveTo(tmp[0], tmp[1]); else ctx.lineTo(tmp[0], tmp[1]);
      }
    }
    ctx.stroke();

    ctx.lineJoin = 'round';
    ctx.lineWidth = 0.6;
    for (const o of ord) {
      if (!o.vis) continue;
      const f = MESH.F[o.i];
      const c = f.col[o.shade];
      ctx.fillStyle = c;
      ctx.strokeStyle = c;
      ctx.beginPath();
      ctx.moveTo(sx[f.v[0]], sy[f.v[0]]);
      for (let k = 1; k < f.v.length; k++) ctx.lineTo(sx[f.v[k]], sy[f.v[k]]);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    this._tailRotor(ctx, h);
    this._mainRotor(ctx, h);
  }

  _tailRotor(ctx, h) {
    const tr = h.p.tailRotor, S = this.view.S;
    const c = this._proj(h, tr.pos[0], tr.pos[1] - 0.2, tr.pos[2], [0, 0, 0, 0, 0]);
    const pts = [];
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      pts.push(this._proj(h, tr.pos[0] + Math.cos(a) * tr.R, tr.pos[1] - 0.2, tr.pos[2] + Math.sin(a) * tr.R, [0, 0, 0, 0, 0]));
    }
    const load = Math.min(1, Math.abs(h.t.trThrust) / 1500);
    ctx.fillStyle = `rgba(210,220,230,${0.1 + 0.15 * load})`;
    ctx.strokeStyle = 'rgba(40,40,45,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    pts.forEach((q, k) => (k ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = '#1d1d20';
    ctx.lineWidth = Math.max(1, S * 0.1);
    ctx.beginPath();
    for (let b = 0; b < 2; b++) {
      const a = this.trAzimuth + b * Math.PI;
      const t = this._proj(h, tr.pos[0] + Math.cos(a) * tr.R, tr.pos[1] - 0.2, tr.pos[2] + Math.sin(a) * tr.R, [0, 0, 0, 0, 0]);
      ctx.moveTo(c[0], c[1]);
      ctx.lineTo(t[0], t[1]);
    }
    ctx.stroke();
  }

  _mainRotor(ctx, h) {
    const mr = h.p.mainRotor, S = this.view.S;
    const hh = mr.hubHeight, Rr = mr.R;
    const coning = Math.max(-0.02, Math.min(0.12, (h.t.cts || 0) * 0.9));
    const aLon = h.aLon, aLat = h.aLat;
    const tip = (ang, frac) => {
      const cx = Math.cos(ang) * Rr * frac, cy = Math.sin(ang) * Rr * frac;
      const dz = -aLon * cx - aLat * cy + coning * Rr * frac;
      return this._proj(h, cx, cy, hh + dz, [0, 0, 0, 0, 0]);
    };
    const hub = this._proj(h, 0, 0, hh, [0, 0, 0, 0, 0]);
    const nr = Math.min(1.2, h.t.nr);
    const stress = Math.min(1, Math.max(0, (h.t.stall - 0.6) * 2.5));
    const vrs = h.t.vrs;
    ctx.beginPath();
    for (let k = 0; k <= 24; k++) {
      const q = tip((k / 24) * Math.PI * 2, 1);
      if (k === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]);
    }
    const r = 190 + 60 * stress + 50 * vrs, g = 205 - 90 * vrs, b = 215 - 100 * vrs;
    ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${0.08 + 0.12 * nr})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(30,30,35,${0.25 * nr})`;
    ctx.lineWidth = 1;
    ctx.stroke();
    // Blades with motion ghosts
    ctx.lineCap = 'round';
    const ghosts = nr > 0.3 ? 4 : 1;
    for (let gI = ghosts - 1; gI >= 0; gI--) {
      ctx.strokeStyle = gI === 0 ? '#18181b' : `rgba(24,24,27,${0.35 / gI})`;
      ctx.lineWidth = Math.max(1.5, S * (gI === 0 ? 0.32 : 0.26));
      ctx.beginPath();
      for (let bl = 0; bl < 2; bl++) {
        const a = this.azimuth + bl * Math.PI - gI * 0.13;
        const t = tip(a, 1);
        const m = tip(a, 0.15);
        ctx.moveTo(m[0], m[1]);
        ctx.lineTo(t[0], t[1]);
      }
      ctx.stroke();
    }
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(hub[0], hub[1], Math.max(2, S * 0.28), 0, Math.PI * 2);
    ctx.fill();
  }

  /** Blade-tip world positions (for vapour trails). */
  tips(h, out) {
    const mr = h.p.mainRotor, R = h.R, p = h.pos;
    const coning = Math.max(0, Math.min(0.12, (h.t.cts || 0) * 0.9));
    for (let b = 0; b < 2; b++) {
      const a = this.azimuth + b * Math.PI;
      const cx = Math.cos(a) * mr.R, cy = Math.sin(a) * mr.R;
      const cz = mr.hubHeight - h.aLon * cx - h.aLat * cy + coning * mr.R;
      out[b * 3] = p[0] + R[0] * cx + R[1] * cy + R[2] * cz;
      out[b * 3 + 1] = p[1] + R[3] * cx + R[4] * cy + R[5] * cz;
      out[b * 3 + 2] = p[2] + R[6] * cx + R[7] * cy + R[8] * cz;
    }
    return out;
  }
}
