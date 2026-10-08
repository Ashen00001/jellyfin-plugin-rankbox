// RankBox v2 data model. The server stores ListState as JSON; the engine derives everything else.

export type Result = 1 | 0 | 0.5; // 1 = a is better, 0 = b is better, 0.5 = about the same
export type Kind = 'place' | 'refine' | 'recheck' | 'conflict' | 'manual';
export type Tier = 'S' | 'A' | 'B' | 'C' | 'D';
export type ListKey = 'series' | 'movies' | 'all';
export const TIERS: Tier[] = ['S', 'A', 'B', 'C', 'D'];

export interface Answer {
  id: string;
  a: string;
  b: string;
  r: Result;
  at: string; // ISO time
  kind: Kind;
  /** a / b had been watched within the last 3 weeks when this was answered */
  freshA?: boolean;
  freshB?: boolean;
  /** set once a recency check re-asked it */
  checkedAt?: string | null;
  outcome?: 'kept' | 'flipped' | null;
}

export interface Item {
  id: string;
  name: string;
  year?: number | null;
  type: 'Series' | 'Movie';
  status: 'finished' | 'watching' | 'unwatched';
  playedEpisodes: number;
  totalEpisodes: number;
  lastWatched: string | null;
  genres: string[];
  studios: string[];
}

export interface SnapshotItem {
  id: string;
  rank: number;
  score: number;
  tier: Tier;
}

export interface Snapshot {
  at: string;
  items: SnapshotItem[];
}

export interface ListState {
  version: 2;
  answers: Answer[];
  excluded: string[];
  tierOverrides: Record<string, Tier>;
  watchedOnly: boolean;
  snapshot?: Snapshot;
}

export interface Ranked {
  id: string;
  rank: number; // 1-based
  theta: number; // log-strength
  se: number; // standard error of theta
  score: number; // 0-10 display score
  tier: Tier;
  tierOverridden: boolean;
  comparisons: number;
  wins: number;
  losses: number;
  ties: number;
}

export interface RecheckDue {
  answerId: string;
  winner: string;
  loser: string;
  fresh: string; // id that was fresh, '' if both
  at: string;
}

export type Question =
  | { kind: 'place'; a: string; b: string; low: number; high: number; left: number }
  | { kind: 'refine'; a: string; b: string; gapDays: number | null }
  | { kind: 'recheck'; a: string; b: string; check: RecheckDue }
  | { kind: 'conflict'; a: string; b: string; old: Answer }
  | { kind: 'seed'; a: string; b: string };

export const emptyState = (): ListState => ({
  version: 2,
  answers: [],
  excluded: [],
  tierOverrides: {},
  watchedOnly: false,
});
