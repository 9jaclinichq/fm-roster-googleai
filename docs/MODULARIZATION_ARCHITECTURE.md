# PrivyDoc Workspace — Modularization Architecture

Status: **proposal / roadmap**, grounded in the actual codebase as of 2026-08-15. Nothing in this
document has been executed yet — see "Rollout phases" for how to apply it safely, since this repo
has no automated test suite to catch a broken mechanical refactor.

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
| `academic-copilot` | `dissertation` | rename target: `dissertation-copilot` for 1:1 module naming |
| `research-copilot` | `research` | already matches |
| `casebook-copilot` | `casebook-logbook` | already matches |
| `roster-parser` | `roster-engine` | already matches |
| `payment-checkout` / `payment-webhook` | `billing` | already matches |
| `paystack-subaccount` | `platform-operator` | tenant provisioning uses this — rename target: `platform-operator-subaccount` |
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
2. **`shared/` extraction** — move `Navbar`, `LoadingShell`, `DevHelper`, `branding.ts`, `tiers.ts`,
   `terminology.tsx` verbatim into `modules/shared/`; update imports. No logic changes.
3. **One module at a time, smallest first**: `announcements` → `doctors` → `billing` →
   `knowledge-packs` → `roster-engine` → `dissertation` → `exam-readiness` → `viva-simulator` →
   `consultant-review` → `form` → `research` → `casebook-logbook` → `auth` → `org-admin` last
   (largest, most tab-coupled — `ChiefDashboardView.tsx`'s 2,062 lines need to actually be split
   into the `dashboard/` sub-panels listed above, not just relocated as one file).
4. **`databaseService.ts` split**, module-by-module, following the same order — each module's
   service slice extracted only after that module's components have already moved, so the diff per
   step stays reviewable.
5. **Type barrel decision** (`shared/types.ts` split per-module vs. kept centralized) — deferred to
   last since `types.ts` mirrors `schema.sql` 1:1 per this repo's own coding standard, and splitting
   it prematurely risks that mirror drifting.

Each phase: `npm run lint` clean, then a manual browser walkthrough of the affected module's routes
(this repo's only QA method per its own CLAUDE.md), then commit+push before starting the next phase.
