<script>
  import { HeliAudio } from './audio/audio.js';

  let { onstart } = $props();

  function lsGet(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* blocked */ } }

  let seed = $state(lsGet('tinyheli.seed', String(Math.floor(Math.random() * 99999))));
  let wind = $state(lsGet('tinyheli.wind', 'light'));
  let sas = $state(lsGet('tinyheli.sas', '1') === '1');
  let quality = $state(lsGet('tinyheli.quality', 'high'));
  let starting = $state(false);
  let error = $state('');

  async function fly() {
    if (starting) return;
    starting = true;
    lsSet('tinyheli.seed', seed); lsSet('tinyheli.wind', wind);
    lsSet('tinyheli.sas', sas ? '1' : '0'); lsSet('tinyheli.quality', quality);
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
  <div class="sun"></div>
  <h1>tiny heli <span>rescue</span></h1>
  <p class="tag">a little helicopter, a big sky, and people who need a lift</p>

  <div class="card">
    <label>world seed
      <div class="row"><input bind:value={seed} maxlength="8" /><button class="small" onclick={reroll} title="new world">⟳</button></div>
    </label>
    <label>weather
      <select bind:value={wind}>
        <option value="calm">calm</option>
        <option value="light">light breeze</option>
        <option value="strong">windy</option>
        <option value="gusty">gusty</option>
      </select>
    </label>
    <label>graphics
      <select bind:value={quality}>
        <option value="low">smooth (1× DPR)</option>
        <option value="high">nice (≤1.5× DPR)</option>
        <option value="max">crisp (≤2× DPR)</option>
      </select>
    </label>
    <label class="check"><input type="checkbox" bind:checked={sas} /> steady hands (SAS) — recommended</label>
  </div>

  <button class="fly" onclick={fly} disabled={starting}>{starting ? 'warming up…' : 'take off'}</button>
  {#if error}<p class="err">{error}</p>{/if}

  <div class="keys">
    <div><b>W/S</b> up / down · wheel</div>
    <div><b>arrows</b> tilt · <b>click</b> mouse steering</div>
    <div><b>A/D</b> turn · <b>T</b> trim · <b>C</b> centre</div>
    <div><b>F</b> hold: engine · <b>G</b> SAS · <b>R</b> reset</div>
    <div><b>H</b> help · <b>`</b> debug · <b>+/-</b> zoom</div>
    <div><b>gamepad</b> RS tilt · LS turn · LT/RT up/down</div>
  </div>
</div>

<style>
  .menu {
    position: relative; overflow: hidden;
    height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px;
    padding: 16px;
    background: linear-gradient(180deg, #a9d8ec 0%, #d6eef3 55%, #fbeed6 100%);
    font-family: 'Nunito', system-ui, sans-serif;
    color: #3d4a5c;
  }
  .sun { position: absolute; top: 8vh; right: 12vw; width: 120px; height: 120px; border-radius: 50%; background: radial-gradient(circle, #ffe7a3 0%, rgba(255, 231, 163, 0) 70%); }
  h1 { font-size: clamp(2.4rem, 8vw, 4.4rem); font-weight: 900; letter-spacing: -0.01em; color: #2f5d7c; text-shadow: 0 3px 0 rgba(255, 255, 255, 0.7); }
  h1 span { color: #f07a5a; }
  .tag { color: #5b6b80; font-size: 1rem; text-align: center; }
  .card { background: #fffaf2; border-radius: 18px; box-shadow: 0 8px 24px rgba(47, 93, 124, 0.15); padding: 18px 22px; display: grid; gap: 12px; width: min(380px, 100%); }
  label { display: grid; gap: 4px; font-size: 0.85rem; font-weight: 700; color: #6a7a8e; }
  label.check { display: flex; align-items: center; gap: 8px; font-weight: 400; }
  .row { display: flex; gap: 6px; }
  input, select { background: #fff; color: #3d4a5c; border: 2px solid #e4dccd; border-radius: 10px; padding: 7px 10px; font-family: inherit; font-size: 0.95rem; width: 100%; }
  input[type='checkbox'] { width: auto; accent-color: #f07a5a; }
  button { font-family: inherit; cursor: pointer; }
  .small { background: #fff; color: #6a7a8e; border: 2px solid #e4dccd; border-radius: 10px; padding: 0 12px; font-size: 1rem; }
  .fly { background: #f07a5a; color: #fff; border: none; border-radius: 999px; padding: 12px 54px; font-size: 1.3rem; font-weight: 900; box-shadow: 0 5px 0 #c95c40, 0 10px 20px rgba(240, 122, 90, 0.35); transition: transform 0.08s; }
  .fly:active { transform: translateY(3px); box-shadow: 0 2px 0 #c95c40; }
  .fly:disabled { opacity: 0.7; }
  .err { color: #c0392b; font-size: 0.8rem; }
  .keys { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 4px 20px; color: #6a7a8e; font-size: 0.8rem; width: min(720px, 100%); }
  .keys b { color: #2f5d7c; }
</style>
