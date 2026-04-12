/* global sampleRate, registerProcessor, AudioWorkletProcessor */
/**
 * HELIBORNE synth — runs on the audio thread, sample-accurate blade timing.
 * Self-contained (no imports): loaded via audioWorklet.addModule.
 *
 * Layers: main-rotor thump + BVI slap + swish, tail-rotor buzz, turbine
 * whine + combustion roar, gearbox whine, airflow, skid scrape, alarms
 * (low-RPM horn, VRS whoop, engine-out beeps), one-shots (thud, crash,
 * chime, click). Reports per-layer RMS back to the main thread.
 */

const TAU = Math.PI * 2;

class HeliSynth extends AudioWorkletProcessor {
  constructor() {
    super();
    this.p = {
      bpf: 13, trbpf: 85, load: 0.5, bvi: 0, vrs: 0, n1: 0.8, power: 0.5, trLoad: 0.5,
      air: 0, scrape: 0, nr: 1, lowRpm: 0, vrsAlarm: 0, engineOut: 0, master: 0.8, etl: 0,
    };
    this.s = { ...this.p };
    this.ph = 0; this.phT = 0; this.phW = 0; this.phW2 = 0; this.phG = 0; this.phA = 0; this.tt = 0;
    this.thEnv = 0; this.slEnv = 0; this.thPh = 0;
    this.seed = 22222;
    this.hp = 0; this.hpx = 0;
    this.lpW = 0; this.lpC = 0; this.lpT = 0; this.lpS = 0; this.lpTh = 0;
    this.bpL = 0; this.bpB = 0; this.bp2L = 0; this.bp2B = 0;
    this.shots = [];
    this.rms = new Float32Array(8);
    this.rmsN = 0;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.p) Object.assign(this.p, d.p);
      if (d.shot) this.shots.push({ type: d.shot, amp: d.amp ?? 1, t: 0 });
    };
  }

  rnd() {
    let x = this.seed;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.seed = x | 0;
    return ((x >>> 0) / 4294967296) * 2 - 1;
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const L = out[0], Rch = out[1] || out[0];
    const n = L.length;
    const sr = sampleRate;
    const p = this.p, s = this.s;
    const k = 1 - Math.exp(-n / (sr * 0.04));     // block-rate smoothing ≈ 40 ms
    for (const key in p) s[key] += (p[key] - s[key]) * k;

    const thDecay = Math.exp(-1 / (sr * 0.045));
    const slDecay = Math.exp(-1 / (sr * 0.007));
    const aW = 1 - Math.exp(-TAU * (140 + s.air * 14 + s.vrs * 120) / sr);
    const aC = 1 - Math.exp(-TAU * (220 + s.power * 520) / sr);
    const aT = 1 - Math.exp(-TAU * 1300 / sr);
    const aS = 1 - Math.exp(-TAU * 900 / sr);
    const aTh = 1 - Math.exp(-TAU * 160 / sr);
    const fSw = Math.min(0.6, 2 * Math.sin(Math.PI * (380 + s.load * 200) / sr));
    const fSl = Math.min(0.6, 2 * Math.sin(Math.PI * 2400 / sr));
    const whineF = 900 + s.n1 * 2600;
    const gearF = 1050 * s.nr;
    const thumpF = 48 + s.load * 18;

    const gThump = (0.18 + 0.34 * Math.min(1.6, s.load)) * Math.min(1, s.nr * 1.3);
    const gSlap = Math.min(1.2, s.bvi) * 0.55 * Math.min(1, s.nr);
    const gSwish = (0.05 + 0.09 * Math.min(1.5, s.load)) * Math.min(1, s.nr);
    const gTail = (0.035 + 0.09 * Math.min(1.5, s.trLoad)) * Math.min(1, s.nr);
    const gWhine = 0.012 + 0.03 * Math.min(1, s.n1 * s.n1);
    const gRoar = 0.1 * Math.min(1.3, s.power);
    const gWind = Math.min(0.35, (s.air / 55) ** 2 * 0.28 + s.vrs * 0.09);
    const gScr = Math.min(1, s.scrape) * 0.3;
    const gGear = 0.006 * Math.min(1, s.nr);

    const rms = this.rms;
    for (let i = 0; i < n; i++) {
      this.tt += 1 / sr;
      // Blade passage
      this.ph += s.bpf / sr;
      if (this.ph >= 1) {
        this.ph -= 1;
        this.thEnv = 1 + 0.12 * this.rnd();
        this.slEnv = 1 + 0.25 * this.rnd();
        this.thPh = 0;
      }
      const w = this.rnd();
      this.thPh += thumpF / sr;
      this.lpTh += aTh * (w - this.lpTh);
      const thump = (Math.sin(TAU * this.thPh) * 0.8 + this.lpTh * 1.6) * this.thEnv * gThump;
      this.thEnv *= thDecay;

      // Slap: high-band noise burst (SVF band-pass)
      this.bp2L += fSl * this.bp2B;
      const hi = w - this.bp2L - 0.5 * this.bp2B;
      this.bp2B += fSl * hi;
      const slap = this.bp2B * this.slEnv * gSlap * 1.6;
      this.slEnv *= slDecay;

      // Swish: band noise modulated at blade rate
      this.bpL += fSw * this.bpB;
      const hb = w - this.bpL - 0.7 * this.bpB;
      this.bpB += fSw * hb;
      const m = 0.5 + 0.5 * Math.cos(TAU * this.ph);
      const swish = this.bpB * (0.3 + m * m * m) * gSwish;

      // Tail rotor buzz
      this.phT += s.trbpf / sr;
      if (this.phT >= 1) this.phT -= 1;
      const sp = Math.sin(Math.PI * this.phT);
      const pulse = sp * sp * sp * sp * sp * sp * sp * sp - 0.27;
      this.lpT += aT * (pulse + 0.15 * w - this.lpT);
      const tail = this.lpT * gTail * 2.2;

      // Turbine
      this.phW += whineF / sr; if (this.phW >= 1) this.phW -= 1;
      this.phW2 += (whineF * 1.502) / sr; if (this.phW2 >= 1) this.phW2 -= 1;
      const whine = (Math.sin(TAU * this.phW) + 0.35 * Math.sin(TAU * this.phW2)) * gWhine;
      this.lpC += aC * (w - this.lpC);
      const roar = this.lpC * gRoar * 2.2;
      this.phG += gearF / sr; if (this.phG >= 1) this.phG -= 1;
      const gear = Math.sin(TAU * this.phG) * gGear;

      // Air
      this.lpW += aW * (w - this.lpW);
      const wind = this.lpW * gWind * 3;
      this.lpS += aS * (w - this.lpS);
      const scr = (w - this.lpS) * gScr * (0.6 + 0.4 * Math.sin(TAU * 37 * this.tt));

      // Alarms
      let alarm = 0;
      if (s.lowRpm > 0.5) {
        this.phA += 640 / sr; if (this.phA >= 1) this.phA -= 1;
        alarm += (this.phA < 0.5 ? 1 : -1) * 0.05;
      }
      if (s.vrsAlarm > 0.5) {
        const cyc = this.tt % 0.45;
        if (cyc < 0.34) {
          const f = 700 + (cyc / 0.34) * 900;
          alarm += Math.sin(TAU * f * this.tt) * 0.09;
        }
      }
      if (s.engineOut > 0.5 && (this.tt % 0.5) < 0.18) alarm += Math.sin(TAU * 1000 * this.tt) * 0.06;

      // One-shots
      let shot = 0;
      for (let j = this.shots.length - 1; j >= 0; j--) {
        const o = this.shots[j];
        o.t += 1 / sr;
        let v = 0, done = false;
        if (o.type === 'thud') {
          v = (Math.sin(TAU * 42 * o.t) * 0.9 + w * 0.3) * Math.exp(-o.t * 14) * o.amp;
          done = o.t > 0.5;
        } else if (o.type === 'crash') {
          this.lpC += 0;
          v = (w * Math.exp(-o.t * 1.2) * 0.8 + Math.sin(TAU * 31 * o.t) * Math.exp(-o.t * 2)) * o.amp;
          done = o.t > 4;
        } else if (o.type === 'chime') {
          v = (Math.sin(TAU * 880 * o.t) + Math.sin(TAU * 1320 * o.t) * 0.6 * (o.t > 0.12 ? 1 : 0)) * Math.exp(-o.t * 3.5) * 0.08 * o.amp;
          done = o.t > 1.5;
        } else if (o.type === 'click') {
          v = Math.sin(TAU * 2000 * o.t) * Math.exp(-o.t * 80) * 0.05;
          done = o.t > 0.1;
        } else if (o.type === 'splash') {
          v = w * Math.exp(-o.t * 2.5) * 0.6 * o.amp;
          done = o.t > 2.5;
        }
        shot += v;
        if (done) this.shots.splice(j, 1);
      }

      const rotor = thump + slap + swish;
      let mix = rotor + tail + whine + roar + gear + wind + scr + alarm + shot;
      mix *= s.master;
      const y = Math.tanh(mix * 1.1) * 0.9;
      L[i] = y;
      if (Rch !== L) Rch[i] = y;

      rms[0] += thump * thump; rms[1] += slap * slap; rms[2] += swish * swish; rms[3] += tail * tail;
      rms[4] += (whine + roar) * (whine + roar); rms[5] += wind * wind; rms[6] += alarm * alarm; rms[7] += y * y;
    }
    this.rmsN += n;
    if (this.rmsN > sr * 0.05) {
      const r = new Array(8);
      for (let j = 0; j < 8; j++) { r[j] = Math.sqrt(rms[j] / this.rmsN); rms[j] = 0; }
      this.rmsN = 0;
      this.port.postMessage({ rms: r });
    }
    return true;
  }
}

registerProcessor('heli-synth', HeliSynth);
