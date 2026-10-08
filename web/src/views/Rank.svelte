<script lang="ts">
  import type { RankBox } from '../lib/store.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import Poster from '../lib/ui/Poster.svelte';
  import TierChip from '../lib/ui/TierChip.svelte';
  import Versus from '../lib/ui/Versus.svelte';

  let { rb, go }: { rb: RankBox; go: (tab: string) => void } = $props();

  const view = $derived(rb.view!);
  const finished = $derived(rb.inbox.filter((f) => rb.items.has(f.id)));
  const shaky = $derived(view.ranked.filter((r) => r.se > 0.85).length);
  const left = $derived(view.queue.length);
  const pct = $derived(view.ranked.length + left ? Math.round((view.ranked.length / (view.ranked.length + left)) * 100) : 0);
  const podium = $derived(view.ranked.slice(0, 3));
  const rankOf = (id: string) => view.byId.get(id)?.rank;
  const poster = (id: string) => rb.backend.poster(id);
</script>

{#if finished.length}
  <section class="inbox" aria-label="Just finished">
    {#each finished as f (f.id)}
      {@const it = rb.item(f.id)!}
      {@const r = view.byId.get(f.id)}
      <article class="fin">
        <Poster name={it.name} src={rb.backend.poster(f.id, 160)} size="sm" />
        <div class="ft">
          <span class="k">Just finished</span>
          <b>{it.name}</b>
          <span class="s">{r ? `#${r.rank} right now` : 'Not ranked yet'}</span>
        </div>
        <button class="go" onclick={() => rb.rankNow(f)}>{r ? 'Re-rank' : 'Rank it'}</button>
        <button class="x" onclick={() => rb.dismiss(f.id)} aria-label="Dismiss"><Icon name="x" size={16} /></button>
      </article>
    {/each}
  </section>
{/if}

{#if rb.q}
  {#key rb.q.a + rb.q.b + rb.q.kind}
    <div class="stage">
      <Versus
        q={rb.q}
        a={rb.item(rb.q.a)!}
        b={rb.item(rb.q.b)!}
        {rankOf}
        {poster}
        slots={view.ranked.length + (view.byId.has(rb.q.a) ? 0 : 1)}
        canUndo={rb.canUndo}
        onanswer={(r) => rb.answer(r)}
        onskip={() => rb.skip()}
        onundo={() => rb.undo()}
        onunseen={(id) => rb.exclude(id)}
      />
    </div>
  {/key}
{:else if view.ranked.length < 2 && view.queue.length < 2}
  <div class="empty">
    <h2>Nothing to rank yet</h2>
    <p>RankBox needs at least two titles. Turn off "watched only" in Ranking, or add back things you hid.</p>
  </div>
{:else}
  <section class="done">
    <p class="eyebrow">{rb.refining ? 'Settled for now' : `All ${view.ranked.length} placed`}</p>
    <h2>{rb.refining ? 'Your answers agree with each other.' : 'Your list is ranked.'}</h2>
    <div class="podium">
      {#each [podium[1], podium[0], podium[2]] as r, i (r?.id ?? i)}
        {#if r}
          {@const it = rb.item(r.id)!}
          <figure class="step s{r.rank}">
            <span class="n num">{r.rank}</span>
            <Poster name={it.name} year={it.year} src={poster(r.id)} size="md" />
            <figcaption>{it.name}</figcaption>
          </figure>
        {/if}
      {/each}
    </div>
    <div class="row">
      {#if !rb.refining}
        <button class="primary" onclick={() => rb.setRefining(true)}><Icon name="sparkle" size={17} />Keep refining</button>
      {/if}
      <button class="ghost" onclick={() => go('ranking')}>See the full ranking</button>
      <button class="ghost" onclick={() => go('tiers')}>Tier list</button>
    </div>
    <p class="hint">Refining asks about neighbours you watched months apart, so whatever you binged last week doesn't float to the top just for being fresh.</p>
  </section>
{/if}

<footer class="progress">
  <div class="nums num">
    <span><b>{view.ranked.length}</b> ranked</span>
    <span><b>{view.queue.length}</b> to place</span>
    <span><b>{rb.b.state.answers.length}</b> answers</span>
    {#if shaky}<span class="shaky"><b>{shaky}</b> still shaky</span>{/if}
    {#if view.rechecks.length}<span class="rc"><b>{view.rechecks.length}</b> recency {view.rechecks.length === 1 ? 'check' : 'checks'}</span>{/if}
  </div>
  <div class="bar" aria-hidden="true"><i style="width:{pct}%"></i></div>
</footer>

{#if view.ranked.length >= 3 && rb.q}
  <aside class="mini">
    <span class="lbl">Top right now</span>
    {#each view.ranked.slice(0, 5) as r (r.id)}
      <span class="m"><b class="num">{r.rank}</b>{rb.item(r.id)?.name}<TierChip tier={r.tier} /></span>
    {/each}
  </aside>
{/if}

<style>
  .inbox { display: flex; gap: 10px; overflow-x: auto; padding: 2px 2px 14px; margin: 0 -2px 6px; scroll-snap-type: x mandatory; }
  .fin {
    flex: 0 0 auto; width: min(360px, 86vw); scroll-snap-align: start;
    display: flex; align-items: center; gap: 12px;
    padding: 10px 10px 10px 12px; border-radius: var(--rb-radius);
    background: linear-gradient(100deg, color-mix(in srgb, var(--rb-gold) 12%, var(--rb-surface)), var(--rb-surface) 60%);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--rb-gold) 30%, var(--rb-line));
  }
  .ft { flex: 1; min-width: 0; display: grid; }
  .ft .k { font-size: 11px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--rb-gold); }
  .ft b { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
  .ft .s { font-size: 12.5px; color: var(--rb-muted); }
  .go { padding: 8px 13px; border-radius: 10px; background: var(--rb-gold); color: #1a1405; font-weight: 700; font-size: 14px; white-space: nowrap; }
  .x { color: var(--rb-faint); padding: 6px; border-radius: 8px; }
  .x:hover { color: var(--rb-text); background: var(--rb-surface-2); }

  .stage { padding-top: 8px; animation: rise .28s cubic-bezier(.2, .8, .2, 1); }
  @media (max-width: 560px) {
    .inbox { padding-bottom: 8px; margin-bottom: 0; }
    .fin { padding: 7px 8px 7px 10px; gap: 10px; }
    .stage { padding-top: 2px; }
    .mini { display: none; }
  }
  @keyframes rise { from { opacity: 0; transform: translateY(6px); } }

  .empty, .done { text-align: center; padding: 30px 0 10px; display: grid; gap: 12px; justify-items: center; }
  .empty h2, .done h2 { font: 800 clamp(28px, 4.5vw, 40px)/1.05 var(--rb-font-display); text-transform: uppercase; letter-spacing: .01em; }
  .empty p { color: var(--rb-muted); max-width: 46ch; margin: 0; }
  .eyebrow { margin: 0; font-size: 12px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; color: var(--rb-gold); }
  .podium { display: grid; grid-template-columns: repeat(3, minmax(0, 150px)); gap: 14px; align-items: end; margin: 14px 0 6px; }
  .step { margin: 0; display: grid; gap: 8px; justify-items: center; position: relative; }
  .step.s1 { transform: translateY(-18px); }
  .step .n { font: 900 54px/0.8 var(--rb-font-display); color: var(--rb-gold); }
  .step.s2 .n, .step.s3 .n { font-size: 40px; color: var(--rb-muted); }
  .step figcaption { font-size: 13px; font-weight: 600; line-height: 1.25; max-width: 15ch; }
  .row { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
  .primary { display: inline-flex; gap: 8px; align-items: center; padding: 12px 20px; border-radius: 12px; background: var(--rb-gold); color: #1a1405; font-weight: 700; }
  .ghost { padding: 12px 18px; border-radius: 12px; box-shadow: inset 0 0 0 1px var(--rb-line-strong); font-weight: 500; }
  .ghost:hover { background: var(--rb-surface-2); }
  .hint { color: var(--rb-faint); font-size: 13px; max-width: 52ch; margin: 4px 0 0; }

  .progress { margin: 34px auto 0; max-width: 620px; display: grid; gap: 8px; }
  .nums { display: flex; flex-wrap: wrap; gap: 6px 16px; justify-content: center; font-size: 13px; color: var(--rb-muted); }
  .nums b { color: var(--rb-text); font-weight: 700; }
  .nums .shaky b { color: var(--rb-tier-B); }
  .nums .rc b { color: var(--rb-gold); }
  .bar { height: 4px; border-radius: 99px; background: var(--rb-surface-2); overflow: hidden; }
  .bar i { display: block; height: 100%; background: var(--rb-gold); transition: width .3s ease; }

  .mini { margin: 26px auto 0; max-width: 620px; display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; align-items: center; }
  .mini .lbl { width: 100%; text-align: center; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--rb-faint); }
  .mini .m { display: inline-flex; align-items: center; gap: 7px; padding: 4px 6px 4px 10px; border-radius: 99px; background: var(--rb-surface); font-size: 13px; }
  .mini .m b { font: 800 16px/1 var(--rb-font-display); color: var(--rb-gold); }
</style>
