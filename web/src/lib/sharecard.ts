import type { BoardView } from './engine/board';
import type { Item, ListKey, Tier } from './engine/types';
import { TIERS } from './engine/types';
import { hueOf, LIST_LABEL } from './ui/format';

// Renders a shareable PNG (1080×1350, Instagram portrait) from the ranking.
// Posters come from the same Jellyfin origin, so the canvas stays exportable.

export type CardStyle = 'top10' | 'tiers';

const W = 1080, H = 1350;
const C = {
  bg: '#0c0f14', surface: '#141922', line: '#263042', text: '#eef1f6', muted: '#8f99ac', gold: '#f4c55a',
  tier: { S: '#f06b6b', A: '#f39a53', B: '#eccb57', C: '#8fd17a', D: '#6aa8e8' } as Record<Tier, string>,
};
const DISPLAY = '"Big Shoulders Display", "Arial Narrow", sans-serif';
const BODY = '"Instrument Sans", "Segoe UI", sans-serif';

function loadImage(src: string): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  return new Promise((res) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  });
}

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawPoster(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null, name: string, x: number, y: number, w: number, h: number, r: number) {
  ctx.save();
  rounded(ctx, x, y, w, h, r);
  ctx.clip();
  if (img) {
    const s = Math.max(w / img.width, h / img.height);
    ctx.drawImage(img, x + (w - img.width * s) / 2, y + (h - img.height * s) / 2, img.width * s, img.height * s);
  } else {
    const hue = hueOf(name);
    const g = ctx.createLinearGradient(x, y, x + w * .4, y + h);
    g.addColorStop(0, `hsl(${hue} 42% 32%)`);
    g.addColorStop(1, `hsl(${hue + 40} 48% 12%)`);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = `hsl(${hue} 60% 92%)`;
    ctx.font = `800 ${Math.round(w * .15)}px ${DISPLAY}`;
    ctx.textBaseline = 'top';
    const words = name.toUpperCase().split(/\s+/);
    const lines: string[] = [];
    let line = '';
    for (const wd of words) {
      const t = line ? line + ' ' + wd : wd;
      if (ctx.measureText(t).width > w * .78 && line) { lines.push(line); line = wd; } else line = t;
    }
    lines.push(line);
    // title sits at the top so the rank numeral can own the bottom corner
    lines.slice(0, 4).forEach((l, i) => ctx.fillText(l, x + w * .09, y + h * .1 + i * w * .15));
    ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();
}

export async function renderCard(
  style: CardStyle, view: BoardView, items: Map<string, Item>, list: ListKey, who: string, answers: number,
  poster: (id: string, h?: number) => string,
): Promise<HTMLCanvasElement> {
  await Promise.all([document.fonts.load(`900 80px ${DISPLAY}`), document.fonts.load(`600 24px ${BODY}`)]).catch(() => {});
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * .5, -100, 50, W * .5, 0, 900);
  glow.addColorStop(0, 'rgba(244,197,90,.18)');
  glow.addColorStop(1, 'rgba(244,197,90,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // header
  ctx.fillStyle = C.gold;
  ctx.font = `700 26px ${BODY}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText((who ? who + "'s" : 'My').toUpperCase() + (style === 'top10' ? ' TOP 10' : ' TIER LIST'), 64, 102);
  ctx.fillStyle = C.text;
  ctx.font = `900 112px ${DISPLAY}`;
  ctx.fillText(LIST_LABEL[list].toUpperCase(), 60, 206);

  const ranked = view.ranked;
  if (style === 'top10') {
    // podium: #1–#3 big across the top, #4–#10 in a row underneath
    const top = ranked.slice(0, 10);
    const imgs = await Promise.all(top.map((r) => loadImage(poster(r.id, 700))));
    const fit = (t: string, max: number) => {
      let s = t;
      while (ctx.measureText(s).width > max && s.length > 3) s = s.slice(0, -2);
      return s === t ? t : s.trimEnd() + '…';
    };
    const cell = (i: number, x: number, y: number, pw: number, ph: number, big: boolean) => {
      const r = top[i], it = items.get(r.id)!;
      drawPoster(ctx, imgs[i], it.name, x, y, pw, ph, big ? 18 : 10);
      const shade = ctx.createLinearGradient(0, y + ph * .55, 0, y + ph);
      shade.addColorStop(0, 'rgba(12,15,20,0)'); shade.addColorStop(1, 'rgba(12,15,20,.75)');
      ctx.save(); rounded(ctx, x, y, pw, ph, big ? 18 : 10); ctx.clip(); ctx.fillStyle = shade; ctx.fillRect(x, y, pw, ph); ctx.restore();
      ctx.font = `900 ${big ? 150 : 72}px ${DISPLAY}`;
      ctx.fillStyle = i === 0 ? C.gold : big ? '#f3e6c4' : C.text;
      ctx.fillText(String(r.rank), x + (big ? 14 : 8), y + ph - (big ? 12 : 6));
      const cs = big ? 44 : 28;
      ctx.fillStyle = C.tier[r.tier]; rounded(ctx, x + pw - cs - 10, y + 10, cs, cs, big ? 10 : 7); ctx.fill();
      ctx.fillStyle = '#12100c'; ctx.font = `900 ${big ? 34 : 22}px ${DISPLAY}`; ctx.textAlign = 'center';
      ctx.fillText(r.tier, x + pw - 10 - cs / 2, y + 10 + cs * .78); ctx.textAlign = 'left';
      ctx.fillStyle = C.text; ctx.font = `600 ${big ? 25 : 17}px ${BODY}`;
      ctx.fillText(fit(it.name, pw), x, y + ph + (big ? 40 : 28));
      if (big) {
        ctx.fillStyle = C.muted; ctx.font = `500 20px ${BODY}`;
        ctx.fillText(`${r.score.toFixed(1)} / 10${it.year ? ' · ' + it.year : ''}`, x, y + ph + 70);
      }
    };
    const x0 = 64, gapBig = 26, pwBig = (W - x0 * 2 - gapBig * 2) / 3, phBig = pwBig * 1.5;
    for (let i = 0; i < Math.min(3, top.length); i++) cell(i, x0 + i * (pwBig + gapBig), 252, pwBig, phBig, true);
    const gap = 14, pw = (W - x0 * 2 - gap * 6) / 7, ph = pw * 1.5, y2 = 252 + phBig + 104;
    for (let i = 3; i < top.length; i++) cell(i, x0 + (i - 3) * (pw + gap), y2, pw, ph, false);
  } else {
    const y0 = 250, rowH = 196, labelW = 120;
    const shown = TIERS.filter((t) => ranked.some((r) => r.tier === t));
    const perRow = 7, gap = 10;
    const pw = (W - 64 * 2 - labelW - 16 - gap * (perRow - 1)) / perRow, ph = Math.min(rowH - 24, pw * 1.5);
    const all = ranked.filter((r) => shown.includes(r.tier));
    const imgs = new Map<string, HTMLImageElement | null>();
    await Promise.all(all.slice(0, 60).map(async (r) => imgs.set(r.id, await loadImage(poster(r.id, 300)))));
    shown.forEach((t, row) => {
      const y = y0 + row * (rowH + 12);
      ctx.fillStyle = C.surface; rounded(ctx, 64, y, W - 128, rowH, 16); ctx.fill();
      ctx.fillStyle = C.tier[t]; rounded(ctx, 64, y, labelW, rowH, 16); ctx.fill();
      ctx.fillStyle = '#12100c'; ctx.font = `900 96px ${DISPLAY}`; ctx.textAlign = 'center';
      ctx.fillText(t, 64 + labelW / 2, y + rowH / 2 + 34); ctx.textAlign = 'left';
      const inTier = ranked.filter((r) => r.tier === t);
      inTier.slice(0, perRow).forEach((r, i) => {
        const x = 64 + labelW + 16 + i * (pw + gap);
        drawPoster(ctx, imgs.get(r.id) ?? null, items.get(r.id)!.name, x, y + (rowH - ph) / 2, pw, ph, 8);
      });
      if (inTier.length > perRow) {
        ctx.fillStyle = C.muted; ctx.font = `600 20px ${BODY}`; ctx.textAlign = 'right';
        ctx.fillText(`+${inTier.length - perRow} more`, W - 80, y + rowH - 14); ctx.textAlign = 'left';
      }
    });
  }

  // footer
  ctx.fillStyle = C.line; ctx.fillRect(64, H - 104, W - 128, 2);
  ctx.fillStyle = C.muted; ctx.font = `500 22px ${BODY}`;
  ctx.fillText(`${ranked.length} ranked · ${answers} head-to-head answers`, 64, H - 58);
  ctx.textAlign = 'right'; ctx.fillStyle = C.text; ctx.font = `900 34px ${DISPLAY}`;
  ctx.fillText('RANKBOX', W - 64, H - 54); ctx.textAlign = 'left';
  return cv;
}
