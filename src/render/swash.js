/**
 * Zoomed, live swashplate/rotor-head cutaway for the debug panel.
 *
 *   servos → stationary plate (tilt = cyclic, height = collective)
 *   rotating plate (spins with the mast) → pitch links → blade grips
 *
 * Blade pitch is computed per azimuth exactly as the sim applies it:
 *   θ(ψ) = θ0 + Alat·cos ψ + Blon·sin ψ   (ψ from the nose, CCW from above)
 * Max pitch leads max flap by 90°, so forward cyclic peaks pitch on the left
 * (retreating) side and the disc dips at the nose. The paddles visibly twist as they go round; the side graph plots the
 * same sinusoid with each blade's current position.
 */

import { RX, RY, FX, FY, SE, CE } from './view.js';

const DEG = 180 / Math.PI;

export class SwashView {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.az = 0;
  }

  attach(canvas) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
  }

  draw(h, azimuth) {
    const c = this.canvas, ctx = this.ctx;
    if (!c || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = c.clientWidth || 260, chh = c.clientHeight || 230;
    if (c.width !== Math.round(cw * dpr)) { c.width = Math.round(cw * dpr); c.height = Math.round(chh * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, chh);
    ctx.fillStyle = '#0d0f16';
    ctx.fillRect(0, 0, cw, chh);

    const t = h.t, mr = h.p.mainRotor, R = h.R;
    const mx = Math.max(mr.maxTilt, 1e-6);
    const lon = t.cLon, lat = t.cLat;            // post-SAS inputs
    const coll = t.coll;
    const theta0 = t.theta;
    const A1 = lat * mx * 0.9;                   // lateral cyclic pitch amplitude
    const B1 = lon * mx * 0.9;                   // longitudinal
    const pitchAt = (psi) => theta0 + A1 * Math.cos(psi) + B1 * Math.sin(psi);

    // Scene in body frame (metres, zoomed ×) rotated by fuselage attitude, projected like the main view
    const Sc = Math.min(cw * 0.4, chh * 0.34);
    const ox = cw * 0.33, oy = chh * 0.7;
    const P = (bx, by, bz) => {
      const x = R[0] * bx + R[1] * by + R[2] * bz;
      const y = R[3] * bx + R[4] * by + R[5] * bz;
      const z = R[6] * bx + R[7] * by + R[8] * bz;
      return [ox + (x * RX + y * RY) * Sc, oy - ((x * FX + y * FY) * SE + z * CE) * Sc];
    };
    const line = (a, b, col, w = 1) => {
      ctx.strokeStyle = col; ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    };

    // Plate geometry: stationary plate normal tilts with cyclic, height with collective
    const tiltLon = lon * 0.22, tiltLat = -lat * 0.22;   // exaggerated for readability
    const zPlate = 0.18 + coll * 0.28;
    const plateR = 0.42;
    const plateZ = (px, py) => zPlate - tiltLon * px - tiltLat * py;
    const ring = (rad, dz, col, fill) => {
      ctx.beginPath();
      for (let k = 0; k <= 28; k++) {
        const a = (k / 28) * Math.PI * 2;
        const px = Math.cos(a) * rad, py = Math.sin(a) * rad;
        const s = P(px, py, plateZ(px, py) + dz);
        if (k === 0) ctx.moveTo(s[0], s[1]); else ctx.lineTo(s[0], s[1]);
      }
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke();
    };

    // Base / gearbox top
    ctx.fillStyle = '#1b1f2a';
    const b0 = P(-0.6, -0.6, -0.05), b1 = P(0.6, -0.6, -0.05), b2 = P(0.6, 0.6, -0.05), b3 = P(-0.6, 0.6, -0.05);
    ctx.beginPath(); ctx.moveTo(...b0); ctx.lineTo(...b1); ctx.lineTo(...b2); ctx.lineTo(...b3); ctx.closePath(); ctx.fill();
    // Fuselage-forward arrow
    line(P(0.45, 0, -0.05), P(0.75, 0, -0.05), '#556', 2);
    const nose = P(0.8, 0, -0.05);
    ctx.fillStyle = '#667'; ctx.font = '9px "Share Tech Mono", monospace'; ctx.fillText('FWD', nose[0] + 2, nose[1] + 3);

    // Servos (three, fixed to gearbox) → stationary plate
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + Math.PI / 6;
      const px = Math.cos(a) * plateR, py = Math.sin(a) * plateR;
      const bot = P(px * 1.05, py * 1.05, 0);
      const top = P(px, py, plateZ(px, py) - 0.02);
      line(bot, top, '#8a6d3b', 4);
      line(bot, P(px * 1.05, py * 1.05, 0.08), '#c79a4a', 5);
    }

    // Mast (rotates) with index stripe
    const mastTop = 1.05;
    line(P(0, 0, -0.05), P(0, 0, mastTop), '#9aa3ad', 5);
    const sa = azimuth;
    line(P(Math.cos(sa) * 0.05, Math.sin(sa) * 0.05, 0.05), P(Math.cos(sa) * 0.05, Math.sin(sa) * 0.05, mastTop), '#ff4020', 1.5);

    // Stationary plate
    ring(plateR, 0, '#c79a4a', 'rgba(199,154,74,0.12)');
    // Rotating plate (spins) + spokes
    ring(plateR * 0.9, 0.05, '#4fc3f7', 'rgba(79,195,247,0.10)');
    for (let k = 0; k < 4; k++) {
      const a = sa + (k * Math.PI) / 2;
      const px = Math.cos(a) * plateR * 0.88, py = Math.sin(a) * plateR * 0.88;
      line(P(0, 0, zPlate + 0.05), P(px, py, plateZ(px, py) + 0.05), 'rgba(79,195,247,0.5)', 1);
    }

    // Blades: grips at hub, pitch links attached 90° ahead (phase lag compensation)
    const hubZ = mastTop;
    for (let b = 0; b < 2; b++) {
      const psi = sa + b * Math.PI;
      const th = pitchAt(psi);
      const dx = Math.cos(psi), dy = Math.sin(psi);
      // Pitch horn position and link
      const hornA = psi + Math.PI / 2;
      const hx = Math.cos(hornA) * plateR * 0.9, hy = Math.sin(hornA) * plateR * 0.9;
      const hornTop = P(hx, hy, hubZ - 0.05 + th * 0.9);
      const hornBot = P(hx, hy, plateZ(hx, hy) + 0.05);
      line(hornBot, hornTop, '#e0e0e0', 2);
      // Blade paddle: chord line rotated by pitch about span axis
      const span0 = 0.18, span1 = 0.95;
      const chord = 0.16;
      const cxv = -dy, cyv = dx;                       // leading-edge direction (CCW rotation)
      const ce = Math.cos(th) * chord, cz = Math.sin(th) * chord;
      const q = [
        P(dx * span0 + cxv * ce * 0.5, dy * span0 + cyv * ce * 0.5, hubZ + cz * 0.5),
        P(dx * span1 + cxv * ce * 0.5, dy * span1 + cyv * ce * 0.5, hubZ + cz * 0.5),
        P(dx * span1 - cxv * ce * 0.5, dy * span1 - cyv * ce * 0.5, hubZ - cz * 0.5),
        P(dx * span0 - cxv * ce * 0.5, dy * span0 - cyv * ce * 0.5, hubZ - cz * 0.5),
      ];
      const k = Math.max(0, Math.min(1, (th * DEG + 2) / 18));
      ctx.fillStyle = `rgb(${60 + 180 * k | 0},${90 + 60 * (1 - Math.abs(k - 0.5) * 2) | 0},${220 - 170 * k | 0})`;
      ctx.beginPath(); ctx.moveTo(...q[0]); ctx.lineTo(...q[1]); ctx.lineTo(...q[2]); ctx.lineTo(...q[3]); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#111'; ctx.lineWidth = 1; ctx.stroke();
      const lbl = P(dx * (span1 + 0.12), dy * (span1 + 0.12), hubZ);
      ctx.fillStyle = '#ddd';
      ctx.fillText(`${(th * DEG).toFixed(1)}°`, lbl[0] - 12, lbl[1]);
    }
    const hub = P(0, 0, hubZ);
    ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(hub[0], hub[1], 4, 0, Math.PI * 2); ctx.fill();

    // Disc tilt vector (actual flapping) seen from the hub
    const dl = 0.9;
    const tip = P(h.aLon * 4 * dl, h.aLat * 4 * dl, hubZ + 0.25);
    line(P(0, 0, hubZ + 0.25), tip, '#7CFC00', 2);

    // ── Pitch-vs-azimuth graph ──
    const gx = cw * 0.70, gy = 16, gw = cw * 0.28, gh = 70;
    ctx.fillStyle = '#111520'; ctx.fillRect(gx, gy, gw, gh);
    ctx.strokeStyle = '#2a3040'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(gx, gy + gh / 2); ctx.lineTo(gx + gw, gy + gh / 2); ctx.stroke();
    const yOf = (th) => gy + gh / 2 - ((th - theta0) * DEG) * (gh / 2 / 12);
    ctx.strokeStyle = '#ffb74d'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let k = 0; k <= 36; k++) {
      const psi = (k / 36) * Math.PI * 2;
      const x = gx + (k / 36) * gw, y = yOf(pitchAt(psi));
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    for (let b = 0; b < 2; b++) {
      const psi = ((sa + b * Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      ctx.fillStyle = b ? '#4fc3f7' : '#ff4020';
      ctx.beginPath(); ctx.arc(gx + (psi / (Math.PI * 2)) * gw, yOf(pitchAt(psi)), 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#778';
    ctx.fillText('θ(ψ) per rev', gx + 2, gy + gh + 10);
    ctx.fillText(`θ0 ${(theta0 * DEG).toFixed(1)}°`, gx + 2, gy + gh + 21);
    ctx.fillText(`lat ${(A1 * DEG).toFixed(1)}° lon ${(B1 * DEG).toFixed(1)}°`, gx + 2, gy + gh + 32);
    ctx.fillText(`disc ${(h.aLon * DEG).toFixed(1)}°/${(h.aLat * DEG).toFixed(1)}°`, gx + 2, gy + gh + 43);
    ctx.fillText(`TR θ ${(t.thetaTr * DEG).toFixed(1)}°`, gx + 2, gy + gh + 54);
    ctx.fillText(`${(h.omega * 60 / (2 * Math.PI)).toFixed(0)} rpm`, gx + 2, gy + gh + 65);

    // Legend
    ctx.fillStyle = '#c79a4a'; ctx.fillText('■ stationary plate (cyclic tilt, collective lift)', 6, chh - 22);
    ctx.fillStyle = '#4fc3f7'; ctx.fillText('■ rotating plate → pitch links', 6, chh - 12);
    ctx.fillStyle = '#7CFC00'; ctx.fillText('— disc tilt (flapping)', 6, chh - 2);
  }
}
