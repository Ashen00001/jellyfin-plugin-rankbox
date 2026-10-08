import type { Friend } from './api';
import type { BoardView } from './engine/board';
import { sigmoid } from './engine/fit';
import type { Answer, Item } from './engine/types';

export interface RecencyBias {
  n: number; // matchups where exactly one side was fresh
  freshWon: number; // share the fresh side actually won
  expected: number; // share the rest of your answers predict
  delta: number; // freshWon - expected
  kept: number;
  flipped: number;
}

/** Do fresh watches win more often than the rest of your answers say they should? */
export function recencyBias(answers: Answer[], view: BoardView): RecencyBias {
  let n = 0, won = 0, exp = 0;
  for (const a of answers) {
    if (a.r === 0.5 || a.kind === 'manual' || !!a.freshA === !!a.freshB) continue;
    const fresh = a.freshA ? a.a : a.b, other = a.freshA ? a.b : a.a;
    const f = view.byId.get(fresh), o = view.byId.get(other);
    if (!f || !o) continue;
    n++;
    won += (a.r === 1) === (fresh === a.a) ? 1 : 0;
    exp += sigmoid(f.theta - o.theta);
  }
  return {
    n,
    freshWon: n ? won / n : 0,
    expected: n ? exp / n : 0,
    delta: n ? (won - exp) / n : 0,
    kept: answers.filter((a) => a.outcome === 'kept').length,
    flipped: answers.filter((a) => a.outcome === 'flipped').length,
  };
}

export interface Facet { name: string; count: number; avg: number; lift: number; best: string }

/** Which genres / studios / eras score highest for you, compared to your overall average. */
export function facets(view: BoardView, items: Map<string, Item>, pick: (it: Item) => string[], minCount = 2): Facet[] {
  const ranked = view.ranked;
  if (!ranked.length) return [];
  const overall = ranked.reduce((s, r) => s + r.score, 0) / ranked.length;
  const acc = new Map<string, { sum: number; n: number; best: string; bestScore: number }>();
  for (const r of ranked) {
    const it = items.get(r.id);
    if (!it) continue;
    for (const k of pick(it)) {
      const e = acc.get(k) ?? { sum: 0, n: 0, best: it.name, bestScore: -1 };
      e.sum += r.score; e.n++;
      if (r.score > e.bestScore) { e.bestScore = r.score; e.best = it.name; }
      acc.set(k, e);
    }
  }
  return [...acc.entries()]
    .filter(([, e]) => e.n >= minCount)
    .map(([name, e]) => ({ name, count: e.n, avg: e.sum / e.n, lift: e.sum / e.n - overall, best: e.best }))
    .sort((x, y) => y.avg - x.avg);
}

export const decade = (it: Item) => (it.year ? [`${Math.floor(it.year / 10) * 10}s`] : []);

/** Tags on most of your list ("Animation", "Anime") say nothing about taste. */
export function meaningfulGenres(items: Iterable<Item>): (it: Item) => string[] {
  const list = [...items];
  const count = new Map<string, number>();
  for (const it of list) for (const g of new Set(it.genres)) count.set(g, (count.get(g) ?? 0) + 1);
  const common = new Set([...count].filter(([, n]) => list.length >= 6 && n / list.length > 0.6).map(([g]) => g));
  return (it) => it.genres.filter((g) => !common.has(g));
}

// Library metadata lists broadcasters and producers next to the studio that animated the show.
// Only these count for "studios you rate highest".
const ANIMATION_STUDIOS = new Set([
  'madhouse', 'mappa', 'wit studio', 'ufotable', 'kyoto animation', 'bones', 'a-1 pictures', 'cloverworks', 'trigger', 'studio trigger',
  'studio ghibli', 'comix wave films', 'production i.g', 'sunrise', 'bandai namco pictures', 'toei animation', 'pierrot', 'studio pierrot',
  'j.c.staff', 'doga kobo', 'science saru', 'shaft', 'lerche', 'david production', 'kinema citrus', 'silver link', 'p.a. works', 'p.a.works',
  'studio deen', 'tms entertainment', 'olm', 'telecom animation film', 'studio voln', 'studio arts', "brain's base", '8bit', 'white fox',
  'studio bind', 'tezuka productions', 'studio hibari', 'diomedéa', 'feel.', 'passione', 'studio gokumi', 'lay-duce', 'cygamespictures',
  'shin-ei animation', 'studio kai', 'satelight', 'polygon pictures', 'orange', 'studio 4°c', 'gainax', 'khara', 'tatsunoko production',
  'studio chizu', 'liden films', 'bibury animation studios', 'project no.9', 'arvo animation', 'gohands', 'seven arcs', 'studio signpost',
  'asahi production', 'studio elias', 'encourage films', 'geno studio', 'ajia-do', 'platinum vision', 'emt squared', 'studio flad', 'tear studio',
  'zero-g', 'cloud hearts', 'c2c', 'studio comet', 'troyca', 'studio colorido', 'studio ponoc', 'yostar pictures', 'studio lan', 'nexus',
  'okuruto noboru', 'studio blanc.', 'connect', 'gekkou', 'bones film', 'e&h production', 'studio mother', 'studio massket', 'quad', 'actas',
  'xebec', 'manglobe', 'ordet', 'studio 3hz', 'yokohama animation laboratory', 'studio mir', 'fortes', 'tnk', 'oriental light and magic',
  'tokyo movie shinsha', 'silver link.', 'cypic', 'clap', 'studio mausu', 'gekkou production', 'drive', 'bug films', 'wildbrain studios',
]);
export const animationStudios = (it: Item) => it.studios.filter((s) => ANIMATION_STUDIOS.has(s.toLowerCase()));

export interface Match {
  friend: Friend;
  common: number;
  match: number; // 0–100
  agree: { id: string; mine: number; theirs: number }[];
  split: { id: string; mine: number; theirs: number }[];
}

/** Spearman correlation over the titles you've both ranked, shown as a 0–100 match. */
export function tasteMatch(view: BoardView, friend: Friend): Match | null {
  const theirs = new Map(friend.items.map((s) => [s.id, s.rank]));
  const common = view.ranked.filter((r) => theirs.has(r.id));
  if (common.length < 3) return null;
  const mineOrder = common.map((r) => r.id);
  const theirOrder = [...mineOrder].sort((a, b) => theirs.get(a)! - theirs.get(b)!);
  const pos = new Map(theirOrder.map((id, i) => [id, i]));
  const n = common.length;
  let d2 = 0;
  const rows = mineOrder.map((id, i) => {
    const d = i - pos.get(id)!;
    d2 += d * d;
    return { id, mine: view.byId.get(id)!.rank, theirs: theirs.get(id)!, d: Math.abs(d), sum: i + pos.get(id)! };
  });
  const rho = 1 - (6 * d2) / (n * (n * n - 1));
  return {
    friend,
    common: n,
    match: Math.round(((rho + 1) / 2) * 100),
    agree: rows.filter((r) => r.d <= 1).sort((a, b) => a.sum - b.sum).slice(0, 3),
    split: [...rows].sort((a, b) => b.d - a.d).slice(0, 3),
  };
}
