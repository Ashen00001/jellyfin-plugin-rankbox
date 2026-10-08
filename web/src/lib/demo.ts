import type { Backend, Finished, Friend, Settings } from './api';
import { Board } from './engine/board';
import type { Item, ListKey, ListState, Result } from './engine/types';
import { emptyState } from './engine/types';

// Sample library for the demo build (opened anywhere that isn't a Jellyfin server).
// Answers are pre-played from a hidden "taste" so every screen has something real to show.

const DAY = 864e5;
const T0 = Date.now();
const ago = (d: number | null) => (d === null ? null : new Date(T0 - d * DAY).toISOString());

type Row = [string, number, 'Series' | 'Movie', Item['status'], number | null, string[], string[]];
const ROWS: Row[] = [
  ['Frieren: Beyond Journey\'s End', 2023, 'Series', 'finished', 45, ['Adventure', 'Drama', 'Fantasy'], ['Madhouse']],
  ['Vinland Saga', 2019, 'Series', 'finished', 300, ['Action', 'Adventure', 'Drama'], ['Wit Studio', 'MAPPA']],
  ['JUJUTSU KAISEN', 2020, 'Series', 'finished', 40, ['Action', 'Supernatural'], ['MAPPA']],
  ['Attack on Titan', 2013, 'Series', 'finished', 700, ['Action', 'Drama'], ['Wit Studio', 'MAPPA']],
  ['Death Note', 2006, 'Series', 'finished', 1200, ['Mystery', 'Thriller', 'Supernatural'], ['Madhouse']],
  ['Solo Leveling', 2024, 'Series', 'finished', 33, ['Action', 'Fantasy'], ['A-1 Pictures']],
  ['Blue Box', 2024, 'Series', 'watching', 1, ['Romance', 'Sports'], ['Telecom Animation Film']],
  ['Chainsaw Man', 2022, 'Series', 'finished', 90, ['Action', 'Horror'], ['MAPPA']],
  ['Your Lie in April', 2014, 'Series', 'unwatched', null, ['Drama', 'Romance', 'Music'], ['A-1 Pictures']],
  ['Erased', 2016, 'Series', 'finished', 500, ['Mystery', 'Thriller'], ['A-1 Pictures']],
  ['My Dress-Up Darling', 2022, 'Series', 'finished', 160, ['Romance', 'Comedy'], ['CloverWorks']],
  ['Cyberpunk: Edgerunners', 2022, 'Series', 'finished', 250, ['Action', 'Sci-Fi'], ['Trigger']],
  ['Toradora!', 2008, 'Series', 'unwatched', null, ['Romance', 'Comedy'], ['J.C.Staff']],
  ['Demon Slayer: Kimetsu no Yaiba', 2019, 'Series', 'finished', 38, ['Action', 'Fantasy'], ['ufotable']],
  ['Mob Psycho 100', 2016, 'Series', 'watching', 220, ['Action', 'Comedy', 'Supernatural'], ['Bones']],
  ['Kaguya-sama: Love Is War', 2019, 'Series', 'finished', 140, ['Romance', 'Comedy'], ['A-1 Pictures']],
  ['SPY x FAMILY', 2022, 'Series', 'finished', 410, ['Comedy', 'Action'], ['Wit Studio', 'CloverWorks']],
  ['BOCCHI THE ROCK!', 2022, 'Series', 'finished', 365, ['Comedy', 'Music'], ['CloverWorks']],
  ['Fullmetal Alchemist: Brotherhood', 2009, 'Series', 'finished', 900, ['Action', 'Adventure', 'Fantasy'], ['Bones']],
  ['DAN DA DAN', 2024, 'Series', 'finished', 60, ['Action', 'Comedy', 'Supernatural'], ['Science SARU']],
  ['Oshi no Ko', 2023, 'Series', 'finished', 120, ['Drama', 'Mystery'], ['Doga Kobo']],
  ['Rascal Does Not Dream of Bunny Girl Senpai', 2018, 'Series', 'finished', 9, ['Romance', 'Drama'], ['CloverWorks']],
  ['The Apothecary Diaries', 2023, 'Series', 'watching', 2, ['Mystery', 'Drama'], ['OLM', 'TOHO animation']],
  ['Hokkaido Gals Are Super Adorable!', 2024, 'Series', 'finished', 1, ['Romance', 'Comedy'], ['Studio ARTS']],
  ['Your Name.', 2016, 'Movie', 'finished', 400, ['Romance', 'Drama', 'Fantasy'], ['CoMix Wave Films']],
  ['A Silent Voice', 2016, 'Movie', 'finished', 230, ['Drama'], ['Kyoto Animation']],
  ['Weathering with You', 2019, 'Movie', 'finished', 260, ['Romance', 'Drama', 'Fantasy'], ['CoMix Wave Films']],
  ['Suzume', 2022, 'Movie', 'finished', 80, ['Adventure', 'Fantasy'], ['CoMix Wave Films']],
  ['Akira', 1988, 'Movie', 'finished', 50, ['Action', 'Sci-Fi'], ['TMS Entertainment']],
  ['Demon Slayer: Infinity Castle', 2025, 'Movie', 'finished', 15, ['Action', 'Fantasy'], ['ufotable']],
  ['I Want to Eat Your Pancreas', 2018, 'Movie', 'unwatched', null, ['Drama', 'Romance'], ['Studio VOLN']],
  ['The Garden of Words', 2013, 'Movie', 'finished', 600, ['Romance', 'Drama'], ['CoMix Wave Films']],
];

