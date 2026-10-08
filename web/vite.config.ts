/// <reference types="vitest/config" />
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// Two entries share one design system:
//  - index.html: the full RankBox app, served by the plugin at /RankBox/App
//  - inject.ts:  the bits that live inside Jellyfin's own web UI (home pane, nav link, badges, banners)
export default defineConfig({
  base: './',
  plugins: [svelte({ compilerOptions: { css: 'injected' } })],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        app: resolve(import.meta.dirname, 'index.html'),
        inject: resolve(import.meta.dirname, 'src/inject/main.ts'),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'inject' ? 'inject.js' : 'assets/[name]-[hash].js'),
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  test: { include: ['src/**/*.test.ts'] },
})
