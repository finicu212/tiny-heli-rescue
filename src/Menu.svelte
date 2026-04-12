<script>
  import { HeliAudio } from './audio/audio.js';

  let { onstart } = $props();

  function lsGet(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* blocked */ } }

  let seed = $state(lsGet('heliborne.seed', String(Math.floor(Math.random() * 99999))));
  let wind = $state(lsGet('heliborne.wind', 'light'));
  let sas = $state(lsGet('heliborne.sas', '1') === '1');
  let quality = $state(lsGet('heliborne.quality', 'high'));
  let starting = $state(false);
  let error = $state('');

  async function fly() {
    if (starting) return;
    starting = true;
    lsSet('heliborne.seed', seed); lsSet('heliborne.wind', wind);
    lsSet('heliborne.sas', sas ? '1' : '0'); lsSet('heliborne.quality', quality);
    const audio = new HeliAudio();
    try { await audio.start(); } catch (e) { error = 'Audio unavailable: ' + e.message; }
    const s = parseInt(seed, 10);
    onstart({
      seed: Number.isFinite(s) ? s : 1, wind, sas, audio,
      maxDpr: quality === 'high' ? 1.5 : quality === 'max' ? 2 : 1,
    });
  }

  // ?fly[&seed=N&wind=W] skips the menu (audio stays suspended until a click)
  if (typeof location !== 'undefined') {
    const q = new URLSearchParams(location.search);
    if (q.has('fly')) {
      if (q.get('seed')) seed = q.get('seed');
      if (q.get('wind')) wind = q.get('wind');
      queueMicrotask(fly);
    }
  }

  function reroll() { seed = String(Math.floor(Math.random() * 99999)); }
</script>

<div class="menu">
  <h1>HELI<span>BORNE</span></h1>
  <p class="tag">single-rotor flight sim · collective · cyclic · anti-torque · VRS</p>

  <div class="card">
    <label>WORLD SEED
      <div class="row"><input bind:value={seed} maxlength="8" /><button class="small" onclick={reroll}>⟳</button></div>
    </label>
    <label>WIND
      <select bind:value={wind}>
        <option value="calm">Calm</option>
        <option value="light">Light (3.5 m/s)</option>
        <option value="strong">Strong (8 m/s)</option>
        <option value="gusty">Gusty (6 m/s ± gusts)</option>
      </select>
    </label>
    <label>RENDER QUALITY
      <select bind:value={quality}>
        <option value="low">Performance (1× DPR)</option>
        <option value="high">High (≤1.5× DPR)</option>
        <option value="max">Max (≤2× DPR)</option>
      </select>
    </label>
    <label class="check"><input type="checkbox" bind:checked={sas} /> SAS rate damping (recommended first flight)</label>
  </div>

  <button class="fly" onclick={fly} disabled={starting}>{starting ? 'SPOOLING…' : 'FLY'}</button>
  {#if error}<p class="err">{error}</p>{/if}

  <div class="keys">
    <div><b>W/S</b> collective · wheel</div>
    <div><b>Arrows</b> cyclic · <b>click</b> = mouse cyclic</div>
    <div><b>A/D</b> pedals · <b>T</b> trim · <b>C</b> centre</div>
    <div><b>F</b> hold: engine · <b>G</b> SAS · <b>R</b> reset</div>
    <div><b>H</b> help · <b>`</b> debug · <b>+/-</b> zoom</div>
    <div><b>Gamepad</b> RS cyclic · LS pedals · LT/RT coll</div>
  </div>
</div>

<style>
  .menu {
    height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px;
    background: radial-gradient(ellipse at 50% 30%, #1d2436 0%, var(--c-bg-deep) 70%);
    padding: 16px;
  }
  h1 { font-size: clamp(2.4rem, 8vw, 4.6rem); letter-spacing: 0.25em; color: var(--c-text-primary); text-shadow: 0 0 24px var(--c-accent-glow); }
  h1 span { color: var(--c-accent); }
  .tag { color: var(--c-text-dim); letter-spacing: 0.12em; font-size: 0.8rem; text-align: center; }
  .card { background: var(--c-bg-panel); border: 1px solid var(--c-border-subtle); border-radius: 8px; padding: 16px 20px; display: grid; gap: 12px; width: min(380px, 100%); }
  label { display: grid; gap: 4px; font-size: 0.7rem; color: var(--c-text-muted); letter-spacing: 0.15em; }
  label.check { display: flex; align-items: center; gap: 8px; letter-spacing: 0.02em; }
  .row { display: flex; gap: 6px; }
  input, select { background: var(--c-bg-inset); color: var(--c-text-primary); border: 1px solid var(--c-border-mid); border-radius: 4px; padding: 6px 8px; font-family: inherit; font-size: 0.9rem; width: 100%; }
  input[type='checkbox'] { width: auto; }
  button { font-family: inherit; cursor: pointer; }
  .small { background: var(--c-bg-inset); color: var(--c-text-secondary); border: 1px solid var(--c-border-mid); border-radius: 4px; padding: 0 10px; }
  .fly { background: var(--c-accent); color: #fff; border: none; border-radius: 6px; padding: 12px 64px; font-size: 1.3rem; letter-spacing: 0.3em; box-shadow: 0 0 24px var(--c-accent-glow); }
  .fly:disabled { opacity: 0.6; }
  .err { color: #ff8080; font-size: 0.75rem; }
  .keys { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 4px 20px; color: var(--c-text-faint); font-size: 0.72rem; width: min(720px, 100%); }
  .keys b { color: var(--c-text-secondary); }
</style>
