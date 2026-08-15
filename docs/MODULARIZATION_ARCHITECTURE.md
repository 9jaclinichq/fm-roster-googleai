# PrivyDoc Workspace — Modularization Architecture

Status: **in progress**, grounded in the actual codebase as of 2026-08-15. Phases 1 (backend
renames) and 2 (`shared/` extraction) are done — see "Rollout phases" for exactly what shipped in
each and how the remaining phases apply safely, since this repo has no automated test suite to
catch a broken mechanical refactor.

## Why this exists

Today the frontend is a flat `src/components/*.tsx` directory of ~30 view files spanning every
domain (auth, resident, chief/org-admin, platform operator, research, casebook, billing) with no
folder boundary between them, and `src/lib/databaseService.ts` is a single 2,978-line file that is
the *only* place Supabase is called from client code — every domain's reads/writes live in one
file. `ChiefDashboardView.tsx` alone is 2,062 lines and inlines the submissions table, workforce
registry, announcements, role delegation, roster manager, customization, and template manager as
tab-switched blocks in one component. The backend (`supabase/functions/`) is already close to
module-shaped (one Edge Function per capability, `_shared/` for cross-function logic) but has no
naming convention tying it back to the frontend modules it serves.

The goal: every domain becomes a **named module** — a folder with its own components, its own slice
of data-access logic, and an explicit public interface — and modules connect to each other only
through those interfaces, never by reaching into another module's internals. Like a plant's
electrical circuit: each module is a self-contained unit, but nothing is orphaned — every module's
inputs and outputs are wired to the modules that need them.

## Scope note — two separate codebases

The directive that produced this document also named **PrivyBrain-2** and **BabsBrain-2**. Neither
exists in this repository. Both are real, but they belong to a *different, unrelated* product in a
sibling repo (`privydoc_prod` — a confidential men's telemedicine platform, see that repo's own
`CLAUDE.md`): `PrivyBrain` is its cross-agent patient/doctor insight system
(`src/utils/agentIntelligence.ts`), and `BabsBrain` is its background orchestration agent
(`agents/babsbrainOrchestrator.ts`). This document covers **PrivyDoc Workspace** (this repo) only.
An equivalent modularization pass for `privydoc_prod`, including those two agents, is out of scope
here and would need its own architecture document written against that codebase's actual files.

## Principles

1. **A module is a folder, not a file.** `components/<view>.tsx` becomes
   `modules/<domain>/components/<View>.tsx` — every domain gets a home, not a naming prefix.
2. **One data-access slice per module, not one shared god-file.** `databaseService.ts` splits along
   the same domain lines as the frontend modules; a module only imports its own slice (plus a
   shared low-level `supabaseClient.ts`), never another module's slice directly.
3. **Cross-module communication happens through explicit contracts**: typed props, a module's
   exported hooks/service functions, or shared types in `modules/shared/types/`. No module reaches
   into another module's internal components or Supabase calls.
4. **Shared UI is its own module**, not duplicated per domain. Buttons, modals, form primitives,
   status badges, loading shells — anything used by 2+ domain modules moves to `modules/shared/ui/`.
5. **A sub-feature that already behaves like an integration (word editing, reference manager,
   knowledge packs, roster parsing, AI copilot panels) is a sub-module of its owning domain module,
   with its own folder**, not a file loose in that domain's root.
6. **The backend Edge Functions already map to domains — name them that way.** Each Edge Function's
   directory name should say which frontend module it serves, and `_shared/` modules should be
   named for the *capability* they provide (already true: `tenantAdaptation.ts`, `casebookRubric.ts`,
   `researchRubric.ts`), not left generic.
7. **Migrations stay a single linear sequence** (`supabase/migrations/NN_*.sql`) — modularizing code
   does not mean modularizing the schema history; that would break this repo's own "apply migrations
   in order" convention and the live DB has no per-module migration table to track it separately.

## Frontend module map (target structure)

