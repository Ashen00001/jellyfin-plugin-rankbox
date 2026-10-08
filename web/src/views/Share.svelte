<script lang="ts">
  import { exportText, MIME, type Format } from '../lib/export';
  import { renderCard, type CardStyle } from '../lib/sharecard';
  import type { RankBox } from '../lib/store.svelte';
  import Icon from '../lib/ui/Icon.svelte';

  let { rb }: { rb: RankBox } = $props();
  const view = $derived(rb.view!);

  let style = $state<CardStyle>('top10');
  let img = $state('');
  let rendering = $state(false);
  let cardErr = $state('');

  $effect(() => {
    // re-render whenever the style or ranking changes
    const s = style, v = view;
    if (!v.ranked.length) { img = ''; return; }
    rendering = true; cardErr = '';
    renderCard(s, v, rb.items, rb.list, rb.me.name === 'You' ? '' : rb.me.name, rb.b.state.answers.length, (id, h) => rb.backend.poster(id, h))
      .then((cv) => { try { img = cv.toDataURL('image/png'); } catch { cardErr = 'Couldn’t export the image.'; } })
      .catch((e) => (cardErr = String(e)))
      .finally(() => (rendering = false));
  });

  let fmt = $state<Format>('md');
  const text = $derived(exportText(fmt, view, rb.items, rb.list, rb.me.name === 'You' ? '' : rb.me.name, rb.b.state.answers.length));
  let msg = $state('');
  const flash = (m: string) => { msg = m; setTimeout(() => (msg = ''), 1800); };

  function save(href: string, name: string) {
    const a = document.createElement('a');
    a.href = href; a.download = name;
    document.body.append(a); a.click(); a.remove();
  }
  const stamp = () => new Date().toISOString().slice(0, 10);
  function downloadText() {
    const url = URL.createObjectURL(new Blob([text], { type: MIME[fmt] + ';charset=utf-8' }));
    save(url, `rankbox-${rb.list}-${stamp()}.${fmt}`);
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
  async function copy() {
    try { await navigator.clipboard.writeText(text); flash('Copied'); }
    catch {
      const t = document.getElementById('export-text') as HTMLTextAreaElement | null;
      t?.select(); flash('Selected. Press Ctrl+C to copy');
    }
  }
  let starMsg = $state('');
  async function star() {
    starMsg = 'Starring…';
    try { const n = await rb.favorites(10); starMsg = `${n} starred in Jellyfin`; }
    catch (e) { starMsg = 'Failed: ' + (e as Error).message; }
  }
</script>

<div class="head">
  <h1>Share</h1>
  <p>A card for Discord or your story, or the whole list as text.</p>
</div>

<div class="layout">
  <section class="card cardgen">
    <div class="seg">
      <button class:on={style === 'top10'} onclick={() => (style = 'top10')}>Top 10</button>
      <button class:on={style === 'tiers'} onclick={() => (style = 'tiers')}>Tier list</button>
    </div>
    <div class="preview" class:busy={rendering}>
      {#if img}<img src={img} alt="RankBox share card" />{:else if !view.ranked.length}<span class="ph">Rank a few titles first</span>{:else}<span class="ph">Drawing…</span>{/if}
    </div>
    {#if cardErr}<p class="err">{cardErr}</p>{/if}
    {#if img}
      {#if rb.backend.demo}
        <p class="hint">Long-press or right-click the image to save it.</p>
      {:else}
        <button class="primary" onclick={() => save(img, `rankbox-${style}-${stamp()}.png`)}><Icon name="download" size={17} />Save image</button>
      {/if}
    {/if}
  </section>

  <section class="card textgen">
    <div class="fmts">
      {#each [['md', 'Markdown'], ['txt', 'Text'], ['csv', 'Spreadsheet'], ['json', 'JSON']] as [f, label]}
        <button class:on={fmt === f} onclick={() => (fmt = f as Format)}>{label}<small>.{f}</small></button>
      {/each}
    </div>
    <textarea id="export-text" readonly value={text} spellcheck="false"></textarea>
    <div class="row">
      <button class="primary" onclick={copy}><Icon name="copy" size={17} />Copy</button>
      {#if !rb.backend.demo}<button class="ghost" onclick={downloadText}><Icon name="download" size={17} />Download .{fmt}</button>{/if}
      <span class="ok">{msg}</span>
    </div>
  </section>

  <section class="card stars">
    <h2><Icon name="star" size={17} />Star your top 10 in Jellyfin</h2>
    <p>Marks them as favorites so they show under Favorites everywhere, Infuse included. It only adds stars and never removes any.</p>
    <div class="row">
      <button class="ghost" onclick={star} disabled={!view.ranked.length}>Star top 10</button>
      <span class="ok">{starMsg}</span>
    </div>
  </section>
</div>

<style>
  .head { margin-bottom: 16px; }
  h1 { font: 800 clamp(30px, 4.6vw, 42px)/1 var(--rb-font-display); text-transform: uppercase; letter-spacing: .01em; }
  .head p { margin: 6px 0 0; color: var(--rb-muted); font-size: 14px; }
  .layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); gap: 12px; align-items: start; }
  .card { background: var(--rb-surface); border-radius: var(--rb-radius); padding: 16px; display: grid; gap: 12px; min-width: 0; }
  .cardgen { grid-row: span 2; }
  .seg { display: flex; padding: 3px; gap: 2px; background: var(--rb-bg); border-radius: 11px; justify-self: start; }
  .seg button { padding: 7px 14px; border-radius: 8px; font-size: 14px; color: var(--rb-muted); font-weight: 500; }
  .seg button.on { background: var(--rb-surface-3); color: var(--rb-text); }
  .preview { aspect-ratio: 4 / 5; border-radius: 12px; overflow: hidden; background: var(--rb-bg); display: grid; place-items: center; max-width: 100%; }
  .preview.busy { opacity: .6; }
  .preview img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .ph { color: var(--rb-faint); font-size: 14px; }
  .hint { margin: 0; color: var(--rb-muted); font-size: 13px; }
  .err { margin: 0; color: var(--rb-danger); font-size: 13px; }
  .fmts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
  .fmts button { padding: 9px 4px; border-radius: 10px; background: var(--rb-bg); box-shadow: inset 0 0 0 1px var(--rb-line); font-weight: 600; font-size: 13.5px; display: grid; }
  .fmts button small { color: var(--rb-faint); font-weight: 400; font-size: 11px; }
  .fmts button.on { box-shadow: inset 0 0 0 2px var(--rb-gold); }
  textarea { width: 100%; min-height: 300px; resize: vertical; border-radius: 11px; border: 0; padding: 12px; background: var(--rb-bg); color: var(--rb-text); font: 13px/1.5 ui-monospace, 'Cascadia Code', Consolas, monospace; box-shadow: inset 0 0 0 1px var(--rb-line); }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .primary { display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; border-radius: 11px; background: var(--rb-gold); color: #1a1405; font-weight: 700; justify-self: start; }
  .ghost { display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; border-radius: 11px; box-shadow: inset 0 0 0 1px var(--rb-line-strong); font-weight: 500; }
  .ghost:hover:not(:disabled) { background: var(--rb-surface-2); }
  .ghost:disabled { opacity: .4; }
  .ok { font-size: 13px; color: var(--rb-up); }
  .stars h2 { display: flex; gap: 8px; align-items: center; font: 800 18px/1 var(--rb-font-display); text-transform: uppercase; letter-spacing: .04em; color: var(--rb-muted); }
  .stars p { margin: 0; color: var(--rb-muted); font-size: 14px; }
  @media (max-width: 820px) { .layout { grid-template-columns: minmax(0, 1fr); } .cardgen { grid-row: auto; } }
</style>
