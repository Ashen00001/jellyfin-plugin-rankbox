<script lang="ts">
  import type { ListKey } from './lib/engine/types';
  import type { RankBox } from './lib/store.svelte';
  import Icon from './lib/ui/Icon.svelte';
  import { LIST_LABEL } from './lib/ui/format';
  import Insights from './views/Insights.svelte';
  import Rank from './views/Rank.svelte';
  import Ranking from './views/Ranking.svelte';
  import Share from './views/Share.svelte';
  import Tiers from './views/Tiers.svelte';

  let { rb, signedOut = false, jellyfinBase = '' }: { rb: RankBox; signedOut?: boolean; jellyfinBase?: string } = $props();

  const TABS = [
    { id: 'rank', label: 'Rank', icon: 'rank' },
    { id: 'ranking', label: 'Ranking', icon: 'list' },
    { id: 'tiers', label: 'Tiers', icon: 'tiers' },
    { id: 'insights', label: 'Insights', icon: 'insights' },
    { id: 'share', label: 'Share', icon: 'share' },
  ] as const;
  type Tab = (typeof TABS)[number]['id'];

  const fromHash = (): Tab => (TABS.find((t) => '#' + t.id === location.hash)?.id ?? 'rank');
  let tab = $state<Tab>(fromHash());
  function go(t: Tab) {
    tab = t;
    try { history.replaceState(null, '', '#' + t); } catch { /* sandboxed viewer */ }
    window.scrollTo({ top: 0 });
  }

  const badge = $derived.by(() => {
    if (!rb.view) return 0;
    const fin = rb.inbox.filter((f) => rb.items.has(f.id)).length;
    return fin + rb.view.rechecks.length;
  });

  const saveText = $derived(
    { idle: '', saving: 'Saving…', saved: 'Saved', error: 'Not saved, retrying', 'signed-out': 'Signed out' }[rb.save],
  );

  function onkey(e: KeyboardEvent) {
    if (tab !== 'rank' || !rb.q || (e.target as HTMLElement)?.closest('input,textarea,select')) return;
    if (e.key === 'ArrowUp') { e.preventDefault(); rb.answer(1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); rb.answer(0); }
    else if (e.key === '=' || e.key === 's') { e.preventDefault(); rb.answer(0.5); }
    else if (e.key === ' ') { e.preventDefault(); rb.skip(); }
    else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); rb.undo(); }
  }
</script>

<svelte:window onkeydown={onkey} onhashchange={() => (tab = fromHash())} />

