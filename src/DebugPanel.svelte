<script>
  import { BAND_NAMES } from './audio/params.js';

  let { data, swashCanvas = $bindable() } = $props();

  const DT_LEN = 90;
  let dtHistory = new Float32Array(DT_LEN);
  let dtIdx = 0;
  let sparkCanvas;

  $effect(() => {
    if (!data || !sparkCanvas) return;
    dtHistory[dtIdx] = data.dt * 1000;
    dtIdx = (dtIdx + 1) % DT_LEN;
    const ctx = sparkCanvas.getContext('2d');
    const w = sparkCanvas.width, h = sparkCanvas.height;
    ctx.clearRect(0, 0, w, h);
    const top = 20;
    ctx.strokeStyle = '#333';
    ctx.setLineDash([2, 2]);
    for (const ms of [6.94, 16.67]) {
      const y = h - (ms / top) * h;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = '#4caf50';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < DT_LEN; i++) {
      const v = Math.min(dtHistory[(dtIdx + i) % DT_LEN], top);
      const x = (i / (DT_LEN - 1)) * w, y = h - (v / top) * h;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  });

  const f = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : '—');
  const pct = (v, max) => (typeof v === 'number' ? Math.max(0, Math.min(100, (v / max) * 100)) : 0);
  const DEG = 180 / Math.PI;
</script>

