# PWA Addition — Scoping Proposal

Status: **scoping document only. No schema, migration, dependency, manifest,
service-worker, or application code was written or changed to produce this.**
Read `CLAUDE.md` in full (Tech Stack, Environment & Supabase Setup, Security
Notes, Deployment, and AI Philosophy sections in particular) before acting on
anything below. This document deliberately mirrors the structure and voice of
`docs/SCHEDULING_MODULE_SCOPING.md` and `docs/CLINICAL_WRITING_MODULE_SCOPING.md`
— same discipline ("map what's real, propose a target, recommend a minimum
first slice, flag every non-goal"), applied to a PWA/installability layer
instead of a data module. There is no schema or migration dimension to this
question, so §§2-5 replace those documents' "target schema" and "migration
paths" sections with the equivalent questions for this domain: what a real
PWA addition needs to contain, and which implementation approach to take.

---

## 0. The question this answers

A user request confirmed, via direct code inspection (not assumption), that
**zero PWA groundwork exists in this repo today** — no manifest, no service
worker, no PWA build tooling, no registration code anywhere. This document
maps that current state precisely, investigates the two real hazards a naive
PWA addition would create in this specific app (a false offline-data promise,
and a static-manifest vs. session-aware-branding mismatch), and recommends a
minimum, honest first slice — installable, fast on repeat load, explicit
about what it does and does not do offline — without writing any of it.

This app is a pure static SPA with a live, 100%-Supabase-dependent data layer
(`databaseService.isMock` hardcoded `false`, no mock/offline layer — per
CLAUDE.md's Environment & Supabase Setup section) and no RLS-based
per-request server session model that could make caching safe (CLAUDE.md's
Security Notes: the anon key is a shared secret, not a per-user credential,
and most tables are `USING (true)` — see §2 below for why this matters to a
caching strategy, not just an auth strategy). Both facts constrain what an
honest PWA here can claim to do.

---

## 1. Current-state map

Confirmed by direct inspection of the actual worktree, not assumed:

- **`package.json`**: no `vite-plugin-pwa`, no `workbox-*` package, in either
  `dependencies` or `devDependencies`. Full dependency list is small and
  deliberate (`@supabase/supabase-js`, `@tailwindcss/vite`,
  `@vitejs/plugin-react`, `lucide-react`, `react`, `react-dom`,
  `react-router-dom`, `vite`) — CLAUDE.md's own "Note on dependencies"
  section already documents this repo's history of removing unused
  dependencies rather than accumulating them; a PWA addition should keep that
  discipline (one plugin, not a grab-bag of workbox sub-packages).
- **`index.html`**: no `<link rel="manifest">`, no `<meta name="theme-color">`,
  no apple-touch-icon links, no inline service-worker registration `<script>`.
  It is a minimal shell — `<title>PrivyDoc Workspace</title>`, a `#root` div,
  and the Vite module entry script. Nothing PWA-adjacent at all.
- **`vite.config.ts`**: two plugins only (`@vitejs/plugin-react`,
  `@tailwindcss/vite`), a path alias, HMR/watch toggling for the AI Studio
  dev environment, and a `manualChunks` vendor-splitting function for build
  output. No `base` path override (defaults to `/`, consistent with the
  Netlify/Cloud Run root-domain deploy targets CLAUDE.md's Deployment section
  describes — no PWA scope complication from a non-root base path). No
  PWA-plugin config of any kind.
- **No `public/` directory exists in this repo at all.** Vite's convention is
  to serve `public/*` at the site root unprocessed — exactly where a
  `manifest.json`, `favicon.ico`, and PWA icon set would normally live — but
  this repo has never had one. There is an `assets/` directory, but it
  contains only `assets/.aistudio/.gitignore` (an empty placeholder left over
  from the Google AI Studio scaffold this project was bootstrapped from, per
  CLAUDE.md's own "Note on dependencies" section) — not a real asset pipeline.
- **Repo-wide grep for `manifest.json`, `serviceWorker`, `service-worker`,
  `workbox`, `vite-plugin-pwa`, and `offline`** across `src/`, `index.html`,
  and `vite.config.ts` returns zero matches. There is no partial or abandoned
  PWA attempt to build on top of — this is a true blank slate, not a gap in
  an existing effort.

### 1.1 The icon-asset gap — real, and needs the user, not fabrication

**No app icon, logo mark, or favicon file exists anywhere in this repository**
— confirmed by a repo-wide search for `.ico`/`.png`/`*logo*`/`*icon*`/
`*favicon*` files (excluding `node_modules`/`dist`/`.git`), which returned
nothing. The closest thing to a visual brand mark in the codebase today is
`src/modules/shared/config/branding.ts`'s `logoInitials: 'PD'` — a two-letter
initials string rendered as text inside a CSS badge in the Navbar, not an
image file of any kind (confirmed by reading that file in full — see §3
below).

A PWA manifest's `icons` array requires real raster image files (conventionally
a 192×192 and a 512×512 PNG at minimum, ideally also a maskable variant) —
"PD" as literal rendered text is not something `manifest.json` can reference.
Per CLAUDE.md's own "Sourcing module content" policy (*"don't silently
fabricate or guess at documents that should be authoritative... if a needed
[asset] can't be reliably found/verified, ask the user for it explicitly"*) —
written about rubrics/templates/curricula, but the same reasoning applies
here: a home-screen icon is the single most visible, most brand-defining
asset a PWA has, and generating a placeholder logo unilaterally (an AI-drawn
mark, a generic default icon, a plain colored square) would bake a fabricated
visual identity into something users literally see on their phone's home
screen. **This needs Dr. Olanipekun to supply a real icon/logomark**
(existing PrivyDoc branding artwork, if any exists outside this repo, or a
fresh design decision) before a manifest can be built with real icons. Until
then, any "first slice" implementation is blocked on this asset specifically
— noted again in §6/§7 below, not just here.

---

## 2. The offline-data problem, specifically

### 2.1 What `databaseService.ts` actually does on failure

Read in full for this document. Two distinct failure modes exist, and they
behave differently — worth being precise about, since "does it throw or
reject" changes what a service worker can safely paper over:

- **Missing configuration** (`VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` not
  set at build time): `checkSupabase()` throws **synchronously** the moment
  any data-service function is called — a real `Error` thrown from ordinary
  JS control flow, not a rejected promise. This is not the failure mode a
  PWA needs to worry about (env vars are baked in at Vite build time; if
  they're present in the shipped bundle, they stay present), but it confirms
  there genuinely is no fallback path even for this simpler case — an error
  is meant to surface, not be silently absorbed.
- **Network/runtime failure while the app is otherwise configured correctly**
  (the real "installed PWA with no internet" case): every `databaseService`
  function is `async` and calls into `@supabase/supabase-js`, which performs
  its own `fetch()` under the hood. A network failure here **rejects the
  returned promise** — it does not throw synchronously into the calling
  component's render path. This is the actually-relevant behavior for a PWA:
  an offline Supabase call is a rejected promise a component's own
  `try/catch` has to handle, exactly like any other async failure in this
  codebase already.

### 2.2 There is no existing "you're offline" UI state to reuse

Grepped `src/` for `navigator.onLine`, `isOnline`, `NetworkError`, and
`ErrorBoundary`/`componentDidCatch` — the only `ErrorBoundary`-shaped match in
the entire codebase is a local one-off inside
`src/modules/org-admin/components/ChiefDashboardView.tsx`, not an app-wide
boundary. Reading `App.tsx`'s own error-handling pattern directly (its
`onAuthStateChange`/`refreshSubadminRoles` handlers) confirms the norm: a
failed async Supabase call is caught locally and `console.warn`'d — there is
no global toast, banner, or "you appear to be offline" UI anywhere in this
app today. Individual views manage their own local `error`/`loading` state
per-component, inconsistently, with no shared primitive.

This matters directly for scoping honesty: **a PWA installed today, opened
with no network, would show the app shell (React mounts fine — it's a static
bundle) and then silently fail every single data call**, each screen either
staying in an indefinite loading state or surfacing whatever ad hoc local
error message that particular view happens to have (many have none). That is
a materially worse experience than the current tab-in-a-browser behavior,
where a user who's actually offline typically also can't load the page shell
at all and gets a clear browser-level "no internet" message instead of a
misleadingly-normal-looking broken app.

### 2.3 Recommendation for this specific problem

**Ship an app-shell-only PWA: cache static assets (JS/CSS/the HTML shell) for
fast installs and fast repeat loads, and do NOT claim or attempt offline data
functionality.** Concretely, this means:

- The service worker's precache/runtime-cache scope covers only build
  output — hashed `/assets/*` JS/CSS chunks, the `index.html` shell, and the
  manifest/icons themselves. It never touches Supabase REST/Storage traffic.
- Because there is genuinely no existing offline-aware UI state to hook into
  (§2.2), a real "you're offline" experience needs **new, minimal UI**, not
  just service-worker config — at minimum, a lightweight `navigator.onLine`
  listener (or a fetch-failure boundary) somewhere central enough to catch
  the installed-standalone-with-no-network case and show one honest message
  ("You're offline — reconnect to load your data") instead of a silently
  broken shell. This is real, if small, application-code work, not just
  build config — flagged explicitly in §7, not bundled into "just add a
  manifest."
- No claim of "works offline" appears anywhere in the manifest description,
  install prompt copy, or marketing language this or any future pass writes.
  This is the same honesty standard CLAUDE.md already holds this app to
  elsewhere (e.g. the AI Copilot `source`/`provider` badging that never lets
  a heuristic fallback masquerade as a real AI response) — a PWA that quietly
  overpromises offline capability would be a worse regression than not
  having a PWA at all.

---

## 3. Branding/manifest naming tension

### 3.1 The tension, confirmed against the real code

Read `src/modules/shared/config/branding.ts` in full. Three profiles exist:

- `B2B_UCH_BRAND` — `productName: 'PrivyDoc Workspace — UCH Family Medicine'`,
  the currently-active profile for all session-agnostic, pre-login UI
  (`getActiveBrand()` always returns this one — domain-based branching was
  retired in the 2026-08-14 UX pass, per that file's own header comment).
- `B2C_INDEPENDENT_BRAND` — `productName: 'PrivyDoc Medical Workspace'`, shown
  only in `getFooterBrand()` for an authenticated, unlinked individual-doctor
  session.
- `NEUTRAL_BRAND` — `productName: 'PrivyDoc Workspace'`, `orgLabel: ''` — added
  2026-08-16 specifically to fix a real bug where the footer showed
  "PrivyDoc — UCH Family Medicine" before login or after logout (when there
  is, in fact, no organization or personal context to attribute the session
  to yet). Its own comment states the philosophy plainly: *"nobody is signed
  in yet, so there is no organization or individual name to show."*

A `manifest.json`'s `name`/`short_name`/`icons` are **static files, baked at
build time, with no runtime session awareness whatsoever** — the installed
home-screen icon and app name are fixed the moment the app is built and
deployed, for every visitor, regardless of who (if anyone) later logs in on
that device. There is no mechanism by which an installed PWA's icon or label
could dynamically become "PrivyDoc Workspace — UCH Family Medicine" only
after a UCH resident logs in, then change again for a different tenant's
Chief on a different device — a manifest is not a per-session artifact the
way `getFooterBrand(session)` is.

### 3.2 Recommendation

**Use `NEUTRAL_BRAND`'s values (`'PrivyDoc Workspace'`) for the manifest's
`name`/`short_name`, never `B2B_UCH_BRAND`'s tenant-qualified name.** This is
not a new design decision invented for this document — it is the direct,
one-line extension of the exact philosophy the 2026-08-16 `NEUTRAL_BRAND` fix
just established for the footer: *neutral until there is a real, specific
session to attribute the branding to.* A manifest has no session, ever — it
is permanently in the "nobody is signed in yet" state from the browser's
perspective — so it should permanently use the neutral name, the same way
the footer does before login.

This also sidesteps a real correctness risk a tenant-qualified manifest name
would create: if a second, non-UCH tenant is ever provisioned (the
self-serve org flow `CreateOrganizationView.tsx`/`AdminPortalChooserView.tsx`,
migration 24, already supports — see CLAUDE.md's Branding & Routing section),
every device that installed the PWA before that tenant existed would be
permanently stuck with a "UCH Family Medicine"-branded home-screen icon
regardless of which org actually uses that install — there is no way to
retroactively re-brand an already-installed PWA's icon short of the user
reinstalling it. A neutral, product-level name has no such staleness
failure mode. `theme-color`/`background-color` meta values should likewise
use whatever this app's existing neutral/global visual tokens are (not a
tenant-specific accent), for the same reason.

**One open question this document does not resolve**: whether the manifest's
`icons` should use a generic "PD" mark (once a real icon file exists per
§1.1) or something more elaborate — that's a design question for whoever
supplies the icon asset, not a branding-logic question this document's
`NEUTRAL_BRAND`-vs-`B2B_UCH_BRAND` analysis needs to settle.

---

## 4. HashRouter + service worker `start_url`/navigation interaction

### 4.1 Investigated, not assumed

Confirmed `App.tsx` still uses `HashRouter` (`import { HashRouter as Router
... } from 'react-router-dom'`, line 2) — CLAUDE.md's own Tech Stack claim is
current, not stale. Checked both SPA-fallback configs a service worker's own
navigation handling would need to cooperate with, per this task's own
framing:

- **`netlify.toml`**: a single `[[redirects]]` rule, `/* → /index.html`,
  status `200` — every path serves the same shell.
- **`nginx.conf`** (Cloud Run container): `location / { try_files $uri $uri/
  /index.html; }` for the general case, plus a dedicated `location =
  /index.html` block that explicitly sets `Cache-Control: no-cache` on the
  shell itself — its own comment states the reasoning directly: *"The HTML
  shell must never be cached — it is what points at the latest hashed
  bundle."* Its SPA-fallback comment is also explicit that this same
  `try_files` fallback is written to cover **both** the current `HashRouter`
  scheme and *"any future switch to path-based routing"* — i.e. this was
  already reasoned about once, deliberately, by whoever wrote `nginx.conf`.

### 4.2 Conclusion: not a real complication, for the reason the task anticipated

Both hosts always resolve every request path to the same single
`index.html`, unconditionally — `#/whatever` is parsed entirely client-side
by `react-router-dom` after the document loads; the server (Netlify's edge
redirect, nginx's `try_files`) never sees the fragment at all, since the URL
fragment is never sent in an HTTP request by any browser. This means:

- A manifest's `start_url` should simply be `/` (or `/#/`, equivalently,
  since a browser installing/launching the PWA would land on the same shell
  either way and `react-router-dom`'s own session-restore logic in `App.tsx`
  already handles picking the right view from `localStorage` session state
  on load, independent of the URL). No special-casing needed.
- A service worker's own navigation-fallback strategy (whether hand-written
  or generated by `vite-plugin-pwa`'s `generateSW`/`injectManifest` modes)
  needs exactly one rule: **any navigation request that doesn't match a
  precached static asset falls back to the cached `index.html` shell** — the
  same "always serve the shell, let the client-side router sort out the
  rest" behavior both `netlify.toml` and `nginx.conf` already implement
  server-side. This is the standard, default behavior of
  `vite-plugin-pwa`'s SPA navigation-fallback mode, not a custom rule this
  app would need to invent.
- The one thing worth flagging, not because it's broken but because it's a
  behavior change to be deliberate about: once a service worker owns the
  shell, `index.html`'s `no-cache` header (nginx) stops being the only
  freshness mechanism — the service worker's own update lifecycle
  (`skipWaiting`/`clientsClaim` or a user-facing "update available" prompt)
  becomes an *additional* layer controlling when a returning visitor actually
  sees a new deploy. This needs an explicit choice (silent auto-update vs.
  a user-visible "refresh to update" prompt) during implementation — flagged
  here as a real decision point, not resolved by this document.

**Plain answer to the question this section asks: no, `HashRouter` does not
create a real complication for `start_url`/navigation-fallback strategy.**
The hash is client-side only, exactly as anticipated, and both existing
server configs already independently converged on the "always serve the
shell" behavior a service worker needs to mirror, not fight.

---

## 5. Recommended approach: `vite-plugin-pwa` vs. hand-rolled

### 5.1 `vite-plugin-pwa` (recommended)

The standard, actively-maintained Vite integration for PWA tooling, built on
Workbox. Generates the manifest from a typed config object (co-located in
`vite.config.ts`, consistent with how this repo already configures its other
two plugins), generates and injects the service-worker registration script,
and handles precache-manifest generation (content-hashed asset list, cache
versioning/invalidation on each build) automatically — the exact
content-hash-based cache-busting `nginx.conf`'s own comment already relies on
for `/assets/*` (*"Vite emits content-hashed filenames... safe to cache
forever; a new deploy produces new hashes"*), so a Workbox-generated precache
manifest is consistent with, not a new parallel idea next to, this repo's
existing caching philosophy.

**Why not hand-roll a manifest + service worker instead**: a hand-written
service worker needs to reimplement precache-list generation, cache
versioning/cleanup on each deploy, and the navigation-fallback logic §4
describes, all by hand, and keep it in sync with Vite's build output on every
change — real, ongoing maintenance surface for a solved problem. This repo's
own stated dependency discipline (CLAUDE.md's "Note on dependencies" section)
is about not carrying *unused* dependencies, not about avoiding
well-maintained ones that do real, non-trivial work — `vite-plugin-pwa` is
the same category of choice as already depending on `@supabase/supabase-js`
rather than hand-rolling REST calls to PostgREST.

### 5.2 Caching strategy per resource type

- **Static build assets** (`/assets/*` hashed JS/CSS, the manifest, icon
  files): **cache-first with the build's own content-hash versioning** —
  exactly matching `nginx.conf`'s existing `Cache-Control: public,
  max-age=31536000, immutable` policy for the same files. This is the one
  resource class genuinely safe to cache aggressively, since a new deploy
  always produces new hashed filenames rather than mutating an existing one.
- **The HTML shell** (`index.html`): **network-first with a cached fallback**
  (Workbox's `NetworkFirst` strategy, short timeout) — mirrors
  `nginx.conf`'s own explicit `no-cache` policy on this exact file (*"must
  never be cached — it is what points at the latest hashed bundle"*) while
  still letting an offline/slow-network launch fall back to whatever shell
  was last cached, which is exactly the "installable, fast repeat load"
  property this document is scoping for.
- **Supabase REST/Storage/Edge Function calls** (`*.supabase.co/rest/v1/*`,
  `/storage/v1/*`, `/functions/v1/*`): **network-only, no service-worker
  caching or offline fallback whatsoever.** This is the direct, load-bearing
  consequence of §2's analysis and this task's own explicit instruction —
  **do not cache Supabase REST responses as if they were safely
  offline-servable.** Per CLAUDE.md's Security Notes, most RLS policies in
  this schema are `USING (true)` for the shared anon key, with real
  `auth.uid()`-scoped boundaries existing only on a handful of doctor-owned
  tables (§ "Real `auth.uid()`-scoped RLS boundaries do exist for a few
  tables" in CLAUDE.md) — there is no per-user session boundary a cached
  response could safely respect anyway, and staler-than-the-server data
  (a resident's submission status, a Chief's roster draft, an AI quota
  count) served from a service-worker cache while claiming to be current
  would be actively misleading in a way this app's data has no tolerance
  for (monthly deadlines, published rosters, billing/quota state). Workbox's
  `NetworkOnly` strategy (i.e., explicitly *not* intercepted/cached) is the
  correct configuration for this entire traffic class.

---

## 6. Recommendation

**Ship an installable, app-shell-only PWA now — manifest + icons (once
supplied, see §1.1) + `vite-plugin-pwa` with the §5.2 caching split — with
true offline data functionality explicitly deferred, not attempted.**

Justification against this repo's own stated values (CLAUDE.md's AI
Philosophy section):

- **"Silent scope creep is not acceptable."** A PWA that silently implies
  "works offline" via its very existence (install prompts, an app icon,
  standalone-window chrome all read to a user as "this is a real app that
  works like one") while actually breaking every data call with no network
  is the scope-creep failure mode in reverse — overclaiming a capability
  nobody built. The app-shell-only framing, plus the explicit "you're
  offline" UI this document flags as necessary new work (§2.3), keeps the
  claim honest and matched to what's actually shipped.
- **Matches this app's existing degrade-gracefully patterns.** Every AI
  Copilot Edge Function in this app already follows a strict
  never-silently-break philosophy — OpenAI → Gemini → deterministic
  heuristic fallback, every result honestly labeled `source`/`provider` so
  the UI never claims a heuristic answer is a real AI response (CLAUDE.md's
  AI/Edge Functions section, repeated across all four Copilot functions).
  This document's §2.3 recommendation is the same instinct applied to
  network state instead of AI-provider state: degrade honestly, label the
  degraded state clearly, never let a fallback path masquerade as the real
  thing.
- **Real, immediate, low-risk value.** Fast repeat loads and installability
  (add-to-home-screen, standalone window chrome) are genuinely useful for a
  workforce-data tool residents and Chiefs open repeatedly on mobile — and
  the static-asset-only caching scope touches zero application logic,
  zero Supabase calls, and zero existing components (beyond the small new
  "you're offline" indicator flagged in §7). This is the same
  additive-first, minimal-blast-radius instinct
  `SCHEDULING_MODULE_SCOPING.md` and `CLINICAL_WRITING_MODULE_SCOPING.md`
  both independently reached for their own domains.
- **Deferring true offline data is the disciplined choice, not a cop-out.**
  This app has no local cache/mock data layer to build real offline reads on
  top of (`databaseService.isMock` hardcoded `false`, per CLAUDE.md), and its
  trust model (shared anon key, mostly-permissive RLS) has no clean story
  for "which cached rows is this specific device even allowed to have."
  Building real offline data support would mean designing a local data
  store, a sync/conflict-resolution strategy, and an offline-write queue —
  a project on the scale of the Scheduling or Clinical Writing module
  build-outs this session already scoped separately, not something to fold
  into "add a manifest."

---

## 7. Minimum first slice

What a first, honest PWA pass needs to include to be real and not
half-built — versus what's explicitly deferred.

### 7.1 Blocked on a real asset (flagged first, since it gates everything else)

- **A real app icon/logomark from Dr. Olanipekun** (§1.1) — at minimum
  source art that can be exported to 192×192 and 512×512 PNG (plus a
  maskable-safe variant, ideally). No manifest can ship with fabricated
  artwork per CLAUDE.md's sourcing-content policy, applied here to visual
  brand assets rather than text content.

### 7.2 In scope for a first slice (once the icon exists)

- Add `vite-plugin-pwa` as a devDependency, configured in `vite.config.ts`
  alongside the existing two plugins.
- `manifest.json` (or inline-generated by the plugin) using `NEUTRAL_BRAND`'s
  `name`/`short_name` values (§3.2) — never a tenant-qualified name.
- `start_url: '/'`, `display: 'standalone'`, the real icon set, a
  `theme-color` matching this app's existing neutral visual tokens.
- Service worker registered, static-asset-only precache + `NetworkFirst` for
  the shell + `NetworkOnly` for all Supabase traffic, per §5.2's split
  exactly.
- **A small, new, explicit "you're offline" UI state** (§2.3) — the one
  piece of real application code in this slice, not just build config. Scope
  it narrowly: a `navigator.onLine`-driven banner or a shared fetch-failure
  indicator central enough to catch the installed-standalone-with-no-network
  case, with copy that says plainly "you're offline, reconnect to load your
  data" — not a full offline-aware redesign of every view's error states.
- A basic install-prompt affordance (a button or banner using the
  `beforeinstallprompt` event) is reasonable to include in this same slice —
  small, and it's the entire point of "installable" — but is not
  load-bearing to the recommendation above; could equally be left to browser
  default install-menu behavior if minimizing this slice further is
  preferred.

### 7.3 Explicitly deferred, not attempted in this slice

- **Any real offline data functionality** — reading, drafting, or queuing
  writes (a resident's rotation submission, a Chief's roster edit) while
  disconnected, then syncing later. No local data store, no
  conflict-resolution strategy, no offline write queue.
- **Background sync** (Workbox's Background Sync API) — meaningless without
  an offline-write queue to flush, which is itself deferred above.
- **Push notifications** — a materially separate feature (needs its own
  opt-in UX, a push-subscription table, and a server-side trigger path) with
  no existing groundwork or user request driving it; not scoped here at all.
- **Per-tenant manifest branding** — ruled out entirely, not just deferred,
  per §3.2's reasoning (a static manifest cannot be session-aware; there is
  no future version of this that becomes possible without a fundamentally
  different distribution model, e.g. per-tenant subdomains each serving
  their own build).
- **Any claim, in-app copy, install-prompt text, or store-listing-style
  language, that this app "works offline."** It does not, and this slice
  does not attempt to make that true.

---

## 8. Explicit non-goals for now

- **No manifest, service worker, icon file, dependency, or application code
  was written or changed to produce this document.** This is scoping only.
- **No table was queried and no schema question applies** — this is a
  build-tooling/static-asset question, not a data-modeling one; nothing in
  this document implies or requires a migration.
- **Nothing here is authorization to proceed.** Per CLAUDE.md's own AI
  Philosophy ("Silent scope creep is not acceptable... must be called out
  explicitly, not slipped in as a side effect"), implementing any part of
  §7 — including something as small as adding `vite-plugin-pwa` to
  `package.json` — needs its own explicit go-ahead from Dr. Olanipekun
  before a single line of code, config, or dependency is written. This
  document exists to make that conversation possible, not to preempt it.
- **The icon-asset gap (§1.1/§7.1) is a hard blocker, not a preference** —
  no placeholder or AI-generated mark should be substituted for it even as a
  "temporary" measure, per CLAUDE.md's sourcing-content policy.
- **The service-worker update-lifecycle choice (§4.2's closing point —
  silent auto-update vs. a user-facing "update available" prompt) is flagged
  as a real decision point, not resolved here.**
- **Whether to include the small install-prompt affordance (§7.2's last
  bullet) in the very first slice or leave it to browser-default install
  behavior is left as an open, low-stakes implementation choice, not decided
  by this document.**
