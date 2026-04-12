/**
 * Main-thread side of the synth: maps sim telemetry to synth parameters and
 * posts them (throttled) to the AudioWorklet.
 */

import workletUrl from './heli-worklet.js?url';

export { audioParams, BAND_NAMES } from './params.js';
import { audioParams } from './params.js';

export class HeliAudio {
  constructor() {
    this.ctx = null;
    this.node = null;
    this.bands = new Array(8).fill(0);
    this.muted = false;
    this.master = 0.8;
    this._acc = 0;
  }

  /** Must be called from a user gesture (autoplay policy). */
  async start() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC({ latencyHint: 'interactive' });
    await this.ctx.audioWorklet.addModule(workletUrl);
    this.node = new AudioWorkletNode(this.ctx, 'heli-synth', { numberOfInputs: 0, outputChannelCount: [2] });
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 4;
    this.node.connect(comp).connect(this.ctx.destination);
    this.node.port.onmessage = (e) => { if (e.data.rms) this.bands = e.data.rms; };
    // Autoplay policy: resume() only settles after a gesture, so never await it
    const wake = () => {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      if (this.ctx.state === 'running') {
        window.removeEventListener('pointerdown', wake);
        window.removeEventListener('keydown', wake);
      }
    };
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);
    wake();
    return true;
  }

  update(dt, h) {
    if (!this.node) return;
    this._acc += dt;
    if (this._acc < 1 / 90) return;          // ~90 Hz is plenty; synth smooths
    this._acc = 0;
    this.node.port.postMessage({ p: audioParams(h, this.muted ? 0 : this.master) });
  }

  shot(type, amp = 1) {
    if (this.node && !this.muted) this.node.port.postMessage({ shot: type, amp });
  }

  toggleMute() {
    this.muted = !this.muted;
  }

  suspend() { if (this.ctx) this.ctx.suspend(); }
  resume() { if (this.ctx) this.ctx.resume(); }
  close() { if (this.ctx) this.ctx.close(); }
}
