/**
 * Airframe parameters — light single-turbine, two-blade teetering rotor
 * (JetRanger-class). SI units throughout; angles in radians.
 */

const DEG = Math.PI / 180;

export const RHO = 1.225;          // sea-level air density, kg/m³
export const G = 9.81;

export const HELI = {
  mass: 1200,                      // kg
  // Principal inertias about CG (body x fwd, y left, z up), kg·m²
  Ixx: 900,
  Iyy: 2400,
  Izz: 2000,

  mainRotor: {
    R: 5.08,                       // radius, m
    blades: 2,
    chord: 0.33,
    a: 5.7,                        // blade lift slope, 1/rad
    cd0: 0.010,
    lock: 5.0,                     // Lock number γ — sets flap time constant 16/(γΩ)
    omegaNom: 41.26,               // 394 rpm
    J: 900,                        // rotor polar inertia, kg·m²
    hubHeight: 1.6,                // hub above CG, m
    hubSpring: 3000,               // N·m/rad — small; teetering rotors have ~none
    maxTilt: 10 * DEG,             // cyclic authority (disc tilt)
    kappa: 1.15,                   // induced power factor
    collMin: -1.0 * DEG,           // θ75 at collective 0 (full down overspeeds in autorotation)
    collMax: 15.5 * DEG,           // θ75 at collective 1
    ctsMax: 0.13,                  // blade-loading stall limit at μ=0
    inflowTau: 0.12,               // dynamic inflow lag, s
  },

  tailRotor: {
    R: 0.79,
    blades: 2,
    chord: 0.12,
    a: 5.7,
    cd0: 0.012,
    gear: 6.47,                    // Ω_tr / Ω_mr
    pos: [-6.0, 0, 0.35],          // body frame, m
    pitchNeutral: 6 * DEG,         // pedal centred
    pitchRange: 14 * DEG,          // ± from neutral at full pedal
    blockage: 0.92,                // fin blockage on thrust
    inflowTau: 0.05,
  },

  engine: {
    pMax: 250e3,                   // W at N1 = 100 %
    n1Idle: 0.62,
    n1Zero: 0.58,                  // N1 where shaft power reaches zero
    n1Max: 1.06,
    tauN1: 0.55,                   // s
    accelLimit: 0.28,              // N1 fraction / s
    decelLimit: 0.40,
    Je: 20,                        // power-turbine inertia reflected to rotor shaft
    govKp: 5.0,
    govKi: 2.5,
    torqueRef: 200e3 / 41.26,      // 100 % torque (transmission limit), N·m at rotor
  },

  fuselage: {
    fx: 1.3,                       // equivalent flat-plate areas, m²
    fy: 6.0,
    fz: 9.0,
    download: 0.03,                // hover download fraction of thrust
    damp: [900, 1800, 900],        // aero rotational damping, N·m·s/rad
  },

  hstab: { pos: [-4.3, 0, 0.1], area: 1.1, cla: 3.5 },
  vfin: { pos: [-5.8, 0, 0.7], area: 0.9, cla: 3.0 },

  // Skid contact points, body frame
  skids: [
    [1.3, 1.1, -1.25],
    [1.3, -1.1, -1.25],
    [-1.4, 1.1, -1.25],
    [-1.4, -1.1, -1.25],
  ],
  skidK: 70000,                    // per point, N/m
  skidC: 7000,                     // per point, N·s/m
  skidMu: 0.55,

  crash: {
    vImpact: 4.0,                  // m/s vertical into ground
    tilt: 40 * DEG,                // attitude limit while in contact
    hImpact: 12,                   // m/s horizontal while in contact
  },
};

export const DERIVED = (() => {
  const mr = HELI.mainRotor;
  const tr = HELI.tailRotor;
  return {
    mrArea: Math.PI * mr.R * mr.R,
    mrSigma: (mr.blades * mr.chord) / (Math.PI * mr.R),
    trArea: Math.PI * tr.R * tr.R,
    trSigma: (tr.blades * tr.chord) / (Math.PI * tr.R),
  };
})();

export { DEG };
