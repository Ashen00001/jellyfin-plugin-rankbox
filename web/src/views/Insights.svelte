<script lang="ts">
  import { animationStudios, decade, facets, meaningfulGenres, recencyBias, tasteMatch } from '../lib/insights';
  import type { RankBox } from '../lib/store.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import Poster from '../lib/ui/Poster.svelte';

  let { rb, go }: { rb: RankBox; go: (tab: string) => void } = $props();
  const view = $derived(rb.view!);
  const bias = $derived(recencyBias(rb.b.state.answers, view));
  const genres = $derived(facets(view, rb.items, meaningfulGenres(rb.items.values())).slice(0, 6));
  const studios = $derived(facets(view, rb.items, animationStudios).slice(0, 5));
  const eras = $derived(facets(view, rb.items, decade, 1).sort((a, b) => a.name.localeCompare(b.name)));
  const settled = $derived(view.ranked.filter((r) => r.se <= 0.6).length);
  const shaky = $derived(view.ranked.filter((r) => r.se > 0.85).length);
  const matches = $derived(rb.friends.map((f) => tasteMatch(view, f)).filter((m) => !!m));
  const name = (id: string) => rb.item(id)?.name ?? '?';
  const pct = (x: number) => Math.round(x * 100);
  // meter: -30%..+30% mapped onto the dial
  const needle = $derived(Math.max(-1, Math.min(1, bias.delta / 0.3)));
  const verdict = $derived(
    bias.n < 6 ? 'Not enough data yet'
      : bias.delta > 0.12 ? 'You overrate fresh watches'
      : bias.delta > 0.05 ? 'A slight lean toward recent stuff'
      : bias.delta < -0.08 ? 'You go easy on old favourites'
      : 'Barely any recency bias',
  );
</script>

<div class="head">
  <h1>Insights</h1>
  <p>Built from {rb.b.state.answers.length} answers across {view.ranked.length} ranked titles.</p>
</div>

