<script lang="ts">
  import { hueOf, initials } from './format';

  let { name, src = '', year = null, size = 'md', alt = '' }: {
    name: string;
    src?: string;
    year?: number | null;
    size?: 'xl' | 'lg' | 'md' | 'sm' | 'xs';
    alt?: string;
  } = $props();

  let failed = $state(false);
  const hue = $derived(hueOf(name));
  const showTitle = $derived(size === 'xl' || size === 'lg' || size === 'md');
</script>

<div class="poster {size}" style="--h:{hue}">
  <!-- designed fallback sits underneath; the real poster covers it once it loads -->
  <div class="ph" aria-hidden="true">
    {#if showTitle}
      <span class="yr">{year ?? ''}</span>
      <span class="t">{name}</span>
    {:else}
      <span class="in">{initials(name)}</span>
    {/if}
  </div>
  {#if src && !failed}
    <img {src} alt={alt || name} loading="lazy" decoding="async" onerror={() => (failed = true)} />
  {/if}
</div>

<style>
  .poster {
    position: relative;
    aspect-ratio: 2 / 3;
    max-width: 100%;
    border-radius: var(--rb-radius-sm);
    overflow: hidden;
    background: var(--rb-surface-2);
    isolation: isolate;
    flex: none;
  }
  .poster.xs { width: 30px; border-radius: 5px; }
  .poster.sm { width: 42px; border-radius: 6px; }
  .poster.md { width: 100%; }
  .poster.lg, .poster.xl { width: 100%; border-radius: var(--rb-radius); }
  .ph {
    position: absolute; inset: 0;
    display: flex; flex-direction: column; justify-content: space-between;
    padding: 9% 9% 10%;
    background:
      radial-gradient(120% 70% at 20% 0%, hsl(var(--h) 70% 62% / .55), transparent 60%),
      linear-gradient(165deg, hsl(var(--h) 42% 30%), hsl(calc(var(--h) + 40) 48% 12%));
    color: hsl(var(--h) 60% 94%);
  }
  .ph .yr { font: 600 .72em/1 var(--rb-font-body); letter-spacing: .14em; opacity: .7; align-self: flex-end; }
  .ph .t {
    font: 800 1.45em/0.95 var(--rb-font-display);
    text-transform: uppercase; letter-spacing: .01em;
    overflow-wrap: anywhere;
    display: -webkit-box; -webkit-line-clamp: 5; line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden;
  }
  .poster.md .ph .t { font-size: 1.1em; }
  .ph .in { margin: auto; font: 800 14px/1 var(--rb-font-display); letter-spacing: .04em; }
  .poster.xs .ph .in { font-size: 11px; }
  .ph:has(.in) { padding: 0; justify-content: center; }
  img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
</style>
