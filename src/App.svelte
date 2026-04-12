<script>
  import Menu from './Menu.svelte';
  import Flight from './Flight.svelte';

  let screen = $state('menu');
  let config = $state(null);

  function handleStart(cfg) {
    config = cfg;
    screen = 'flight';
  }
</script>

<main>
  {#if screen === 'menu'}
    <Menu onstart={handleStart} />
  {:else}
    <Flight {config} />
  {/if}
</main>

<style>
  :global(*) { margin: 0; padding: 0; box-sizing: border-box; }

  :global(:root) {
    --c-accent: #ff4020;
    --c-accent-glow: rgba(255, 64, 32, 0.4);
    --c-accent-dim: rgba(255, 64, 32, 0.1);
    --c-bg-deep: #0f0f1a;
    --c-bg-panel: #1a1a2e;
    --c-bg-inset: #111;
    --c-bg-overlay: rgba(10, 10, 20, 0.88);
    --c-border-subtle: #333;
    --c-border-mid: #444;
    --c-text-primary: #eee;
    --c-text-secondary: #ccc;
    --c-text-muted: #999;
    --c-text-dim: #888;
    --c-text-faint: #777;
    --c-text-subtle: #666;
    --c-text-ghost: #555;
    --c-text-disabled: #444;
    --c-bar-rpm: #ff4020;
    --c-bar-rotor: #4fc3f7;
    --c-bar-torque: #ff9800;
    --c-bar-coll: #ffb74d;
    --c-bar-pedal: #9c27b0;
    --c-bar-thrust: #2196f3;
    --c-bar-inflow: #26a69a;
    --c-bar-vrs: #ff3b30;
    --c-bar-ge: #90caf9;
    --c-status-on-bg: #1b3a1b;
    --c-status-on: #4caf50;
    --c-status-warn-bg: #3a3a1b;
    --c-status-warn: #ffc107;
    --c-status-bad-bg: #3a1b1b;
    --c-status-bad: #ff6060;
    --c-status-info-bg: #1b2a3a;
    --c-status-info: #42a5f5;
  }

  :global(body) {
    background: var(--c-bg-deep);
    color: var(--c-text-primary);
    font-family: 'Share Tech Mono', monospace;
    overflow: hidden;
    height: 100vh;
    width: 100vw;
    user-select: none;
  }

  main { height: 100vh; width: 100vw; }
</style>
