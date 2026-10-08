<script lang="ts">
  import { tick } from 'svelte';
  import type { Ranked } from '../lib/engine/types';
  import type { RankBox } from '../lib/store.svelte';
  import { agoText, LIST_LABEL } from '../lib/ui/format';
  import Icon from '../lib/ui/Icon.svelte';
  import Poster from '../lib/ui/Poster.svelte';
  import TierChip from '../lib/ui/TierChip.svelte';

  let { rb }: { rb: RankBox } = $props();
  const view = $derived(rb.view!);

  let query = $state('');
  const rows = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return q ? view.ranked.filter((r) => rb.item(r.id)?.name.toLowerCase().includes(q)) : view.ranked;
  });
  const maxScore = 10;

  /* ---------- jump to a position ---------- */
  let jumping = $state<string | null>(null);
  let jumpVal = $state('');
  async function startJump(r: Ranked) {
    jumping = r.id; jumpVal = String(r.rank);
    await tick();
    (document.getElementById('jump-' + r.id) as HTMLInputElement | null)?.select();
  }
  function commitJump() {
    const n = parseInt(jumpVal, 10);
    if (jumping && n >= 1) rb.move(jumping, Math.min(n, view.ranked.length) - 1);
    jumping = null;
  }

  /* ---------- drag to reorder ---------- */
  let listEl: HTMLOListElement;
  let drag: { li: HTMLElement; ph: HTMLElement; dy: number; y: number; id: string } | null = null;

  function dragStart(e: PointerEvent, id: string) {
    if (query) return;
    const handle = e.currentTarget as HTMLElement;
    const li = handle.closest('li') as HTMLElement;
    const r = li.getBoundingClientRect();
    e.preventDefault();
    const ph = document.createElement('li');
    ph.className = 'ph';
    ph.style.height = r.height + 'px';
    li.after(ph);
    li.classList.add('lifted');
    Object.assign(li.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px' });
    drag = { li, ph, dy: e.clientY - r.top, y: e.clientY, id };
    handle.setPointerCapture(e.pointerId);
    requestAnimationFrame(autoScroll);
  }
  function dragMove(e: PointerEvent) {
    if (!drag) return;
    drag.y = e.clientY;
    drag.li.style.top = e.clientY - drag.dy + 'px';
    const items = [...listEl.querySelectorAll<HTMLElement>('li[data-id]')].filter((x) => x !== drag!.li);
    const before = items.find((row) => { const r = row.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    if (before) {
      const prev = before.previousElementSibling as HTMLElement | null;
      (prev && prev.classList.contains('divider') ? prev : before).before(drag.ph);
    } else listEl.append(drag.ph);
  }
  function dragEnd() {
    if (!drag) return;
    const { li, ph, id } = drag;
    const idx = [...listEl.querySelectorAll('li[data-id], li.ph')].filter((x) => x !== li).indexOf(ph);
    ph.remove();
    li.classList.remove('lifted');
    li.removeAttribute('style');
    drag = null;
    if (idx >= 0 && idx !== view.byId.get(id)!.rank - 1) rb.move(id, idx);
  }
  function autoScroll() {
    if (!drag) return;
    const edge = 80, y = drag.y, h = innerHeight;
    if (y < edge) scrollBy(0, -Math.ceil((edge - y) / 5));
    else if (y > h - edge) scrollBy(0, Math.ceil((y - (h - edge)) / 5));
    requestAnimationFrame(autoScroll);
  }

  let confirmReset = $state(false);
  let open = $state<string | null>(null); // phones: tap a row to show score + actions
</script>

<div class="head">
  <div>
    <h1>Your {LIST_LABEL[rb.list].toLowerCase()}</h1>
    <p class="sub num">{view.ranked.length} ranked · {rb.b.state.answers.length} answers · drag <Icon name="drag" size={13} /> to move, tap a number to jump</p>
  </div>
  <label class="search">
    <Icon name="search" size={16} />
    <input id="rank-search" type="search" placeholder="Find a title" bind:value={query} />
  </label>
</div>

{#if !view.ranked.length}
  <p class="empty">Nothing ranked yet. Answer a few questions in Rank and your list builds itself here.</p>
{/if}

<ol class="board" bind:this={listEl}>
  {#each rows as r, i (r.id)}
    {@const it = rb.item(r.id)!}
    {#if !query && (i === 0 || rows[i - 1].tier !== r.tier)}
      <li class="divider" style="--c: var(--rb-tier-{r.tier})">
        <TierChip tier={r.tier} big /><span>{view.ranked.filter((x) => x.tier === r.tier).length} titles</span>
      </li>
    {/if}
    <li data-id={r.id} class:top={r.rank <= 3} class:open={open === r.id} style="--c: var(--rb-tier-{r.tier})">
      <span class="handle" class:off={!!query} onpointerdown={(e) => dragStart(e, r.id)} onpointermove={dragMove}
        onpointerup={dragEnd} onpointercancel={dragEnd} title="Drag to move" aria-hidden="true"><Icon name="drag" size={18} /></span>
      {#if jumping === r.id}
        <input id="jump-{r.id}" class="jump num" type="number" min="1" max={view.ranked.length} bind:value={jumpVal}
          onkeydown={(e) => { if (e.key === 'Enter') commitJump(); if (e.key === 'Escape') jumping = null; }} onblur={commitJump} aria-label="Move to position" />
      {:else}
        <button class="rank num" onclick={() => startJump(r)} title="Move to a position">{r.rank}</button>
      {/if}
      <Poster name={it.name} src={rb.backend.poster(r.id, 140)} size="sm" />
      <div class="main" role="button" tabindex="0" onclick={() => (open = open === r.id ? null : r.id)} onkeydown={(e) => e.key === 'Enter' && (open = open === r.id ? null : r.id)}>
        <span class="t">{it.name}</span>
        <span class="m">{it.year ?? ''}{rb.list === 'all' ? (it.type === 'Movie' ? ' · movie' : ' · series') : ''} · {agoText(it.lastWatched)}{r.comparisons ? ` · ${r.wins}–${r.losses}${r.ties ? '–' + r.ties : ''}` : ''}</span>
      </div>
      <div class="score" title="Score {r.score} / 10 · {r.se > 0.85 ? 'still shaky' : 'settled'}">
        <span class="sv num">{r.score.toFixed(1)}</span>
        <span class="sbar"><i style="width:{(r.score / maxScore) * 100}%"></i></span>
        <span class="conf" class:shaky={r.se > 0.85}>{r.se > 0.85 ? 'shaky' : r.se > 0.6 ? 'fair' : 'settled'}</span>
      </div>
      <TierChip tier={r.tier} pinned={r.tierOverridden} />
      <div class="acts">
        <button onclick={() => rb.rerank(r.id)} title="Place this one again from scratch" aria-label="Re-rank {it.name}"><Icon name="redo" size={16} /></button>
        <button onclick={() => rb.exclude(r.id)} title="Haven't seen it" aria-label="Haven't seen {it.name}"><Icon name="eyeoff" size={16} /></button>
      </div>
    </li>
  {/each}
</ol>

{#if view.queue.length}
  <section class="pool">
    <h2>Not ranked yet <span class="num">{view.queue.length}</span></h2>
    <div class="chips">
      {#each view.queue as id (id)}
        {@const it = rb.item(id)!}
        <span class="chip"><Poster name={it.name} src={rb.backend.poster(id, 80)} size="xs" />{it.name}
          <button onclick={() => rb.rankNow({ id })}>Rank now</button></span>
      {/each}
    </div>
  </section>
{/if}

{#if view.excluded.length}
  <section class="pool">
    <h2>Haven't seen <span class="num">{view.excluded.length}</span></h2>
    <div class="chips">
      {#each view.excluded as id (id)}
        {@const it = rb.item(id)}
        {#if it}<span class="chip muted">{it.name}<button onclick={() => rb.include(id)}>Add back</button></span>{/if}
      {/each}
    </div>
  </section>
{/if}

<section class="settings">
  <label class="tog">
    <input type="checkbox" checked={rb.b.state.watchedOnly} onchange={(e) => rb.setWatchedOnly((e.currentTarget as HTMLInputElement).checked)} />
    <span><b>Only things Jellyfin knows I've watched</b><br /><small>Leave off if you watch offline in Infuse. Jellyfin often doesn't know about those; just hit "haven't seen it" instead.</small></span>
  </label>
  <div class="reset">
    {#if confirmReset}
      <span>Clear every answer for {LIST_LABEL[rb.list].toLowerCase()}?</span>
      <button class="danger" onclick={() => { rb.reset(); confirmReset = false; }}>Yes, reset</button>
      <button onclick={() => (confirmReset = false)}>Cancel</button>
    {:else}
      <button class="danger-ghost" onclick={() => (confirmReset = true)}>Reset this list</button>
    {/if}
  </div>
</section>

<style>
  .head { display: flex; align-items: end; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 14px; }
  h1 { font: 800 clamp(30px, 4.6vw, 42px)/1 var(--rb-font-display); text-transform: uppercase; letter-spacing: .01em; }
  .sub { margin: 6px 0 0; color: var(--rb-muted); font-size: 13px; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
  .search { display: flex; align-items: center; gap: 8px; padding: 0 12px; height: 40px; border-radius: 11px; background: var(--rb-surface); box-shadow: inset 0 0 0 1px var(--rb-line); color: var(--rb-muted); min-width: min(260px, 100%); }
  .search input { flex: 1; min-width: 0; background: none; border: 0; outline: 0; color: var(--rb-text); }
  .empty { color: var(--rb-muted); }

  .board { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
  .board li[data-id] {
    display: grid; grid-template-columns: 22px 48px 42px minmax(0, 1fr) 150px 34px auto;
    align-items: center; gap: 12px; padding: 7px 10px 7px 6px;
    border-radius: 12px; background: var(--rb-surface);
    box-shadow: inset 3px 0 0 var(--c);
  }
  .board li.top { background: linear-gradient(90deg, color-mix(in srgb, var(--rb-gold) 9%, var(--rb-surface)), var(--rb-surface) 45%); }
  :global(.board li.lifted) { position: fixed; z-index: 50; pointer-events: none; box-shadow: 0 18px 40px rgba(0, 0, 0, .6), inset 3px 0 0 var(--c), 0 0 0 1px var(--rb-gold) !important; }
  :global(.board li.ph) { border-radius: 12px; border: 1px dashed var(--rb-gold); background: color-mix(in srgb, var(--rb-gold) 8%, transparent); list-style: none; }
  .divider { display: flex; align-items: center; gap: 10px; padding: 14px 4px 6px; color: var(--rb-muted); font-size: 12.5px; list-style: none; }
  .divider::after { content: ''; flex: 1; height: 1px; background: linear-gradient(90deg, color-mix(in srgb, var(--c) 50%, transparent), transparent); }
  .handle { touch-action: none; cursor: grab; color: var(--rb-faint); display: grid; place-items: center; height: 40px; }
  .handle.off { opacity: .2; cursor: default; }
  .handle:active { cursor: grabbing; }
  .rank { font: 800 30px/1 var(--rb-font-display); color: var(--rb-muted); text-align: right; padding: 2px 4px; border-radius: 8px; }
  .top .rank { color: var(--rb-gold); font-size: 36px; }
  .rank:hover { background: var(--rb-surface-2); color: var(--rb-text); }
  .jump { width: 48px; height: 36px; text-align: center; border-radius: 8px; border: 1px solid var(--rb-gold); background: var(--rb-bg); }
  .main { display: grid; min-width: 0; }
  .t { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .m { font-size: 12.5px; color: var(--rb-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .score { display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto; column-gap: 8px; align-items: center; }
  .sv { font: 800 22px/1 var(--rb-font-display); grid-row: span 2; }
  .sbar { height: 5px; border-radius: 99px; background: var(--rb-surface-3); overflow: hidden; }
  .sbar i { display: block; height: 100%; background: var(--c); }
  .conf { font-size: 11px; color: var(--rb-faint); }
  .conf.shaky { color: var(--rb-tier-B); }
  .acts { display: flex; gap: 2px; }
  .acts button { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 8px; color: var(--rb-faint); }
  .acts button:hover { background: var(--rb-surface-2); color: var(--rb-text); }

  .pool { margin-top: 28px; }
  .pool h2 { font: 800 20px/1 var(--rb-font-display); text-transform: uppercase; letter-spacing: .02em; margin-bottom: 10px; display: flex; gap: 8px; align-items: baseline; }
  .pool h2 span { color: var(--rb-faint); font-size: 16px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { display: inline-flex; align-items: center; gap: 8px; padding: 4px 6px 4px 4px; border-radius: 10px; background: var(--rb-surface); font-size: 13px; box-shadow: inset 0 0 0 1px var(--rb-line); }
  .chip.muted { padding-left: 10px; color: var(--rb-muted); }
  .chip button { padding: 4px 9px; border-radius: 7px; color: var(--rb-accent); font-weight: 600; font-size: 12.5px; }
  .chip button:hover { background: var(--rb-surface-2); }

  .settings { margin-top: 30px; padding: 16px; border-radius: var(--rb-radius); background: var(--rb-surface); display: grid; gap: 14px; }
  .tog { display: flex; gap: 12px; align-items: flex-start; cursor: pointer; }
  .tog input { width: 18px; height: 18px; margin-top: 3px; accent-color: var(--rb-gold); flex: none; }
  .tog small { color: var(--rb-muted); }
  .reset { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 14px; }
  .reset button { padding: 8px 13px; border-radius: 9px; font-weight: 600; font-size: 13.5px; }
  .danger { background: var(--rb-danger); color: #2a0606; }
  .danger-ghost { color: var(--rb-danger); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--rb-danger) 40%, transparent); }

  @media (max-width: 760px) {
    .board li[data-id] { grid-template-columns: 18px 40px 38px minmax(0, 1fr) 34px; gap: 9px; }
    .score, .acts { display: none; }
    li.open .score { display: grid; grid-column: 3 / 5; grid-row: 2; }
    li.open .acts { display: flex; grid-column: 5 / -1; grid-row: 2; justify-content: flex-end; }
    .main { cursor: pointer; }
    .rank { font-size: 26px; }
    .top .rank { font-size: 30px; }
  }
</style>
