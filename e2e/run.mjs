// Browser half of scripts/e2e.ps1.
// Env: E2E_BASE, E2E_CREDS (path to creds.json), E2E_ARTIFACTS (dir), E2E_INJECT=0 when File Transformation is really installed.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const base = process.env.E2E_BASE;
const art = process.env.E2E_ARTIFACTS;
const emulateFT = process.env.E2E_INJECT !== '0';
const creds = JSON.parse(readFileSync(process.env.E2E_CREDS, 'utf8').replace(/^﻿/, '')).user;
mkdirSync(art, { recursive: true });

const checks = [];
const ok = (name, detail = '') => { checks.push({ name, detail }); console.log(`  ok   ${name}${detail ? ' - ' + detail : ''}`); };
class Fail extends Error {}
const must = (cond, name, detail = '') => { if (!cond) throw new Fail(`${name}${detail ? ': ' + detail : ''}`); ok(name, detail); };

const browser = await chromium.launch({ headless: true, args: ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
const shot = (n) => page.screenshot({ path: join(art, n + '.png') }).catch(() => {});

const problems = [];
const noise = /fonts\.(googleapis|gstatic)\.com|\/Images\/|favicon|\/socket|tanstack|CancelledError/i; // third-party / Jellyfin-web noise, not RankBox
page.on('console', (m) => { if (m.type() === 'error' && !noise.test(m.text() + (m.location().url || ''))) problems.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
const netfails = [];
page.on('response', (r) => { if (r.status() >= 400 && !noise.test(r.url())) netfails.push(r.status() + ' ' + r.request().method() + ' ' + new URL(r.url()).pathname); });
page.on('response', (r) => { const u = r.url(); if (u.includes('/RankBox/') && r.status() >= 400) problems.push(`http ${r.status()} ${u}`); });

// File Transformation is a third-party plugin that is not bundled. Without it, apply the same two edits the plugin's callbacks make.
if (emulateFT) {
  await page.route(/\/web\/(index\.html|config\.json)?(\?.*)?$/, async (route) => {
    const u = new URL(route.request().url());
    const res = await route.fetch();
    const type = res.headers()['content-type'] || '';
    if (u.pathname.endsWith('config.json')) {
      const cfg = await res.json();
      cfg.menuLinks = [...(cfg.menuLinks || []), { name: 'RankBox', icon: 'leaderboard', url: '../RankBox/App' }];
      return route.fulfill({ response: res, json: cfg });
    }
    if (!type.includes('html')) return route.fulfill({ response: res });
    const html = (await res.text()).replace(/<\/body>/i, '<script type="module" plugin="RankBox" src="../RankBox/inject.js?v=e2e"></script></body>');
    return route.fulfill({ response: res, body: html });
  });
}

const bbox = (loc) => loc.evaluate((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
async function stableBox(loc) {
  let prev = null;
  for (let i = 0; i < 40; i++) {
    const b = await bbox(loc);
    if (prev && ['x', 'y', 'w', 'h'].every((k) => Math.abs(b[k] - prev[k]) < 0.5)) return b;
    prev = b;
    await page.waitForTimeout(120);
  }
  return prev;
}

const api = (path, token) => fetch(base + path, { headers: { Authorization: `MediaBrowser Token="${token}"` } });
let reason = null;
try {
  // sign in through the real login page
  await page.goto(`${base}/web/#/login.html`, { waitUntil: 'domcontentloaded' });
  const manual = page.locator('.btnManual, button:has-text("Manual Login")');
  await page.locator('#txtManualName').or(manual.first()).first().waitFor({ timeout: 60000 });
  if (await manual.first().isVisible().catch(() => false)) await manual.first().click();
  await page.locator('#txtManualName').fill(creds.name);
  await page.locator('#txtManualPassword').fill(creds.password);
  const landed = page.waitForResponse((r) => r.url().includes('/UserViews'), { timeout: 30000 });
  await page.locator('.manualLoginForm button[type=submit]:visible, .manualLoginForm .btnSubmit:visible').first().click();
  await landed;
  await page.waitForFunction(() => !!window.ApiClient?.accessToken?.(), null, { timeout: 30000 });
  const token = await page.evaluate(() => window.ApiClient.accessToken());
  const userId = await page.evaluate(() => window.ApiClient.getCurrentUserId());
  const me = await (await api('/Users/Me', token)).json();
  if (me.Policy?.IsAdministrator !== false || me.Name !== creds.name) throw new Fail(`signed in as the wrong account (admin=${me.Policy?.IsAdministrator})`);
  ok('signed in as the non-admin test user');

  // header / menu link (config.json menuLinks)
  await page.goto(`${base}/web/#/home`, { waitUntil: 'domcontentloaded' });
  await page.locator('a[href*="RankBox/App"]').first().waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  const links = await page.locator('a[href*="RankBox/App"]').count();
  must(links > 0, 'RankBox menu link exists', `${links} link(s)`);

  // home pane
  await page.locator('.rankbox-home').waitFor({ state: 'attached', timeout: 60000 });
  await page.locator('.rankbox-home h2').first().waitFor({ timeout: 30000 });
  must((await page.locator('.rankbox-home h2').first().innerText()).trim().toLowerCase() === 'rankbox', 'home pane renders');
  await page.locator('.rankbox-home .ans.hi').waitFor({ timeout: 30000 });
  await page.locator('.rankbox-home').scrollIntoViewIfNeeded();
  await shot('1-home-pane');

  // answer consecutive questions: the answer buttons must not move
  const boxes = [];
  for (let i = 0; i < 6; i++) {
    const hi = page.locator('.rankbox-home .ans.hi');
    if (!(await hi.count())) break;
    const ask = await page.locator('.rankbox-home h2.ask').first().innerText();
    boxes.push([await stableBox(hi), await stableBox(page.locator('.rankbox-home .ans.same')), await stableBox(page.locator('.rankbox-home .ans.lo'))]);
    if (i === 0) await shot('2-question');
    await hi.click();
    await page.waitForFunction((prev) => {
      const h = document.querySelector('.rankbox-home')?.shadowRoot?.querySelector('h2.ask');
      return !h || h.textContent !== prev;
    }, ask, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(250);
  }
  must(boxes.length >= 2, 'at least two consecutive questions were asked', `${boxes.length} asked`);
  let moved = '';
  for (let i = 1; i < boxes.length; i++) {
    boxes[i].forEach((b, j) => {
      const a = boxes[0][j];
      if (['x', 'y', 'w', 'h'].some((k) => Math.abs(b[k] - a[k]) > 1)) moved += ` q${i + 1}/btn${j}: ${JSON.stringify(a)} -> ${JSON.stringify(b)};`;
    });
  }
  must(!moved, 'answer buttons keep their position across questions', moved || `${boxes.length} questions, 3 buttons each`);
  await shot('3-after-answers');

  // the ranking reached the server, then the badge on a show page
  const shows = (await (await api(`/Items?Recursive=true&IncludeItemTypes=Series&userId=${userId}`, token)).json()).Items;
  let ranked = null;
  for (let t = 0; t < 40 && !ranked; t++) {
    for (const s of shows) {
      const r = await api(`/RankBox/Badge?itemId=${s.Id}`, token);
      if (r.status === 200) { ranked = { s, b: await r.json() }; break; }
    }
    if (!ranked) await page.waitForTimeout(500);
  }
  must(!!ranked, 'a ranking was saved on the server', ranked ? `${ranked.s.Name} is #${ranked.b.rank}, tier ${ranked.b.tier}` : '');

  await page.goto(`${base}/web/#/details?id=${ranked.s.Id}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.rankbox-badge').waitFor({ state: 'attached', timeout: 30000 });
  const txt = (await page.locator('.rankbox-badge .n').innerText()).trim();
  const tier = (await page.locator('.rankbox-badge .t').innerText()).trim();
  must(/#\d+/.test(txt) && /^[SABCD]$/.test(tier), 'show page badge shows rank and tier', `${tier} ${txt}`);
  await shot('4-show-badge');

  await page.waitForTimeout(500);
  must(problems.length === 0, 'no console errors', problems.slice(0, 5).join(' | '));
} catch (e) {
  reason = e instanceof Fail ? e.message : e.message.split('\n')[0];
  if (problems.length) reason += ` (also: ${problems.slice(0, 3).join(' | ')})`;
  if (netfails.length) console.log('  http failures: ' + netfails.slice(0, 8).join(', '));
  await shot('failure');
  console.log(`  FAIL ${reason}`);
} finally {
  writeFileSync(join(art, 'result.json'), JSON.stringify({ passed: !reason, reason, checks: checks.length, detail: checks }, null, 2));
  await browser.close();
}
process.exit(reason ? 1 : 0);