<div class="debug-overlay">
  <div class="debug-title">DEBUG <span class="key-hint">`</span> <span class="seed">seed {data?.seed} · wind {data?.wind} {f(data?.windSpeed, 1)} m/s</span></div>

  <div class="debug-subtitle">DRIVETRAIN</div>
  <div class="debug-grid">
    <span class="label">N1</span>
    <div class="bar-container"><div class="bar rpm-bar" style="width:{pct(data?.n1, 1.1)}%"></div><span class="bar-value">{f(data?.n1 * 100, 1)} %</span></div>
    <span class="label">N2</span>
    <div class="bar-container"><div class="bar rpm-bar dim" style="width:{pct(data?.n2, 1.2)}%"></div><span class="bar-value">{f(data?.n2 * 100, 1)} %</span></div>
    <span class="label">NR</span>
    <div class="bar-container"><div class="bar rotor-bar" class:bad={data?.nr < 0.95 || data?.nr > 1.07} style="width:{pct(data?.nr, 1.2)}%"></div><span class="bar-value">{f(data?.rotorRpm)} rpm</span></div>
    <span class="label">TRR</span>
    <div class="bar-container"><div class="bar rotor-bar dim" style="width:{pct(data?.trRpm, 3100)}%"></div><span class="bar-value">{f(data?.trRpm)} rpm</span></div>
    <span class="label">TRQ</span>
    <div class="bar-container"><div class="bar torque-bar" class:bad={data?.torquePct > 1} style="width:{pct(data?.torquePct, 1.2)}%"></div><span class="bar-value">{f(data?.torquePct * 100)} % · {f(data?.powerKw)} kW</span></div>
    <span class="label">QSH</span>
    <div class="bar-container"><div class="bar torque-bar dim" style="width:{pct(Math.abs(data?.qShaft), 7000)}%"></div><span class="bar-value">{f(data?.qShaft)} N·m yaw rxn</span></div>
  </div>

  <div class="debug-subtitle">CONTROLS</div>
  <div class="debug-grid">
    <span class="label">COL</span>
    <div class="bar-container"><div class="bar coll-bar" style="width:{pct(data?.coll, 1)}%"></div><span class="bar-value">{f(data?.coll * 100)} % · θ₀ {f(data?.theta * DEG, 1)}°</span></div>
    <span class="label">LON</span>
    <div class="bar-container center"><div class="bar cbar" style="width:{Math.abs(data?.cLon || 0) * 50}%; left:{(data?.cLon || 0) < 0 ? 50 + (data?.cLon || 0) * 50 : 50}%"></div><span class="bar-value">{f(data?.cLon, 2)} · disc {f(data?.aLon * DEG, 1)}°</span></div>
    <span class="label">LAT</span>
    <div class="bar-container center"><div class="bar cbar" style="width:{Math.abs(data?.cLat || 0) * 50}%; left:{(data?.cLat || 0) < 0 ? 50 + (data?.cLat || 0) * 50 : 50}%"></div><span class="bar-value">{f(data?.cLat, 2)} · disc {f(data?.aLat * DEG, 1)}°</span></div>
    <span class="label">PED</span>
    <div class="bar-container center"><div class="bar pedal-bar" style="width:{Math.abs(data?.ped || 0) * 50}%; left:{(data?.ped || 0) < 0 ? 50 + (data?.ped || 0) * 50 : 50}%"></div><span class="bar-value">{f(data?.ped, 2)} · TR θ {f(data?.thetaTr * DEG, 1)}°</span></div>
    <span class="label">ATQ</span>
    <div class="bar-container"><div class="bar pedal-bar" style="width:{pct(Math.abs(data?.trThrust), 1500)}%"></div><span class="bar-value">{f(data?.trThrust)} N · r {f(data?.yawRate * DEG, 0)}°/s</span></div>
  </div>

  <div class="debug-subtitle">ROTOR AERO</div>
  <div class="debug-grid">
    <span class="label">T</span>
    <div class="bar-container"><div class="bar thrust-bar" style="width:{pct(data?.thrust, 22000)}%"></div><span class="bar-value">{f(data?.thrust)} N · {f(data?.loadFactor, 2)} g</span></div>
    <span class="label">CT/σ</span>
    <div class="bar-container"><div class="bar thrust-bar" class:bad={data?.stall > 0.92} style="width:{pct(data?.stall, 1)}%"></div><span class="bar-value">{f(data?.cts, 3)} ({f(data?.stall * 100)}% stall)</span></div>
    <span class="label">vi</span>
    <div class="bar-container"><div class="bar inflow-bar" style="width:{pct(data?.vi, 20)}%"></div><span class="bar-value">{f(data?.vi, 1)} / vh {f(data?.vh, 1)} m/s</span></div>
    <span class="label">Vc</span>
    <div class="bar-container center"><div class="bar inflow-bar" style="width:{Math.min(50, Math.abs(data?.vc || 0) * 2.5)}%; left:{(data?.vc || 0) < 0 ? 50 - Math.min(50, Math.abs(data?.vc || 0) * 2.5) : 50}%"></div><span class="bar-value">{f(data?.vc, 1)} m/s · μ {f(data?.mu, 3)}</span></div>
    <span class="label">VRS</span>
    <div class="bar-container"><div class="bar vrs-bar" style="width:{pct(data?.vrs, 1)}%"></div><span class="bar-value">{f(data?.vrs, 2)} · TR {f(data?.vrsTr, 2)}</span></div>
    <span class="label">IGE</span>
    <div class="bar-container"><div class="bar ge-bar" style="width:{pct(1 - (data?.ge ?? 1), 0.25)}%"></div><span class="bar-value">×{f(data?.ge, 3)} · hub {f(data?.hubAgl, 1)} m</span></div>
    <span class="label">ETL</span>
    <div class="bar-container"><div class="bar on-bar" style="width:{pct(data?.etl, 1)}%"></div><span class="bar-value">{f(data?.airspeed * 1.944)} kt · {f(data?.vs * 196.85)} fpm</span></div>
  </div>

  <div class="indicators">
    <span class="indicator" class:on={data?.engineOn} class:bad={!data?.engineOn}>ENG</span>
    <span class="indicator" class:on={data?.engaged} class:info={!data?.engaged}>{data?.engaged ? 'SPRAG' : 'FREEWHEEL'}</span>
    <span class="indicator" class:on={data?.sas}>SAS</span>
    {#if data?.ge < 0.97}<span class="indicator info">IGE</span>{/if}
    {#if data?.etl > 0.6}<span class="indicator on">ETL</span>{/if}
    {#if data?.vrs > 0.3}<span class="indicator bad">VRS</span>{/if}
    {#if data?.lowRpm}<span class="indicator bad">LOW NR</span>{/if}
    {#if data?.overTorque}<span class="indicator warn">OVTQ</span>{/if}
    {#if data?.stall > 0.92}<span class="indicator warn">STALL</span>{/if}
    {#if data?.mastBump}<span class="indicator bad">MAST</span>{/if}
    {#if data?.contacts > 0}<span class="indicator">GND {data.contacts}</span>{/if}
    {#if data?.nan > 0}<span class="indicator bad">NaN×{data.nan}</span>{/if}
  </div>

  <div class="debug-subtitle">SWASHPLATE · ROTOR HEAD (live)</div>
  <canvas bind:this={swashCanvas} class="swash"></canvas>

  <div class="debug-subtitle">AUDIO BANDS</div>
  <div class="band-bars">
    {#each BAND_NAMES as name, i}
      <div class="band-row">
        <span class="band-label">{name}</span>
        <div class="band-track"><div class="band-fill" style="width:{Math.min(100, (data?.bands?.[i] || 0) * 400)}%"></div></div>
        <span class="band-val">{f(data?.bands?.[i], 3)}</span>
      </div>
    {/each}
  </div>

  <div class="debug-subtitle">FRAME <span class="dt-val">{f(data?.dt * 1000, 2)} ms · {f(1 / (data?.dt || 1))} fps</span></div>
  <canvas bind:this={sparkCanvas} width="260" height="32" class="sparkline"></canvas>
  <div class="perf">phys {f(data?.physMs, 2)} · draw {f(data?.renderMs, 2)} · total {f(data?.frameMs, 2)} ms · chunks {data?.chunks}{data?.chunksPending ? `+${data.chunksPending}` : ''} · fx {data?.puffs}/{data?.rings}</div>
</div>

<style>
  .debug-overlay {
    position: fixed; top: 12px; right: 12px; bottom: 12px;
    width: 290px; overflow-y: auto;
    background: var(--c-bg-overlay); border: 1px solid var(--c-bg-panel); border-radius: 6px;
    padding: 10px 12px; font-size: 0.62rem; color: var(--c-text-muted);
    z-index: 100; pointer-events: auto; scrollbar-width: thin;
  }
  .debug-title { font-size: 0.6rem; color: var(--c-text-ghost); letter-spacing: 0.2em; margin-bottom: 4px; }
  .key-hint { color: var(--c-text-disabled); }
  .seed { letter-spacing: 0.02em; color: var(--c-text-subtle); margin-left: 6px; }
  .debug-subtitle { font-size: 0.55rem; color: var(--c-text-ghost); letter-spacing: 0.15em; text-transform: uppercase; margin: 8px 0 3px; }
  .debug-grid { display: grid; grid-template-columns: 30px 1fr; gap: 3px 6px; align-items: center; }
  .label { color: var(--c-text-subtle); font-size: 0.55rem; letter-spacing: 0.08em; }
  .bar-container { position: relative; height: 12px; background: var(--c-bg-panel); border-radius: 2px; overflow: hidden; }
  .bar-container.center::after { content: ''; position: absolute; left: 50%; top: 0; bottom: 0; width: 1px; background: #444; }
  .bar { height: 100%; border-radius: 2px; position: absolute; left: 0; top: 0; }
  .rpm-bar { background: var(--c-bar-rpm); }
  .rotor-bar { background: var(--c-bar-rotor); }
  .torque-bar { background: var(--c-bar-torque); }
  .coll-bar { background: var(--c-bar-coll); }
  .cbar { background: var(--c-status-info); }
  .pedal-bar { background: var(--c-bar-pedal); }
  .thrust-bar { background: var(--c-bar-thrust); }
  .inflow-bar { background: var(--c-bar-inflow); }
  .vrs-bar { background: var(--c-bar-vrs); }
  .ge-bar { background: var(--c-bar-ge); }
  .on-bar { background: var(--c-status-on); }
  .dim { opacity: 0.55; }
  .bar.bad { background: #ff3030; }
  .bar-value { position: absolute; right: 4px; top: 0; line-height: 12px; font-size: 0.55rem; color: var(--c-text-secondary); text-shadow: 0 0 3px #000; white-space: nowrap; }
  .indicators { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 8px; }
  .indicator { padding: 1px 5px; border-radius: 2px; font-size: 0.55rem; background: var(--c-bg-panel); color: var(--c-text-dim); }
  .indicator.on { background: var(--c-status-on-bg); color: var(--c-status-on); }
  .indicator.bad { background: var(--c-status-bad-bg); color: var(--c-status-bad); }
  .indicator.warn { background: var(--c-status-warn-bg); color: var(--c-status-warn); }
  .indicator.info { background: var(--c-status-info-bg); color: var(--c-status-info); }
  .swash { display: block; width: 100%; height: 230px; border-radius: 3px; background: #0d0f16; }
  .band-bars { display: flex; flex-direction: column; gap: 2px; }
  .band-row { display: grid; grid-template-columns: 50px 1fr 36px; gap: 4px; align-items: center; }
  .band-label { font-size: 0.5rem; color: var(--c-text-subtle); text-align: right; text-transform: uppercase; }
  .band-track { height: 8px; background: var(--c-bg-panel); border-radius: 2px; overflow: hidden; }
  .band-fill { height: 100%; background: var(--c-bar-torque); }
  .band-val { font-size: 0.5rem; color: var(--c-text-faint); }
  .dt-val { color: var(--c-status-on); letter-spacing: 0; }
  .sparkline { display: block; width: 100%; height: 32px; background: var(--c-bg-inset); border-radius: 2px; }
  .perf { font-size: 0.5rem; color: var(--c-text-faint); margin-top: 3px; }
</style>
