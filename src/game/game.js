/**
 * Game loop: fixed-step physics (400 Hz) decoupled from rAF rendering
 * (runs at display rate — 144 Hz+ on high-refresh monitors).
 */

import { Heli } from '../sim/heli.js';
import { World } from '../world/world.js';
import { View, CE } from '../render/view.js';
import { TerrainCache } from '../render/terrain.js';
import { HeliRenderer } from '../render/heli.js';
import { FX } from '../render/fx.js';
import { Hud } from '../render/hud.js';
import { SwashView } from '../render/swash.js';
import { Input } from '../input/input.js';
import { Mission } from './mission.js';

const PHYS_DT = 1 / 400;

// Altitude the camera frames: linear up to A0, then log soft-limit so high
// flight keeps detail (shadow may leave the screen; the AGL tag still reads).
const A0 = 35, AK = 20;
export function framedAltitude(agl) {
  return agl <= A0 ? agl : A0 + AK * Math.log1p((agl - A0) / AK);
}
/** Slight zoom-out with ground speed: ~7 % at 25 m/s, ~13 % at 50 m/s. */
export function speedZoom(gs) {
  return 1 / (1 + 0.003 * gs);
}
const MAX_FRAME = 0.1;

function lsGet(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } }

export class Game {
  constructor(canvas, { seed = 1, wind = 'light', sas = true, audio = null, maxDpr = 1.5, onDebug = null }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.world = new World(seed, wind);
    this.heli = new Heli(this.world);
    this.heli.sas = sas;
    this.view = new View();
    this.terrain = new TerrainCache(this.world, this.view);
    this.heliR = new HeliRenderer(this.view);
    this.fx = new FX(this.world, this.view, this.terrain);
    this.hud = new Hud(this.world);
    this.swash = new SwashView();
    this.mission = new Mission(this.world, seed);
    this.input = new Input(canvas);
    this.audio = audio;
    this.maxDpr = maxDpr;
    this.onDebug = onDebug;
    this.debugVisible = true;
    this.paused = false;
    this.acc = 0;
    this.engineHold = 0;
    this.shake = 0;
    this.azTotal = 0;
    this.wind = new Float64Array(3);
    this.tips = new Float64Array(6);
    this.cam = [0, 0, 0];
    this.frameMs = 0;
    this.physMs = 0;
    this.renderMs = 0;
    this.dt = 0;
    this._dbgAcc = 0;
    this.bestScore = Number(lsGet('tinyheli.best', '0')) || 0;
    this._deliveries = 0;
    this._raf = 0;
    this.seed = seed;

    const start = this.world.pads.find((p) => p.kind === 'ground') || this.world.pads[0];
    this.homePad = start;
    this._spawn(start);
    this.mission.next(start);

    this._resize = () => this.resize();
    window.addEventListener('resize', this._resize);
    this.resize();
    this.hud.buildMinimap();
    this.terrain.update(1500);        // prefill visible chunks before first frame
  }

  _spawn(pad) {
    this.heli.reset(pad.x, pad.y, pad.z, 1.0);
    this.input.coll = 0;
    this.input.trim = { lon: 0, lat: 0, ped: 0 };
    this.input.cyc = { lon: 0, lat: 0 };
    this.input.ped = 0;
    this.fx.reset();
    this.cam = [pad.x, pad.y, pad.z];
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    const w = window.innerWidth, h = window.innerHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.view.resize(w, h, dpr);
  }

