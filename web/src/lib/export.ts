import type { BoardView } from './engine/board';
import type { Item, ListKey, Tier } from './engine/types';
import { TIERS } from './engine/types';
import { LIST_LABEL } from './ui/format';

export type Format = 'txt' | 'md' | 'csv' | 'json';
export const MIME: Record<Format, string> = { txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json' };

const yr = (it?: Item) => (it?.year ? ` (${it.year})` : '');
const md = (s: string) => s.replace(/([\\*_[\]#])/g, '\\$1');
const csv = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function exportText(fmt: Format, view: BoardView, items: Map<string, Item>, list: ListKey, who: string, answers: number): string {
  const rows = view.ranked.map((r) => ({ r, it: items.get(r.id)! })).filter((x) => x.it);
  const title = `${who ? who + "'s " : ''}${LIST_LABEL[list]} ranking`;
  const date = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const kind = (it: Item) => (list === 'all' ? (it.type === 'Movie' ? ' · movie' : ' · series') : '');

  switch (fmt) {
    case 'md': {
      const out = [`# ${title}`, '', `_${rows.length} ranked · ${answers} answers · ${date} · made with RankBox_`, ''];
      for (const t of TIERS as Tier[]) {
        const inTier = rows.filter((x) => x.r.tier === t);
        if (!inTier.length) continue;
        out.push(`## ${t} tier`, '');
        for (const { r, it } of inTier) out.push(`${r.rank}. **${md(it.name)}**${yr(it)}${kind(it)} — ${r.score.toFixed(1)}`);
        out.push('');
      }
      return out.join('\n').trimEnd() + '\n';
    }
    case 'csv':
      return ['rank,title,year,type,tier,score,last_watched,jellyfin_id',
        ...rows.map(({ r, it }) => [r.rank, csv(it.name), it.year ?? '', it.type, r.tier, r.score.toFixed(1), it.lastWatched?.slice(0, 10) ?? '', r.id].join(','))].join('\n') + '\n';
    case 'json':
      return JSON.stringify({
        title, list, exported: new Date().toISOString(), answers,
        ranking: rows.map(({ r, it }) => ({ rank: r.rank, title: it.name, year: it.year ?? null, type: it.type, tier: r.tier, score: r.score, id: r.id })),
      }, null, 2);
    default: {
      const out = [`${title} (${date})`, ''];
      let tier: Tier | null = null;
      for (const { r, it } of rows) {
        if (r.tier !== tier) { if (tier) out.push(''); out.push(`${r.tier} TIER`); tier = r.tier; }
        out.push(`${r.rank}. ${it.name}${yr(it)}`);
      }
      return out.join('\n') + '\n';
    }
  }
}
