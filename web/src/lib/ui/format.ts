const DAY = 864e5;

export function hueOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase();
}

export function agoText(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'no watch date';
  const d = (now - Date.parse(iso)) / DAY;
  if (d < 1) return 'watched today';
  if (d < 2) return 'watched yesterday';
  if (d < 30) return `watched ${Math.round(d)}d ago`;
  if (d < 365) return `watched ${Math.round(d / 30)}mo ago`;
  return `watched ${(d / 365).toFixed(1)}y ago`;
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export const LIST_LABEL = { series: 'Shows', movies: 'Movies', all: 'Everything' } as const;