```
src/
  modules/
    auth/                         # AUTH MODULE
      components/
        AuthLandingView.tsx
        ResidentLoginView.tsx
        ChiefLoginView.tsx
        DoctorAuthView.tsx
        AdminPortalChooserView.tsx
      lib/
        authService.ts            # login/session slice split out of databaseService.ts:
                                   #   verifyResidentLogin, verifyChiefLogin, doctor auth state,
                                   #   session storage helpers currently inline in App.tsx

    doctors/                      # DOCTORS MODULE (unaffiliated individual-doctor identity)
      components/
        DoctorHomeView.tsx
        CreateOrganizationView.tsx   # doctor-adjacent: self-serve org creation entry point
      lib/
        doctorService.ts          # doctor_profiles CRUD, doctor<->workforce linking

    org-admin/                    # ORGANIZATION ADMIN MODULE (today's "Chief Resident")
      components/
        ChiefDashboardView.tsx    # becomes a thin shell composing the sub-modules below
        dashboard/                # DASHBOARD MODULE — one sub-folder per tab, not one 2k-line file
          SubmissionsPanel.tsx
          PendingResidentsPanel.tsx
          WorkforceRegistryPanel.tsx
          AnnouncementsAdminPanel.tsx
          RoleDelegationPanel.tsx
          KnowledgePacksTab.tsx        # thin wrapper delegating to knowledge-packs sub-module below
          MultiRosterManagerView.tsx
          TenantCustomizationView.tsx
          TemplateManagerView.tsx
          CollectionSettingsPanel.tsx
        ComplianceNudgesView.tsx
        TenantUpgradeCheckoutModal.tsx
      lib/
        orgAdminService.ts        # chief_* RPC calls, workforce/collection/settings CRUD

    platform-operator/            # PLATFORM OPERATOR MODULE
      components/
        SaaSOperatorConsoleView.tsx
      lib/
        operatorService.ts        # platform_operators auth, tenant provisioning/plan changes,
                                   # per-tenant usage analytics query

    form/                         # FORM MODULE (the monthly resident submission form)
      components/
        ResidentFormView.tsx
        ResidentActivityGraph.tsx
      lib/
        formService.ts            # submissions CRUD, leave-document upload

    announcements/
      components/
        AnnouncementBoardView.tsx

    research/                     # RESEARCH MODULE (Universal Research Engine)
      components/
        ResearchWorkspaceView.tsx
      lib/                        # already partially modular — keep, just relocate
        rubricEngine.ts
        templateEngine.ts
        folderStructure.ts
        researchCopilot.ts        # move from lib/ai/ — it's research-module-owned, not generic AI

    casebook-logbook/             # CASEBOOK & CLINICAL LOGBOOK MODULE
      components/
        CasebookWorkspaceView.tsx
        CasebookBuilderView.tsx   # legacy 15-slot MVP — same module, flagged as the older sibling
      lib/
        caseRubricEngine.ts
        familyTools.ts
        casebookCopilot.ts        # move from lib/ai/

    exam-readiness/
      components/
        ExamReadinessView.tsx

    viva-simulator/
      components/
        OralExamSimulatorView.tsx

    consultant-review/
      components/
        ConsultantReviewView.tsx
        GuestReviewView.tsx       # token-based guest path belongs to the same review domain

    dissertation/
      components/
        DissertationAssistantView.tsx
      lib/
        academicCopilot.ts        # move from lib/ai/

    knowledge-packs/              # INTEGRATION SUB-MODULE (referenced by dashboard + resident nav)
      components/
        KnowledgeLibraryView.tsx
        KnowledgePackManagerView.tsx

    roster-engine/                # INTEGRATION SUB-MODULE
      lib/
        uchRosterParser.ts

    billing/
      components/
        UpgradeCheckoutModal.tsx
      lib/
        useWorkspaceQuota.ts

    shared/                       # cross-module only — nothing domain-specific lives here
      ui/
        Navbar.tsx
        LoadingShell.tsx
        DevHelper.tsx             # dev-only; still lives here since every module's login screen uses it
      config/
        branding.ts
        tiers.ts
      terminology.tsx
      types.ts                    # OR split per-module with a shared/types/ barrel — see Phase 3
      supabaseClient.ts           # new: the actual `createClient(...)` call + `checkSupabase()`,
                                   # extracted out of databaseService.ts so every module's service
                                   # file imports the client from one place instead of the god-file

  App.tsx                         # stays the composition root: routes + session state, but each
                                   # route imports from its module instead of a flat components/ path
```

**Not yet named above and worth flagging so it isn't orphaned when this is executed**: the
`.env`-driven `databaseService.isMock` flag and mock-mode code path referenced in `CLAUDE.md`'s
Environment section — if any of that logic still exists, it belongs in `shared/` as a cross-cutting
concern, not duplicated per module.

