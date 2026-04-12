/**
 * Fixed-orientation orthographic camera (2.5D). The camera yaw/elevation
 * never change, so terrain can be cached as bitmaps and only translated.
 *
 *   right  r = p·(rx, ry)
 *   up     u = (p·(fx, fy))·sinE + z·cosE
 *   depth  d = (p·(fx, fy))·cosE − z·sinE   (larger = farther)
 */

const YAW = (28 * Math.PI) / 180;
const ELEV = (50 * Math.PI) / 180;

export const RX = Math.cos(YAW), RY = -Math.sin(YAW);
export const FX = Math.sin(YAW), FY = Math.cos(YAW);
export const SE = Math.sin(ELEV), CE = Math.cos(ELEV);

// Unit vector from the scene toward the camera
export const TO_CAM = [-FX * CE, -FY * CE, SE];

export const ZOOMS = [3.5, 5, 7, 9.5, 13, 18];

export class View {
  constructor() {
    this.W = 1;
    this.H = 1;
    this.dpr = 1;
    this.zoomIdx = 3;
    this.S = ZOOMS[this.zoomIdx];
    this.camR = 0;
    this.camU = 0;
    this.shakeX = 0;
    this.shakeY = 0;
  }

  resize(cssW, cssH, dpr) {
    this.dpr = dpr;
    this.W = Math.round(cssW * dpr);
    this.H = Math.round(cssH * dpr);
    this.S = ZOOMS[this.zoomIdx] * dpr;
  }

  setZoom(idx) {
    this.zoomIdx = Math.max(0, Math.min(ZOOMS.length - 1, idx));
    this.S = ZOOMS[this.zoomIdx] * this.dpr;
  }

  lookAt(x, y, z) {
    this.camR = x * RX + y * RY;
    this.camU = (x * FX + y * FY) * SE + z * CE;
  }

  sx(x, y) {
    return this.W * 0.5 + (x * RX + y * RY - this.camR) * this.S + this.shakeX;
  }

  sy(x, y, z) {
    return this.H * 0.5 - ((x * FX + y * FY) * SE + z * CE - this.camU) * this.S + this.shakeY;
  }

  /** Screen → world on a horizontal plane at height z. */
  unproject(px, py, z, out) {
    const r = (px - this.W * 0.5 - this.shakeX) / this.S + this.camR;
    const u = -(py - this.H * 0.5 - this.shakeY) / this.S + this.camU;
    const f = (u - z * CE) / SE;
    out[0] = r * RX + f * FX;
    out[1] = r * RY + f * FY;
    return out;
  }
}

export function depth(x, y, z) {
  return (x * FX + y * FY) * CE - z * SE;
}
