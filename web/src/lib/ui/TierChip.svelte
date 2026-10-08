<script lang="ts">
  import type { Tier } from '../engine/types';
  let { tier, pinned = false, big = false }: { tier: Tier; pinned?: boolean; big?: boolean } = $props();
</script>

<span class="tier" class:big style="--c: var(--rb-tier-{tier})" title={pinned ? `${tier} tier (pinned)` : `${tier} tier`}>
  {tier}{#if pinned}<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 1l5 5-3 1-3 4v3l-2-2-4 4-1-1 4-4-2-2h3l4-3 1-3z" fill="currentColor"/></svg>{/if}
</span>

<style>
  .tier {
    display: inline-flex; align-items: center; justify-content: center; gap: 2px;
    min-width: 24px; height: 24px; padding: 0 6px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--c) 22%, transparent);
    color: var(--c);
    font: 800 15px/1 var(--rb-font-display);
    letter-spacing: .02em;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c) 45%, transparent);
  }
  .big { min-width: 34px; height: 34px; font-size: 22px; border-radius: 8px; }
  svg { width: 9px; height: 9px; opacity: .8; }
</style>
