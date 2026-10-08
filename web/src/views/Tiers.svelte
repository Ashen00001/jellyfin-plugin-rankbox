<script lang="ts">
  import type { Tier } from '../lib/engine/types';
  import { TIERS } from '../lib/engine/types';
  import type { RankBox } from '../lib/store.svelte';
  import Poster from '../lib/ui/Poster.svelte';
  import TierChip from '../lib/ui/TierChip.svelte';

  let { rb }: { rb: RankBox } = $props();
  const view = $derived(rb.view!);
  const rows = $derived(TIERS.map((t) => ({ tier: t, items: view.ranked.filter((r) => r.tier === t) })));
  const NAMES: Record<Tier, string> = { S: 'All-time', A: 'Great', B: 'Good', C: 'Fine', D: 'Meh' };

  let selected = $state<string | null>(null);
  const sel = $derived(selected ? view.byId.get(selected) : undefined);

  /* drag a poster to another tier = pin it there */
  let drag: { id: string; ghost: HTMLElement; ox: number; oy: number; moved: boolean; x0: number; y0: number } | null = null;
  let over = $state<Tier | null>(null);

  function down(e: PointerEvent, id: string) {
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    drag = { id, ghost: el, ox: e.clientX - r.left, oy: e.clientY - r.top, moved: false, x0: e.clientX, y0: e.clientY };
    el.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return;
    if (!drag.moved) {
      drag.moved = true;
      const g = drag.ghost.cloneNode(true) as HTMLElement;
      g.classList.add('ghost');
      g.style.width = drag.ghost.getBoundingClientRect().width + 'px';
      document.body.append(g);
      drag.ghost = g;
    }
    drag.ghost.style.left = e.clientX - drag.ox + 'px';
    drag.ghost.style.top = e.clientY - drag.oy + 'px';
    const row = document.elementsFromPoint(e.clientX, e.clientY).find((n) => (n as HTMLElement).dataset?.tier) as HTMLElement | undefined;
    over = (row?.dataset.tier as Tier) ?? null;
  }
  function up() {
    if (!drag) return;
    const { id, moved } = drag;
    if (moved) drag.ghost.remove();
    drag = null;
    if (!moved) { selected = selected === id ? null : id; return; }
    if (over && over !== view.byId.get(id)?.tier) rb.setTier(id, over);
    over = null;
  }
</script>

<div class="head">
  <h1>Tier list</h1>
  <p>Tiers split where your scores have natural gaps. Drag a poster to another row to pin it there; tap one for details.</p>
</div>

