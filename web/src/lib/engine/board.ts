import { fit, pairKey, sigmoid, toScore, type FitResult } from './fit';
import { naturalTiers } from './tiers';
import type { Answer, Item, ListState, Question, Ranked, RecheckDue, Result, Snapshot, Tier } from './types';
import { TIERS } from './types';

const DAY = 864e5;
export const FRESH_DAYS = 21;
export const RECHECK_AFTER_DAYS = 21;

export interface BoardView {
  ranked: Ranked[];
  byId: Map<string, Ranked>;
  queue: string[];
  excluded: string[];
  rechecks: RecheckDue[];
  fit: FitResult;
}

interface UndoEntry {
  added: number;
  removed: { index: number; answer: Answer }[];
  checked: string[];
  excluded: string[];
  overrides: Record<string, Tier>;
  placing: string | null;
}

export interface BoardOptions {
  now?: () => number;
  rng?: () => number;
}

let idCounter = 0;
const newId = () => Date.now().toString(36) + (idCounter++).toString(36) + Math.random().toString(36).slice(2, 6);

/**
 * One ranking list (shows, movies or both) for one person.
 * Holds the persisted state plus session-only bits (current placement, recent pairs, undo).
 */
export class Board {
  readonly items: Map<string, Item>;
  state: ListState;
  view!: BoardView;
  placing: string | null = null;
  refining = false;
  private recentPairs: string[] = [];
  private sinceConflict = 99;
  private history: UndoEntry[] = [];
  private now: () => number;
  private rng: () => number;

  constructor(items: Item[], state: ListState, opts: BoardOptions = {}) {
    this.items = new Map(items.map((i) => [i.id, i]));
    this.state = state;
    this.now = opts.now ?? Date.now;
    this.rng = opts.rng ?? Math.random;
    this.recompute();
  }

  /* ---------------- derived view ---------------- */

  recompute(): BoardView {
    const s = this.state;
    const excluded = new Set(s.excluded.filter((id) => this.items.has(id)));
    const live = (id: string) => this.items.has(id) && !excluded.has(id);
    const answers = s.answers.filter((a) => live(a.a) && live(a.b) && a.a !== a.b);
    const rankedIds = [...new Set(answers.flatMap((a) => [a.a, a.b]))];
    const f = fit(rankedIds, answers, this.now());

    const byTheta = [...rankedIds].sort((x, y) => f.theta.get(y)! - f.theta.get(x)!);
    const natural = naturalTiers(byTheta.map((id) => f.theta.get(id)!));
    const tierOf = new Map(byTheta.map((id, i) => [id, natural[i]]));
    const tierIdx = (id: string) => TIERS.indexOf(s.tierOverrides[id] ?? tierOf.get(id)!);
    const order = [...byTheta].sort((x, y) => tierIdx(x) - tierIdx(y) || f.theta.get(y)! - f.theta.get(x)!);

    const ranked: Ranked[] = order.map((id, i) => ({
      id,
      rank: i + 1,
      theta: f.theta.get(id)!,
      se: f.se.get(id)!,
      score: toScore(f.theta.get(id)!),
      tier: s.tierOverrides[id] ?? tierOf.get(id)!,
      tierOverridden: !!s.tierOverrides[id],
      comparisons: f.n.get(id) ?? 0,
      wins: f.wins.get(id) ?? 0,
      losses: f.losses.get(id) ?? 0,
      ties: f.ties.get(id) ?? 0,
    }));
    const byId = new Map(ranked.map((r) => [r.id, r]));

    const inRanked = new Set(rankedIds);
    const queue = [...this.items.values()]
      .filter((it) => !inRanked.has(it.id) && !excluded.has(it.id) && (!s.watchedOnly || it.status !== 'unwatched'))
      .map((it) => it.id);

    this.view = { ranked, byId, queue, excluded: [...excluded], rechecks: this.dueRechecks(answers, byId), fit: f };
    return this.view;
  }

