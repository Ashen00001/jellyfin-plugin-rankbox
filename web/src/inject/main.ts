import { mount, unmount } from 'svelte';
import tokens from '../lib/ui/tokens.css?inline';
import { ApiBackend, type Auth } from '../lib/api';
import { RankBox } from '../lib/store.svelte';
import { hueOf } from '../lib/ui/format';
import HomePane from './HomePane.svelte';

// Runs inside Jellyfin's own web app (added to index.html by the RankBox plugin via File Transformation).
// Adds: a RankBox pane on the home screen, a "#4 · A tier" badge on show/movie pages, and small top banners.

declare global {
  interface Window {
    ApiClient?: { accessToken(): string; getCurrentUserId(): string; serverAddress(): string };
    __rankboxInject?: boolean;
  }
}

const FONTS = 'https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@700;800;900&family=Instrument+Sans:wght@400;500;600;700&display=swap';
const BASE_CSS = `:host{all:initial;display:block}*{box-sizing:border-box}button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer}
a{color:inherit}h2,h3,p{margin:0}.num{font-variant-numeric:tabular-nums}:focus-visible{outline:2px solid var(--rb-accent);outline-offset:2px}`;

function auth(): Auth | null {
  const c = window.ApiClient;
  if (!c?.accessToken?.()) return null;
  const base = (c.serverAddress?.() || location.origin + location.pathname.replace(/\/web\/.*$/, '')).replace(/\/+$/, '');
  return { base, token: c.accessToken(), userId: c.getCurrentUserId?.() };
}

function shadowHost(cls: string, tag = 'div'): { host: HTMLElement; root: ShadowRoot } {
  const host = document.createElement(tag);
  host.className = cls;
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = tokens + BASE_CSS;
  root.append(style);
  return { host, root };
}

