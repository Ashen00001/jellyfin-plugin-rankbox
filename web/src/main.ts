import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { ApiBackend, authFromJellyfinStorage, type Backend } from './lib/api';
import { DemoBackend } from './lib/demo';
import { RankBox } from './lib/store.svelte';

// Served by Jellyfin at <base>/RankBox/App → real data. Opened any other way → demo with sample data.
const m = location.pathname.match(/^(.*)\/RankBox\/App/i);
const forceDemo = new URLSearchParams(location.search).has('demo');
let backend: Backend;
let signedOut = false;
if (m && !forceDemo) {
  const auth = authFromJellyfinStorage(location.origin + m[1]);
  if (auth) backend = new ApiBackend(auth);
  else { backend = new DemoBackend(); signedOut = true; }
} else {
  backend = new DemoBackend();
}

const rb = new RankBox(backend);
const params = new URLSearchParams(location.search);
const list = (['series', 'movies', 'all'] as const).find((l) => l === params.get('list')) ?? 'series';

mount(App, { target: document.getElementById('app')!, props: { rb, signedOut, jellyfinBase: m ? location.origin + m[1] : '' } });

if (!signedOut) {
  rb.start(list).then(() => {
    const rank = params.get('rank');
    if (rank) {
      void rb.rankNow({ id: rank, list });
      try { history.replaceState(null, '', location.pathname + location.hash); } catch { /* sandboxed */ }
    }
  });
}
