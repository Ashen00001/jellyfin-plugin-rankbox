<script lang="ts">
  // Where the title being placed can still land. Narrows with every answer, like a binary search you can see.
  let { slots, low, high }: { slots: number; low: number; high: number } = $props();
  const pct = (n: number) => ((n - 1) / Math.max(1, slots)) * 100;
  const left = $derived(pct(low));
  const width = $derived(Math.max(100 / Math.max(1, slots), pct(high + 1) - pct(low)));
</script>

<div class="ladder" role="img" aria-label="Lands between #{low} and #{high} of {slots}">
  <div class="track">
    {#if slots <= 80}
      {#each { length: slots } as _, i}<span class="tick" style="left:{pct(i + 1)}%"></span>{/each}
    {/if}
    <span class="win" style="left:{left}%;width:{width}%"></span>
  </div>
  <div class="labels num">
    <span>#1</span>
    <span class="range">{low === high ? `lands at #${low}` : `lands between #${low} and #${high}`}</span>
    <span>#{slots}</span>
  </div>
</div>

<style>
  .ladder { width: 100%; }
  .track { position: relative; height: 10px; border-radius: 99px; background: var(--rb-surface-2); overflow: hidden; }
  .tick { position: absolute; top: 3px; width: 1px; height: 4px; background: var(--rb-line-strong); }
  .win {
    position: absolute; top: 0; bottom: 0; border-radius: 99px;
    background: linear-gradient(90deg, color-mix(in srgb, var(--rb-gold) 70%, transparent), var(--rb-gold));
    box-shadow: 0 0 14px color-mix(in srgb, var(--rb-gold) 45%, transparent);
    transition: left .35s cubic-bezier(.2, .8, .2, 1), width .35s cubic-bezier(.2, .8, .2, 1);
  }
  .labels { display: flex; justify-content: space-between; gap: 8px; margin-top: 6px; font-size: 12px; color: var(--rb-faint); }
  .range { color: var(--rb-muted); text-align: center; }
</style>
