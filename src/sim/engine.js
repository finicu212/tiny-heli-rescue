/**
 * Free-turbine turboshaft with N2 governor and sprag (freewheel) clutch.
 *
 * N1 = gas producer (fraction of 100 %). Shaft power follows N1 with lag and
 * accel/decel limits, so quick collective pulls droop rotor RPM before the
 * governor catches up. Engine speed is tracked separately from rotor speed so
 * the needles split when the rotor overruns the engine (autorotation).
 */

import { HELI } from './params.js';
import { clamp } from './rotor.js';

export class Engine {
  constructor(p = HELI.engine, omegaNom = HELI.mainRotor.omegaNom) {
    this.p = p;
    this.omegaNom = omegaNom;
    this.reset(omegaNom);
  }

  reset(omega, running = true) {
    this.running = running;
    this.n1 = running ? 0.8 : 0;
    this.omegaE = omega;
    this.integ = 0;
    this.engaged = true;
  }

  /** Shaft power at current N1, W. */
  power() {
    const p = this.p;
    const f = (this.n1 - p.n1Zero) / (1 - p.n1Zero);
    return f > 0 ? p.pMax * Math.pow(f, 1.3) : 0;
  }

  /** Output torque at power-turbine speed ω (rotor-equivalent). Rises as N2 droops. */
  torque() {
    const P = this.power();
    if (P <= 0) return 0;
    const qn = P / this.omegaNom;
    return Math.max(0, qn * (2 - this.omegaE / this.omegaNom));
  }

  /** Advance N1 — governor on N2 with collective anticipation. */
  updateN1(dt, collective) {
    const p = this.p;
    if (!this.running) {
      this.n1 = Math.max(0, this.n1 - 0.12 * dt);
      this.integ = 0;
      return;
    }
    if (this.n1 < p.n1Idle - 0.01) {
      // Starter-assisted light-off
      this.n1 = Math.min(p.n1Idle, this.n1 + 0.09 * dt);
      this.integ = 0;
      return;
    }
    const e = (this.omegaNom - this.omegaE) / this.omegaNom;
    this.integ = clamp(this.integ + e * dt, -0.08, 0.12);
    const ff = 0.70 + 0.30 * collective;
    const cmd = clamp(ff + p.govKp * e + p.govKi * this.integ, p.n1Idle, p.n1Max);
    const rate = clamp((cmd - this.n1) / p.tauN1, -p.decelLimit, p.accelLimit);
    this.n1 += rate * dt;
  }
}
