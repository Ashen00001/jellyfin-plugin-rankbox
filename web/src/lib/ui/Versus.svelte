<script lang="ts">
  import type { Item, Question, Result } from '../engine/types';
  import { agoText, hueOf, shortDate } from './format';
  import Icon from './Icon.svelte';
  import Ladder from './Ladder.svelte';
  import Poster from './Poster.svelte';

  let {
    q, a, b, rankOf, poster, slots, canUndo = false, compact = false,
    onanswer, onskip, onundo, onunseen,
  }: {
    q: Question;
    a: Item;
    b: Item;
    rankOf: (id: string) => number | undefined;
    poster: (id: string) => string;
    slots: number;
    canUndo?: boolean;
    compact?: boolean;
    onanswer: (r: Result) => void;
    onskip: () => void;
    onundo?: () => void;
    onunseen: (id: string) => void;
  } = $props();

  const rA = $derived(rankOf(q.a));
  const rB = $derived(rankOf(q.b));

  const eyebrow = $derived.by(() => {
    switch (q.kind) {
      case 'seed': return 'First matchup';
      case 'place': return q.left > 1 ? `Placing · about ${q.left} more` : 'Placing · last one for this';
      case 'refine': return q.gapDays && q.gapDays > 60 ? `Double-check · watched ${Math.round(q.gapDays / 30)} months apart` : 'Double-check';
      case 'recheck': return 'Recency check';
      case 'conflict': return 'Mixed signals';
    }
  });

  const labels = $derived(
    q.kind === 'recheck'
      ? { hi: 'Yes, still', same: 'About the same', lo: 'No, flip it' }
      : { hi: 'Higher', same: 'About the same', lo: 'Lower' },
  );

  let picked = $state<Result | null>(null);
  function choose(r: Result) {
    picked = r;
    setTimeout(() => { picked = null; onanswer(r); }, 140);
  }
</script>

