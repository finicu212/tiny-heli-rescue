// Test autopilot: velocity → attitude → cyclic, vertical speed → collective, yaw rate → pedal.
const cl = (v, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));

export function makePilot(coll0 = 0.4) {
  return { coll0, vi: 0, pi: 0, holdVz: true };
}

export function pilot(h, st, dt, { vx = 0, vy = 0, vz = 0, collective } = {}) {
  const R = h.R, v = h.vel;
  const ub = R[0] * v[0] + R[3] * v[1], vb = R[1] * v[0] + R[4] * v[1];
  const tu = R[0] * vx + R[3] * vy, tv = R[1] * vx + R[4] * vy;
  const pitchDown = -R[6], rollRight = R[7];
  const wantPitch = cl(0.04 * (tu - ub), -0.25, 0.25);
  const wantRoll = cl(-0.04 * (tv - vb), -0.25, 0.25);
  h.controls.cyclicLon = cl(3 * (wantPitch - pitchDown) - 0.8 * h.w[1]);
  h.controls.cyclicLat = cl(3 * (wantRoll - rollRight) - 0.8 * h.w[0]);
  if (collective !== undefined) {
    h.controls.collective = collective;
  } else {
    st.vi += (vz - v[2]) * dt;
    h.controls.collective = cl(st.coll0 + 0.06 * (vz - v[2]) + 0.03 * st.vi, 0, 1);
  }
  st.pi += 0.5 * h.w[2] * dt;
  h.controls.pedal = cl(2 * h.w[2] + st.pi);
}

export function airborne(h, z = 300) {
  h.pos[2] = z;
  h.wasInContact = false;
}