const route = () => location.hash.replace(/^#!?/, '');

/* ---------------- home pane ---------------- */

let home: { host: HTMLElement; app: ReturnType<typeof mount>; rb: RankBox } | null = null;

function placeHome(a: Auth) {
  const r = route();
  const onHome = /^\/home(\.html)?(\?|$)/.test(r) && !/tab=[1-9]/.test(r);
  const container = document.querySelector<HTMLElement>('.homePage:not(.hide) .homeSectionsContainer, #indexPage:not(.hide) .homeSectionsContainer');
  if (!onHome || !container) return;
  if (home && container.contains(home.host)) return;
  if (home) { unmount(home.app); home.host.remove(); home = null; }
  const { host, root } = shadowHost('verticalSection rankbox-home');
  host.style.cssText = 'padding:0 3.3% 0 3.3%;';
  // right after "My Media", before Continue Watching
  const first = container.querySelector(':scope > .verticalSection, :scope > .section0');
  if (first?.nextSibling) container.insertBefore(host, first.nextSibling); else container.prepend(host);
  const rb = new RankBox(new ApiBackend(a));
  const app = mount(HomePane, { target: root, props: { rb, appUrl: a.base + '/RankBox/App' } });
  home = { host, app, rb };
}

/* ---------------- badge on detail pages ---------------- */

let badgeFor = '';
async function placeBadge(a: Auth) {
  const m = route().match(/^\/details\?(?:.*&)?id=([0-9a-f]{32})/i);
  const page = document.querySelector<HTMLElement>('.itemDetailPage:not(.hide)');
  const anchor = page?.querySelector<HTMLElement>('.itemMiscInfo-primary');
  if (!m || !anchor) return;
  const id = m[1].toLowerCase();
  const existing = page!.querySelector<HTMLElement>('.rankbox-badge');
  if (existing && existing.dataset.id === id) return;
  existing?.remove();
  if (badgeFor === id + '…') return;
  badgeFor = id + '…';
  try {
    const r = await fetch(`${a.base}/RankBox/Badge?itemId=${id}`, { headers: { Authorization: `MediaBrowser Token="${a.token}"` } });
    const b = r.ok ? await r.json() : null;
    badgeFor = id;
    if (!b || !b.rank || route().indexOf(id) < 0) return;
    const { host, root } = shadowHost('rankbox-badge', 'span');
    host.dataset.id = id;
    host.style.cssText = 'display:inline-block;margin:.2em 0 .6em;';
    const tierColor = `var(--rb-tier-${b.tier})`;
    root.innerHTML += `<style>
      a{display:inline-flex;align-items:center;gap:10px;padding:5px 12px 5px 6px;border-radius:99px;text-decoration:none;
        background:rgba(12,15,20,.6);backdrop-filter:blur(8px);box-shadow:inset 0 0 0 1px rgba(255,255,255,.12);
        font:600 14px/1 var(--rb-font-body);color:var(--rb-text)}
      a:hover{box-shadow:inset 0 0 0 1px var(--rb-gold)}
      .t{display:grid;place-items:center;min-width:26px;height:26px;border-radius:7px;background:${tierColor};color:#12100c;font:900 17px/1 var(--rb-font-display)}
      .n{font:900 22px/1 var(--rb-font-display);color:var(--rb-gold)}
      .s{color:var(--rb-muted);font-weight:500}</style>
      <a href="${a.base}/RankBox/App?list=${b.list}#ranking" title="Open RankBox"><span class="t">${b.tier}</span>
      <span class="n">#${b.rank}</span><span>in your ${b.list === 'movies' ? 'movies' : b.list === 'series' ? 'shows' : 'list'}</span>
      <span class="s">· ${Number(b.score).toFixed(1)}</span></a>`;
    anchor.after(host);
  } catch { badgeFor = ''; }
}

/* ---------------- banners (just finished / recency check) ---------------- */

const SEEN = 'rankbox.banner.seen';
let bannerOpen = false;
const seen = (): string[] => { try { return JSON.parse(localStorage.getItem(SEEN) || '[]'); } catch { return []; } };
const markSeen = (k: string) => { try { localStorage.setItem(SEEN, JSON.stringify([...seen().filter((x) => x !== k), k].slice(-300))); } catch { /* ignore */ } };
const playing = () => !!document.querySelector('.videoPlayerContainer:not(.hide)') || /^\/video/.test(route());
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

async function pollBanner(a: Auth) {
  if (bannerOpen || document.hidden || playing() || /\/RankBox/i.test(location.pathname)) return;
  let data: { finished: any[]; rechecks: any[] };
  try {
    const r = await fetch(`${a.base}/RankBox/Inbox?withRechecks=true`, { headers: { Authorization: `MediaBrowser Token="${a.token}"` } });
    if (!r.ok) return;
    const j = await r.json();
    data = Array.isArray(j) ? { finished: j, rechecks: [] } : j;
  } catch { return; }
  const s = seen();
  const onHome = !!home && document.contains(home.host);
  const f = data.finished.find((x) => !s.includes('f:' + x.id + ':' + x.finishedAt));
  if (f && !onHome) {
    markSeen('f:' + f.id + ':' + f.finishedAt);
    return banner(a, [f.id], `<p class="k">RankBox · just finished</p><p class="t">Where does <b>${esc(f.name)}</b> rank?</p>`,
      [{ label: f.rankedAt ? 'Re-rank' : 'Rank it', go: `${a.base}/RankBox/App?list=${f.list}&rank=${f.id}` }]);
  }
  const rc = data.rechecks.find((x) => !s.includes('r:' + x.answerId));
  if (rc && !onHome) {
    markSeen('r:' + rc.answerId);
    const when = new Date(rc.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return banner(a, [rc.winner, rc.loser], `<p class="k">RankBox · still agree?</p><p class="t">On ${when} you rated <b>${esc(rc.winnerName)}</b> over <b>${esc(rc.loserName)}</b>.</p>`,
      [{ label: 'Answer', go: `${a.base}/RankBox/App?list=${rc.list}#rank` }]);
  }
}

function banner(a: Auth, posters: string[], html: string, actions: { label: string; go: string }[]) {
  const { host, root } = shadowHost('rankbox-banner');
  host.style.cssText = 'position:fixed;left:50%;top:calc(10px + env(safe-area-inset-top,0px));z-index:99999;width:min(440px,calc(100vw - 24px));transform:translate(-50%,-150%);transition:transform .35s cubic-bezier(.2,.9,.3,1.15)';
  root.innerHTML += `<style>
    .b{display:flex;gap:12px;align-items:center;padding:10px 12px 10px 10px;border-radius:16px;background:rgba(20,25,34,.96);
      backdrop-filter:blur(14px);box-shadow:0 18px 44px rgba(0,0,0,.55),inset 0 0 0 1px rgba(255,255,255,.09);font:14px/1.35 var(--rb-font-body);color:var(--rb-text)}
    .ps{display:flex;gap:4px}.p{width:36px;height:54px;border-radius:6px;background-size:cover;background-position:center}
    .x{flex:1;min-width:0}.k{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--rb-gold)}
    .t{margin-top:2px}.t b{color:#fff}.acts{display:flex;gap:6px;margin-top:8px}
    .acts a{padding:6px 12px;border-radius:9px;background:var(--rb-gold);color:#1a1405;font-weight:700;font-size:13px;text-decoration:none}
    .close{position:absolute;top:6px;right:8px;color:var(--rb-faint);font-size:18px;line-height:1}</style>
    <div class="b"><div class="ps">${posters.map((id) => `<span class="p" style="background-color:hsl(${hueOf(id)} 40% 30%);background-image:url('${a.base}/Items/${id}/Images/Primary?fillHeight=120')"></span>`).join('')}</div>
    <div class="x">${html}<div class="acts">${actions.map((x) => `<a href="${x.go}">${x.label}</a>`).join('')}</div></div>
    <button class="close" aria-label="Close">×</button></div>`;
  document.body.append(host);
  bannerOpen = true;
  requestAnimationFrame(() => requestAnimationFrame(() => (host.style.transform = 'translate(-50%,0)')));
  const close = () => { host.style.transform = 'translate(-50%,-150%)'; setTimeout(() => { host.remove(); bannerOpen = false; }, 400); };
  root.querySelector('.close')!.addEventListener('click', close);
  let y0: number | null = null;
  host.addEventListener('touchstart', (e) => (y0 = e.touches[0].clientY), { passive: true });
  host.addEventListener('touchmove', (e) => { if (y0 !== null && y0 - e.touches[0].clientY > 25) close(); }, { passive: true });
  const t = setTimeout(close, 20000);
  host.addEventListener('mouseenter', () => clearTimeout(t));
}

/* ---------------- wiring ---------------- */

function boot() {
  if (window.__rankboxInject) return;
  window.__rankboxInject = true;
  if (!document.querySelector('link[data-rankbox-fonts]')) {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = FONTS; l.dataset.rankboxFonts = '';
    document.head.append(l);
  }
  let pending = 0;
  const tick = () => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => {
      const a = auth();
      if (!a) return;
      placeHome(a);
      void placeBadge(a);
    });
  };
  new MutationObserver(tick).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('hashchange', tick);
  tick();
  const poll = () => { const a = auth(); if (a) void pollBanner(a); };
  setTimeout(poll, 6000);
  setInterval(poll, 45000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(poll, 1500); });
  // marking something watched: check right away
  document.addEventListener('click', (e) => {
    if ((e.target as HTMLElement)?.closest?.('button[is="emby-playstatebutton"], .btnPlaystate, [data-action="markplayed"]')) setTimeout(poll, 2500);
  }, true);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
