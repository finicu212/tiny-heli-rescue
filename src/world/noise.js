/** Seeded RNG + value-noise fBm. Deterministic per seed. */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class ValueNoise {
  constructor(seed) {
    const rand = mulberry32(seed);
    this.perm = new Uint8Array(512);
    this.vals = new Float32Array(256);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) { p[i] = i; this.vals[i] = rand() * 2 - 1; }
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  /** Smooth value noise in [-1, 1]. */
  noise(x, y) {
    const xf = Math.floor(x), yf = Math.floor(y);
    const xi = xf & 255, yi = yf & 255;
    const tx = x - xf, ty = y - yf;
    const u = tx * tx * tx * (tx * (tx * 6 - 15) + 10);
    const v = ty * ty * ty * (ty * (ty * 6 - 15) + 10);
    const P = this.perm, V = this.vals;
    const a = P[xi] + yi, b = P[xi + 1] + yi;
    const v00 = V[P[a]], v01 = V[P[a + 1]], v10 = V[P[b]], v11 = V[P[b + 1]];
    const i0 = v00 + (v10 - v00) * u;
    const i1 = v01 + (v11 - v01) * u;
    return i0 + (i1 - i0) * v;
  }

  fbm(x, y, oct) {
    let sum = 0, amp = 0.5, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += amp * this.noise(x * f, y * f);
      norm += amp;
      amp *= 0.5;
      f *= 2.03;
    }
    return sum / norm;
  }

  /** Ridged multifractal in [0, 1] — sharp mountain crests. */
  ridge(x, y, oct) {
    let sum = 0, amp = 0.5, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) {
      const n = 1 - Math.abs(this.noise(x * f, y * f));
      sum += amp * n * n;
      norm += amp;
      amp *= 0.5;
      f *= 2.1;
    }
    return sum / norm;
  }
}
