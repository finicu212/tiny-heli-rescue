/** Telemetry → synth parameter mapping (pure, unit-tested). */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export const BAND_NAMES = ['thump', 'slap', 'swish', 'tail', 'turbine', 'wind', 'alarm', 'master'];

/** Pure mapping — telemetry → synth params (unit-tested). */
export function audioParams(h, master = 0.8) {
  const t = h.t;
  const nr = Math.max(0, t.nr);
  const blades = h.p.mainRotor.blades;
  const descent = Math.max(0, -t.vc) / (t.vh + 1);
  // Blade–vortex interaction: blades meet their own tip vortices in descent,
  // VRS and high-g turns — the classic "wop-wop" slap
  const bvi = clamp(descent * 0.9 * (1 - clamp(t.mu * 6, 0, 0.7)) + t.vrs * 0.9 + Math.max(0, t.loadFactor - 1.25) * 1.2, 0, 1.5);
  return {
    bpf: (h.omega * blades) / (2 * Math.PI),
    trbpf: (h.omega * h.p.tailRotor.gear * h.p.tailRotor.blades) / (2 * Math.PI),
    load: clamp(Math.abs(t.cts) / 0.07, 0, 2),
    bvi: h.crashed ? 0 : bvi,
    vrs: t.vrs,
    n1: t.n1,
    power: clamp(t.powerKw / 250, 0, 1.3),
    trLoad: clamp(Math.abs(t.trThrust) / 800, 0, 2),
    air: t.airspeed,
    scrape: h.contacts > 0 ? clamp(h.scrape / 3, 0, 1) : 0,
    nr,
    lowRpm: !h.crashed && nr < 0.95 && nr > 0.2 ? 1 : 0,
    vrsAlarm: !h.crashed && t.vrs > 0.3 ? 1 : 0,
    engineOut: !h.crashed && !t.engineOn ? 1 : 0,
    master: h.crashed ? master * 0.6 : master,
  };
}
