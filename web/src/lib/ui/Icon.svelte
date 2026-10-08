<script lang="ts">
  // Small hand-tuned stroke icons (24px grid) so nothing depends on an icon font.
  let { name, size = 20 }: { name: string; size?: number } = $props();
  const P: Record<string, string> = {
    rank: 'M7 4v16M7 4 3.5 7.5M7 4l3.5 3.5M17 20V4m0 16-3.5-3.5M17 20l3.5-3.5',
    list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
    tiers: 'M4 5h4v4H4zM10 6h10M4 11h4v4H4zM10 12h7M4 17h4v4H4zM10 18h4',
    insights: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
    share: 'M12 15V3m0 0L8 7m4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7',
    up: 'M12 19V5m0 0-6 6m6-6 6 6',
    down: 'M12 5v14m0 0-6-6m6 6 6-6',
    same: 'M5 9h14M5 15h14',
    undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
    skip: 'M5 5l8 7-8 7zM17 5v14',
    eyeoff: 'M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A9.8 9.8 0 0 1 12 5c5 0 9 4.5 10 7a12.6 12.6 0 0 1-3 4.2M6.6 6.6A12.4 12.4 0 0 0 2 12c1 2.5 5 7 10 7a9.6 9.6 0 0 0 5.4-1.6',
    drag: 'M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01',
    redo: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
    x: 'M6 6l12 12M18 6 6 18',
    clock: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
    bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
    star: 'm12 3 2.8 5.8 6.2.9-4.5 4.4 1 6.2L12 17.4l-5.5 2.9 1-6.2L3 9.7l6.2-.9z',
    copy: 'M9 9h10v12H9zM5 15V3h10',
    download: 'M12 3v12m0 0-4-4m4 4 4-4M5 21h14',
    check: 'm5 12 5 5 9-10',
    back: 'M15 18 9 12l6-6',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm9 3-4.3-4.3',
    pin: 'M12 17v5M8 3h8l-1 6 3 3H6l3-3z',
    users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
    sparkle: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6',
  };
</script>

<svg class="ic" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d={P[name] ?? ''} />
</svg>

<style>
  .ic { flex: none; display: block; }
</style>