<div class="shell">
  <header class="top">
    <a class="brand" href={jellyfinBase ? jellyfinBase + '/web/' : '#rank'} title={jellyfinBase ? 'Back to Jellyfin' : 'RankBox'}>
      <svg viewBox="0 0 64 64" aria-hidden="true"><rect x="8" y="28" width="14" height="28" rx="2.5" fill="var(--rb-tier-A)"/><rect x="25" y="10" width="14" height="46" rx="2.5" fill="var(--rb-gold)"/><rect x="42" y="38" width="14" height="18" rx="2.5" fill="var(--rb-tier-D)"/></svg>
      <span>RankBox</span>
    </a>
    {#if rb.backend.demo && !signedOut}<span class="demo">Demo · sample library</span>{/if}
    <div class="seg" role="tablist" aria-label="Which list">
      {#each ['series', 'movies', 'all'] as const as l}
        <button role="tab" aria-selected={rb.list === l} class:on={rb.list === l} onclick={() => rb.list !== l && rb.load(l as ListKey)}>{LIST_LABEL[l]}</button>
      {/each}
    </div>
    <span class="save" class:err={rb.save === 'error' || rb.save === 'signed-out'}>{saveText}</span>
  </header>

  <nav class="tabs" aria-label="Sections">
    {#each TABS as t}
      <button class:on={tab === t.id} onclick={() => go(t.id)} aria-current={tab === t.id ? 'page' : undefined}>
        <Icon name={t.icon} size={19} />
        <span>{t.label}</span>
        {#if t.id === 'rank' && badge}<b class="dot num">{badge}</b>{/if}
      </button>
    {/each}
  </nav>

  <main>
    {#if signedOut || rb.error === 'signed-out'}
      <div class="state">
        <h1>Sign in to Jellyfin first</h1>
        <p>RankBox uses the Jellyfin login from this browser.</p>
        <a class="cta" href={jellyfinBase + '/web/'}>Open Jellyfin</a>
      </div>
    {:else if rb.error}
      <div class="state">
        <h1>Couldn't load RankBox</h1>
        <p>{rb.error}</p>
        <button class="cta" onclick={() => rb.load(rb.list)}>Try again</button>
      </div>
    {:else if rb.loading || !rb.view}
      <div class="state dim"><span class="spinner" aria-hidden="true"></span>Loading your {LIST_LABEL[rb.list].toLowerCase()}…</div>
    {:else if tab === 'rank'}
      <Rank {rb} go={(t) => go(t as Tab)} />
    {:else if tab === 'ranking'}
      <Ranking {rb} />
    {:else if tab === 'tiers'}
      <Tiers {rb} />
    {:else if tab === 'insights'}
      <Insights {rb} go={(t) => go(t as Tab)} />
    {:else}
      <Share {rb} />
    {/if}
  </main>
</div>

<style>
  .shell { max-width: 1040px; margin: 0 auto; padding: 0 16px calc(96px + env(safe-area-inset-bottom, 0px)); }
  .top {
    display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
    padding: calc(14px + env(safe-area-inset-top, 0px)) 0 12px;
  }
  .brand { display: inline-flex; align-items: center; gap: 9px; text-decoration: none; color: var(--rb-text); }
  .brand svg { width: 26px; height: 26px; }
  .brand span { font: 900 25px/1 var(--rb-font-display); letter-spacing: .02em; text-transform: uppercase; }
  .demo { font-size: 12px; color: var(--rb-muted); border: 1px dashed var(--rb-line-strong); border-radius: 99px; padding: 3px 10px; }
  .seg { margin-left: auto; display: flex; padding: 3px; gap: 2px; background: var(--rb-surface); border-radius: 11px; box-shadow: inset 0 0 0 1px var(--rb-line); }
  .seg button { padding: 7px 13px; border-radius: 8px; font-size: 14px; font-weight: 500; color: var(--rb-muted); }
  .seg button.on { background: var(--rb-surface-3); color: var(--rb-text); }
  .save { font-size: 12px; color: var(--rb-faint); min-width: 5.5em; text-align: right; }
  .save.err { color: var(--rb-danger); }

  .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--rb-line); margin-bottom: 22px; }
  .tabs button {
    position: relative; display: inline-flex; align-items: center; gap: 8px;
    padding: 11px 14px 12px; color: var(--rb-muted); font-weight: 500; font-size: 15px;
    border-bottom: 2px solid transparent; margin-bottom: -1px;
  }
  .tabs button:hover { color: var(--rb-text); }
  .tabs button.on { color: var(--rb-text); border-bottom-color: var(--rb-gold); }
  .dot {
    min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px;
    background: var(--rb-gold); color: #1a1405; font: 700 11px/18px var(--rb-font-body); text-align: center;
  }

  .state { text-align: center; padding: 70px 16px; display: grid; gap: 10px; justify-items: center; }
  .state h1 { font: 800 30px/1.1 var(--rb-font-display); text-transform: uppercase; letter-spacing: .02em; }
  .state p { margin: 0; color: var(--rb-muted); }
  .state.dim { color: var(--rb-muted); grid-auto-flow: column; justify-content: center; align-items: center; gap: 12px; }
  .cta { margin-top: 8px; padding: 11px 20px; border-radius: 11px; background: var(--rb-accent); color: var(--rb-accent-ink); font-weight: 700; text-decoration: none; }
  .spinner { width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--rb-line-strong); border-top-color: var(--rb-gold); animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  @media (max-width: 700px) {
    .top { gap: 10px; }
    .seg { margin-left: 0; order: 3; width: 100%; }
    .seg button { flex: 1; }
    .save { margin-left: auto; }
    .tabs {
      position: fixed; z-index: 30; left: 0; right: 0; bottom: 0; margin: 0;
      padding: 6px 6px calc(6px + env(safe-area-inset-bottom, 0px));
      background: color-mix(in srgb, var(--rb-bg) 88%, transparent); backdrop-filter: blur(14px);
      border-top: 1px solid var(--rb-line); border-bottom: 0; justify-content: space-around;
    }
    .tabs button { flex-direction: column; gap: 3px; padding: 6px 4px; font-size: 11px; border-bottom: 0; flex: 1; border-radius: 10px; }
    .tabs button.on { color: var(--rb-gold); }
    .dot { position: absolute; top: 2px; right: calc(50% - 22px); }
  }
</style>
