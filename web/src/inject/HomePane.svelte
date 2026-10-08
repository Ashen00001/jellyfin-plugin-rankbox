<script lang="ts">
  import { onMount } from 'svelte';
  import type { ListKey } from '../lib/engine/types';
  import type { RankBox } from '../lib/store.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import Poster from '../lib/ui/Poster.svelte';
  import TierChip from '../lib/ui/TierChip.svelte';
  import Versus from '../lib/ui/Versus.svelte';

  // Lives on Jellyfin's home screen: answer the next question in place, glance at your top 5.
  let { rb, appUrl }: { rb: RankBox; appUrl: string } = $props();

  let list = $state<ListKey>('series');
  onMount(() => {
    try { list = (localStorage.getItem('rankbox.home.list') as ListKey) || 'series'; } catch { /* ignore */ }
    void rb.start(list);
  });
  function pick(l: ListKey) {
    list = l;
    try { localStorage.setItem('rankbox.home.list', l); } catch { /* ignore */ }
    void rb.load(l);
  }

  const view = $derived(rb.view);
  const top = $derived(view ? view.ranked.slice(0, 5) : []);
  const finished = $derived(rb.inbox.filter((f) => rb.items.has(f.id)));
  const open = (q = '') => appUrl + (q ? '?' + q : '');
</script>

<div class="pane">
  <div class="title">
    <h2>RankBox</h2>
    <div class="seg">
      <button class:on={list === 'series'} onclick={() => pick('series')}>Shows</button>
      <button class:on={list === 'movies'} onclick={() => pick('movies')}>Movies</button>
    </div>
    <a class="open" href={open(`list=${list}`)}>Open RankBox <Icon name="back" size={14} /></a>
  </div>

  {#if rb.loading || !view}
    <div class="body skeleton"><span></span><span></span></div>
  {:else if rb.error}
    <p class="muted">RankBox couldn't load ({rb.error}).</p>
  {:else}
    <div class="body">
      <div class="ask">
        {#if finished[0]}
          {@const f = finished[0]}
          <div class="fin">
            <span><b>Just finished:</b> {rb.item(f.id)?.name}</span>
            <button onclick={() => rb.rankNow(f)}>{view.byId.has(f.id) ? 'Re-rank' : 'Rank it'}</button>
            <button class="x" onclick={() => rb.dismiss(f.id)} aria-label="Dismiss">×</button>
          </div>
        {/if}
        {#if rb.q}
          {#key rb.q.a + rb.q.b + rb.q.kind}
            <Versus
              compact
              q={rb.q}
              a={rb.item(rb.q.a)!}
              b={rb.item(rb.q.b)!}
              rankOf={(id) => view.byId.get(id)?.rank}
              poster={(id) => rb.backend.poster(id, 360)}
              slots={view.ranked.length + (view.byId.has(rb.q.a) ? 0 : 1)}
              canUndo={rb.canUndo}
              onanswer={(r) => rb.answer(r)}
              onskip={() => rb.skip()}
              onundo={() => rb.undo()}
              onunseen={(id) => rb.exclude(id)}
            />
          {/key}
        {:else}
          <div class="settled">
            <p class="k">All {view.ranked.length} placed</p>
            <p>Nothing to ask right now. Recency checks show up here about three weeks after you binge something.</p>
            <a href={open()}>See the full ranking</a>
          </div>
        {/if}
      </div>

      <aside class="top">
        <p class="k">Your top {top.length}</p>
        {#each top as r (r.id)}
          {@const it = rb.item(r.id)!}
          <a class="row" href={rb.backend.jellyfinUrl() + '#/details?id=' + r.id}>
            <span class="n num" class:gold={r.rank === 1}>{r.rank}</span>
            <Poster name={it.name} src={rb.backend.poster(r.id, 120)} size="sm" />
            <span class="nm">{it.name}</span>
            <TierChip tier={r.tier} />
          </a>
        {/each}
        {#if !top.length}<p class="muted">Answer a few questions and your top 5 shows up here.</p>{/if}
        <p class="meta num">{view.ranked.length} ranked · {view.queue.length} to place{view.rechecks.length ? ` · ${view.rechecks.length} recency checks` : ''}</p>
      </aside>
    </div>
  {/if}
</div>

<style>
  .pane { color: var(--rb-text); font: 15px/1.45 var(--rb-font-body); margin: 0 0 1.8em; }
  .title { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 12px; }
  h2 { margin: 0; font: 900 26px/1 var(--rb-font-display); letter-spacing: .03em; text-transform: uppercase; }
  .seg { display: flex; padding: 3px; gap: 2px; background: rgba(0, 0, 0, .35); border-radius: 10px; }
  .seg button { padding: 5px 11px; border-radius: 7px; font-size: 13px; color: var(--rb-muted); }
  .seg button.on { background: rgba(255, 255, 255, .12); color: var(--rb-text); }
  .open { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; color: var(--rb-gold); text-decoration: none; font-size: 14px; font-weight: 600; }
  .open :global(svg) { transform: rotate(180deg); }
  .body {
    display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(240px, 1fr); gap: 18px;
    padding: 18px; border-radius: 18px;
    background: rgba(12, 15, 20, .72); backdrop-filter: blur(16px);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .07), 0 20px 50px -25px rgba(0, 0, 0, .8);
  }
  .ask { min-width: 0; display: grid; gap: 12px; align-content: start; }
  .fin { display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 12px; border-radius: 12px; background: color-mix(in srgb, var(--rb-gold) 14%, transparent); font-size: 14px; }
  .fin span { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fin button { padding: 6px 12px; border-radius: 9px; background: var(--rb-gold); color: #1a1405; font-weight: 700; font-size: 13px; }
  .fin .x { background: none; color: var(--rb-muted); font-size: 18px; padding: 2px 8px; }
  .settled { display: grid; gap: 6px; align-content: center; min-height: 200px; text-align: center; justify-items: center; }
  .settled p { margin: 0; max-width: 40ch; color: var(--rb-muted); font-size: 14px; }
  .settled a { color: var(--rb-gold); font-weight: 600; }
  .k { margin: 0; font-size: 11px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; color: var(--rb-gold); }
  .top { display: grid; gap: 8px; align-content: start; min-width: 0; border-left: 1px solid rgba(255, 255, 255, .08); padding-left: 18px; }
  .row { display: grid; grid-template-columns: 28px 42px minmax(0, 1fr) auto; gap: 10px; align-items: center; text-decoration: none; color: inherit; padding: 4px; border-radius: 10px; }
  .row:hover { background: rgba(255, 255, 255, .06); }
  .n { font: 900 26px/1 var(--rb-font-display); color: var(--rb-muted); text-align: right; }
  .n.gold { color: var(--rb-gold); }
  .nm { font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta { margin: 4px 0 0; font-size: 12px; color: var(--rb-faint); }
  .muted { color: var(--rb-muted); font-size: 14px; margin: 0; }
  .skeleton { min-height: 260px; }
  .skeleton span { border-radius: 12px; background: linear-gradient(90deg, rgba(255,255,255,.04), rgba(255,255,255,.09), rgba(255,255,255,.04)); background-size: 200% 100%; animation: sh 1.4s infinite; }
  @keyframes sh { to { background-position: -200% 0; } }
  @media (max-width: 760px) {
    .body { grid-template-columns: minmax(0, 1fr); padding: 14px; }
    .top { border-left: 0; padding-left: 0; border-top: 1px solid rgba(255, 255, 255, .08); padding-top: 14px; }
    .open { margin-left: 0; }
  }
</style>
