/**
 * Single rigid-body helicopter: 6-DOF fuselage + main rotor (flapping disc,
 * dynamic inflow, VRS, ground effect) + tail rotor + turboshaft drivetrain
 * + skid contact. Frames: world x east / y north / z up; body x fwd / y left
 * / z up. Quaternion q rotates body → world. Allocation-free in step().
 */

import { HELI, DERIVED, RHO, G } from './params.js';
import { Engine } from './engine.js';
import {
  clamp, smoothstep, inflowTarget, vrsIndex, groundEffectFactor,
  thrustCoeff, stallCap, torqueCoeff,
} from './rotor.js';

export const SURF = { GROUND: 0, WATER: 1, ROOF: 2, PAD: 3 };

export const FLAT_ENV = {
  surfaceZ: () => 0,
  surfaceKind: () => SURF.GROUND,
  normal: (x, y, out) => { out[0] = 0; out[1] = 0; out[2] = 1; },
  wind: (x, y, z, t, out) => { out[0] = 0; out[1] = 0; out[2] = 0; },
};

const RIM_N = 8;
const RIM_COS = new Float64Array(RIM_N);
const RIM_SIN = new Float64Array(RIM_N);
for (let i = 0; i < RIM_N; i++) {
  RIM_COS[i] = Math.cos((i / RIM_N) * Math.PI * 2);
  RIM_SIN[i] = Math.sin((i / RIM_N) * Math.PI * 2);
}

export class Heli {
  constructor(env = FLAT_ENV, p = HELI) {
    this.p = p;
    this.env = env;
    this.engine = new Engine(p.engine, p.mainRotor.omegaNom);

    this.pos = new Float64Array(3);
    this.vel = new Float64Array(3);
    this.q = new Float64Array(4);
    this.w = new Float64Array(3);
    this.R = new Float64Array(9);

    // Controls (pilot, pre-SAS)
    this.controls = { collective: 0, cyclicLon: 0, cyclicLat: 0, pedal: 0 };
    this.sas = true;

    this._n = new Float64Array(3);
    this._wind = new Float64Array(3);
    this._F = new Float64Array(3);
    this._M = new Float64Array(3);
    this._safe = null;

    this.t = new Telemetry();
    this.reset(0, 0, 0, 0);
  }

  /** Place at rest with skids on the surface at (x, y). */
  reset(x, y, zSurface, heading, engineRunning = true) {
    const mr = this.p.mainRotor;
    this.pos[0] = x; this.pos[1] = y;
    this.pos[2] = zSurface + 1.25 - (this.p.mass * G) / (4 * this.p.skidK);
    this.vel.fill(0);
    this.w.fill(0);
    const h = heading * 0.5;
    this.q[0] = Math.cos(h); this.q[1] = 0; this.q[2] = 0; this.q[3] = Math.sin(h);
    this.omega = engineRunning ? mr.omegaNom : 0;
    this.engine.reset(this.omega, engineRunning);
    this.vi = 0;
    this.viTr = 0;
    this.aLon = 0;
    this.aLat = 0;
    this.time = 0;
    this.crashed = false;
    this.crashReason = '';
    this.contacts = 0;
    this.wasInContact = true;
    this.maxImpact = 0;
    this.impactEvent = 0;       // latched peak touchdown sink rate for FX/audio
    this.scrape = 0;
    this.controls.collective = 0;
    this.controls.cyclicLon = 0;
    this.controls.cyclicLat = 0;
    this.controls.pedal = 0;
    this._safe = null;
    this._snapshot();
    this._updateR();
  }

  heading() {
    const R = this.R;
    return Math.atan2(R[3], R[0]);
  }

  _updateR() {
    const q = this.q, R = this.R;
    const w = q[0], x = q[1], y = q[2], z = q[3];
    R[0] = 1 - 2 * (y * y + z * z); R[1] = 2 * (x * y - w * z);     R[2] = 2 * (x * z + w * y);
    R[3] = 2 * (x * y + w * z);     R[4] = 1 - 2 * (x * x + z * z); R[5] = 2 * (y * z - w * x);
    R[6] = 2 * (x * z - w * y);     R[7] = 2 * (y * z + w * x);     R[8] = 1 - 2 * (x * x + y * y);
  }

  _snapshot() {
    this._safe = {
      pos: Float64Array.from(this.pos), vel: Float64Array.from(this.vel),
      q: Float64Array.from(this.q), w: Float64Array.from(this.w),
      omega: this.omega, vi: this.vi, viTr: this.viTr, aLon: this.aLon, aLat: this.aLat,
      omegaE: this.engine.omegaE, n1: this.engine.n1,
    };
  }

