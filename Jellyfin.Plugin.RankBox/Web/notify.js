/* RankBox banner: a small card that slides down from the top of Jellyfin's web app.
   - "Just finished X, where does it rank?"   (after finishing or marking watched)
   - "You rated X over Y, still agree?"        (recency check, ~3 weeks later)
   Never full screen, never during playback, one at a time. */
(function () {
  'use strict';
  if (window.__rankboxBanner) return;
  window.__rankboxBanner = true;

  var POLL_MS = 30000;
  var SHOW_MS = 20000;
  var MAX_RECHECKS_PER_DAY = 3;
  var SEEN_KEY = 'rankbox.banner.seen';
  var DAY_KEY = 'rankbox.banner.day';
  var showing = false;
  var timer = null;

  function client() { return window.ApiClient && window.ApiClient.accessToken && window.ApiClient.accessToken() ? window.ApiClient : null; }
  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }
  function seen() { return store(SEEN_KEY) || []; }
  function markSeen(key) { var s = seen().filter(function (k) { return k !== key; }); s.push(key); store(SEEN_KEY, s.slice(-300)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function thumb(c, id) { return c.getUrl('Items/' + id + '/Images/Primary', { maxHeight: 120, quality: 90 }); }
  function appUrl(c, q) { return c.getUrl('RankBox/App') + (q ? '?' + q : ''); }
  function playing() {
    var v = document.querySelector('.videoPlayerContainer:not(.hide), video');
    return !!(v && v.offsetParent !== null) || /#\/?video/.test(location.hash);
  }
  function rechecksToday() {
    var d = store(DAY_KEY) || {}; var today = new Date().toDateString();
    return d.day === today ? d.n : 0;
  }
  function countRecheck() {
    var today = new Date().toDateString(); var d = store(DAY_KEY) || {};
    store(DAY_KEY, { day: today, n: (d.day === today ? d.n : 0) + 1 });
  }

  function css() {
    if (document.getElementById('rankbox-banner-css')) return;
    var s = document.createElement('style');
    s.id = 'rankbox-banner-css';
    s.textContent =
      '#rankbox-banner{position:fixed;left:50%;top:calc(10px + env(safe-area-inset-top));z-index:99999;' +
      'transform:translate(-50%,-140%);transition:transform .35s cubic-bezier(.2,.9,.3,1.2),opacity .3s;opacity:0;' +
      'width:min(420px,calc(100vw - 20px));background:rgba(24,24,31,.97);color:#ececf3;border:1px solid #34344a;' +
      'border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.45);padding:10px;display:flex;gap:10px;align-items:center;' +
      'font:14px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;backdrop-filter:blur(10px)}' +
      '#rankbox-banner.in{transform:translate(-50%,0);opacity:1}' +
      '#rankbox-banner .rb-th{display:flex;gap:3px;flex:none}' +
      '#rankbox-banner .rb-th img{width:34px;height:51px;object-fit:cover;border-radius:5px;background:#2a2a38}' +
      '#rankbox-banner .rb-tx{flex:1;min-width:0}' +
      '#rankbox-banner .rb-k{font-size:11px;color:#a78bfa;text-transform:uppercase;letter-spacing:.5px;margin-bottom:1px}' +
      '#rankbox-banner .rb-t{overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}' +
      '#rankbox-banner .rb-t b{color:#fff}' +
      '#rankbox-banner .rb-b{display:flex;gap:6px;margin-top:7px;flex-wrap:wrap}' +
      '#rankbox-banner button{font:inherit;font-size:12.5px;font-weight:600;border:0;border-radius:8px;padding:6px 11px;cursor:pointer;color:#fff;background:#8b5cf6}' +
      '#rankbox-banner button.rb-g{background:#2c2c3c;color:#ececf3}' +
      '#rankbox-banner .rb-x{position:absolute;top:4px;right:6px;background:none;color:#8f8fa3;padding:2px 6px;font-size:16px}';
    document.head.appendChild(s);
  }

  function show(html, onClick) {
    css();
    var el = document.createElement('div');
    el.id = 'rankbox-banner';
    el.setAttribute('role', 'status');
    el.innerHTML = html + '<button class="rb-x" data-a="close" aria-label="Close">×</button>';
    document.body.appendChild(el);
    showing = true;
    requestAnimationFrame(function () { requestAnimationFrame(function () { el.classList.add('in'); }); });

    var startY = null;
    el.addEventListener('touchstart', function (e) { startY = e.touches[0].clientY; }, { passive: true });
    el.addEventListener('touchmove', function (e) { if (startY !== null && startY - e.touches[0].clientY > 25) close(); }, { passive: true });
    el.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-a]');
      if (!b) return;
      var a = b.getAttribute('data-a');
      if (a === 'close') return close();
      Promise.resolve(onClick(a, el)).then(function (keepOpen) { if (!keepOpen) close(); });
    });
    var t = setTimeout(close, SHOW_MS);
    el.addEventListener('mouseenter', function () { clearTimeout(t); });

    function close() {
      clearTimeout(t);
      el.classList.remove('in');
      setTimeout(function () { el.remove(); showing = false; }, 400);
    }
  }

  function finishedBanner(c, f) {
    var key = 'f:' + f.Id + ':' + f.FinishedAt;
    markSeen(key);
    var already = f.RankedAt ? ' It\'s #' + f.RankedAt + ' on your list right now.' : '';
    show(
      '<div class="rb-th"><img src="' + thumb(c, f.Id) + '" alt="" onerror="this.style.visibility=\'hidden\'"></div>' +
      '<div class="rb-tx"><div class="rb-k">RankBox · just finished</div>' +
      '<div class="rb-t">Where does <b>' + esc(f.Name) + '</b> rank?' + esc(already) + '</div>' +
      '<div class="rb-b"><button data-a="rank">' + (f.RankedAt ? 'Re-rank' : 'Rank it') + '</button>' +
      '<button class="rb-g" data-a="later">Later</button></div></div>',
      function (a) {
        if (a === 'rank') location.href = appUrl(c, 'rank=' + f.Id + '&list=' + f.List);
      });
  }

  function recheckBanner(c, r) {
    markSeen('r:' + r.AnswerId);
    countRecheck();
    var when = new Date(r.AnsweredAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    var fresh = r.FreshId === r.WinnerId ? ' (you\'d just watched it)' : r.FreshId === r.LoserId ? '' : '';
    show(
      '<div class="rb-th"><img src="' + thumb(c, r.WinnerId) + '" alt="" onerror="this.style.visibility=\'hidden\'">' +
      '<img src="' + thumb(c, r.LoserId) + '" alt="" onerror="this.style.visibility=\'hidden\'"></div>' +
      '<div class="rb-tx"><div class="rb-k">RankBox · still agree?</div>' +
      '<div class="rb-t">On ' + esc(when) + ' you rated <b>' + esc(r.WinnerName) + '</b>' + esc(fresh) +
      ' over <b>' + esc(r.LoserName) + '</b>.</div>' +
      '<div class="rb-b"><button data-a="keep">Yes</button><button class="rb-g" data-a="flip">No, flip it</button>' +
      '<button class="rb-g" data-a="skip">Not sure</button></div></div>',
      function (a, el) {
        var q = { list: r.List, answerId: r.AnswerId };
        if (a === 'keep') q.agree = true;
        if (a === 'flip') q.agree = false;
        return c.ajax({ type: 'POST', url: c.getUrl('RankBox/Recheck', q) }).then(function () {
          el.querySelector('.rb-tx').innerHTML = '<div class="rb-k">RankBox</div><div class="rb-t">' +
            (a === 'flip' ? 'Flipped: <b>' + esc(r.LoserName) + '</b> moved above ' + esc(r.WinnerName) + '.' : 'Got it ✓') + '</div>';
          setTimeout(function () { el.querySelector('.rb-x').click(); }, 1800);
          return true;
        }, function () { return false; });
      });
  }

  function poll() {
    var c = client();
    if (!c || showing || document.hidden || playing()) return;
    if (/RankBox|userpluginsettings/i.test(location.href)) return;   // already looking at RankBox
    c.getJSON(c.getUrl('RankBox/Inbox')).then(function (inbox) {
      if (!inbox || showing || playing()) return;
      var s = seen();
      var f = (inbox.Finished || []).filter(function (x) { return s.indexOf('f:' + x.Id + ':' + x.FinishedAt) < 0; })[0];
      if (f) return finishedBanner(c, f);
      if (rechecksToday() >= MAX_RECHECKS_PER_DAY) return;
      var r = (inbox.Rechecks || []).filter(function (x) { return s.indexOf('r:' + x.AnswerId) < 0; })[0];
      if (r) recheckBanner(c, r);
    }, function () { /* plugin missing or signed out: stay quiet */ });
  }

  function soon(ms) { clearTimeout(timer); timer = setTimeout(poll, ms); }

  // marking something watched in Jellyfin: check right after instead of waiting for the next poll
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('button[is="emby-playstatebutton"], .btnPlaystate, [data-action="markplayed"], [data-id="markplayed"]')) soon(2500);
  }, true);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) soon(1500); });
  window.addEventListener('hashchange', function () { soon(2000); });

  setInterval(poll, POLL_MS);
  soon(5000);
})();