<div class="tiers">
  {#each rows as row (row.tier)}
    <section class="row" class:over={over === row.tier} data-tier={row.tier} style="--c: var(--rb-tier-{row.tier})">
      <div class="label"><span class="l">{row.tier}</span><span class="n">{NAMES[row.tier]}</span></div>
      <div class="items">
        {#each row.items as r (r.id)}
          {@const it = rb.item(r.id)!}
          <button class="tile" class:sel={selected === r.id} onpointerdown={(e) => down(e, r.id)} onpointermove={move} onpointerup={up}
            onpointercancel={up} aria-label="{it.name}, #{r.rank}">
            <Poster name={it.name} year={it.year} src={rb.backend.poster(r.id, 220)} size="sm" />
            <span class="rk num">{r.rank}</span>
            {#if r.tierOverridden}<span class="pin" title="Pinned to {r.tier}">•</span>{/if}
          </button>
        {/each}
        {#if !row.items.length}<span class="drop">Drop a poster here</span>{/if}
      </div>
    </section>
  {/each}
</div>

{#if sel}
  {@const it = rb.item(sel.id)!}
  <aside class="sheet" aria-live="polite">
    <Poster name={it.name} src={rb.backend.poster(sel.id, 160)} size="sm" />
    <div class="info">
      <b>{it.name}</b>
      <span class="num">#{sel.rank} · score {sel.score.toFixed(1)} · {sel.wins}–{sel.losses}{sel.ties ? '–' + sel.ties : ''}</span>
      <div class="pins">
        {#each TIERS as t}
          <button class:on={sel.tier === t && sel.tierOverridden} onclick={() => rb.setTier(sel.id, t)} aria-label="Pin to {t}"><TierChip tier={t} /></button>
        {/each}
        <button class="auto" class:on={!sel.tierOverridden} onclick={() => rb.setTier(sel.id, null)}>Auto</button>
      </div>
    </div>
    <button class="close" onclick={() => (selected = null)} aria-label="Close">×</button>
  </aside>
{/if}

<style>
  .head { margin-bottom: 16px; }
  h1 { font: 800 clamp(30px, 4.6vw, 42px)/1 var(--rb-font-display); text-transform: uppercase; letter-spacing: .01em; }
  .head p { margin: 6px 0 0; color: var(--rb-muted); font-size: 14px; max-width: 60ch; }
  .tiers { display: grid; gap: 6px; }
  .row { display: grid; grid-template-columns: 96px minmax(0, 1fr); border-radius: 12px; overflow: hidden; background: var(--rb-surface); transition: box-shadow .15s; }
  .row.over { box-shadow: 0 0 0 2px var(--c); }
  .label { background: var(--c); color: #12100c; display: grid; place-content: center; justify-items: center; padding: 10px 6px; }
  .label .l { font: 900 44px/0.9 var(--rb-font-display); }
  .label .n { font-size: 11px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; opacity: .75; }
  .items { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px; min-height: 108px; align-content: flex-start; }
  .tile { position: relative; width: 74px; touch-action: none; border-radius: 9px; transition: transform .12s; }
  .tile :global(.poster) { width: 100%; border-radius: 9px; }
  .tile :global(.poster .in) { font-size: 20px; }
  .tile:hover { transform: translateY(-2px); }
  .tile.sel { outline: 2px solid var(--rb-gold); outline-offset: 2px; }
  .rk { position: absolute; left: 4px; bottom: 3px; font: 900 22px/1 var(--rb-font-display); color: #fff; text-shadow: 0 2px 8px #000, 0 0 2px #000; }
  .pin { position: absolute; right: 5px; top: 1px; color: var(--c); font-size: 22px; line-height: 1; text-shadow: 0 0 4px #000; }
  .drop { margin: auto; color: var(--rb-faint); font-size: 13px; }
  :global(.tile.ghost) { position: fixed; z-index: 60; pointer-events: none; transform: rotate(-3deg) scale(1.06); box-shadow: 0 20px 40px rgba(0, 0, 0, .6); }

  .sheet {
    position: fixed; z-index: 40; left: 50%; transform: translateX(-50%);
    bottom: calc(18px + env(safe-area-inset-bottom, 0px)); width: min(520px, calc(100% - 32px));
    display: flex; gap: 12px; align-items: center; padding: 12px;
    border-radius: 16px; background: var(--rb-surface-2); box-shadow: 0 20px 50px rgba(0, 0, 0, .55), inset 0 0 0 1px var(--rb-line-strong);
  }
  .info { flex: 1; min-width: 0; display: grid; gap: 4px; }
  .info b { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .info span { font-size: 13px; color: var(--rb-muted); }
  .pins { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .pins button { border-radius: 8px; padding: 2px; opacity: .55; }
  .pins button.on, .pins button:hover { opacity: 1; }
  .pins .auto { padding: 4px 10px; font-size: 12.5px; font-weight: 600; box-shadow: inset 0 0 0 1px var(--rb-line-strong); }
  .close { align-self: flex-start; font-size: 22px; line-height: 1; color: var(--rb-faint); padding: 2px 6px; }

  @media (max-width: 700px) {
    .row { grid-template-columns: 58px minmax(0, 1fr); }
    .label .l { font-size: 34px; }
    .label .n { display: none; }
    .tile { width: 58px; }
    .items { min-height: 92px; }
    .sheet { bottom: calc(82px + env(safe-area-inset-bottom, 0px)); }
  }
</style>
