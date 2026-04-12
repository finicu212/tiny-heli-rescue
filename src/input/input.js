/**
 * Pilot input → heli.controls. Keyboard, pointer-locked mouse cyclic,
 * mouse wheel collective, standard-mapping gamepad (with rumble).
 * Uses KeyboardEvent.code so it is layout-independent (AZERTY etc.).
 */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function approach(v, target, rate, dt) {
  const d = target - v;
  const s = rate * dt;
  return Math.abs(d) <= s ? target : v + Math.sign(d) * s;
}

export function expo(x, e = 1.6) {
  return Math.sign(x) * Math.pow(Math.abs(x), e);
}

export class Input {
  constructor(target) {
    this.target = target;
    this.keys = new Set();
    this.pressed = new Set();         // edge-triggered this frame
    this.trim = { lon: 0, lat: 0, ped: 0 };
    this.cyc = { lon: 0, lat: 0 };
    this.ped = 0;
    this.coll = 0;
    this.wheel = 0;
    this.mouseCyclic = false;
    this.mouseSens = 0.0032;
    this.gp = null;
    this.gpPrev = [];
    this.rumble = 0;
    this._bind();
  }

  _bind() {
    const t = this.target;
    this._kd = (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Backquote'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    };
    this._ku = (e) => { this.keys.delete(e.code); };
    this._blur = () => { this.keys.clear(); };
    this._md = (e) => {
      if (e.button === 0 && t.requestPointerLock && document.pointerLockElement !== t) {
        const r = t.requestPointerLock({ unadjustedMovement: true });
        if (r && r.catch) r.catch(() => t.requestPointerLock());
      }
      if (e.button === 2) this.pressed.add('KeyT');
    };
    this._mm = (e) => {
      if (!this.mouseCyclic) return;
      this.cyc.lat = clamp(this.cyc.lat + e.movementX * this.mouseSens, -1, 1);
      this.cyc.lon = clamp(this.cyc.lon - e.movementY * this.mouseSens, -1, 1);
    };
    this._wh = (e) => {
      e.preventDefault();
      this.wheel += -Math.sign(e.deltaY) * 0.025;
    };
    this._pl = () => {
      this.mouseCyclic = document.pointerLockElement === t;
      if (this.mouseCyclic) { this.cyc.lon = this.trim.lon; this.cyc.lat = this.trim.lat; }
    };
    this._ctx = (e) => e.preventDefault();
    window.addEventListener('keydown', this._kd);
    window.addEventListener('keyup', this._ku);
    window.addEventListener('blur', this._blur);
    t.addEventListener('mousedown', this._md);
    window.addEventListener('mousemove', this._mm);
    t.addEventListener('wheel', this._wh, { passive: false });
    t.addEventListener('contextmenu', this._ctx);
    document.addEventListener('pointerlockchange', this._pl);
  }

  destroy() {
    const t = this.target;
    window.removeEventListener('keydown', this._kd);
    window.removeEventListener('keyup', this._ku);
    window.removeEventListener('blur', this._blur);
    t.removeEventListener('mousedown', this._md);
    window.removeEventListener('mousemove', this._mm);
    t.removeEventListener('wheel', this._wh);
    t.removeEventListener('contextmenu', this._ctx);
    document.removeEventListener('pointerlockchange', this._pl);
    if (document.pointerLockElement === t) document.exitPointerLock();
  }

  was(code) { return this.pressed.has(code); }
  down(code) { return this.keys.has(code); }

  /** Apply one frame of input to heli controls. Returns gamepad button edges. */
  update(dt, controls) {
    const k = this.keys;
    const gpEdges = this._pollGamepad();
    const gp = this.gp;

    // Collective
    let collRate = 0;
    if (k.has('KeyW') || k.has('PageUp')) collRate += 0.55;
    if (k.has('KeyS') || k.has('PageDown')) collRate -= 0.55;
    if (k.has('ShiftLeft')) collRate *= 0.35;       // fine
    if (gp) collRate += (gp.rt - gp.lt) * 0.6 - expo(gp.ly, 1.4) * 0.5;
    this.coll = clamp(this.coll + collRate * dt + this.wheel, 0, 1);
    this.wheel = 0;

    // Trim
    if (this.was('KeyT') || gpEdges.includes(0)) {
      this.trim.lon = controls.cyclicLon; this.trim.lat = controls.cyclicLat; this.trim.ped = controls.pedal;
    }
    if (this.was('KeyC')) {
      this.trim.lon = 0; this.trim.lat = 0; this.trim.ped = 0;
      if (this.mouseCyclic) { this.cyc.lon = 0; this.cyc.lat = 0; }
    }

    // Cyclic
    if (!this.mouseCyclic) {
      const defl = k.has('ShiftLeft') ? 0.25 : 0.6;
      let tLon = this.trim.lon, tLat = this.trim.lat;
      if (k.has('ArrowUp') || k.has('KeyI')) tLon += defl;
      if (k.has('ArrowDown') || k.has('KeyK')) tLon -= defl;
      if (k.has('ArrowRight') || k.has('KeyL')) tLat += defl;
      if (k.has('ArrowLeft') || k.has('KeyJ')) tLat -= defl;
      this.cyc.lon = approach(this.cyc.lon, clamp(tLon, -1, 1), 2.6, dt);
      this.cyc.lat = approach(this.cyc.lat, clamp(tLat, -1, 1), 2.6, dt);
    } else if (this.was('KeyT')) {
      this.trim.lon = this.cyc.lon; this.trim.lat = this.cyc.lat;
    }
    let lon = this.cyc.lon, lat = this.cyc.lat;
    if (gp && (Math.abs(gp.rx) > 0.02 || Math.abs(gp.ry) > 0.02)) {
      lon = clamp(this.trim.lon - expo(gp.ry) * 0.8, -1, 1);
      lat = clamp(this.trim.lat + expo(gp.rx) * 0.8, -1, 1);
      this.cyc.lon = lon; this.cyc.lat = lat;
    }

    // Pedals
    let tp = this.trim.ped;
    if (k.has('KeyA') || k.has('KeyQ')) tp -= 0.7;
    if (k.has('KeyD') || k.has('KeyE')) tp += 0.7;
    this.ped = approach(this.ped, clamp(tp, -1, 1), 3.2, dt);
    let ped = this.ped;
    if (gp && Math.abs(gp.lx) > 0.02) ped = clamp(this.trim.ped + expo(gp.lx, 1.5), -1, 1);

    controls.collective = this.coll;
    controls.cyclicLon = lon;
    controls.cyclicLat = lat;
    controls.pedal = ped;
    return gpEdges;
  }

  endFrame() { this.pressed.clear(); }

  _pollGamepad() {
    const edges = [];
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let g = null;
    for (const p of pads) if (p && p.connected) { g = p; break; }
    if (!g) { this.gp = null; return edges; }
    const dz = (v) => (Math.abs(v) < 0.08 ? 0 : (v - Math.sign(v) * 0.08) / 0.92);
    this.gp = {
      lx: dz(g.axes[0] || 0), ly: dz(g.axes[1] || 0), rx: dz(g.axes[2] || 0), ry: dz(g.axes[3] || 0),
      lt: g.buttons[6] ? g.buttons[6].value : 0, rt: g.buttons[7] ? g.buttons[7].value : 0,
      raw: g,
    };
    for (let i = 0; i < g.buttons.length; i++) {
      const p = g.buttons[i].pressed;
      if (p && !this.gpPrev[i]) edges.push(i);
      this.gpPrev[i] = p;
    }
    return edges;
  }

  /** Continuous rumble 0..1 (dual-rumble where supported, e.g. Chrome/Windows XInput). */
  setRumble(strong, weak) {
    const g = this.gp && this.gp.raw;
    const act = g && g.vibrationActuator;
    if (!act || !act.playEffect) return;
    this._rt = (this._rt || 0) + 1;
    if (this._rt % 6 !== 0) return;
    if (strong < 0.02 && weak < 0.02) return;
    act.playEffect('dual-rumble', { duration: 120, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) }).catch(() => {});
  }
}