<div class="grid">
  <section class="card bias">
    <h2><Icon name="clock" size={17} />Recency bias</h2>
    <div class="dial" aria-hidden="true">
      <svg viewBox="0 0 200 110">
        <path d="M14 100a86 86 0 0 1 172 0" fill="none" stroke="var(--rb-surface-3)" stroke-width="14" stroke-linecap="round" />
        <path d="M14 100a86 86 0 0 1 43-74.5" fill="none" stroke="var(--rb-tier-D)" stroke-width="14" stroke-linecap="round" opacity=".7" />
        <path d="M143 25.5a86 86 0 0 1 43 74.5" fill="none" stroke="var(--rb-tier-S)" stroke-width="14" stroke-linecap="round" opacity=".8" />
        {#if bias.n >= 6}
          <g style="transform: rotate({needle * 80}deg); transform-origin: 100px 100px; transition: transform .6s cubic-bezier(.2,.8,.2,1)">
            <line x1="100" y1="100" x2="100" y2="30" stroke="var(--rb-gold)" stroke-width="4" stroke-linecap="round" />
          </g>
        {/if}
        <circle cx="100" cy="100" r="8" fill="var(--rb-gold)" />
      </svg>
    </div>
    <p class="big">{verdict}</p>
    {#if bias.n >= 6}
      <p class="body">
        In {bias.n} matchups against something you'd watched in the last 3 weeks, the fresh one won
        <b class="num">{pct(bias.freshWon)}%</b> of the time. The rest of your answers predict <b class="num">{pct(bias.expected)}%</b>.
      </p>
    {:else}
      <p class="body">Shows up once you've answered about 6 matchups involving something watched in the last 3 weeks ({bias.n} so far).</p>
    {/if}
    <p class="foot num">Recency checks: <b>{bias.kept}</b> kept · <b>{bias.flipped}</b> flipped · <b>{view.rechecks.length}</b> waiting</p>
  </section>

  <section class="card conf">
    <h2><Icon name="bolt" size={17} />How sure the list is</h2>
    <div class="stack" aria-hidden="true">
      <i style="flex:{settled}; background: var(--rb-tier-C)"></i>
      <i style="flex:{view.ranked.length - settled - shaky}; background: var(--rb-tier-B)"></i>
      <i style="flex:{shaky}; background: var(--rb-tier-S)"></i>
    </div>
    <p class="body num"><b>{settled}</b> settled · <b>{view.ranked.length - settled - shaky}</b> fair · <b>{shaky}</b> shaky</p>
    <p class="body dim">Shaky titles haven't faced enough close matchups yet. Refining asks about them first.</p>
    {#if shaky}
      <button class="cta" onclick={() => { rb.setRefining(true); go('rank'); }}>Firm up the shaky ones</button>
    {/if}
  </section>

  <section class="card wide taste">
    <h2><Icon name="star" size={17} />Your taste</h2>
    {#if genres.length}
      <div class="bars">
        {#each genres as g (g.name)}
          <div class="bar">
            <span class="k">{g.name}</span>
            <span class="track"><i style="width:{g.avg * 10}%" class:hot={g.lift > 0.4} class:cold={g.lift < -0.4}></i></span>
            <span class="v num">{g.avg.toFixed(1)}</span>
            <span class="note">{g.count} titles · best: {g.best}</span>
          </div>
        {/each}
      </div>
    {:else}
      <p class="body dim">Rank a few more titles to see which genres you rate highest.</p>
    {/if}
    <div class="cols">
      <div>
        <h3>Studios you rate highest</h3>
        <ol class="mini">
          {#each studios as s (s.name)}<li><span>{s.name}</span><b class="num">{s.avg.toFixed(1)}</b><small>{s.count}</small></li>{/each}
          {#if !studios.length}<li class="dim">Needs 2+ titles from the same studio</li>{/if}
        </ol>
      </div>
      <div>
        <h3>By era</h3>
        <div class="eras">
          {#each eras as e (e.name)}
            <div class="era"><span class="col" style="height:{Math.max(8, e.avg * 9)}px"></span><b class="num">{e.avg.toFixed(1)}</b><small>{e.name}</small></div>
          {/each}
        </div>
      </div>
    </div>
  </section>

  <section class="card wide friends">
    <h2><Icon name="users" size={17} />Taste match</h2>
    <label class="tog">
      <input type="checkbox" checked={rb.settings.shareWithFriends} onchange={(e) => rb.setShare((e.currentTarget as HTMLInputElement).checked)} />
      <span>Share my ranking with others on this server</span>
    </label>
    {#if !rb.settings.shareWithFriends}
      <p class="body dim">Turn sharing on to compare with Karl, meth and anyone else who shares theirs. Only your order and tiers are shared.</p>
    {:else if !matches.length}
      <p class="body dim">Nobody else is sharing yet, or you don't have 3 titles in common.</p>
    {:else}
      <div class="matches">
        {#each matches as m (m!.friend.userId)}
          <article class="match">
            <div class="mh"><span class="pct num">{m!.match}%</span><span><b>{m!.friend.name}</b><small>{m!.common} titles in common</small></span></div>
            {#if m!.agree.length}
              <p class="lbl">You agree on</p>
              <ul>{#each m!.agree as r}<li><Poster name={name(r.id)} src={rb.backend.poster(r.id, 80)} size="xs" />{name(r.id)}<span class="num">#{r.mine} · #{r.theirs}</span></li>{/each}</ul>
            {/if}
            <p class="lbl">Biggest splits</p>
            <ul>{#each m!.split as r}<li><Poster name={name(r.id)} src={rb.backend.poster(r.id, 80)} size="xs" />{name(r.id)}<span class="num">you #{r.mine} · {m!.friend.name} #{r.theirs}</span></li>{/each}</ul>
          </article>
        {/each}
      </div>
    {/if}
  </section>
</div>

<style>
  .head { margin-bottom: 16px; }
  h1 { font: 800 clamp(30px, 4.6vw, 42px)/1 var(--rb-font-display); text-transform: uppercase; letter-spacing: .01em; }
  .head p { margin: 6px 0 0; color: var(--rb-muted); font-size: 14px; }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .card { background: var(--rb-surface); border-radius: var(--rb-radius); padding: 18px; display: grid; gap: 10px; align-content: start; min-width: 0; }
  .wide { grid-column: 1 / -1; }
  h2 { display: flex; align-items: center; gap: 8px; font: 800 18px/1 var(--rb-font-display); text-transform: uppercase; letter-spacing: .04em; color: var(--rb-muted); }
  h3 { font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: var(--rb-faint); margin-bottom: 8px; }
  .big { margin: 0; font: 800 26px/1.05 var(--rb-font-display); text-transform: uppercase; text-align: center; }
  .body { margin: 0; color: var(--rb-muted); font-size: 14px; }
  .body b { color: var(--rb-text); }
  .dim { color: var(--rb-faint); }
  .foot { margin: 4px 0 0; font-size: 13px; color: var(--rb-faint); }
  .foot b { color: var(--rb-text); }
  .dial { display: grid; justify-items: center; }
  .dial svg { width: min(240px, 100%); }
  .stack { display: flex; height: 12px; border-radius: 99px; overflow: hidden; gap: 2px; }
  .stack i { min-width: 0; }
  .cta { justify-self: start; margin-top: 4px; padding: 10px 16px; border-radius: 11px; background: var(--rb-gold); color: #1a1405; font-weight: 700; }

  .bars { display: grid; gap: 9px; }
  .bar { display: grid; grid-template-columns: 110px minmax(0, 1fr) 40px; grid-template-rows: auto auto; column-gap: 10px; align-items: center; }
  .bar .k { font-weight: 600; font-size: 14px; }
  .bar .track { height: 10px; border-radius: 99px; background: var(--rb-surface-3); overflow: hidden; }
  .bar .track i { display: block; height: 100%; background: var(--rb-tier-B); border-radius: 99px; }
  .bar .track i.hot { background: var(--rb-tier-S); }
  .bar .track i.cold { background: var(--rb-tier-D); }
  .bar .v { font: 800 18px/1 var(--rb-font-display); text-align: right; }
  .bar .note { grid-column: 2 / -1; font-size: 12px; color: var(--rb-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 18px; margin-top: 8px; }
  .mini { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  .mini li { display: grid; grid-template-columns: minmax(0, 1fr) auto 26px; gap: 8px; align-items: baseline; font-size: 14px; }
  .mini li span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mini b { font: 800 17px/1 var(--rb-font-display); }
  .mini small { color: var(--rb-faint); text-align: right; }
  .eras { display: flex; align-items: end; gap: 10px; height: 130px; }
  .era { display: grid; justify-items: center; gap: 4px; flex: 1; }
  .era .col { width: 100%; max-width: 34px; border-radius: 6px 6px 2px 2px; background: linear-gradient(var(--rb-gold), color-mix(in srgb, var(--rb-gold) 30%, transparent)); }
  .era b { font: 800 15px/1 var(--rb-font-display); }
  .era small { font-size: 11px; color: var(--rb-faint); }

  .tog { display: flex; gap: 10px; align-items: center; cursor: pointer; font-size: 14px; }
  .tog input { width: 18px; height: 18px; accent-color: var(--rb-gold); }
  .matches { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
  .match { background: var(--rb-surface-2); border-radius: 12px; padding: 14px; display: grid; gap: 6px; min-width: 0; }
  .mh { display: flex; align-items: center; gap: 12px; }
  .pct { font: 900 44px/0.9 var(--rb-font-display); color: var(--rb-gold); }
  .mh span:last-child { display: grid; }
  .mh small { color: var(--rb-faint); font-size: 12px; }
  .lbl { margin: 6px 0 0; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--rb-faint); }
  .match ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  .match li { display: grid; grid-template-columns: 30px minmax(0, 1fr) auto; gap: 8px; align-items: center; font-size: 13.5px; }
  .match li > :nth-child(2) { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .match li span { font-size: 12px; color: var(--rb-muted); white-space: nowrap; }

  @media (max-width: 760px) {
    .grid { grid-template-columns: minmax(0, 1fr); }
    .cols { grid-template-columns: minmax(0, 1fr); }
    .bar { grid-template-columns: 92px minmax(0, 1fr) 36px; }
  }
</style>
