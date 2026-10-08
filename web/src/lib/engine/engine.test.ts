import { describe, expect, it } from 'vitest';
import { Board } from './board';
import { naturalTiers } from './tiers';
import { emptyState, type Item, type Question, type Result } from './types';

const DAY = 864e5;
const NOW = Date.parse('2026-10-07T12:00:00Z');

function seeded(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
}

function library(n: number, freshEvery = 0): Item[] {
  return Array.from({ length: n }, (_, i) => ({
    id: 'i' + String(i).padStart(3, '0'),
    name: 'Show ' + i,
    year: 2000 + i,
    type: 'Series' as const,
    status: 'finished' as const,
    playedEpisodes: 12,
    totalEpisodes: 12,
    lastWatched: new Date(NOW - (freshEvery && i % freshEvery === 0 ? 3 : 200 + i) * DAY).toISOString(),
    genres: [],
    studios: [],
  }));
}

/** Kendall tau between the board order and the true order. 1 = identical. */
function tau(order: string[], truth: string[]) {
  const pos = new Map(truth.map((id, i) => [id, i]));
  let c = 0, d = 0;
  for (let i = 0; i < order.length; i++)
    for (let j = i + 1; j < order.length; j++)
      (pos.get(order[i])! < pos.get(order[j])! ? c++ : d++);
  return (c - d) / (c + d);
}

function play(board: Board, truth: string[], opts: { noise?: number; rng?: () => number; max?: number } = {}) {
  const better = (a: string, b: string) => truth.indexOf(a) < truth.indexOf(b);
  const rng = opts.rng ?? Math.random;
  let asked = 0;
  const kinds: Record<string, number> = {};
  let q: Question | null;
  while ((q = board.next()) && asked < (opts.max ?? 5000)) {
    let r: Result = better(q.a, q.b) ? 1 : 0;
    if (opts.noise && rng() < opts.noise) r = r === 1 ? 0 : 1;
    board.answer(q, r);
    kinds[q.kind] = (kinds[q.kind] ?? 0) + 1;
    asked++;
  }
  return { asked, kinds };
}

describe('placement', () => {
  it('rebuilds a known order from consistent answers, in about n·log n questions', () => {
    const items = library(40);
    const rng = seeded(7);
    const truth = items.map((i) => i.id).sort(() => rng() - 0.5);
    const board = new Board(items, emptyState(), { now: () => NOW, rng: seeded(11) });
    const { asked } = play(board, truth);
    board.refining = true;
    play(board, truth, { max: 150 });
    const order = board.view.ranked.map((r) => r.id);
    expect(order).toHaveLength(40);
    expect(tau(order, truth)).toBeGreaterThan(0.9);
    expect(asked).toBeLessThan(40 * Math.log2(40) * 1.3);
  });

  it('copes with 10% wrong answers and goes back to check contradictions', () => {
    const items = library(30);
    const rng = seeded(3);
    const truth = items.map((i) => i.id).sort(() => rng() - 0.5);
    const board = new Board(items, emptyState(), { now: () => NOW, rng: seeded(5) });
    play(board, truth, { noise: 0.1, rng: seeded(9) });
    board.refining = true;
    const { kinds } = play(board, truth, { noise: 0.1, rng: seeded(10), max: 200 });
    expect(tau(board.view.ranked.map((r) => r.id), truth)).toBeGreaterThan(0.75);
    expect((kinds.conflict ?? 0) + (kinds.refine ?? 0)).toBeGreaterThan(0);
  });
});