  start() {
    let last = performance.now();
    const frame = (now) => {
      this._raf = requestAnimationFrame(frame);
      const dt = Math.max(0, Math.min(MAX_FRAME, (now - last) / 1000));
      last = now;
      this.tick(dt);
    };
    this._raf = requestAnimationFrame(frame);
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._resize);
    this.input.destroy();
  }

  _keys(dt) {
    const I = this.input, h = this.heli;
    if (I.was('Backquote')) this.debugVisible = !this.debugVisible;
    if (I.was('KeyH')) this.hud.showHelp = !this.hud.showHelp;
    if (I.was('KeyG')) { h.sas = !h.sas; this.audio?.shot('click'); }
    if (I.was('KeyM')) this.audio?.toggleMute();
    if (I.was('KeyP')) { this.paused = !this.paused; this.paused ? this.audio?.suspend() : this.audio?.resume(); }
    if (I.was('Tab')) this.hud.showMini = !this.hud.showMini;
    if (I.was('Equal') || I.was('NumpadAdd')) this.view.setZoom(this.view.zoomIdx + 1);
    if (I.was('Minus') || I.was('NumpadSubtract')) this.view.setZoom(this.view.zoomIdx - 1);
    if (I.was('KeyN')) this.mission.next(this.mission.padUnder(h)?.pad || this.mission.origin);
    if (I.was('KeyR')) {
      const pad = this.mission.origin || this.homePad;
      if (h.crashed) this.mission.onCrash();
      this._spawn(pad);
    }
    if (I.down('KeyF') && !h.crashed) {
      if (this.engineHold >= 0) this.engineHold += dt;
      if (this.engineHold >= 0.6) {
        h.engine.running = !h.engine.running;
        this.engineHold = -10;        // latch until release
        this.audio?.shot('click');
      }
    } else this.engineHold = 0;
  }

  tick(dt) {
    const t0 = performance.now();
    this.dt = dt;
    const h = this.heli;
    const gpEdges = this.input.update(dt, h.controls);
    this._keys(dt);
    if (gpEdges.includes(3)) this._spawn(this.mission.origin || this.homePad);
    if (gpEdges.includes(1) && !h.crashed) h.engine.running = !h.engine.running;
    if (gpEdges.includes(9)) this.paused = !this.paused;

    // ── physics ──
    const tp = performance.now();
    if (!this.paused) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= PHYS_DT && n < 80) {
        h.step(PHYS_DT);
        this.acc -= PHYS_DT;
        n++;
      }
      if (n === 80) this.acc = 0;
    }
    this.physMs = performance.now() - tp;

    const wasCrashed = this._wasCrashed;
    if (h.crashed && !wasCrashed) { this.audio?.shot(h.crashReason === 'DITCHED' ? 'splash' : 'crash', 1); this.shake = 1.5; this.mission.onCrash(); }
    this._wasCrashed = h.crashed;

    // ── effects & audio ──
    const simDt = this.paused ? 0 : dt;
    this.heliR.advance(simDt, h);
    this.azTotal += h.omega * simDt;
    h.azimuthCount = Math.floor(this.azTotal / Math.PI);
    h.tipsWorld = this.heliR.tips(h, this.tips);
    this.world.wind(h.pos[0], h.pos[1], h.pos[2], h.time, this.wind);
    if (!this.paused) this.fx.update(simDt, h, this.wind);
    this.mission.update(simDt, h);
    if (this.mission.deliveries !== this._deliveries) {
      this._deliveries = this.mission.deliveries;
      this.audio?.shot('chime');
      if (this.mission.score > this.bestScore) { this.bestScore = this.mission.score; lsSet('tinyheli.best', String(this.bestScore)); }
    }
    if (h.impactEvent > 0.3) {
      this.audio?.shot('thud', Math.min(1.2, h.impactEvent / 2.5));
      this.shake = Math.max(this.shake, Math.min(1, h.impactEvent / 3));
    }
    h.impactEvent = 0;
    this.audio?.update(dt, h);

    // Vibration: VRS buffet, ETL shudder, blade stall, ground scrape
    const t = h.t;
    const etlShudder = t.etl > 0.5 && t.airspeed > 4 && t.airspeed < 14 ? (t.etl - 0.5) * 0.5 : 0;
    const vib = t.vrs * 0.9 + etlShudder + Math.max(0, t.stall - 0.85) * 3 + (h.contacts ? Math.min(0.6, h.scrape * 0.2) : 0);
    this.shake = Math.max(0, this.shake - dt * 1.6);
    const amp = (vib * 2.2 + this.shake * 9) * this.view.dpr;
    this.view.shakeX = (Math.random() - 0.5) * amp;
    this.view.shakeY = (Math.random() - 0.5) * amp;
    this.input.setRumble(t.vrs * 0.7 + this.shake * 0.8, 0.04 + etlShudder + Math.min(0.3, Math.abs(t.cts) * 1.5) * t.nr);

    // ── camera: follow with velocity lead; zoom out as needed to keep heli + shadow framed ──
    const v = this.view;
    const zg = this.world.surfaceZ(h.pos[0], h.pos[1]);
    const agl = Math.max(0, h.pos[2] - zg);
    const aFrame = framedAltitude(agl);
    const gs = Math.hypot(h.vel[0], h.vel[1]);
    const fitS = (0.34 * v.H) / (Math.max(1, aFrame) * CE);
    const targetS = Math.max(2.4 * v.dpr, Math.min(v.userS, fitS) * speedZoom(gs));
    if (!this.liveS) this.liveS = targetS;
    this.liveS += (targetS - this.liveS) * (1 - Math.exp(-dt * 2.2));
    v.S = this.liveS;
    const leadMax = (0.22 * v.W) / v.S;
    const lead = 0.7;
    const tx = h.pos[0] + Math.max(-leadMax, Math.min(leadMax, h.vel[0] * lead));
    const ty = h.pos[1] + Math.max(-leadMax, Math.min(leadMax, h.vel[1] * lead));
    // Midway to the shadow while it fits; above that keep the heli ~30 % from the top
    const tz = h.pos[2] - Math.min(0.5 * aFrame, (0.2 * v.H) / (v.S * CE));
    const k = 1 - Math.exp(-dt * 5);
    this.cam[0] += (tx - this.cam[0]) * k;
    this.cam[1] += (ty - this.cam[1]) * k;
    this.cam[2] += (tz - this.cam[2]) * k;
    v.lookAt(this.cam[0], this.cam[1], this.cam[2]);

    // ── render ──
    const tr = performance.now();
    this.render(dt);
    this.renderMs = performance.now() - tr;
    if (this.debugVisible) this.swash.draw(h, this.heliR.azimuth);
    this.input.endFrame();

    this.frameMs = performance.now() - t0;
    this._dbgAcc += dt;
    if (this.onDebug && this._dbgAcc > 0.05) {
      this._dbgAcc = 0;
      this.onDebug(this.snapshot());
    }
  }

  render(dt) {
    const ctx = this.ctx, v = this.view, h = this.heli;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#56704c';
    ctx.fillRect(0, 0, v.W, v.H);
    this.terrain.update(2.5);
    this.terrain.draw(ctx);
    this.fx.drawGround(ctx);
    const zg = this.world.surfaceZ(h.pos[0], h.pos[1]);
    this.heliR.drawShadow(ctx, h, zg);
    // Drop line + AGL tag: the altitude cue from heli to its shadow
    const agl = h.pos[2] - zg;
    if (agl > 2.5) {
      const x = v.sx(h.pos[0], h.pos[1]);
      const y0 = v.sy(h.pos[0], h.pos[1], h.pos[2] - 1.25), y1 = v.sy(h.pos[0], h.pos[1], zg);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.setLineDash([5 * v.dpr, 5 * v.dpr]);
      ctx.lineWidth = v.dpr;
      ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
      ctx.setLineDash([]);
      // 10 m ticks
      ctx.beginPath();
      for (let m = 10; m < agl - 1.25; m += 10) {
        const yy = v.sy(h.pos[0], h.pos[1], zg + m);
        ctx.moveTo(x - 4 * v.dpr, yy); ctx.lineTo(x + 4 * v.dpr, yy);
      }
      ctx.stroke();
      ctx.font = `${12 * v.dpr}px "Share Tech Mono", monospace`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      const label = `${Math.round((agl - 1.25) * 3.28084)} ft`;
      const ym = Math.max(y0 + 24 * v.dpr, Math.min((y0 + y1) / 2, v.H * 0.7));
      ctx.fillRect(x + 8 * v.dpr, ym - 9 * v.dpr, ctx.measureText(label).width + 8 * v.dpr, 18 * v.dpr);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, x + 12 * v.dpr, ym);
    }
    this.heliR.draw(ctx, h);
    this.fx.drawRings(ctx);
    this.fx.drawAir(ctx, h);
    this.fx.drawVapour(ctx);
    this.hud.draw(ctx, this, dt);
  }

  snapshot() {
    const h = this.heli, t = h.t, a = this.audio;
    return {
      dt: this.dt, frameMs: this.frameMs, physMs: this.physMs, renderMs: this.renderMs,
      n1: t.n1, n2: t.n2, nr: t.nr, rotorRpm: (h.omega * 60) / (2 * Math.PI),
      trRpm: (h.omega * h.p.tailRotor.gear * 60) / (2 * Math.PI),
      torquePct: t.torquePct, powerKw: t.powerKw, qShaft: t.qShaft,
      coll: h.controls.collective, theta: t.theta, thetaTr: t.thetaTr,
      cLon: t.cLon, cLat: t.cLat, ped: t.ped,
      thrust: t.thrust, cts: t.cts, stall: t.stall, trThrust: t.trThrust,
      vi: t.vi, vh: t.vh, vc: t.vc, vip: t.vip, mu: t.mu, lambda: t.lambda,
      vrs: t.vrs, vrsTr: t.vrsTr, ge: t.ge, etl: t.etl, hubAgl: t.hubAgl,
      airspeed: t.airspeed, vs: h.vel[2], loadFactor: t.loadFactor,
      aLon: h.aLon, aLat: h.aLat, yawRate: h.w[2], pitchRate: h.w[1], rollRate: h.w[0],
      engaged: t.engaged, engineOn: t.engineOn, sas: h.sas, contacts: h.contacts, mastBump: t.mastBump,
      crashed: h.crashed, lowRpm: t.nr < 0.95, overTorque: t.torquePct > 1,
      bands: a ? a.bands : null,
      chunksPending: this.terrain.pending, chunks: this.terrain.chunks.size,
      puffs: this.fx.stats.puffs, rings: this.fx.stats.rings, wash: this.fx.washLevel,
      nan: t.nanRecoveries, seed: this.seed, wind: this.world.windSetting,
      windSpeed: Math.hypot(this.wind[0], this.wind[1]),
    };
  }
}