  _restore() {
    const s = this._safe;
    this.pos.set(s.pos); this.vel.set(s.vel); this.q.set(s.q); this.w.set(s.w);
    this.w.fill(0);
    this.omega = s.omega; this.vi = s.vi; this.viTr = s.viTr;
    this.aLon = 0; this.aLat = 0;
    this.engine.omegaE = s.omegaE; this.engine.n1 = s.n1; this.engine.integ = 0;
    this.t.nanRecoveries++;
  }

  crash(reason) {
    if (this.crashed) return;
    this.crashed = true;
    this.crashReason = reason;
    this.engine.running = false;
  }

  /** Advance dt seconds (call with small fixed dt, ~2.5 ms). */
  step(dt) {
    const p = this.p, mr = p.mainRotor, tr = p.tailRotor, env = this.env, T = this.t;
    const R = this.R, pos = this.pos, vel = this.vel, w = this.w;
    this.time += dt;
    this._updateR();

    // ── Air-relative body velocity at CG ──
    env.wind(pos[0], pos[1], pos[2], this.time, this._wind);
    const vax = vel[0] - this._wind[0], vay = vel[1] - this._wind[1], vaz = vel[2] - this._wind[2];
    const ub = R[0] * vax + R[3] * vay + R[6] * vaz;
    const vb = R[1] * vax + R[4] * vay + R[7] * vaz;
    const wb = R[2] * vax + R[5] * vay + R[8] * vaz;
    const wx = w[0], wy = w[1], wz = w[2];

    // ── Controls with rate-damping SAS ──
    const c = this.controls;
    const coll = this.crashed ? 0 : clamp(c.collective, 0, 1);
    let cLon = c.cyclicLon, cLat = c.cyclicLat, ped = c.pedal;
    if (this.sas) {
      cLon -= 0.35 * wy;
      cLat -= 0.30 * wx;
      ped += 0.45 * wz;
    }
    cLon = clamp(cLon, -1, 1); cLat = clamp(cLat, -1, 1); ped = clamp(ped, -1, 1);

    let Fx = 0, Fy = 0, Fz = 0, Mx = 0, My = 0, Mz = 0;

    // ── Main rotor ──
    const Om = Math.max(this.omega, 0);
    const tip = Om * mr.R;
    const A = DERIVED.mrArea, sig = DERIVED.mrSigma;
    const h = mr.hubHeight;
    let nx = this.aLon, ny = this.aLat;
    const nInv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
    nx *= nInv; ny *= nInv; const nz = nInv;

    const hx = ub + wy * h, hy = vb - wx * h, hz = wb;
    const Vc = hx * nx + hy * ny + hz * nz;
    const ipx = hx - Vc * nx, ipy = hy - Vc * ny, ipz = hz - Vc * nz;
    const Vip = Math.sqrt(ipx * ipx + ipy * ipy + ipz * ipz);

    const theta = mr.collMin + coll * (mr.collMax - mr.collMin);
    const hubWz = pos[2] + R[8] * h;
    const hubWx = pos[0] + R[2] * h, hubWy = pos[1] + R[5] * h;
    const hubAgl = hubWz - env.surfaceZ(hubWx, hubWy);

    let thrust = 0, qMr = 0, cts = 0, lambda = 0, mu = 0, vh = 0, vrs = 0, geF = 1, ctsLim = mr.ctsMax;
    if (tip > 2) {
      lambda = (Vc + this.vi) / tip;
      mu = Vip / tip;
      const ctRaw = thrustCoeff(theta, lambda, mu, sig, mr.a);
      cts = stallCap(ctRaw / sig, mr.ctsMax, mu);
      ctsLim = Math.max(mr.ctsMax * (1 - 0.9 * mu * mu) - 0.03 * mu, 0.04);
      const ct = cts * sig;
      thrust = ct * RHO * A * tip * tip;

      vh = Math.sqrt(Math.abs(thrust) / (2 * RHO * A));
      geF = groundEffectFactor(mr.R, hubAgl, Vip, vh);
      const viT = inflowTarget(thrust, Vc, Vip, RHO, A, this.vi, geF);
      this.vi += (viT - this.vi) * Math.min(1, dt / mr.inflowTau);
      vrs = vrsIndex(vh, Vc, Vip);

      const stallX = Math.max(0, Math.abs(cts) / ctsLim - 0.8);
      const cd = mr.cd0 * (1 + 60 * stallX * stallX);
      const cq = torqueCoeff(ct, Vc, this.vi, tip, mr.kappa, sig, cd, mu);
      qMr = cq * RHO * A * tip * tip * mr.R;
      // Recirculating wake wastes power: ~30 % of ideal induced power at peak VRS
      qMr += (0.3 * vrs * Math.abs(thrust) * vh) / Om;
    } else {
      this.vi *= 1 - Math.min(1, dt / mr.inflowTau);
    }

    // VRS: unsteady thrust and disc buffet from the recirculating wake
    const tt = this.time;
    const nA = Math.sin(tt * 13.2) * 0.5 + Math.sin(tt * 23.1 + 1.3) * 0.3 + Math.sin(tt * 37.7 + 2.1) * 0.2;
    const nB = Math.sin(tt * 11.7 + 0.4) * 0.5 + Math.sin(tt * 29.3 + 2.7) * 0.3 + Math.sin(tt * 41.9) * 0.2;
    // Pulling collective in VRS feeds the ring: loss grows with collective
    const vrsLoss = vrs * (0.10 + 0.30 * coll);
    const thrustApplied = thrust * (1 - vrsLoss + 0.22 * vrs * nA);

    Fx += thrustApplied * nx; Fy += thrustApplied * ny; Fz += thrustApplied * nz;
    Mx += -h * thrustApplied * ny - mr.hubSpring * this.aLat;
    My += h * thrustApplied * nx + mr.hubSpring * this.aLon;
    const buffet = vrs * Math.abs(thrust) * 0.05;
    Mx += buffet * nB; My += buffet * nA * 0.8;

    // ── Disc flapping (first-order, gyroscopic lag gives rate damping) ──
    const tauB = 16 / (mr.lock * Math.max(Om, 8));
    let tLon = cLon * mr.maxTilt, tLat = -cLat * mr.maxTilt;
    let etl = 0;
    if (Vip > 0.5 && tip > 2) {
      const dx = ipx / Vip, dy = ipy / Vip;
      const a1 = (2 * mu * ((4 * theta) / 3 - lambda)) / (1 - 0.5 * mu * mu);
      const beta0 = (mr.lock / 8) * (theta * (1 + mu * mu) - (4 / 3) * lambda);
      const s = vh > 1 ? Vip / vh : 0;
      etl = s * Math.exp(1 - s);                        // transverse-flow bump, peaks at Vip ≈ vh
      const b1 = ((4 / 3) * mu * beta0) / (1 + 0.5 * mu * mu) + 0.02 * etl;
      tLon += -a1 * dx + b1 * dy;
      tLat += -a1 * dy - b1 * dx;
    }
    this.aLon += ((tLon - this.aLon) / tauB - wy) * dt;
    this.aLat += ((tLat - this.aLat) / tauB + wx) * dt;
    const stop = mr.maxTilt * 1.6;
    const mastBump = Math.abs(this.aLon) > stop * 0.9 || Math.abs(this.aLat) > stop * 0.9;
    this.aLon = clamp(this.aLon, -stop, stop);
    this.aLat = clamp(this.aLat, -stop, stop);

    // Fuselage download in the rotor wake
    const wakeOnBody = 1 - smoothstep(0, 1.5, vh > 1 ? Vip / vh : 2);
    Fz -= p.fuselage.download * thrust * wakeOnBody;

    // ── Tail rotor (thrust along −y body) ──
    const trx = tr.pos[0], trz = tr.pos[2];
    const tvx = ub + wy * trz, tvy = vb + wz * trx - wx * trz, tvz = wb - wy * trx;
    const VcT = -tvy;
    const VipT = Math.sqrt(tvx * tvx + tvz * tvz);
    const OmT = Om * tr.gear;
    const tipT = OmT * tr.R;
    const thetaT = tr.pitchNeutral - ped * tr.pitchRange;
    let thrustT = 0, qTr = 0, ctsT = 0, vrsT = 0;
    if (tipT > 5) {
      const lamT = (VcT + this.viTr) / tipT;
      const muT = VipT / tipT;
      ctsT = stallCap(thrustCoeff(thetaT, lamT, muT, DERIVED.trSigma, tr.a) / DERIVED.trSigma, 0.14, muT);
      const ctT = ctsT * DERIVED.trSigma;
      thrustT = ctT * RHO * DERIVED.trArea * tipT * tipT;
      const viT = inflowTarget(thrustT, VcT, VipT, RHO, DERIVED.trArea, this.viTr, 1);
      this.viTr += (viT - this.viTr) * Math.min(1, dt / tr.inflowTau);
      const vhT = Math.sqrt(Math.abs(thrustT) / (2 * RHO * DERIVED.trArea));
      vrsT = vrsIndex(vhT, VcT * Math.sign(thrustT || 1), VipT);
      const cqT = torqueCoeff(ctT, VcT, this.viTr, tipT, 1.2, DERIVED.trSigma, tr.cd0, muT);
      qTr = cqT * RHO * DERIVED.trArea * tipT * tipT * tr.R;
      thrustT *= tr.blockage * (1 - 0.35 * vrsT);
    }
    Fy -= thrustT;
    Mx += trz * thrustT;
    Mz += -trx * thrustT;

    // ── Fuselage aero ──
    const fu = p.fuselage;
    const V = Math.sqrt(ub * ub + vb * vb + wb * wb);
    const qd = 0.5 * RHO * V;
    Fx -= qd * fu.fx * ub; Fy -= qd * fu.fy * vb; Fz -= qd * fu.fz * wb;
    Mx -= fu.damp[0] * wx; My -= fu.damp[1] * wy; Mz -= fu.damp[2] * wz;

    // Horizontal stabiliser — sees rotor wake in transition (pitch-up hump)
    {
      const s = p.hstab, rx = s.pos[0], rz = s.pos[2];
      const sx = ub + wy * rz;
      let sz = wb - wy * rx;
      const wr = this.vi > 0.5 ? Math.abs(sx) / this.vi : 0;
      sz += this.vi * 1.4 * smoothstep(0.3, 0.9, wr) * (1 - smoothstep(1.4, 2.6, wr));
      const V2 = sx * sx + sz * sz;
      const alpha = clamp(Math.atan2(-sz, Math.abs(sx)), -0.35, 0.35);
      const L = 0.5 * RHO * V2 * s.area * s.cla * alpha;
      Fz += L; My += -rx * L;
    }
    // Vertical fin — weathercock stability
    {
      const f = p.vfin, rx = f.pos[0], rz = f.pos[2];
      const sx = ub + wy * rz, sy = vb + wz * rx - wx * rz;
      const Vf = Math.sqrt(sx * sx + sy * sy);
      if (Vf > 0.5) {
        const sb = sy / Vf;
        const coef = (f.cla * sb) / (1 + (sb / 0.4) ** 2) + 1.2 * sb * Math.abs(sb);
        const Fs = -0.5 * RHO * Vf * Vf * f.area * coef;
        Fy += Fs; Mx += -rz * Fs; Mz += rx * Fs;
      }
    }

    // ── Drivetrain: engine ↔ sprag ↔ rotor ──
    const eng = this.engine;
    eng.updateN1(dt, coll);
    const Jr = mr.J, Je = p.engine.Je;
    const qFric = 60 + 1.2 * Om;
    const qLoad = qMr + qTr * tr.gear + qFric;
    const qE = eng.torque();
    let dOm;
    if (eng.engaged) {
      dOm = (qE - qLoad) / (Jr + Je);
      if (qE - Je * dOm < 0 && this.omega > 1) {
        eng.engaged = false;
      }
    }
    if (eng.engaged) {
      this.omega += dOm * dt;
      eng.omegaE = this.omega;
    } else {
      dOm = -qLoad / Jr;
      this.omega += dOm * dt;
      const dOe = (qE - (8 + 0.4 * eng.omegaE)) / Je;
      eng.omegaE = Math.max(0, eng.omegaE + dOe * dt);
      if (eng.omegaE >= this.omega) {
        const m = (Jr * this.omega + Je * eng.omegaE) / (Jr + Je);
        this.omega = m; eng.omegaE = m; eng.engaged = true;
      }
    }
    if (this.omega < 0) this.omega = 0;
    // Shaft torque into the main rotor reacts on the fuselage (nose-right for CCW rotor)
    const qShaft = qMr + Jr * dOm;
    Mz -= qShaft;

    // ── World-frame force sum ──
    const F = this._F, M = this._M;
    F[0] = R[0] * Fx + R[1] * Fy + R[2] * Fz;
    F[1] = R[3] * Fx + R[4] * Fy + R[5] * Fz;
    F[2] = R[6] * Fx + R[7] * Fy + R[8] * Fz - p.mass * G;
    M[0] = 0; M[1] = 0; M[2] = 0;       // world-frame contact moments

    // ── Skid contacts ──
    let contacts = 0, sink = 0, slide = 0;
    const n = this._n;
    const sk = p.skids;
    for (let i = 0; i < sk.length; i++) {
      const bx = sk[i][0], by = sk[i][1], bz = sk[i][2];
      const rx = R[0] * bx + R[1] * by + R[2] * bz;
      const ry = R[3] * bx + R[4] * by + R[5] * bz;
      const rz = R[6] * bx + R[7] * by + R[8] * bz;
      const px = pos[0] + rx, py = pos[1] + ry, pz = pos[2] + rz;
      const zs = env.surfaceZ(px, py);
      const pen = zs - pz;
      if (pen <= 0) continue;
      contacts++;
      if (env.surfaceKind(px, py) === SURF.WATER) this.crash('DITCHED');
      if (pen > 0.9) this.crash('STRUCK OBSTACLE');
      // Point velocity = v + ω × r (ω to world)
      const owx = R[0] * wx + R[1] * wy + R[2] * wz;
      const owy = R[3] * wx + R[4] * wy + R[5] * wz;
      const owz = R[6] * wx + R[7] * wy + R[8] * wz;
      const pvx = vel[0] + owy * rz - owz * ry;
      const pvy = vel[1] + owz * rx - owx * rz;
      const pvz = vel[2] + owx * ry - owy * rx;
      env.normal(px, py, n);
      const vn = pvx * n[0] + pvy * n[1] + pvz * n[2];
      if (!this.wasInContact && -vn > sink) sink = -vn;
      let fn = p.skidK * pen - p.skidC * vn;
      if (fn < 0) fn = 0;
      const tx = pvx - vn * n[0], ty = pvy - vn * n[1], tz = pvz - vn * n[2];
      const vt = Math.sqrt(tx * tx + ty * ty + tz * tz);
      slide = Math.max(slide, vt);
      const ff = (-p.skidMu * fn) / (vt + 0.05);
      const cfx = fn * n[0] + ff * tx, cfy = fn * n[1] + ff * ty, cfz = fn * n[2] + ff * tz;
      F[0] += cfx; F[1] += cfy; F[2] += cfz;
      M[0] += ry * cfz - rz * cfy;
      M[1] += rz * cfx - rx * cfz;
      M[2] += rx * cfy - ry * cfx;
    }
    if (contacts > 0 && !this.wasInContact) {
      this.impactEvent = Math.max(this.impactEvent, sink);
      if (sink > p.crash.vImpact) this.crash('HARD LANDING');
    }
    if (contacts > 0) {
      const hs = Math.hypot(vel[0], vel[1]);
      if (hs > p.crash.hImpact) this.crash('GROUND IMPACT');
      if (R[8] < Math.cos(p.crash.tilt)) this.crash('ROLLOVER');
    }
    this.scrape = contacts > 0 ? slide : 0;
    this.wasInContact = contacts > 0;
    this.contacts = contacts;

    // Rotor rim + tail strikes
    if (Om > 8) {
      const ex = R[0], ey = R[3], ez = R[6];     // body x in world
      const fx = R[1], fy = R[4], fz = R[7];     // body y in world
      for (let i = 0; i < RIM_N; i++) {
        const cx = RIM_COS[i] * mr.R, cy = RIM_SIN[i] * mr.R;
        const px = hubWx + ex * cx + fx * cy;
        const py = hubWy + ey * cx + fy * cy;
        const pz = hubWz + ez * cx + fz * cy - this.aLon * cx - this.aLat * cy;
        if (pz < env.surfaceZ(px, py)) { this.crash('ROTOR STRIKE'); break; }
      }
      const tpx = pos[0] + R[0] * trx + R[2] * trz;
      const tpy = pos[1] + R[3] * trx + R[5] * trz;
      const tpz = pos[2] + R[6] * trx + R[8] * trz - tr.R;
      if (tpz < env.surfaceZ(tpx, tpy) - 0.1) this.crash('TAIL ROTOR STRIKE');
    }

    // ── Integrate ──
    const im = 1 / p.mass;
    vel[0] += F[0] * im * dt; vel[1] += F[1] * im * dt; vel[2] += F[2] * im * dt;
    if (this.crashed) {
      const d = Math.exp(-2.5 * dt);
      if (contacts > 0) { vel[0] *= d; vel[1] *= d; }
    }
    pos[0] += vel[0] * dt; pos[1] += vel[1] * dt; pos[2] += vel[2] * dt;

    // Contact moment into body frame
    const cMx = R[0] * M[0] + R[3] * M[1] + R[6] * M[2];
    const cMy = R[1] * M[0] + R[4] * M[1] + R[7] * M[2];
    const cMz = R[2] * M[0] + R[5] * M[1] + R[8] * M[2];
    const tMx = Mx + cMx, tMy = My + cMy, tMz = Mz + cMz;
    const Ix = p.Ixx, Iy = p.Iyy, Iz = p.Izz;
    w[0] += ((tMx - (Iz - Iy) * wy * wz) / Ix) * dt;
    w[1] += ((tMy - (Ix - Iz) * wz * wx) / Iy) * dt;
    w[2] += ((tMz - (Iy - Ix) * wx * wy) / Iz) * dt;
    if (this.crashed && contacts > 0) {
      const d = Math.exp(-3 * dt);
      w[0] *= d; w[1] *= d; w[2] *= d;
    }

    const q = this.q;
    const q0 = q[0], q1 = q[1], q2 = q[2], q3 = q[3];
    const hw = 0.5 * dt;
    q[0] += hw * (-q1 * w[0] - q2 * w[1] - q3 * w[2]);
    q[1] += hw * (q0 * w[0] + q2 * w[2] - q3 * w[1]);
    q[2] += hw * (q0 * w[1] - q1 * w[2] + q3 * w[0]);
    q[3] += hw * (q0 * w[2] + q1 * w[1] - q2 * w[0]);
    const qn = 1 / Math.hypot(q[0], q[1], q[2], q[3]);
    q[0] *= qn; q[1] *= qn; q[2] *= qn; q[3] *= qn;

    // ── Finite-state guard ──
    if (!Number.isFinite(pos[0] + pos[1] + pos[2] + vel[0] + vel[1] + vel[2] + w[0] + w[1] + w[2]
      + q[0] + this.omega + this.vi + this.viTr + this.aLon + this.aLat)) {
      this._restore();
    } else if ((this._snapTick = (this._snapTick || 0) + 1) % 200 === 0) {
      this._snapshot();
    }

    // ── Telemetry ──
    T.thrust = thrust;
    T.torqueMr = qMr;
    T.torqueTr = qTr;
    T.qShaft = qShaft;
    T.cts = cts;
    T.ctsLim = ctsLim;
    T.stall = Math.abs(cts) / ctsLim;
    T.vi = this.vi;
    T.vh = vh;
    T.lambda = lambda;
    T.mu = mu;
    T.vc = Vc;
    T.vip = Vip;
    T.vrs = vrs;
    T.vrsTr = vrsT;
    T.ge = geF;
    T.hubAgl = hubAgl;
    T.etl = etl;
    T.trThrust = thrustT;
    T.trCts = ctsT;
    T.theta = theta;
    T.thetaTr = thetaT;
    T.nr = this.omega / mr.omegaNom;
    T.n2 = eng.omegaE / mr.omegaNom;
    T.n1 = eng.n1;
    T.engaged = eng.engaged;
    T.engineOn = eng.running;
    T.powerKw = eng.power() / 1000;
    T.torquePct = eng.engaged ? (qE / p.engine.torqueRef) : 0;
    T.loadFactor = (thrustApplied * nz) / (p.mass * G);
    T.mastBump = mastBump;
    T.airspeed = V;
    T.cLon = cLon; T.cLat = cLat; T.ped = ped; T.coll = coll;
  }
}

export class Telemetry {
  constructor() {
    this.thrust = 0; this.torqueMr = 0; this.torqueTr = 0; this.qShaft = 0;
    this.cts = 0; this.ctsLim = 0.13; this.stall = 0;
    this.vi = 0; this.vh = 0; this.lambda = 0; this.mu = 0; this.vc = 0; this.vip = 0;
    this.vrs = 0; this.vrsTr = 0; this.ge = 1; this.hubAgl = 0; this.etl = 0;
    this.trThrust = 0; this.trCts = 0; this.theta = 0; this.thetaTr = 0;
    this.nr = 1; this.n2 = 1; this.n1 = 0.8; this.engaged = true; this.engineOn = true;
    this.powerKw = 0; this.torquePct = 0; this.loadFactor = 1; this.mastBump = false;
    this.airspeed = 0; this.cLon = 0; this.cLat = 0; this.ped = 0; this.coll = 0;
    this.nanRecoveries = 0;
  }
}