## `databaseService.ts` split (backend-facing frontend slice)

The 2,978-line file splits along the same module lines as above — each module's `lib/*Service.ts`
owns only the tables/RPCs it actually calls today (traceable directly from the current file's own
function names: `verifyResidentLogin`/`verifyChiefLogin` → `auth`, `getWorkforce`/`addWorkforceMember`
→ `org-admin`, `getResearchWorkspaces`/`createResearchWorkspace` → `research`, `initiatePaymentCheckout`
→ `billing`, `getTenant`/`updateTenantPlan`/`createTenant` → split between `org-admin` (self-serve
creation) and `platform-operator` (plan changes), etc.). A `shared/supabaseClient.ts` holds the one
`createClient()` call and the `checkSupabase()` guard every slice already calls before every query.

## Backend module map (`supabase/functions/`)

Already close to this shape — rename for clarity, don't restructure:

| Current name | Serves module | Notes |
|---|---|---|
| `dissertation-copilot` | `dissertation` | **renamed 2026-08-15** from `academic-copilot` for 1:1 module naming |
| `research-copilot` | `research` | already matches |
| `casebook-copilot` | `casebook-logbook` | already matches |
| `roster-parser` | `roster-engine` | already matches |
| `payment-checkout` / `payment-webhook` | `billing` | already matches |
| `platform-operator-subaccount` | `platform-operator` | tenant provisioning uses this — **renamed 2026-08-15** from `paystack-subaccount` |
| `_shared/tenantAdaptation.ts` | cross-module (AI-rigor tuning) | correctly named already — keep as the pattern for future cross-module backend helpers |
| `_shared/casebookRubric.ts` / `researchRubric.ts` | `casebook-logbook` / `research` | correctly scoped already |

No Edge Function needs to move directories for this to work — Deno bundles per-function anyway, so
renaming is cosmetic-but-clarifying, not a functional refactor. Do it in the same pass as the
frontend module it corresponds to, not as a separate backend-only sweep.

## How modules "talk" (the circuit, not orphaned islands)

