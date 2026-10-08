import type { Answer } from './types';

// Bradley–Terry with ties, fitted as a MAP estimate with a normal prior.
// Every answer is evidence; newer answers about the same pair outweigh older ones,
// and answers given right after a binge count a bit less until they're re-confirmed.

const PRIOR_SD = 1.5;
const DAY = 864e5;

export interface FitResult {
  theta: Map<string, number>;
  se: Map<string, number>;
  n: Map<string, number>;
  wins: Map<string, number>;
  losses: Map<string, number>;
  ties: Map<string, number>;
}

export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
export const pairKey = (a: string, b: string) => (a < b ? a + '|' + b : b + '|' + a);

export function answerWeights(answers: Answer[], now = Date.now()): number[] {
  // newest answer per pair is the real one; earlier ones still count, just less
  const latest = new Map<string, number>();
  answers.forEach((a, i) => {
    const k = pairKey(a.a, a.b);
    const j = latest.get(k);
    if (j === undefined || answers[j].at <= a.at) latest.set(k, i);
  });
  return answers.map((a, i) => {
    let w = a.kind === 'manual' ? 1.5 : 1;
    if (latest.get(pairKey(a.a, a.b)) !== i) w *= 0.35;
    const ageDays = Math.max(0, (now - Date.parse(a.at)) / DAY);
    w *= Math.pow(0.5, ageDays / 365); // taste drifts: a year-old answer counts half
    if ((a.freshA || a.freshB) && !a.checkedAt) w *= 0.7; // recency-bias discount until re-confirmed
    return w;
  });
}

export function fit(ids: string[], answers: Answer[], now = Date.now()): FitResult {
  const idx = new Map(ids.map((id, i) => [id, i]));
  const n = ids.length;
  const theta = new Float64Array(n);
  const hess = new Float64Array(n);
  const prec = 1 / (PRIOR_SD * PRIOR_SD);
  const weights = answerWeights(answers, now);

  const edges: { i: number; j: number; y: number; w: number }[] = [];
  const cnt = new Map<string, number>(), wins = new Map<string, number>(), losses = new Map<string, number>(), ties = new Map<string, number>();
  const inc = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  answers.forEach((a, k) => {
    const i = idx.get(a.a), j = idx.get(a.b);
    if (i === undefined || j === undefined || i === j) return;
    edges.push({ i, j, y: a.r, w: weights[k] });
    inc(cnt, a.a); inc(cnt, a.b);
    if (a.r === 0.5) { inc(ties, a.a); inc(ties, a.b); }
    else if (a.r === 1) { inc(wins, a.a); inc(losses, a.b); }
    else { inc(wins, a.b); inc(losses, a.a); }
  });

  // diagonal Newton steps on a concave log-posterior: converges in a few dozen passes
  const g = new Float64Array(n);
  for (let pass = 0; pass < 300; pass++) {
    for (let i = 0; i < n; i++) { g[i] = -theta[i] * prec; hess[i] = prec; }
    for (const e of edges) {
      const p = sigmoid(theta[e.i] - theta[e.j]);
      const d = e.w * (e.y - p), h = e.w * p * (1 - p);
      g[e.i] += d; g[e.j] -= d; hess[e.i] += h; hess[e.j] += h;
    }
    let maxStep = 0;
    for (let i = 0; i < n; i++) {
      const step = Math.max(-2, Math.min(2, g[i] / hess[i]));
      theta[i] += step;
      maxStep = Math.max(maxStep, Math.abs(step));
    }
    if (maxStep < 1e-6) break;
  }

  const res: FitResult = { theta: new Map(), se: new Map(), n: cnt, wins, losses, ties };
  ids.forEach((id, i) => { res.theta.set(id, theta[i]); res.se.set(id, 1 / Math.sqrt(hess[i])); });
  return res;
}

/** 0–10 display score: 5 is "average for you". */
export const toScore = (theta: number) => Math.round(100 * sigmoid(1.1 * theta)) / 10;