  private dueRechecks(answers: Answer[], byId: Map<string, Ranked>): RecheckDue[] {
    const latest = new Map<string, Answer>();
    for (const a of answers) {
      const k = pairKey(a.a, a.b);
      const cur = latest.get(k);
      if (!cur || cur.at <= a.at) latest.set(k, a);
    }
    const cutoff = this.now() - RECHECK_AFTER_DAYS * DAY;
    const perItem = new Map<string, RecheckDue[]>();
    for (const a of latest.values()) {
      if (a.checkedAt || a.r === 0.5 || a.kind === 'manual' || !(a.freshA || a.freshB) || Date.parse(a.at) > cutoff) continue;
      const winner = a.r === 1 ? a.a : a.b, loser = a.r === 1 ? a.b : a.a;
      const winnerFresh = winner === a.a ? a.freshA : a.freshB;
      if (!winnerFresh) continue; // recency bias inflates fresh titles, so only re-ask the wins they got
      const w = byId.get(winner), l = byId.get(loser);
      if (!w || !l || w.rank > l.rank) continue; // the list already moved on
      const due: RecheckDue = { answerId: a.id, winner, loser, at: a.at, fresh: a.freshA && a.freshB ? '' : winner };
      perItem.set(winner, [...(perItem.get(winner) ?? []), due]);
    }
    // two per title is enough: wins over the strongest titles are the ones that lifted it most
    const out: RecheckDue[] = [];
    for (const [id, list] of perItem) {
      const myRank = byId.get(id)!.rank;
      list.sort((x, y) => byId.get(x.loser)!.rank - byId.get(y.loser)!.rank)
        .filter((d) => byId.get(d.loser)!.rank > myRank)
        .slice(0, 2)
        .forEach((d) => out.push(d));
    }
    return out.sort((x, y) => x.at.localeCompare(y.at));
  }

  /* ---------------- helpers ---------------- */

  ageDays(id: string): number | null {
    const lw = this.items.get(id)?.lastWatched;
    return lw ? (this.now() - Date.parse(lw)) / DAY : null;
  }

  isFresh(id: string): boolean {
    const d = this.ageDays(id);
    return d !== null && d <= FRESH_DAYS;
  }

  private comparedWith(id: string): Set<string> {
    const out = new Set<string>();
    for (const a of this.state.answers) {
      if (a.a === id) out.add(a.b);
      else if (a.b === id) out.add(a.a);
    }
    return out;
  }

  /** Where a not-yet-settled item could still land, as 1-based ranks among the others. */
  landingRange(id: string): { low: number; high: number } {
    const others = this.view.ranked.filter((r) => r.id !== id);
    const me = this.view.byId.get(id);
    if (!me) return { low: 1, high: others.length + 1 };
    const rankAt = (t: number) => 1 + others.filter((r) => r.theta > t).length;
    return { low: rankAt(me.theta + 1.2 * me.se), high: rankAt(me.theta - 1.2 * me.se) };
  }

  /* ---------------- choosing the next question ---------------- */

  next(): Question | null {
    const v = this.view;

    if (this.placing) {
      const q = this.placementQuestion(this.placing);
      if (q) return q;
      this.placing = null;
    }

    const rc = v.rechecks[0];
    if (rc) return { kind: 'recheck', a: rc.winner, b: rc.loser, check: rc };

    if (this.sinceConflict >= 6) {
      const c = this.findConflict();
      if (c) return c;
    }

    if (v.queue.length) {
      if (v.ranked.length === 0) {
        if (v.queue.length < 2) return null;
        const [a, b] = this.pickFromQueue(2);
        return { kind: 'seed', a, b };
      }
      this.placing = this.pickFromQueue(1)[0];
      const q = this.placementQuestion(this.placing);
      if (q) return q;
      this.placing = null;
    }

    if (this.refining) return this.refinePair();
    return null;
  }

  /** Prefer things NOT watched in the last 3 weeks, so the list isn't built newest-first. */
  private pickFromQueue(count: number): string[] {
    const q = [...this.view.queue];
    const older = q.filter((id) => !this.isFresh(id));
    const pool = (older.length >= count ? older : q).slice();
    const out: string[] = [];
    while (out.length < count && pool.length) {
      const i = Math.floor(this.rng() * Math.min(pool.length, 8));
      out.push(pool.splice(i, 1)[0]);
    }
    return out;
  }

  private placementQuestion(id: string): Question | null {
    const v = this.view;
    const me = v.byId.get(id);
    const done = this.comparedWith(id);
    const others = v.ranked.filter((r) => r.id !== id && !done.has(r.id));
    const n = v.ranked.length;
    const cmp = me?.comparisons ?? 0;
    const maxQs = Math.ceil(Math.log2(n + 1)) + 1;
    if (!others.length || cmp >= maxQs || (me && cmp >= 2 && me.se < 0.62)) return null;

    // binary-search-ish: face the most similar strength, preferring settled opponents
    const t = me?.theta ?? 0;
    let best = others[0], bestCost = Infinity;
    for (const r of others) {
      const cost = Math.abs(r.theta - t) + 0.15 * r.se;
      if (cost < bestCost) { bestCost = cost; best = r; }
    }
    const { low, high } = me ? this.landingRange(id) : { low: 1, high: n + 1 };
    const left = Math.max(1, Math.min(maxQs - cmp, Math.ceil(Math.log2(high - low + 1)) || 1));
    return { kind: 'place', a: id, b: best.id, low, high, left };
  }