<section class="vs" class:compact style="--ha:{hueOf(a.name)};--hb:{hueOf(b.name)}" aria-live="polite">
  <div class="glow" aria-hidden="true"></div>

  <header class="head">
    <p class="eyebrow">{#if q.kind === 'recheck'}<Icon name="clock" size={14} />{/if}{eyebrow}</p>
    {#if q.kind === 'recheck'}
      <h2 class="ask">On {shortDate(q.check.at)} you rated <b>{a.name}</b> over <b>{b.name}</b>. Still agree?</h2>
      {#if q.check.fresh}
        <p class="why">You'd just watched {q.check.fresh === q.a ? a.name : b.name} back then.</p>
      {/if}
    {:else if q.kind === 'conflict'}
      <h2 class="ask">Rate <b>{a.name}</b> higher or lower than <b>{b.name}</b>?</h2>
      <p class="why">On {shortDate(q.old.at)} you said {q.old.r === 1 ? a.name : b.name}, but your other answers point the other way.</p>
    {:else}
      <h2 class="ask">Rate <b>{a.name}</b> higher or lower than <b>{b.name}</b>?</h2>
    {/if}
  </header>

  <div class="pair">
    <figure class="side" class:win={picked === 1} class:lose={picked === 0}>
      {#if q.kind === 'place' || q.kind === 'seed' || !rA}
        <div class="badge rating">{q.kind === 'seed' ? 'New' : 'Rating'}</div>
      {:else}
        <div class="badge rank left num">#{rA}</div>
      {/if}
      <Poster name={a.name} year={a.year} src={poster(a.id)} size={compact ? 'lg' : 'xl'} />
      <figcaption>
        <span class="t">{a.name}</span>
        <span class="m">{a.year ?? ''}{a.year ? ' · ' : ''}{agoText(a.lastWatched)}</span>
        <button class="unseen" onclick={() => onunseen(a.id)}>Haven't seen it</button>
      </figcaption>
    </figure>

    <div class="medal" aria-hidden="true">VS</div>

    <figure class="side" class:win={picked === 0} class:lose={picked === 1}>
      {#if rB}<div class="badge rank num">#{rB}</div>{/if}
      <Poster name={b.name} year={b.year} src={poster(b.id)} size={compact ? 'lg' : 'xl'} />
      <figcaption>
        <span class="t">{b.name}</span>
        <span class="m">{b.year ?? ''}{b.year ? ' · ' : ''}{agoText(b.lastWatched)}</span>
        <button class="unseen" onclick={() => onunseen(b.id)}>Haven't seen it</button>
      </figcaption>
    </figure>
  </div>

  {#if q.kind === 'place'}
    <div class="ladder"><Ladder {slots} low={q.low} high={q.high} /></div>
  {/if}

  <div class="answers">
    <button class="ans hi" onclick={() => choose(1)}><Icon name="up" size={18} />{labels.hi}</button>
    <button class="ans same" onclick={() => choose(0.5)}><Icon name="same" size={18} />{labels.same}</button>
    <button class="ans lo" onclick={() => choose(0)}><Icon name="down" size={18} />{labels.lo}</button>
  </div>

  <div class="tools">
    <button onclick={onskip}><Icon name="skip" size={15} />{q.kind === 'recheck' ? 'Not sure' : 'Skip'}</button>
    {#if onundo}<button onclick={onundo} disabled={!canUndo}><Icon name="undo" size={15} />Undo</button>{/if}
    {#if !compact}<span class="keys">↑ higher · ↓ lower · = same · space skip</span>{/if}
  </div>
</section>

<style>
  .vs { position: relative; isolation: isolate; display: grid; gap: 18px; }
  .glow {
    position: absolute; inset: -40px -20px auto; height: 420px; z-index: -1; pointer-events: none;
    background:
      radial-gradient(45% 55% at 22% 45%, hsl(var(--ha) 70% 50% / .22), transparent 70%),
      radial-gradient(45% 55% at 78% 45%, hsl(var(--hb) 70% 50% / .22), transparent 70%);
    filter: blur(8px);
  }
  .head { text-align: center; display: grid; gap: 6px; justify-items: center; }
  .eyebrow {
    margin: 0; display: inline-flex; align-items: center; gap: 6px;
    font: 700 12px/1 var(--rb-font-body); letter-spacing: .16em; text-transform: uppercase; color: var(--rb-gold);
  }
  .ask { font: 600 clamp(19px, 2.6vw, 26px)/1.25 var(--rb-font-body); max-width: 34ch; }
  .ask b { color: #fff; font-weight: 700; }
  .why { margin: 0; color: var(--rb-muted); font-size: 14px; max-width: 46ch; }

  .pair { position: relative; display: grid; grid-template-columns: 1fr 1fr; gap: clamp(12px, 3vw, 28px); max-width: 620px; width: 100%; margin: 0 auto; }
  .side { margin: 0; position: relative; display: grid; gap: 10px; min-width: 0; transition: transform .18s ease, opacity .18s ease; }
  .side :global(.poster) { box-shadow: var(--rb-shadow); }
  .side.win { transform: translateY(-6px) scale(1.02); }
  .side.lose { opacity: .45; transform: scale(.97); }
  .badge {
    position: absolute; z-index: 2; top: 10px; left: 10px;
    padding: 4px 9px; border-radius: 99px;
    font: 700 11px/1.2 var(--rb-font-body); letter-spacing: .12em; text-transform: uppercase;
    background: rgba(8, 10, 14, .72); backdrop-filter: blur(6px); color: var(--rb-text);
  }
  .badge.rating { background: var(--rb-accent); color: var(--rb-accent-ink); }
  .badge.rank.left { right: auto; left: 8px; }
  .badge.rank {
    left: auto; right: 8px; top: 6px; padding: 0 2px; background: none; backdrop-filter: none;
    font: 900 clamp(38px, 7vw, 58px)/1 var(--rb-font-display); letter-spacing: -.01em; color: var(--rb-gold);
    text-shadow: 0 3px 18px rgba(0, 0, 0, .8), 0 0 2px rgba(0, 0, 0, .9);
  }
  figcaption { display: grid; gap: 2px; min-width: 0; }
  .t { font-weight: 600; font-size: 15px; line-height: 1.25; overflow-wrap: anywhere; }
  .m { font-size: 12.5px; color: var(--rb-muted); }
  .unseen { justify-self: start; margin-top: 4px; font-size: 12.5px; color: var(--rb-faint); text-decoration: underline; text-underline-offset: 3px; }
  .unseen:hover { color: var(--rb-text); }
  .medal {
    position: absolute; left: 50%; top: calc(50% - 30px); transform: translate(-50%, -50%);
    width: 52px; height: 52px; border-radius: 50%;
    display: grid; place-items: center;
    background: var(--rb-bg); border: 2px solid var(--rb-line-strong);
    font: 900 18px/1 var(--rb-font-display); letter-spacing: .04em; color: var(--rb-gold);
    box-shadow: 0 0 0 6px color-mix(in srgb, var(--rb-bg) 60%, transparent);
  }
  .ladder { max-width: 620px; width: 100%; margin: 0 auto; }

  .answers { display: grid; grid-template-columns: 1fr auto 1fr; gap: 10px; max-width: 620px; width: 100%; margin: 0 auto; }
  .ans {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    min-height: 54px; padding: 0 16px; border-radius: 14px;
    font-weight: 700; font-size: 16px;
    transition: transform .08s ease, background .15s ease;
  }
  .ans:active { transform: scale(.97); }
  .ans.hi { background: var(--rb-up); color: var(--rb-up-ink); }
  .ans.hi:hover { background: color-mix(in srgb, var(--rb-up) 88%, #fff); }
  .ans.lo { background: var(--rb-surface-3); color: var(--rb-text); box-shadow: inset 0 0 0 1px var(--rb-line-strong); }
  .ans.lo:hover { background: var(--rb-line-strong); }
  .ans.same { background: transparent; color: var(--rb-muted); box-shadow: inset 0 0 0 1px var(--rb-line); font-weight: 600; font-size: 14px; }
  .ans.same:hover { color: var(--rb-text); }

  .tools { display: flex; justify-content: center; align-items: center; gap: 6px; flex-wrap: wrap; }
  .tools button {
    display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 99px;
    color: var(--rb-muted); font-size: 13.5px; font-weight: 500;
  }
  .tools button:hover:not(:disabled) { background: var(--rb-surface-2); color: var(--rb-text); }
  .tools button:disabled { opacity: .35; cursor: default; }
  .keys { font-size: 12px; color: var(--rb-faint); margin-left: 8px; }

  .compact { gap: 14px; }
  .compact .ask { font-size: 18px; }
  .compact .pair { max-width: 380px; }
  .compact .medal { width: 42px; height: 42px; font-size: 15px; }
  .compact .ans { min-height: 46px; font-size: 15px; }

  @media (max-width: 560px) {
    .vs { gap: 12px; }
    .ask { font-size: 17px; }
    .why { font-size: 13px; }
    .pair { max-width: 290px; gap: 14px; }
    .t { font-size: 13.5px; }
    .m { font-size: 11.5px; }
    .unseen { font-size: 11.5px; margin-top: 2px; }
    .badge.rank { font-size: 36px; }
    .answers { grid-template-columns: 1fr 1fr; }
    .ans.same { grid-column: 1 / -1; order: 3; min-height: 42px; }
    .keys { display: none; }
    .medal { width: 42px; height: 42px; font-size: 15px; }
  }
</style>
