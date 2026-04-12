<script>
  import { onMount } from 'svelte';
  import { Game } from './game/game.js';
  import DebugPanel from './DebugPanel.svelte';

  let { config } = $props();
  let canvas;
  let swashCanvas = $state(null);
  let debug = $state(null);
  let showDebug = $state(true);
  let game;

  onMount(() => {
    game = new Game(canvas, {
      ...config,
      onDebug: (d) => { debug = d; showDebug = game.debugVisible; },
    });
    if (import.meta.env.DEV) window.__game = game;
    game.start();
    canvas.focus();
    return () => { game.destroy(); config.audio?.close(); };
  });

  $effect(() => {
    if (game) game.swash.attach(swashCanvas);
  });
</script>

<canvas bind:this={canvas} tabindex="0" class="view"></canvas>
{#if showDebug}
  <DebugPanel data={debug} bind:swashCanvas />
{/if}

<style>
  .view { position: fixed; inset: 0; display: block; outline: none; cursor: crosshair; }
</style>