export const DEMO_ITEMS: Item[] = ROWS.map(([name, year, type, status, days, genres, studios], i) => ({
  id: 'demo' + String(i).padStart(2, '0'),
  name, year, type, status,
  playedEpisodes: status === 'finished' ? 24 : status === 'watching' ? 7 : 0,
  totalEpisodes: type === 'Movie' ? 0 : 24,
  lastWatched: ago(days),
  genres, studios,
}));

// the hidden taste the demo answers come from (best first)
const TASTE = ['demo00', 'demo01', 'demo18', 'demo24', 'demo03', 'demo25', 'demo04', 'demo14', 'demo02', 'demo11', 'demo19',
  'demo09', 'demo28', 'demo07', 'demo16', 'demo21', 'demo26', 'demo13', 'demo27', 'demo17', 'demo20', 'demo10', 'demo31',
  'demo15', 'demo29', 'demo05', 'demo22', 'demo06', 'demo23', 'demo12', 'demo08', 'demo30'];

function rng(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
}

const forList = (list: ListKey) => DEMO_ITEMS.filter((i) => list === 'all' || (list === 'movies') === (i.type === 'Movie'));

/** Play a history: most of it a month ago (so a recency check is due), leaving a few titles to place. */
function seedState(list: ListKey): ListState {
  const items = forList(list);
  const state = emptyState();
  let now = T0 - 30 * DAY;
  const r = rng(list.length * 31);
  const board = new Board(items, state, { now: () => now, rng: r });
  const skipIds = new Set(['demo06', 'demo22', 'demo23', 'demo08', 'demo12', 'demo30']); // still to place / unseen
  board.state.excluded.push('demo08');
  board.recompute();
  let guard = 0;
  for (let q = board.next(); q && guard < 600; q = board.next(), guard++) {
    if (skipIds.has(q.a) || skipIds.has(q.b)) { board.exclude(skipIds.has(q.a) ? q.a : q.b); continue; }
    const res: Result = TASTE.indexOf(q.a) < TASTE.indexOf(q.b) ? 1 : 0;
    const noisy = r() < 0.06 ? (res ? 0 : 1) : res;
    board.answer(q, noisy as Result);
    now += 0.02 * DAY;
  }
  // the "still to place" ones go back into the queue; "haven't seen it" stays out
  board.state.excluded = board.state.excluded.filter((id) => id === 'demo08' || id === 'demo12');
  return board.state;
}

const store = new Map<ListKey, ListState>();

export class DemoBackend implements Backend {
  demo = true;
  private gone = new Set<string>();
  private share = true;

  async me() { return { id: 'demo', name: 'You' }; }
  async candidates(list: ListKey) { return forList(list); }
  async state(list: ListKey) {
    if (!store.has(list)) store.set(list, seedState(list));
    return structuredClone(store.get(list)!);
  }
  async save(list: ListKey, state: ListState) { store.set(list, structuredClone(state)); }
  async inbox(): Promise<Finished[]> {
    const f: Finished[] = [
      { id: 'demo23', name: 'Hokkaido Gals Are Super Adorable!', type: 'Series', list: 'series', finishedAt: ago(0.2)! },
      { id: 'demo21', name: 'Rascal Does Not Dream of Bunny Girl Senpai', type: 'Series', list: 'series', finishedAt: ago(1)!, rankedAt: 14 },
    ];
    return f.filter((x) => !this.gone.has(x.id));
  }
  async dismiss(id: string) { this.gone.add(id); }
  async favorites(ids: string[]) { return ids.length; }
  async settings(): Promise<Settings> { return { shareWithFriends: this.share }; }
  async saveSettings(s: Settings) { this.share = s.shareWithFriends; }
  async friends(list: ListKey): Promise<Friend[]> {
    if (!this.share) return [];
    const ids = forList(list).map((i) => i.id);
    const shuffle = (seed: number, swaps: number) => {
      const t = TASTE.filter((id) => ids.includes(id));
      const r = rng(seed);
      for (let k = 0; k < swaps; k++) { const i = Math.floor(r() * t.length), j = Math.min(t.length - 1, i + 1 + Math.floor(r() * 6)); [t[i], t[j]] = [t[j], t[i]]; }
      return t;
    };
    const mk = (name: string, seed: number, swaps: number, drop: number): Friend => {
      const order = shuffle(seed, swaps).filter((_, i) => i % drop !== 1);
      return { userId: name, name, items: order.map((id, i) => ({ id, rank: i + 1, score: Math.round((9.6 - i * 0.3) * 10) / 10, tier: i < 3 ? 'S' : i < 8 ? 'A' : i < 14 ? 'B' : i < 19 ? 'C' : 'D' })) };
    };
    return [mk('Karl', 3, 10, 5), mk('meth', 9, 40, 4)];
  }
  poster() { return ''; }
  backdrop() { return ''; }
  appUrl() { return '#'; }
  jellyfinUrl() { return '#'; }
}
