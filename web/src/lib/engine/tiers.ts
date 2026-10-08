import type { Tier } from './types';
import { TIERS } from './types';

/** How many tiers a list of n ranked items gets. Tiny lists don't need five. */
export function tierCount(n: number): number {
  if (n < 4) return 1;
  if (n < 8) return 3;
  if (n < 15) return 4;
  return 5;
}

/**
 * Natural breaks (Jenks) on the strengths: tiers split where the gaps are,
 * not at fixed percentages. `values` must be sorted best-first.
 * Returns the tier for each position.
 */
export function naturalTiers(values: number[]): Tier[] {
  const n = values.length;
  const k = Math.min(tierCount(n), n);
  if (n === 0) return [];
  const labels = k === 1 ? (['A'] as Tier[]) : TIERS.slice(0, k);
  if (k === 1) return values.map(() => labels[0]);

  // prefix sums for O(1) within-class squared error
  const ps = [0], ps2 = [0];
  for (const v of values) { ps.push(ps[ps.length - 1] + v); ps2.push(ps2[ps2.length - 1] + v * v); }
  const sse = (i: number, j: number) => { // items i..j-1
    const m = j - i, s = ps[j] - ps[i];
    return ps2[j] - ps2[i] - (s * s) / m;
  };

  // cost[c][j] = best error for the first j items in c classes
  const INF = Number.POSITIVE_INFINITY;
  const cost: number[][] = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(INF));
  const cut: number[][] = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(0));
  cost[0][0] = 0;
  for (let c = 1; c <= k; c++) {
    for (let j = c; j <= n; j++) {
      for (let i = c - 1; i < j; i++) {
        const v = cost[c - 1][i] + sse(i, j);
        if (v < cost[c][j]) { cost[c][j] = v; cut[c][j] = i; }
      }
    }
  }
  const out: Tier[] = new Array(n);
  let j = n;
  for (let c = k; c >= 1; c--) {
    const i = cut[c][j];
    for (let t = i; t < j; t++) out[t] = labels[c - 1];
    j = i;
  }
  return out;
}