  private findConflict(): Question | null {
    const v = this.view;
    const latest = new Map<string, Answer>();
    for (const a of this.state.answers) {
      const k = pairKey(a.a, a.b);
      const cur = latest.get(k);
      if (!cur || cur.at <= a.at) latest.set(k, a);
    }
    const twoWeeks = this.now() - 14 * DAY;
    let worst: Answer | null = null, worstP = 0.2;
    for (const a of latest.values()) {
      if (a.r === 0.5 || (a.kind === 'conflict' && Date.parse(a.at) > twoWeeks)) continue;
      const x = v.byId.get(a.a), y = v.byId.get(a.b);
      if (!x || !y || x.comparisons < 3 || y.comparisons < 3) continue;
      if (this.recentPairs.includes(pairKey(a.a, a.b))) continue;
      const pObserved = a.r === 1 ? sigmoid(x.theta - y.theta) : sigmoid(y.theta - x.theta);
      if (pObserved < worstP) { worstP = pObserved; worst = a; }
    }
    return worst ? { kind: 'conflict', a: worst.a, b: worst.b, old: worst } : null;
  }

  private refinePair(): Question | null {
    const r = this.view.ranked;
    let best: Question | null = null, bestVal = 0.08;
    for (let i = 0; i < r.length; i++) {
      for (let d = 1; d <= 3 && i + d < r.length; d++) {
        const hi = r[i], lo = r[i + d];
        const p = sigmoid(lo.theta - hi.theta);
        const gap = this.ageDays(lo.id) !== null && this.ageDays(hi.id) !== null
          ? Math.abs(this.ageDays(lo.id)! - this.ageDays(hi.id)!) : null;
        let val = p * (1 - p) * (lo.se + hi.se) - d * 0.01;
        if (gap !== null && gap > 60) val += 0.06; // watched far apart: exactly where recency skews things
        if (Math.min(lo.comparisons, hi.comparisons) < 3) val += 0.04;
        if (this.recentPairs.includes(pairKey(lo.id, hi.id))) val -= 1;
        if (val > bestVal) {
          bestVal = val;
          best = { kind: 'refine', a: lo.id, b: hi.id, gapDays: gap === null ? null : Math.round(gap) };
        }
      }
    }
    return best;
  }

  /* ---------------- changing things ---------------- */

  private push(extra: Partial<UndoEntry> = {}) {
    this.history.push({
      added: 0, removed: [], checked: [],
      excluded: [...this.state.excluded],
      overrides: { ...this.state.tierOverrides },
      placing: this.placing,
      ...extra,
    });
    if (this.history.length > 80) this.history.shift();
    return this.history[this.history.length - 1];
  }

  private addAnswer(a: string, b: string, r: Result, kind: Answer['kind'], checked = false): Answer {
    const at = new Date(this.now()).toISOString();
    const ans: Answer = { id: newId(), a, b, r, at, kind, freshA: this.isFresh(a), freshB: this.isFresh(b) };
    if (checked) ans.checkedAt = at;
    this.state.answers.push(ans);
    return ans;
  }

  answer(q: Question, r: Result) {
    const entry = this.push();
    const nowIso = new Date(this.now()).toISOString();
    if (q.kind === 'recheck') {
      for (const a of this.state.answers) {
        if (pairKey(a.a, a.b) === pairKey(q.a, q.b) && !a.checkedAt) { a.checkedAt = nowIso; entry.checked.push(a.id); }
      }
      const orig = this.state.answers.find((a) => a.id === q.check.answerId);
      if (orig) orig.outcome = r === 1 ? 'kept' : r === 0 ? 'flipped' : null;
      this.addAnswer(q.a, q.b, r, 'recheck', true);
    } else {
      this.addAnswer(q.a, q.b, r, q.kind === 'seed' ? 'place' : q.kind, q.kind === 'conflict');
    }
    entry.added = 1;
    if (q.kind === 'conflict') this.sinceConflict = 0; else this.sinceConflict++;
    this.recentPairs.push(pairKey(q.a, q.b));
    if (this.recentPairs.length > 30) this.recentPairs.shift();
    if (q.kind === 'seed') this.placing = null;
    this.recompute();
  }