describe('scores and tiers', () => {
  it('ties land close together', () => {
    const items = library(3);
    const b = new Board(items, emptyState(), { now: () => NOW });
    b.answer({ kind: 'seed', a: 'i000', b: 'i001' }, 0.5);
    b.answer({ kind: 'refine', a: 'i000', b: 'i002', gapDays: null }, 1);
    b.answer({ kind: 'refine', a: 'i001', b: 'i002', gapDays: null }, 1);
    const s = (id: string) => b.view.byId.get(id)!.score;
    expect(Math.abs(s('i000') - s('i001'))).toBeLessThan(0.3);
    expect(s('i000')).toBeGreaterThan(s('i002'));
  });

  it('natural breaks split at the gaps', () => {
    const v = [9, 8.9, 8.8, 6, 5.9, 5.8, 3, 2.9, 2.8, 1, 0.9, 0.8, -2, -2.1, -2.2];
    expect(naturalTiers(v).join('')).toBe('SSSAAABBBCCCDDD');
  });

  it('a tier pin moves an item into that tier', () => {
    const items = library(10);
    const truth = items.map((i) => i.id);
    const b = new Board(items, emptyState(), { now: () => NOW, rng: seeded(1) });
    play(b, truth);
    const last = b.view.ranked[b.view.ranked.length - 1].id;
    b.setTier(last, 'S');
    expect(b.view.byId.get(last)!.tier).toBe('S');
    expect(b.view.ranked[0].tier).toBe('S');
  });
});

describe('editing', () => {
  const setup = () => {
    const items = library(12);
    const truth = items.map((i) => i.id);
    const b = new Board(items, emptyState(), { now: () => NOW, rng: seeded(2) });
    play(b, truth);
    return b;
  };

  it('drag moves an item to where you dropped it', () => {
    const b = setup();
    const id = b.view.ranked[9].id;
    b.move(id, 2);
    expect(b.view.byId.get(id)!.rank).toBe(3);
    const id2 = b.view.ranked[0].id;
    b.move(id2, 7);
    expect(Math.abs(b.view.byId.get(id2)!.rank - 8)).toBeLessThanOrEqual(1);
  });

  it('undo reverses answers, moves, re-ranks and exclusions exactly', () => {
    const b = setup();
    const start = JSON.stringify(b.view.ranked.map((r) => r.id));
    const n = b.state.answers.length;
    b.move(b.view.ranked[5].id, 0);
    b.rerank(b.view.ranked[3].id);
    b.exclude(b.view.ranked[1].id);
    b.undo(); b.undo(); b.undo();
    expect(b.state.answers.length).toBe(n);
    expect(JSON.stringify(b.view.ranked.map((r) => r.id))).toBe(start);
  });

  it("haven't seen it removes an item and keeps it out of the queue", () => {
    const b = setup();
    const id = b.view.ranked[4].id;
    b.exclude(id);
    expect(b.view.byId.has(id)).toBe(false);
    expect(b.view.queue).not.toContain(id);
    b.include(id);
    expect(b.view.byId.has(id)).toBe(true);
  });
});

describe('recency checks', () => {
  it('re-asks answers made right after a watch, three weeks later, and a flip swaps them', () => {
    let now = NOW;
    const items = library(6, 2); // every 2nd show watched 3 days ago
    const truth = items.map((i) => i.id);
    const b = new Board(items, emptyState(), { now: () => now, rng: seeded(4) });
    play(b, truth);
    expect(b.view.rechecks).toHaveLength(0);
    now += 25 * DAY;
    b.recompute();
    expect(b.view.rechecks.length).toBeGreaterThan(0);
    const q = b.next()!;
    expect(q.kind).toBe('recheck');
    const before = b.view.byId.get(q.a)!.rank < b.view.byId.get(q.b)!.rank;
    expect(before).toBe(true);
    for (let i = 0; i < 4; i++) b.answer({ ...q }, 0); // insist: the other one is better
    expect(b.view.byId.get(q.b)!.rank).toBeLessThan(b.view.byId.get(q.a)!.rank);
    expect(b.view.rechecks.find((r) => r.answerId === (q as any).check.answerId)).toBeUndefined();
  });

  it('starts with older watches before last week’s binge', () => {
    const items = library(20, 3);
    const b = new Board(items, emptyState(), { now: () => NOW, rng: seeded(8) });
    const first = b.next()!;
    expect(b.isFresh(first.a)).toBe(false);
    expect(b.isFresh(first.b)).toBe(false);
  });
});
