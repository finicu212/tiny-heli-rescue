/**
 * Cockpit HUD drawn on the main canvas (CSS-pixel space): warnings, dual
 * tach / torque / N1 gauges, airspeed-VSI-altitude, control-position
 * widget, mission panel, target marker, minimap.
 */

import { TER, WORLD_HALF, WATER_Z } from '../world/world.js';
import { SE } from './view.js';

const FONT = '"Share Tech Mono", monospace';
const KT = 1.943844;
const FT = 3.28084;

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export class Hud {
  constructor(world) {
    this.world = world;
    this.mini = null;
    this.miniSize = 170;
    this.flash = 0;
    this.showHelp = false;
    this.showMini = true;
  }

  buildMinimap() {
    const n = this.miniSize;
    const c = makeCanvas(n, n);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(n, n);
    const w = this.world;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = ((i + 0.5) / n * 2 - 1) * WORLD_HALF;
        const y = (1 - (j + 0.5) / n * 2) * WORLD_HALF;
        const h = w.height(x, y);
        let r, g, b;
        if (h < WATER_Z) { r = 40; g = 80; b = 120; }
        else {
          const t = w.terrainType(x, y, h);
          const k = 0.7 + Math.min(0.5, h / 400);
          if (t === TER.SNOW) { r = 225; g = 228; b = 235; }
          else if (t === TER.ROCK) { r = 110 * k; g = 104 * k; b = 98 * k; }
          else if (t === TER.SAND) { r = 180; g = 168; b = 120; }
          else { r = 70 * k; g = 100 * k; b = 56 * k; }
        }
        const o = (j * n + i) * 4;
        img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 230;
      }
    }
    ctx.putImageData(img, 0, 0);
    ctx.fillStyle = 'rgba(160,160,160,0.9)';
    for (const t of w.towns) {
      const [px, py] = this._mp(t.x, t.y);
      const r = (t.r / WORLD_HALF) * n * 0.5;
      ctx.fillRect(px - r, py - r, r * 2, r * 2);
    }
    this.mini = c;
  }

  _mp(x, y) {
    const n = this.miniSize;
    return [((x / WORLD_HALF) + 1) * 0.5 * n, (1 - y / WORLD_HALF) * 0.5 * n];
  }

  draw(ctx, g, dt) {
    const { heli: h, view: v, mission: m } = g;
    const t = h.t;
    const W = v.W / v.dpr, H = v.H / v.dpr;
    this.flash += dt;
    ctx.save();
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    ctx.textBaseline = 'middle';

    this._targetMarker(ctx, g, W, H);
    this._warnings(ctx, g, W, H);
    this._gauges(ctx, h, W, H);
    this._controls(ctx, h, g, W, H);
    this._mission(ctx, g, W, H);
    if (this.showMini) this._minimap(ctx, g, W, H);
    if (this.showHelp) this._help(ctx, W, H);
    ctx.restore();
  }

  _warnings(ctx, g, W, H) {
    const h = g.heli, t = h.t;
    const blink = Math.floor(this.flash * 4) % 2 === 0;
    const list = [];
    if (h.crashed) {
      ctx.fillStyle = 'rgba(10,0,0,0.35)';
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff3b30';
      ctx.font = `bold 44px ${FONT}`;
      ctx.fillText(h.crashReason || 'CRASHED', W / 2, H * 0.38);
      ctx.font = `18px ${FONT}`;
      ctx.fillStyle = '#ddd';
      ctx.fillText('R — reset to last pad', W / 2, H * 0.38 + 40);
      return;
    }
    if (t.vrs > 0.3) {
      const a = 0.55 + 0.45 * Math.min(1, t.vrs);
      ctx.textAlign = 'center';
      ctx.font = `bold ${38 + t.vrs * 10}px ${FONT}`;
      ctx.fillStyle = blink ? `rgba(255,40,30,${a})` : `rgba(255,120,100,${a * 0.6})`;
      ctx.fillText('[VRS]', W / 2, H * 0.3);
      ctx.font = `13px ${FONT}`;
      ctx.fillStyle = 'rgba(255,190,180,0.9)';
      ctx.fillText('VORTEX RING STATE — FORWARD / LATERAL CYCLIC, DON\'T PULL', W / 2, H * 0.3 + 32);
    }
    if (!t.engineOn) list.push(['ENGINE OUT', '#ff3b30']);
    if (t.nr < 0.95 && t.nr > 0.02) list.push(['LOW ROTOR RPM', '#ff3b30']);
    if (t.nr > 1.07) list.push(['ROTOR OVERSPEED', '#ffb300']);
    if (t.torquePct > 1.0) list.push(['OVERTORQUE', '#ffb300']);
    if (t.stall > 0.92) list.push(['BLADE STALL', '#ffb300']);
    if (t.mastBump) list.push(['MAST BUMP', '#ff3b30']);
    if (t.loadFactor < 0.35 && t.nr > 0.5 && h.contacts === 0 && t.hubAgl > 4) list.push(['LOW G — DON\'T ROLL', '#ffb300']);
    if (t.vrsTr > 0.4) list.push(['TAIL ROTOR VRS / LTE', '#ffb300']);
    if (!h.sas) list.push(['SAS OFF', '#8aa']);
    ctx.textAlign = 'center';
    ctx.font = `bold 16px ${FONT}`;
    let y = H * 0.3 + (t.vrs > 0.3 ? 62 : 0);
    for (const [txt, col] of list) {
      const wd = ctx.measureText(txt).width + 18;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(W / 2 - wd / 2, y - 12, wd, 24);
      ctx.fillStyle = col === '#ff3b30' && !blink ? '#a02018' : col;
      ctx.fillText(txt, W / 2, y);
      y += 28;
    }
    // Soft cues
    ctx.font = `12px ${FONT}`;
    if (t.etl > 0.6 && t.hubAgl < 60) {
      ctx.fillStyle = `rgba(160,255,160,${(t.etl - 0.6) * 1.5})`;
      ctx.fillText('ETL', W / 2 - 60, H * 0.62);
    }
    if (t.ge < 0.97) {
      ctx.fillStyle = `rgba(160,210,255,${Math.min(1, (1 - t.ge) * 6)})`;
      ctx.fillText('IN GROUND EFFECT', W / 2 + 60, H * 0.62);
    }
    if (g.engineHold > 0) {
      ctx.fillStyle = '#ffb300';
      ctx.fillText(`HOLD F — ${h.engine.running ? 'CUT' : 'START'} ENGINE ${(g.engineHold * 100 / 0.6).toFixed(0)}%`, W / 2, H * 0.66);
    }
  }

  _gauge(ctx, x, y, r, label, val, max, arcs, fmt, needle2) {
    ctx.fillStyle = 'rgba(8,10,16,0.82)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#2a2e3a'; ctx.lineWidth = 2; ctx.stroke();
    const a0 = Math.PI * 0.75, span = Math.PI * 1.5;
    const ang = (v) => a0 + span * Math.max(0, Math.min(1, v / max));
    for (const [lo, hi, col] of arcs) {
      ctx.strokeStyle = col; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(x, y, r - 5, ang(lo), ang(hi)); ctx.stroke();
    }
    const nd = (v, col, w) => {
      const a = ang(v);
      ctx.strokeStyle = col; ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * (r - 8), y + Math.sin(a) * (r - 8)); ctx.stroke();
    };
    if (needle2 !== undefined) nd(needle2, '#4fc3f7', 2);
    nd(val, '#f0f0f0', 2.5);
    ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#8890a0'; ctx.font = `10px ${FONT}`;
    ctx.fillText(label, x, y + r * 0.42);
    ctx.fillStyle = '#e8e8e8'; ctx.font = `13px ${FONT}`;
    ctx.fillText(fmt, x, y + r * 0.72);
  }

  _gauges(ctx, h, W, H) {
    const t = h.t;
    const r = 42, y = H - r - 14;
    let x = 14 + r;
    this._gauge(ctx, x, y, r, 'NR / N2', t.nr * 100, 120, [[95, 100, '#3ecf5a'], [100, 107, '#e0c030'], [107, 120, '#e03a30'], [0, 90, 'rgba(224,58,48,0.4)']], `${(t.nr * 100).toFixed(0)} ${(t.n2 * 100).toFixed(0)}`, t.n2 * 100);
    x += r * 2 + 10;
    this._gauge(ctx, x, y, r, 'TORQUE %', t.torquePct * 100, 120, [[0, 85, '#3ecf5a'], [85, 100, '#e0c030'], [100, 120, '#e03a30']], `${(t.torquePct * 100).toFixed(0)}`);
    x += r * 2 + 10;
    this._gauge(ctx, x, y, r, 'N1 %', t.n1 * 100, 110, [[62, 100, '#3ecf5a'], [100, 105, '#e0c030'], [105, 110, '#e03a30']], `${(t.n1 * 100).toFixed(1)}`);
    x += r * 2 + 10;
    // Air data block
    const bx = x - r, by = y - r;
    ctx.fillStyle = 'rgba(8,10,16,0.82)';
    ctx.fillRect(bx, by, 132, r * 2);
    ctx.strokeStyle = '#2a2e3a'; ctx.strokeRect(bx, by, 132, r * 2);
    ctx.textAlign = 'left';
    const vs = h.vel[2] * 196.85;
    const gs = Math.hypot(h.vel[0], h.vel[1]);
    const rows = [
      ['IAS', `${(t.airspeed * KT).toFixed(0)} kt`],
      ['GS', `${(gs * KT).toFixed(0)} kt`],
      ['VSI', `${vs >= 0 ? '+' : ''}${vs.toFixed(0)} fpm`],
      ['AGL', `${Math.max(0, (t.hubAgl - 2.85) * FT).toFixed(0)} ft`],
      ['HDG', `${String(Math.round(((90 - h.heading() * 57.2958) % 360 + 360) % 360)).padStart(3, '0')}°`],
    ];
    ctx.font = `11px ${FONT}`;
    rows.forEach(([k, val], i) => {
      ctx.fillStyle = '#7a8090'; ctx.fillText(k, bx + 8, by + 11 + i * 15.5);
      ctx.fillStyle = k === 'VSI' && vs < -500 && gs < 8 ? '#ff6050' : '#e8e8e8';
      ctx.fillText(val, bx + 44, by + 11 + i * 15.5);
    });
  }

  _controls(ctx, h, g, W, H) {
    const c = h.controls, t = h.t;
    const cx = W / 2, by = H - 16;
    // Collective lever
    const colX = cx - 110, colH = 84;
    ctx.fillStyle = 'rgba(8,10,16,0.75)';
    ctx.fillRect(colX - 9, by - colH, 18, colH);
    ctx.fillStyle = '#ff9800';
    ctx.fillRect(colX - 7, by - c.collective * colH, 14, c.collective * colH);
    ctx.fillStyle = '#aaa'; ctx.font = `10px ${FONT}`; ctx.textAlign = 'center';
    ctx.fillText('COLL', colX, by - colH - 9);
    // Cyclic box
    const s = 84, bx = cx - s / 2, byy = by - s;
    ctx.fillStyle = 'rgba(8,10,16,0.75)';
    ctx.fillRect(bx, byy, s, s);
    ctx.strokeStyle = '#333a48';
    ctx.beginPath(); ctx.moveTo(cx, byy); ctx.lineTo(cx, by); ctx.moveTo(bx, byy + s / 2); ctx.lineTo(bx + s, byy + s / 2); ctx.stroke();
    const tr = g.input ? g.input.trim : { lon: 0, lat: 0 };
    ctx.strokeStyle = '#8a8'; ctx.lineWidth = 1;
    const tx = cx + tr.lat * s / 2, ty = byy + s / 2 - tr.lon * s / 2;
    ctx.beginPath(); ctx.moveTo(tx - 5, ty); ctx.lineTo(tx + 5, ty); ctx.moveTo(tx, ty - 5); ctx.lineTo(tx, ty + 5); ctx.stroke();
    // Effective (post-SAS) ghost + pilot stick
    ctx.fillStyle = 'rgba(79,195,247,0.6)';
    ctx.beginPath(); ctx.arc(cx + t.cLat * s / 2, byy + s / 2 - t.cLon * s / 2, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ff4020';
    ctx.beginPath(); ctx.arc(cx + c.cyclicLat * s / 2, byy + s / 2 - c.cyclicLon * s / 2, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#aaa';
    ctx.fillText(g.input && g.input.mouseCyclic ? 'CYCLIC (MOUSE)' : 'CYCLIC', cx, byy - 9);
    // Pedals
    const px = cx + 70, pw = 90, py = by - 14;
    ctx.fillStyle = 'rgba(8,10,16,0.75)';
    ctx.fillRect(px, py, pw, 14);
    ctx.fillStyle = '#9c27b0';
    const pv = c.pedal;
    const x0 = px + pw / 2;
    ctx.fillRect(Math.min(x0, x0 + pv * pw / 2), py + 2, Math.abs(pv * pw / 2), 10);
    ctx.fillStyle = '#ddd'; ctx.fillRect(x0 - 1, py, 2, 14);
    ctx.fillStyle = '#aaa';
    ctx.fillText('PEDALS', px + pw / 2, py - 9);
    ctx.fillText(`TR ${(t.trThrust).toFixed(0)} N`, px + pw / 2, py - 24);
  }

  _mission(ctx, g, W, H) {
    const m = g.mission, h = g.heli;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(8,10,16,0.78)';
    ctx.fillRect(12, 12, 280, 82);
    ctx.font = `bold 13px ${FONT}`;
    ctx.fillStyle = '#ff4020';
    ctx.fillText('tiny heli rescue', 22, 26);
    ctx.font = `12px ${FONT}`;
    ctx.fillStyle = '#ddd';
    ctx.fillText(`SCORE ${m.score}   STREAK ×${m.streak}   BEST ${g.bestScore}`, 22, 44);
    if (m.target) {
      const d = Math.hypot(m.target.x - h.pos[0], m.target.y - h.pos[1]);
      const brg = ((90 - Math.atan2(m.target.y - h.pos[1], m.target.x - h.pos[0]) * 57.2958) % 360 + 360) % 360;
      ctx.fillStyle = '#f2d23a';
      ctx.fillText(`→ ${m.target.name}`, 22, 62);
      ctx.fillStyle = '#aab';
      ctx.fillText(`${(d / 1000).toFixed(2)} km  BRG ${brg.toFixed(0).padStart(3, '0')}°  ${m.target.kind.toUpperCase()}  ${m.elapsed.toFixed(0)}s`, 22, 80);
      if (m.hold > 0) {
        ctx.fillStyle = '#3ecf5a';
        ctx.fillRect(22, 88, 256 * Math.min(1, m.hold / 1.5), 3);
      }
    }
    if (m.lastResult && m.resultAge < 5) {
      const r = m.lastResult;
      const a = Math.min(1, 5 - m.resultAge);
      ctx.textAlign = 'center';
      ctx.font = `bold 28px ${FONT}`;
      ctx.fillStyle = `rgba(62,207,90,${a})`;
      ctx.fillText(`${r.grade} LANDING  +${r.total}`, W / 2, H * 0.2);
      ctx.font = `12px ${FONT}`;
      ctx.fillStyle = `rgba(220,220,220,${a})`;
      ctx.fillText(`${r.pad} · sink ${r.sink.toFixed(2)} m/s · centre +${r.center} · time +${r.time} · ×${r.mult.toFixed(2)}`, W / 2, H * 0.2 + 26);
    }
    ctx.textAlign = 'left';
    ctx.font = `10px ${FONT}`;
    ctx.fillStyle = 'rgba(200,200,200,0.5)';
    ctx.fillText('H help  ` debug  F engine  G SAS  R reset  +/- zoom', 14, 108);
  }

  _targetMarker(ctx, g, W, H) {
    const m = g.mission, v = g.view;
    if (!m.target) return;
    const p = m.target;
    const x = v.sx(p.x, p.y) / v.dpr, y = v.sy(p.x, p.y, p.z) / v.dpr;
    const pulse = 0.5 + 0.5 * Math.sin(this.flash * 5);
    const S = v.S / v.dpr;
    if (x > 20 && x < W - 20 && y > 20 && y < H - 20) {
      ctx.strokeStyle = `rgba(242,210,58,${0.5 + 0.4 * pulse})`;
      ctx.lineWidth = 2;
      const r = (p.r + 3 + pulse * 2) * S;
      ctx.beginPath(); ctx.ellipse(x, y, r, r * SE, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y - 30 - pulse * 6); ctx.lineTo(x, y - 12); ctx.stroke();
    } else {
      const cx = W / 2, cy = H / 2;
      const ang = Math.atan2(y - cy, x - cx);
      const ex = cx + Math.cos(ang) * (Math.min(W, H) / 2 - 40);
      const ey = cy + Math.sin(ang) * (Math.min(W, H) / 2 - 40);
      ctx.save();
      ctx.translate(ex, ey); ctx.rotate(ang);
      ctx.fillStyle = `rgba(242,210,58,${0.6 + 0.4 * pulse})`;
      ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-8, -10); ctx.lineTo(-8, 10); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  _minimap(ctx, g, W, H) {
    if (!this.mini) return;
    const n = this.miniSize;
    const x0 = W - n - 12 - (g.debugVisible ? 300 : 0), y0 = H - n - 12;
    ctx.globalAlpha = 0.92;
    ctx.drawImage(this.mini, x0, y0);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#2a2e3a'; ctx.strokeRect(x0, y0, n, n);
    for (const p of this.world.pads) {
      const [px, py] = this._mp(p.x, p.y);
      ctx.fillStyle = p === g.mission.target ? (Math.floor(this.flash * 3) % 2 ? '#f2d23a' : '#fff') : '#c0c0c0';
      ctx.fillRect(x0 + px - 2, y0 + py - 2, 4, 4);
    }
    const h = g.heli;
    const [hx, hy] = this._mp(h.pos[0], h.pos[1]);
    const a = h.heading();
    ctx.save();
    ctx.translate(x0 + hx, y0 + hy); ctx.rotate(-a);
    ctx.fillStyle = '#ff4020';
    ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, -4); ctx.lineTo(-4, 4); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  _help(ctx, W, H) {
    const lines = [
      'CONTROLS',
      'W / S ........ collective up / down   (mouse wheel too)',
      'Arrows ....... cyclic (springs back to trim)',
      'Click ........ lock mouse → mouse = cyclic (stays put)',
      'A / D ........ pedals (anti-torque)',
      'T ............ force-trim: hold current cyclic + pedal',
      'C ............ centre trim',
      'F (hold) ..... cut / relight engine → practise autorotation',
      'G ............ SAS rate damping on/off',
      'R ............ reset to last pad    N  new target',
      '+ / - ........ zoom    `  debug   M  mute   P  pause',
      'Gamepad ...... RS cyclic, LS-X pedals, LT/RT collective, A trim',
      '',
      'Land on the yellow pad, settle 1.5 s. Softer + centred = more points.',
      'Vertical descents > ~500 fpm below ETL → [VRS]. Fly out forward.',
    ];
    const w = 540, hh = lines.length * 18 + 24;
    const x = W / 2 - w / 2, y = H / 2 - hh / 2;
    ctx.fillStyle = 'rgba(8,10,16,0.92)';
    ctx.fillRect(x, y, w, hh);
    ctx.textAlign = 'left';
    lines.forEach((l, i) => {
      ctx.fillStyle = i === 0 ? '#ff4020' : '#ccd';
      ctx.font = `${i === 0 ? 'bold 14px' : '12px'} ${FONT}`;
      ctx.fillText(l, x + 20, y + 20 + i * 18);
    });
  }
}