  skip(q: Question) {
    this.recentPairs.push(pairKey(q.a, q.b));
    if (q.kind === 'place' && this.placing === q.a) {
      // try a different item next time; this one goes to the back of the line
      this.placing = null;
    }
    if (q.kind === 'recheck') {
      // "not sure": retire it without changing anything
      this.answerRecheckUnsure(q);
    }
  }

  private answerRecheckUnsure(q: Extract<Question, { kind: 'recheck' }>) {
    const entry = this.push();
    const nowIso = new Date(this.now()).toISOString();
    for (const a of this.state.answers) {
      if (pairKey(a.a, a.b) === pairKey(q.a, q.b) && !a.checkedAt) { a.checkedAt = nowIso; entry.checked.push(a.id); }
    }
    this.recompute();
  }

  /** Drag in the list: moving past items is the same as saying you prefer it (or don't). */
  move(id: string, toIndex: number) {
    const order = this.view.ranked.map((r) => r.id);
    const from = order.indexOf(id);
    toIndex = Math.max(0, Math.min(order.length - 1, toIndex));
    if (from < 0 || from === toIndex) return;
    const entry = this.push();
    const before = this.state.answers.length;
    if (toIndex < from) {
      for (const p of order.slice(toIndex, from)) this.addAnswer(id, p, 1, 'manual', true);
      if (toIndex > 0) this.addAnswer(id, order[toIndex - 1], 0, 'manual', true);
    } else {
      for (const p of order.slice(from + 1, toIndex + 1)) this.addAnswer(id, p, 0, 'manual', true);
      if (toIndex + 1 < order.length) this.addAnswer(id, order[toIndex + 1], 1, 'manual', true);
    }
    // where you dropped it decides its tier now, not an old pin
    delete this.state.tierOverrides[id];
    entry.added = this.state.answers.length - before;
    this.recompute();
  }

  setTier(id: string, tier: Tier | null) {
    this.push();
    if (tier) this.state.tierOverrides[id] = tier;
    else delete this.state.tierOverrides[id];
    this.recompute();
  }

  exclude(id: string) {
    this.push();
    if (!this.state.excluded.includes(id)) this.state.excluded.push(id);
    if (this.placing === id) this.placing = null;
    this.recompute();
  }

  include(id: string) {
    this.push();
    this.state.excluded = this.state.excluded.filter((x) => x !== id);
    this.recompute();
  }

  /** Forget everything said about one title and place it again from scratch. */
  rerank(id: string) {
    const entry = this.push();
    const keep: Answer[] = [];
    this.state.answers.forEach((a, index) => {
      if (a.a === id || a.b === id) entry.removed.push({ index, answer: a });
      else keep.push(a);
    });
    this.state.answers = keep;
    delete this.state.tierOverrides[id];
    this.placing = id;
    this.recompute();
  }

  /** Put an unranked title at the front and start placing it now. */
  rankNow(id: string) {
    if (!this.items.has(id)) return;
    if (this.state.excluded.includes(id)) this.include(id);
    if (this.view.byId.has(id)) this.rerank(id);
    else this.placing = id;
  }

  setWatchedOnly(on: boolean) {
    this.state.watchedOnly = on;
    this.recompute();
  }

  canUndo() { return this.history.length > 0; }

  undo() {
    const e = this.history.pop();
    if (!e) return;
    if (e.added) this.state.answers.splice(this.state.answers.length - e.added, e.added);
    for (const r of [...e.removed].sort((x, y) => x.index - y.index)) this.state.answers.splice(r.index, 0, r.answer);
    if (e.checked.length) {
      const ids = new Set(e.checked);
      for (const a of this.state.answers) if (ids.has(a.id)) { a.checkedAt = null; a.outcome = null; }
    }
    this.state.excluded = e.excluded;
    this.state.tierOverrides = e.overrides;
    this.placing = e.placing;
    this.recompute();
  }

  reset() {
    this.push({ removed: this.state.answers.map((answer, index) => ({ index, answer })) });
    this.state.answers = [];
    this.state.tierOverrides = {};
    this.placing = null;
    this.refining = false;
    this.recompute();
  }

  snapshot(): Snapshot {
    return {
      at: new Date(this.now()).toISOString(),
      items: this.view.ranked.map((r) => ({ id: r.id, rank: r.rank, score: r.score, tier: r.tier })),
    };
  }

  /** What gets saved to the server. */
  persisted(): ListState {
    return { ...this.state, snapshot: this.snapshot() };
  }
}