- **Frontend → own module's backend slice**: via that module's `lib/*Service.ts` only.
- **Frontend module → frontend module**: via typed props passed down from `App.tsx` (the existing
  pattern — e.g. `owner: {id, name, kind, tenantId}` passed into `research`/`casebook-logbook` from
  `App.tsx`'s session state) or via `shared/` (terminology, branding, types). Never via one module
  importing a component from deep inside another module's folder.
- **Backend Edge Function → Edge Function**: only the existing relay pattern (e.g. the
  cross-repo Flutterwave webhook relay) or shared `_shared/` helpers — never a function calling
  another function's HTTP endpoint for logic that could be a shared module instead.
- **Session/identity is the spine**: `App.tsx`'s `currentResident` / `isChiefAuthenticated` /
  `currentDoctor` state (and the `activeTenantId` derived from it) is what every module receives to
  know who's asking — this is already true today and should stay the single source of truth rather
  than each module re-deriving session state independently.

## Rollout phases (why this can't be one mechanical move)

This repo has **no automated test suite** (`npm run lint` is `tsc --noEmit` only) and several
components exceed 1,000 lines with dozens of internal `useState` hooks — a single blind
find-and-replace-the-folder-structure pass risks breaking imports silently (TypeScript will catch
broken import paths, but not broken runtime behavior from an incorrectly split state hook). Proposed
order, each phase independently shippable and manually browser-verified before the next:

1. **Backend renames** (`paystack-subaccount` → `platform-operator-subaccount`, `academic-copilot` →
   `dissertation-copilot`) — zero frontend risk, just update the 2 caller sites and redeploy.
   **DONE (2026-08-15)**: both functions renamed and deployed, the 2 real client call sites
   (`src/lib/ai/academicCopilot.ts`, `databaseService.ts`'s `provisionTenantWithSubaccount`) updated,
   comment references updated throughout the codebase and this repo's `CLAUDE.md`, old function slugs
   deleted from Supabase, `tsc --noEmit` clean. Live-verified: a real OpenAI response through the
   actual Dissertation Assistant UI (logged in as a real resident, ran "Check Departmental
   Guidelines"), and a real Paystack validation-error response confirming the renamed subaccount
   function's key still authenticates (without creating a real subaccount). Test data cleaned up
   afterward. The `academic_copilot` `tenant_ai_adaptation_rules` feature_key was deliberately left
   unrenamed — see `CLAUDE.md`'s AI/Edge Functions section for why.
2. **`shared/` extraction** — move `Navbar`, `LoadingShell`, `DevHelper`, `branding.ts`, `tiers.ts`,
   `terminology.tsx` verbatim into `modules/shared/`; update imports. No logic changes.
   **DONE (2026-08-15)**: all 6 files moved via `git mv` (rename-tracked) to
   `src/modules/shared/ui/{Navbar,LoadingShell,DevHelper}.tsx`,
   `src/modules/shared/config/{branding,tiers}.ts`, and `src/modules/shared/terminology.tsx`. Every
   importer updated (13 files: `App.tsx`, 10 components, `useWorkspaceQuota.ts`, plus the 3 moved
   files' own internal cross-imports to each other/`databaseService.ts`/`types.ts`), including one
   same-directory-style import (`ChiefDashboardView.tsx`'s `'./LoadingShell'`) a first grep sweep
   missed and a second sweep caught before it reached commit. Stale path references in comments
   updated too. Found and fixed two genuinely stale UI claims in `TenantCustomizationView.tsx`'s
   Local Terminology / Required Case Reports Count panels while browser-verifying this phase (one
   said terminology only applied to 3 components — true before the later retrofit pass, not now;
   one said `CasebookBuilderView` still hardcodes 15 — also since fixed) — unrelated to the file
   move itself, just adjacent staleness noticed along the way. `tsc --noEmit` and `npm run build`
   both clean. Live-verified in a real browser: resident login → dashboard nav (Navbar +
   terminology + DevHelper) → Chief login → dashboard → Customization tab → Multi-Roster Manager
   tab, no console errors, no broken imports.
3. **One module at a time, smallest first**: `announcements` → `doctors` → `billing` →
   `knowledge-packs` → `roster-engine` → `dissertation` → `exam-readiness` → `viva-simulator` →
   `consultant-review` → `form` → `research` → `casebook-logbook` → `auth` → `org-admin` last
   (largest, most tab-coupled — `ChiefDashboardView.tsx`'s 2,062 lines need to actually be split
   into the `dashboard/` sub-panels listed above, not just relocated as one file).
   **`announcements`/`doctors`/`billing`/`knowledge-packs`/`exam-readiness`/`viva-simulator`/
   `roster-engine` DONE (2026-08-15)**, verified together as one batch since each is a small,
   independent, mostly self-contained move (single or double-file, no shared internal
   cross-imports between them): `AnnouncementBoardView.tsx` → `modules/announcements/components/`;
   `DoctorHomeView.tsx`/`CreateOrganizationView.tsx` → `modules/doctors/components/`;
   `UpgradeCheckoutModal.tsx` → `modules/billing/components/` + `useWorkspaceQuota.ts` →
   `modules/billing/lib/` (old now-empty `src/lib/billing/` removed); `KnowledgeLibraryView.tsx`/
   `KnowledgePackManagerView.tsx` → `modules/knowledge-packs/components/`;
   `ExamReadinessView.tsx` → `modules/exam-readiness/components/`; `OralExamSimulatorView.tsx` →
   `modules/viva-simulator/components/`; `uchRosterParser.ts` → `modules/roster-engine/lib/` (old
   now-empty `src/lib/roster/` removed — this module has no `components/`,
   `MultiRosterManagerView.tsx` belongs to `org-admin/dashboard/`, not here, per the module map
   above). Every importer updated across `App.tsx`, `ChiefDashboardView.tsx`,
   `MultiRosterManagerView.tsx`, `CasebookWorkspaceView.tsx`, `ResearchWorkspaceView.tsx`, plus
   each moved file's own internal imports. `tsc --noEmit` and `npm run build` both clean (identical
   bundle shape to before). Live-verified in a real browser: resident routes (Announcements,
   Library, Exam Readiness, Viva Simulator all render with real data) and Chief routes (Knowledge
   Packs and Multi-Roster Manager tabs both load, the latter confirming the relocated roster
   parser's import resolves), no console errors.
   **`dissertation`/`consultant-review`/`form` DONE (2026-08-15)**, second batch: 
   `DissertationAssistantView.tsx` → `modules/dissertation/components/` + `academicCopilot.ts` →
   `modules/dissertation/lib/` (still shared with the legacy `CasebookBuilderView.tsx`, which stays
   in `src/components/` until the `casebook-logbook` module's turn — its import updated to point at
   the new location); `ConsultantReviewView.tsx`/`GuestReviewView.tsx` →
   `modules/consultant-review/components/`; `ResidentFormView.tsx`/`ResidentActivityGraph.tsx` →
   `modules/form/components/`. One deliberate cross-module import left as-is, not "fixed": 
   `ResidentFormView.tsx` renders `ComplianceNudgesView.tsx`, which belongs to `org-admin` per the
   module map and hasn't moved yet — Phase 3 is pure relocation, not a redesign of genuine
   cross-module UI composition, so this is flagged rather than silently special-cased; revisit once
   `org-admin` moves. `tsc --noEmit` and `npm run build` both clean, identical bundle shape.
   Live-verified: resident login → My Form (activity graph + compliance nudges both render) →
   Dissertation (create flow renders) → the public `/guest-review/:token` route (renders its real
   "invalid token" error state, not a broken-import crash) — no console errors beyond the expected
   "invite not found" warning for the deliberately-fake test token.
   **`research` DONE (2026-08-15)**: `ResearchWorkspaceView.tsx` → `modules/research/components/`;
   `folderStructure.ts`/`rubricEngine.ts`/`templateEngine.ts` (from `src/lib/research/`, now
   removed) and `researchCopilot.ts` (from `src/lib/ai/`) → `modules/research/lib/`. Notable
   reverse dependency, left as-is per Phase 3's pure-relocation scope (Phase 4's `databaseService.ts`
   split is where this gets properly resolved): `databaseService.ts` itself imports
   `buildDefaultFolderTree` from `modules/research/lib/folderStructure.ts` — the shared god-file
   reaching into a module's lib, not the other way around. `TemplateManagerView.tsx` (stays in
   `src/components/` until `org-admin`'s turn) also updated its `forkTemplate` import. A first
   `tsc --noEmit` pass caught one real miss — `ResearchWorkspaceView.tsx`'s second, multi-line
   `../types` import was overlooked when only the first import block was fixed — corrected before
   the pass came back clean, which is exactly why every phase runs `tsc` rather than trusting the
   sweep alone. `npm run build` clean, identical bundle shape. Live-verified: resident login →
   Research Engine → "New Research Workspace" modal, whose Template dropdown populated with real
   options (proving the relocated `templateEngine.ts`'s `loadAvailableTemplates()` call still
   resolves), closed without creating test data. No console errors.
   **`casebook-logbook` DONE (2026-08-15)**: `CasebookWorkspaceView.tsx` (the richer, newer engine)
   and `CasebookBuilderView.tsx` (the legacy 15-slot MVP, same module per the plan's own "flagged as
   the older sibling" note) → `modules/casebook-logbook/components/`; `caseRubricEngine.ts`/
   `familyTools.ts` (from `src/lib/clinical/`, now removed) and `casebookCopilot.ts` (from
   `src/lib/ai/`) → `modules/casebook-logbook/lib/`. `CasebookBuilderView.tsx`'s cross-module import
   of `academicCopilot` (still shared with `dissertation`, per that module's own move) updated to
   the new relative path. `tsc --noEmit` and `npm run build` both clean on the first pass this time
   (learned from the research module's miss — checked the whole file for a second import block
   before moving on). Live-verified: resident login → Casebook (legacy Builder renders) →
   Casebook & Logbook (the newer engine renders, exercising all 3 relocated lib files at once) — no
   console errors.
4. **`databaseService.ts` split**, module-by-module, following the same order — each module's
   service slice extracted only after that module's components have already moved, so the diff per
   step stays reviewable.
5. **Type barrel decision** (`shared/types.ts` split per-module vs. kept centralized) — deferred to
   last since `types.ts` mirrors `schema.sql` 1:1 per this repo's own coding standard, and splitting
   it prematurely risks that mirror drifting.

Each phase: `npm run lint` clean, then a manual browser walkthrough of the affected module's routes
(this repo's only QA method per its own CLAUDE.md), then commit+push before starting the next phase.
