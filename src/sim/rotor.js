/**
 * Rotor aerodynamics — blade-element thrust with momentum/empirical inflow.
 *
 * Inflow regimes:
 *   climb / forward flight  → Glauert momentum theory
 *   axial descent           → Johnson empirical fit through the vortex-ring
 *                             state (momentum theory has no valid solution there)
 *   fast axial descent      → windmill-brake momentum branch
 * Forward speed blends the empirical curve back toward Glauert, which is why
 * flying out forward (Vuichard/forward cyclic) recovers from VRS.
 */

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

// Johnson (1980) fit, valid -2 ≤ x ≤ 0 where x = Vc/vh (negative = descent).
const K1 = -1.125, K2 = -1.372, K3 = -1.718, K4 = -0.655;

/** Induced velocity ratio vi/vh for pure axial flight. */
export function axialInflowRatio(x) {
  if (x >= 0) return -x / 2 + Math.sqrt((x * x) / 4 + 1);
  if (x <= -2) return -x / 2 - Math.sqrt((x * x) / 4 - 1);
  return 1 + x * (K1 + x * (K2 + x * (K3 + x * K4)));
}

/**
 * Glauert induced velocity with in-plane speed. Damped fixed-point with a
 * floored denominator so it stays bounded in near-VRS inputs (those get
 * blended toward the empirical curve anyway).
 */
export function glauertInflow(vh, Vc, Vip, vi0) {
  const vh2 = vh * vh;
  let vi = vi0 > 0 ? vi0 : vh;
  const floor = 0.35 * vh;
  for (let k = 0; k < 8; k++) {
    const u = Vc + vi;
    let d = Math.sqrt(Vip * Vip + u * u);
    if (d < floor) d = floor;
    vi = 0.5 * vi + 0.5 * (vh2 / d);
  }
  return vi;
}

/**
 * VRS intensity 0..1. Peaks around Vc ≈ -0.9 vh with little in-plane flow;
 * decays once in-plane speed exceeds ~vh (wake blown clear of the disc).
 */
export function vrsIndex(vh, Vc, Vip) {
  if (vh < 1) return 0;
  const d = -Vc / vh;
  if (d <= 0.2 || d >= 1.8) return 0;
  const b = 1 - ((d - 0.9) / 0.7) ** 2;
  if (b <= 0) return 0;
  return b * (1 - smoothstep(0.35, 1.1, Vip / vh));
}

/**
 * Ground-effect multiplier on induced velocity (Cheeseman–Bennett, faded by
 * in-plane speed since the wake is swept aft of the disc).
 */
export function groundEffectFactor(R, hubAgl, Vip, vh) {
  if (!(hubAgl > 0)) hubAgl = 0.01;
  const zr = Math.max(hubAgl, 0.5 * R);
  const k = (R / (4 * zr)) ** 2;
  const s = vh > 0.5 ? Vip / vh : 4;
  return 1 - k / (1 + s * s);
}

/**
 * Target (quasi-steady) induced velocity for thrust T.
 * Handles negative thrust by symmetry.
 */
export function inflowTarget(T, Vc, Vip, rho, area, viPrev, geFactor) {
  const sign = T < 0 ? -1 : 1;
  const Ta = T * sign;
  const vc = Vc * sign;
  const vh = Math.sqrt(Ta / (2 * rho * area));
  if (vh < 0.05) return 0;
  let vi;
  if (vc >= 0) {
    vi = glauertInflow(vh, vc, Vip, Math.abs(viPrev));
  } else {
    const wEmp = 1 - smoothstep(0.5, 1.6, Vip / vh);
    const ve = vh * axialInflowRatio(vc / vh);
    const vg = wEmp < 1 ? glauertInflow(vh, vc, Vip, Math.abs(viPrev)) : 0;
    vi = wEmp * ve + (1 - wEmp) * vg;
  }
  return sign * vi * geFactor;
}

/** Blade-element thrust coefficient (θ at 0.75R, uniform inflow). */
export function thrustCoeff(theta, lambda, mu, sigma, a) {
  return 0.5 * sigma * a * ((theta / 3) * (1 + 1.5 * mu * mu) - lambda / 2);
}

/**
 * Soft blade-stall cap on CT/σ. Linear below 75 % of the limit, then
 * saturates. Limit drops with μ (retreating-blade stall).
 */
export function stallCap(cts, ctsMax, mu) {
  const lim = ctsMax * (1 - 0.9 * mu * mu) - 0.03 * mu;
  const L = Math.max(lim, 0.04);
  const a = Math.abs(cts);
  const k = 0.75 * L;
  if (a <= k) return cts;
  const over = a - k;
  const span = L - k;
  const capped = k + span * Math.tanh(over / span);
  return cts < 0 ? -capped : capped;
}

/** Torque coefficient: induced + climb + profile. */
export function torqueCoeff(ct, Vc, vi, tipSpeed, kappa, sigma, cd, mu) {
  return (ct * (Vc + kappa * vi)) / tipSpeed + (sigma * cd / 8) * (1 + 4.65 * mu * mu);
}
