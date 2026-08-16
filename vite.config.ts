import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      // App-shell-only installable PWA — see docs/PWA_ADDITION_SCOPING.md for
      // the full scoping rationale. Deliberately does NOT claim or attempt
      // any offline data functionality (this app is 100% live-Supabase, no
      // mock/offline layer — see CLAUDE.md's Environment & Supabase Setup
      // section); only the static build shell (hashed JS/CSS/HTML/icons) is
      // ever cached.
      VitePWA({
        // Silent background update, no custom "update available" prompt UI
        // in this first slice (scoping doc §4.2, resolved here in favor of
        // the simpler option) — nginx.conf/netlify.toml already serve
        // index.html as no-cache, and users navigate between /workspace/*
        // views often enough that a background-updated SW takes effect
        // naturally on next navigation.
        registerType: 'autoUpdate',
        // Never enable the service worker in the dev server — must not
        // interfere with the existing `npm run dev` experience.
        devOptions: {
          enabled: false,
        },
        manifest: {
          // NEUTRAL_BRAND's values (src/modules/shared/config/branding.ts),
          // never B2B_UCH_BRAND's tenant-qualified name — a manifest is a
          // static file with no session to be tenant-aware with (scoping
          // doc §3.2).
          name: 'PrivyDoc Workspace',
          short_name: 'PrivyDoc Workspace',
          start_url: '/',
          display: 'standalone',
          background_color: '#2563eb',
          theme_color: '#2563eb',
          icons: [
            {
              src: 'icons/icon-192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: 'icons/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              // Same 512x512 file legitimately serves both purposes per its
              // maskable-safe design (full-bleed background, monogram+sparkle
              // within the safe-zone circle) — not duplicated as a separate
              // asset.
              src: 'icons/icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          // Static build assets (hashed /assets/*.js/.css, index.html,
          // manifest, icons): precached + cache-first is generateSW mode's
          // default precache behavior for whatever this glob matches in the
          // build output — no separate hand-written cache-first runtime rule
          // needed for this class of asset.
          globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
          // SPA shell fallback for any navigation that isn't a precached
          // asset — mirrors nginx.conf's/netlify.toml's own "always serve
          // the shell, let react-router-dom's HashRouter sort out the rest"
          // behavior (scoping doc §4).
          navigateFallback: '/index.html',
          // Defensive: stop the SPA navigation fallback from ever matching a
          // Supabase URL. Supabase calls are fetch/XHR, not browser
          // navigations, so this shouldn't be reachable in practice — the
          // runtimeCaching NetworkOnly rule below is the mechanism that
          // actually matters (see its comment) — but costs nothing to be
          // explicit about both.
          navigateFallbackDenylist: [/^\/rest\/v1\//, /^\/storage\/v1\//, /^\/functions\/v1\//],
          runtimeCaching: [
            {
              // NetworkFirst (short timeout) for navigation requests — the
              // HTML shell must never be served stale-first, mirroring
              // nginx.conf's explicit `Cache-Control: no-cache` on
              // index.html ("it is what points at the latest hashed
              // bundle"). Falls back to whatever shell was last cached only
              // if the network doesn't respond within networkTimeoutSeconds.
              urlPattern: ({request}) => request.mode === 'navigate',
              handler: 'NetworkFirst',
              options: {
                cacheName: 'html-shell',
                networkTimeoutSeconds: 3,
              },
            },
            {
              // Supabase REST/Storage/Edge Function traffic: NetworkOnly —
              // never cached, never served stale, always hits the network.
              // This is the load-bearing mechanism for the "never cache
              // Supabase responses" requirement (scoping doc §5.2): explicitly
              // registering this pattern with Workbox's router as NetworkOnly
              // guarantees it's provably excluded from caching regardless of
              // any other config, rather than relying on the (also true, but
              // implicit) fact that generateSW mode doesn't intercept
              // cross-origin requests unless a runtimeCaching rule claims
              // them. Most RLS policies in this schema are USING(true) for
              // the shared anon key (see CLAUDE.md Security Notes) — there is
              // no per-user session boundary a cached response could safely
              // respect, and stale data here (submission status, roster
              // drafts, AI quota counts) would be actively misleading.
              urlPattern: ({url}) =>
                url.hostname.endsWith('.supabase.co') &&
                (url.pathname.startsWith('/rest/v1/') ||
                  url.pathname.startsWith('/storage/v1/') ||
                  url.pathname.startsWith('/functions/v1/')),
              handler: 'NetworkOnly',
            },
          ],
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify: file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    build: {
      rollupOptions: {
        output: {
          // Split heavy, rarely-changing vendor code into its own cacheable
          // chunks so no single chunk (app code included) crosses the
          // 500KB warning threshold, and repeat visitors don't re-download
          // vendor code just because app code changed.
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('@supabase')) return 'vendor-supabase';
            if (id.includes('lucide-react')) return 'vendor-icons';
            if (id.includes('react-router')) return 'vendor-router';
            if (id.includes('/react-dom/') || id.includes('/react/') || id.includes('scheduler')) return 'vendor-react';
            return 'vendor';
          },
        },
      },
    },
  };
});
