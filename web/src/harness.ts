// Dev-only: mounts the Jellyfin home pane with demo data inside a mock home screen (web/harness.html).
import { mount } from 'svelte';
import tokens from './lib/ui/tokens.css?inline';
import { DemoBackend } from './lib/demo';
import { RankBox } from './lib/store.svelte';
import HomePane from './inject/HomePane.svelte';

const host = document.getElementById('slot')!;
host.className = 'verticalSection';
const root = host.attachShadow({ mode: 'open' });
const style = document.createElement('style');
style.textContent = tokens + ':host{display:block}*{box-sizing:border-box}button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer}';
root.append(style);
mount(HomePane, { target: root, props: { rb: new RankBox(new DemoBackend()), appUrl: '/' } });
