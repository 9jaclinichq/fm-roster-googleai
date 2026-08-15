# PrivyDoc Workspace — Component Registry

Per `docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md` §7. This is a refresh of the
registry against what actually exists on disk as of this pass (branch
`worktree-agent-a1fa77173ef5fa8d3`, based on `main`, migrations through
`43_seed_generic_research_templates.sql`). This refresh folds in the wave of
work that landed since the previous registry snapshot: the Scored Rubric
primitive (a new, not-yet-consumed generic scoring engine), the Forms
module's global-seed ownership shape plus 5 seeded generic form templates,
4 new generic seed rows split across `research_templates`/`casebook_templates`,
`CategoryManagerPanel.tsx` going from standalone to actually wired into
`ChiefDashboardView.tsx`'s "Categories" tab, and a scoping-only pass on a
possible Scheduling module generalization. Every path below was
re-confirmed against the real file tree in this pass, not copied forward
from the previous snapshot without checking — one real gap was found this
way: `workforce_categories`/`CategoryManagerPanel.tsx` (migration 39) had
**no registry entry at all** in the previous snapshot despite already
existing on disk; that's corrected here, not just updated.

Status legend: `stable` = works, matches its current scope; `fixing` = mid-move
in the modularization pass; `fragmented` = still split across the old
`src/components/` and new `src/modules/` trees, or doing one god-file's worth
of unrelated things; `stub` = scaffolding exists but no real behavior yet.

**Note on migration status**: migrations 32–35 each carry an explicit
"NOT APPLIED LIVE — a human will review and apply the pending batch" header
comment. Migration 36 (org-defined groups) carries no such disclaimer.
Migration 37 (`insights`) also says "NOT APPLIED LIVE" in its own header, yet
migration 38's header describes a *live* duplicate-row bug it fixed ("Confirmed
live: 18 rows for 9 actually-pending residents") — i.e. 37 was apparently
applied live at some point after its own header was written, contradicting
that header. This audit is docs-only and has no database access, so this
contradiction is reported as-is from the migration files rather than resolved
against the live schema — flag it to whoever applies the pending batch.
**Migrations 41 and 42 also explicitly say "NOT APPLIED LIVE"** in their own
headers (both defer to "a human reviews and applies the pending batch
afterward", same posture as 32–35/37). **Migration 43 states neither** — its
header describes scope/judgment calls at length but never says whether it's
been applied; reported as-is, not assumed either way.

**Biggest remaining gap, this pass**: with org-defined groups (36) and
categories (39) both now real and wired into at least one consuming panel
each, and the Forms/Research/Casebook seed libraries growing (42/43), the
single largest structural gap is no longer "no org-defined vocabulary" — it's
that **Clinical & Professional Writing has no generic instance table at
all**. Migration 42's own header says this explicitly while declining to
seed a referral-letter/SOP-template form: `DissertationAssistantView.tsx`,
`CasebookBuilderView.tsx`, and `CasebookWorkspaceView.tsx` remain three
separate hardcoded features with no builder+instances model the way Forms
now has one. Close behind: the new Scored Rubric primitive (migration 41) is
schema+engine+form with **zero consuming faces** (see M15 below) — a second,
even newer "built but unwired" gap alongside the pre-existing Scheduling/
Meetings ones (both still additive-only, no dashboard wiring, no schema at
all for Meetings — see the new M16/M17 entries below).

---

## L5 Faces

### F1 Auth Landing
layer: L5
face: landing
path: `src/modules/auth/components/AuthLandingView.tsx`
owner engine: none
tenant scope: any (pre-tenant-resolution)
consumes: none
emits: navigation intents only (`/workspace/login`, `/doctor/login`)
udr fields: none
gates: none
status: stable — **but see gap audit**: renders institutional-flavored copy pre-login because `TerminologyProvider` (mounted higher in the tree) defaults to `DEFAULT_TENANT_ID` (UCH) until a session exists, so `t('member','Resident')`/`t('admin','Chief Resident')` fallbacks resolve to UCH's actual overrides, not neutral copy. Violates spec rule 6 ("neutral until known"). Not re-verified in this pass; carried forward from the previous audit.

### F2 Resident/Member Login
layer: L5
face: landing
path: `src/modules/auth/components/ResidentLoginView.tsx`
owner engine: none
tenant scope: org
consumes: `tenants` (active list, migration 26), `workforce` (by tenant), terminology overrides
emits: none (writes session to localStorage client-side only, not an event)
udr fields: none (no formal UDR write path yet — see S3)
gates: none
status: stable — already does tenant → member → code → registered-email order (migration 26).

### F3 Chief/Org-Admin Login
layer: L5
face: landing
path: `src/modules/auth/components/ChiefLoginView.tsx`
owner engine: none
tenant scope: org
consumes: `settings` (per-tenant admin code, migration 23)
emits: none
udr fields: none
gates: none
status: stable

### F4 Individual Doctor Auth
layer: L5
face: landing
path: `src/modules/auth/components/DoctorAuthView.tsx`
owner engine: none
tenant scope: individual
consumes: Supabase Auth (real auth.users, migration 18)
emits: none
udr fields: none
gates: none
status: stable

### F5 Admin Portal Chooser
layer: L5
face: landing
path: `src/modules/auth/components/AdminPortalChooserView.tsx`
owner engine: none
tenant scope: any
consumes: none
emits: navigation intents (`/chief/login`, `/organization/new`)
udr fields: none
gates: none
status: stable

### F6 Create Organization (self-serve tenant creation)
layer: L5
face: org-admin
path: `src/modules/doctors/components/CreateOrganizationView.tsx`
owner engine: none
tenant scope: platform → creates a new org tenant
consumes: none
emits: none (calls `create_tenant_self_serve` RPC, migration 24, directly)
udr fields: none
gates: none
status: stable — module placement is odd (lives under `doctors/`, not `auth/` or a dedicated `org-admin/`), a minor organizational mismatch worth fixing in a future pass, not a functional gap.

### F7 Doctor Home (individual doctor waiting room / personal workspace launcher)
layer: L5
face: doctor
path: `src/modules/doctors/components/DoctorHomeView.tsx`
owner engine: none
tenant scope: individual
consumes: `currentDoctor` session
emits: navigation intents (`/doctor/research`, `/doctor/casebook-logbook`)
udr fields: none
gates: none
status: stable — surfaces entry cards into personal Research and Casebook workspaces (migration 25), **and now also renders F19 `DoctorIntegrationsPanel`** (new since the previous snapshot — see L4 organs).

### F8 SaaS Operator Console
layer: L5
face: operator-admin
path: `src/components/SaaSOperatorConsoleView.tsx`
owner engine: none
tenant scope: platform
consumes: `tenants`, `tenant_ai_usage`, `workforce`, `submissions`, `platform_operators`
emits: none
udr fields: none
gates: operator login (separate shared code, `platform_operators`)
status: fragmented — **still** under `src/components/`, unlike every Chief-dashboard-adjacent face, which did move in this wave's org-admin module split. Confirmed unchanged in this pass — not touched by the Phase 3 modularization batch.

### F9 Org-Admin: Chief Dashboard (root shell)
layer: L5
face: org-admin
path: `src/modules/org-admin/components/ChiefDashboardView.tsx`
owner engine: none
tenant scope: org
consumes: `workforce`, `collections`, `submissions`, `settings`, `user_roles`, `org_groups` (migration 36, via `RoleDelegationPanel`)
emits: none directly (the L1 agent it embeds, F18 `InsightsStrip`, does emit — see below)
udr fields: none
gates: Chief session
status: **substantially de-fragmented since the previous audit** — the Phase 3 org-admin module split landed. `ChiefDashboardView.tsx` is now 1,169 lines (down from ~1,900; up slightly from 1,153 at the last snapshot for the `CategoryManagerPanel` wiring below) and composes 9 sibling panels directly imported from `src/modules/org-admin/components/dashboard/`: `SubmissionsPanel`, `PendingResidentsPanel`, `WorkforceRegistryPanel`, `AnnouncementsAdminPanel`, `RoleDelegationPanel`, `CollectionSettingsPanel`, `FormsBuilderPanel`, `IntegrationsPanel`, and **`CategoryManagerPanel`** (new this pass — see the "Categories" tab paragraph in S4 below; the previous registry snapshot never actually carried an entry for it at all despite it already existing on disk — see this file's intro note), plus 4 lazy-loaded: `MultiRosterManagerView`, `TenantCustomizationView`, `TemplateManagerView`, and **`KnowledgePackManagerView`** (also lazy-loaded here; missing from the previous snapshot's list even though it already existed on disk). **Correction**: the previous snapshot's list also named `TenantUpgradeCheckoutModal` as one of this component's lazy imports — re-checked directly this pass and that's not accurate: `ChiefDashboardView.tsx` does not import it at all; it's opened one level down, from inside `TemplateManagerView.tsx` (see F13). Still not a pure composition shell (1,169 lines still holds substantial cross-panel state/handlers), so still marked `fixing` rather than fully `stable` — but this is real, confirmed progress, not a re-label. Also now renders **F18 `InsightsStrip`** between the KPI cards and the tab switcher (the living-system spec's Dashboard-module row: "insight strips, module tiles, tenant switcher").

### F10 Org-Admin: Multi-Roster Manager (HITL roster editor)
layer: L5
face: org-admin
path: `src/modules/org-admin/components/dashboard/MultiRosterManagerView.tsx`
owner engine: babsbrain-2 (via `roster-parser`)
tenant scope: org
consumes: `raw_roster_uploads`, `combined_master_rosters`, `roster_types`, `workforce`
emits: none
udr fields: none
gates: Chief session
status: fragmented — **path corrected**: moved out of `src/components/` in the org-admin split, but into `org-admin/components/dashboard/`, not into its own module's `roster-engine/components/`. `roster-engine` (M11 below) is still lib-only (`uchRosterParser.ts`); this face lives in a different module's folder than the lib it calls, which is itself a cross-module import (`org-admin` face importing `roster-engine`'s lib) — not a new problem, just re-homed rather than resolved.

### F11 Org-Admin: Template Manager
layer: L5
face: org-admin
path: `src/modules/org-admin/components/dashboard/TemplateManagerView.tsx`
owner engine: none
tenant scope: org
consumes: `casebook_templates`, `research_templates`, `viva_vignettes`, `tenants.plan_type`
emits: none
udr fields: none
gates: Chief session; plan-gated (migration 29 — `free_seeded` tenants blocked from create/update)
status: fragmented — **path corrected** (moved from `src/components/` into `org-admin/components/dashboard/`). Still one screen acting as a builder for three separate L4 organs (casebook-logbook, research, viva-simulator) at once — same architectural note as before, not resolved by the module split.

### F12 Org-Admin: Tenant Customization
layer: L5
face: org-admin
path: `src/modules/org-admin/components/dashboard/TenantCustomizationView.tsx`
owner engine: none
tenant scope: org
consumes: `tenants` (module_flags, call_duty_rules, terminology_overrides, tenant_ai_adaptation_rules)
emits: none
udr fields: none
gates: Chief session
status: stable — **path corrected** (moved from `src/components/`). Still the closest existing thing to a real "tenant config service" (S4), but remains a single UI screen writing directly to `tenants` columns/child tables, not a spine service other faces/modules call through.

### F13 Org-Admin: Tenant Upgrade Checkout
layer: L5
face: org-admin
path: `src/modules/org-admin/components/dashboard/TenantUpgradeCheckoutModal.tsx`
owner engine: none
tenant scope: org
consumes: none
emits: none (calls `payment-checkout` Edge Function directly with `scope: 'tenant'`)
udr fields: none
gates: Chief session
status: stable — **path corrected** (moved from `src/components/`).

### F14 Compliance Nudges (embedded doctor-face panel)
layer: L5
face: doctor
path: `src/modules/org-admin/components/ComplianceNudgesView.tsx`
owner engine: babsbrain-2 (conceptually — "submission chaser" per spec §7; **note this is a distinct, older client-side derivation, not the same code as the new L1 `submissionChaserAgent.ts` below** — the two currently coexist unmerged)
tenant scope: individual (per-resident)
consumes: `dissertations`, `case_reports`, `exam_readiness`, `settings`, `collections` (via `deriveNudges`)
emits: none
udr fields: none
gates: none
status: fragmented — **path corrected**: moved from `src/components/` to `src/modules/org-admin/components/` (note: directly under `org-admin/components/`, not under its `dashboard/` panel subfolder), embedded (compact mode) inside `src/modules/form/components/ResidentFormView.tsx` — a cross-module embedding (`form` face importing an `org-admin` face) that predates and is unrelated to the module split. Logic that conceptually belongs to BabsBrain-2 is still computed client-side in a React component, not by any engine/agent — **this is now a real duplication risk**: `src/modules/shared/lib/submissionChaserAgent.ts` (A1 below) is a second, independently-built "submission chaser" concept with different mechanics (persisted `insights` rows, tenant-wide, deadline-gated) that has not been reconciled with this component's per-resident client-side nudges. Flagged for a future consolidation pass, not silently merged here.

### F15 Navbar
layer: L5
face: shared
path: `src/modules/shared/ui/Navbar.tsx`
owner engine: none
tenant scope: any
consumes: session state (resident/chief/doctor), terminology overrides, branding config
emits: navigation intents
udr fields: none
gates: none
status: stable

### F16 Loading Shell / Dev Helper
layer: L5
face: shared
path: `src/modules/shared/ui/LoadingShell.tsx`, `src/modules/shared/ui/DevHelper.tsx`
owner engine: none
tenant scope: any
consumes: `workforce`, `settings` (DevHelper only)
emits: none
udr fields: none
gates: none
status: `LoadingShell` stable. `DevHelper` — **flagged in CLAUDE.md as the single highest-priority security finding**: mounted unconditionally in `App.tsx`. Not re-verified line-by-line in this pass (still present, unchanged path/behavior).

### F17 Tenant Selector (institution-first login step)
layer: L5
face: landing
path: `src/modules/auth/components/TenantSelectorView.tsx`
owner engine: none
tenant scope: any (pre-tenant-resolution)
consumes: `tenants` (active list, via `databaseService`)
emits: navigation intent carrying the selected tenant id forward
udr fields: none
gates: none
status: stable — **new since the previous snapshot**, not part of the task's briefed list but found while walking `src/modules/auth/`. Sits between `AuthLandingView`'s "My organization has an access code" choice and `ResidentLoginView`, listing every active tenant as a selectable card plus the individual-doctor path at the same top level. Directly addresses part of CLAUDE.md's "Backlog: institution-first / self-serve org flow" item (1) — the tenant-first ordering — though that backlog item's other two asks (a limited-tools "not affiliated" tier, and a single unified admin panel) remain unbuilt.

### F18 Insights Strip (L1 agent's dashboard face)
layer: L5
face: org-admin
path: `src/modules/shared/ui/InsightsStrip.tsx`
owner engine: babsbrain-2
tenant scope: org
consumes: `insights` (via `getActiveInsights`), triggers `A1` (`runSubmissionChaser`) on mount
emits: none directly (the agent it triggers emits `insight.generated` — see A1)
udr fields: `insights[]` conceptually, though this reads the `insights` table directly rather than through `udr.ts` (see S3's gap note — `udr.ts`'s own `insights[]` field is still hardcoded empty)
gates: dismiss is a plain user action (no approval gate — matches rung-1 "shown as suggestion")
status: stable, new — first real face wired to a real L1 agent. Wired into `ChiefDashboardView.tsx` (F9) between the KPI cards and tab switcher. Fails gracefully by design: if `insights`/`agent_manifests` don't exist yet (migration 37/38 not applied) or Supabase isn't configured, renders nothing — no error boundary, no visible failure state.

### F19 Doctor Integrations Panel
layer: L5
face: doctor
path: `src/modules/doctors/components/DoctorIntegrationsPanel.tsx`
owner engine: none
tenant scope: individual
consumes: `integrations_catalog`, `integrations_connections` (scope='individual', via `integrationsService.getConnectionsForDoctor`)
emits: none
udr fields: none
gates: none
status: stub — read-only. Sibling to org-admin's `IntegrationsPanel` (M14 below); unlike that panel, this one does fetch the doctor's real `integrations_connections` rows and treats `status: 'connected'` as connected, but there is still no connect/disconnect mutation flow anywhere in the app, so in practice every row reads as not-connected until a future pass seeds/writes real connections. Wired into `DoctorHomeView.tsx` (F7).

---

## L4 Organs (current `src/modules/` folders + still-fragmented equivalents)

### M1 Announcements
layer: L4
face: doctor, org-admin
path: `src/modules/announcements/components/AnnouncementBoardView.tsx` (instance/consumption view); **builder now exists** at `src/modules/org-admin/components/dashboard/AnnouncementsAdminPanel.tsx`
owner engine: babsbrain-2 (target)
tenant scope: org
consumes: `announcements` (tenant-scoped, migration 11), `announcement_reads`
emits: none today (spec wants `module.configured`/broadcast events — not implemented; `event_log`/`eventBus.ts` now exist but nothing in this module calls `emitEvent`)
udr fields: none
gates: none
status: fragmented, **gap partially closed since the previous audit** — the previous snapshot flagged "module has no builder component of its own... not traced in this pass." That's now confirmed: `AnnouncementsAdminPanel.tsx` is a real, separate builder component (create/pin/categorize), composed into `ChiefDashboardView.tsx` (F9) rather than embedded inline in the god-file. **Gap vs spec unchanged**: still one fixed announcement-category enum (Roster/Exam/CME/Admin), not a generic instance/pipeline model — maps toward target capability #8 "Messages & broadcasts."

### M2 Auth (see L5 Faces F1–F5, F17 above)
This "module" is entirely L5 faces (login/landing screens), not an L4 organ with builder/instance/data/pipeline shape. Registered under Faces, not here, to avoid a duplicate entry.

### M3 Billing
layer: L4
face: doctor, org-admin
path: `src/modules/billing/components/UpgradeCheckoutModal.tsx`, `src/modules/billing/lib/useWorkspaceQuota.ts`
owner engine: babsbrain-2 (target — "payment watcher")
tenant scope: individual (per-resident quota) and org (tenant plan)
consumes: `ai_action_logs`, `user_subscriptions`, `tenants.plan_type`
emits: none (spec wants `payment.succeeded`/`plan.changed` — not implemented as events; `eventBus.ts`'s `EventType` union already includes `billing.checkout_started`/`billing.subscription_activated`/`billing.subscription_cancelled`/`billing.quota_exhausted` for when this is wired)
udr fields: none
gates: payment confirmation (external, Flutterwave/Paystack hosted checkout)
status: stable — unchanged in this pass. Now that `integrations_catalog` (M14) exists with a seeded `payment-processor` row representing Flutterwave, there's a nominal cross-reference between this module and the integrations layer, though nothing in `useWorkspaceQuota.ts`/`UpgradeCheckoutModal.tsx` reads from `integrations_catalog` — the two remain independent today.

### M4 Casebook & Logbook
layer: L4
face: doctor, org-admin
path: `src/modules/casebook-logbook/components/{CasebookBuilderView,CasebookWorkspaceView}.tsx`, `src/modules/casebook-logbook/lib/{caseRubricEngine,casebookCopilot,familyTools}.ts`
owner engine: privybrain-2
tenant scope: org (institutional) and individual (doctor-owned workspaces, migration 25)
consumes: `casebook_templates`, `casebook_workspaces`, `clinical_case_reports`, `clinical_logbooks`, `case_reports` (old MVP)
emits: none
udr fields: `udr.ts`'s `instances[]` now includes `casebook_workspace` rows (see S3) — the first real UDR read-composition wiring for this module, though `udr.ts` remains read-only/composition-only, not a write path this module calls into
gates: AI Copilot actions require doctor review before save (client-side, no formal gate record)
status: stable, unchanged in this pass — still two separate hardcoded flows (`CasebookBuilderView`/`case_reports` vs. `CasebookWorkspaceView`/`clinical_case_reports`), deliberately kept independent per CLAUDE.md's own "SCOPE DECISION."

**`casebook_templates` gains 1 new global seed row this pass (migration 43, schema only — not confirmed applied live, see intro note)**: "Generic Case-Based Portfolio (Specialty-Agnostic)" (`framework_type = 'CUSTOM_CLINICAL'`), bundling a case-mix planner into `thematic_distribution`, a generic 8-domain scoring rubric, and a generic case-write-up-structure + case-selection-guide pair folded into `formatting_rules` — deliberately reusing existing jsonb columns rather than adding a new table, per migration 43's own header (Judgment Call 4). This is content-only (no schema/app-code change) and sits alongside the 4 WACP/NPMCN rows migration 15 already seeded, taking the total to 5 seeded `casebook_templates` rows once applied.

### M5 Consultant / Co-Resident Review
layer: L4
face: doctor
path: `src/modules/consultant-review/components/{ConsultantReviewView,GuestReviewView}.tsx`
owner engine: none (approval workflow, not AI-driven)
tenant scope: org
consumes: `consultant_reviews`, `guest_review_invites`
emits: none
udr fields: none
gates: subadmin role check (`canApprove`) — **now backed by `org_groups.grants_review_approval`** (migration 36) rather than a hardcoded 4-value role-id list, via `RoleDelegationPanel`/`chief_assign_user_role`; guest-link token
status: stable, unchanged in this pass structurally. One retrofit gap carried forward: its own panel heading ("Consultant Review Workspace") is still hardcoded, not routed through `t('senior_reviewer', ...)`.

### M6 Dissertation Assistant
layer: L4
face: doctor
path: `src/modules/dissertation/components/DissertationAssistantView.tsx`, `src/modules/dissertation/lib/academicCopilot.ts`
owner engine: privybrain-2
tenant scope: org (institutional resident only — no doctor-owned path)
consumes: `dissertations`, `dissertation_milestones`
emits: none
udr fields: `udr.ts`'s `academic.dissertation`/`entries[]` (type `dissertation_milestone`) now read this module's tables directly (see S3) — read-only composition, no write-back
gates: none
status: stable, unchanged — still one hardcoded dissertation-tracking flow, not folded into the newer `research` module's template system (M10).

### M7 Exam Readiness
layer: L4
face: doctor
path: `src/modules/exam-readiness/components/ExamReadinessView.tsx`
owner engine: babsbrain-2 (target — compliance checker)
tenant scope: org
consumes: `exam_readiness` (fixed named columns, migration 05)
emits: none
udr fields: `udr.ts`'s `academic.examReadiness` now reads this table directly (see S3) — read-only
gates: none
status: stable — unchanged, deliberately not generalized (see CLAUDE.md).

### M8 Forms (monthly roster submission)
layer: L4
face: doctor, org-admin
path: `src/modules/form/components/{ResidentFormView,ResidentActivityGraph}.tsx`
owner engine: babsbrain-2
tenant scope: org
consumes: `submissions`, `collections`, `rotations`; **now also writes (additively) into `form_entries`** via `src/modules/form/lib/formService.ts` — see M13
emits: none as an event, but **now has a real, live dual-write into the generalized Forms scaffold** (M13) on every successful submission
udr fields: `udr.ts`'s `entries[]` (type `submission`) reads `submissions` directly (see S3)
gates: none
status: stable but still **the single clearest example of a use-case wearing a module's clothes** (spec rule 9) as its own hardcoded flow — **however, this is no longer purely a hardcoded dead end**: `ResidentFormView.tsx`'s `handleSubmit` (around line 294–332) now does a best-effort, non-blocking dual-write into `form_entries` immediately after the real `submissions` insert succeeds. Mechanism: looks up the seeded `form_instances` row by exact name (`"Monthly Rotation & Leave Schedule Form"`, migration 35's seed) via `getFormInstanceByName(tenantId, name)`, then calls `createFormEntry(instanceId, tenantId, resident.id, payload)` mirroring the submission's own fields into the generic `payload` jsonb. Wrapped in try/catch — any failure (missing tenant, no seeded instance, network, RLS) is logged and swallowed; `submissions` remains the sole source of truth and the dual-write can never block or roll back the real submission. Nothing yet *reads* `form_entries` back out for any user-facing purpose (`FormsBuilderPanel.tsx`'s "view submissions" affordance isn't built — see M13) — so today this is a one-way mirror with no consumer, not yet a functioning pipeline.

### M9 Knowledge Packs
layer: L4
face: doctor, org-admin
path: `src/modules/knowledge-packs/components/{KnowledgeLibraryView,KnowledgePackManagerView}.tsx`
owner engine: privybrain-2 (target)
tenant scope: org
consumes: `knowledge_packs`, `knowledge_pack_items`
emits: none
udr fields: none
gates: none
status: stable, unchanged in this pass.

### M10 Research Engine
layer: L4
face: doctor, org-admin
path: `src/modules/research/components/ResearchWorkspaceView.tsx`, `src/modules/research/lib/{folderStructure,researchCopilot,rubricEngine,templateEngine}.ts`
owner engine: privybrain-2
tenant scope: org (institutional) and individual (doctor-owned, migration 25)
consumes: `research_templates`, `research_workspaces`, `research_chapters`, `research_correction_logs`
emits: none
udr fields: `udr.ts`'s `instances[]` includes `research_workspace` rows for both `workforceId` and `doctorId` lookups (see S3) — read-only composition
gates: none
status: stable, unchanged in this pass — still the module closest to the spec's target shape.

**`research_templates` gains 3 new global seed rows this pass (migration 43, schema only — not confirmed applied live, see intro note)**: "Generic Audit / Quality Improvement (QI) Project Track" (the only one of the 3 with a real `dissertation_rubric`, riding the same fixed `ch1_intro`..`ch5_discussion` chapter slots every staged template uses), "Generic Publication / Journal Manuscript Track", and "Generic Research Grant Proposal Track" (both single-stage, proposal-rubric-only, mirroring the existing lighter ICMJE/STROBE/CONSORT/PRISMA/CARE rows). All 3 use `organization_or_body = 'Custom_Doctor'` — migration 43's own header flags this as a judgment call (the CHECK-constrained enum has no QI/publication/grant-specific value, and widening it for 3 rows was judged not worth the schema churn) rather than an oversight. Takes the seeded total from 9 (migration 13) to 12 once applied.

### M11 Roster Engine
layer: L4
face: org-admin
path: `src/modules/roster-engine/lib/uchRosterParser.ts` (lib only — see F10 for the UI, now in `src/modules/org-admin/components/dashboard/`, not this module's own folder)
owner engine: babsbrain-2
tenant scope: org
consumes: `raw_roster_uploads`
emits: none
udr fields: none
gates: HITL review before publish (manual, in F10)
status: fragmented, unchanged in substance — still no `components/` directory under this module; F10's move (this wave) landed it in `org-admin/dashboard/` rather than here, so the module/face split is now cross-module rather than resolved.

### M12 Viva Simulator
layer: L4
face: doctor, org-admin
path: `src/modules/viva-simulator/components/OralExamSimulatorView.tsx`
owner engine: privybrain-2
tenant scope: org
consumes: `viva_vignettes` (tenant-scoped bank, migration 28), `viva_simulations` (scores)
emits: none
udr fields: none
gates: plan-gated vignette creation (migration 29, Chief-authored content only)
status: stable, unchanged in this pass.

### M13 Forms & Pipelines (generalization scaffold)
layer: L4
face: org-admin
path: builder — `src/modules/org-admin/components/dashboard/FormsBuilderPanel.tsx`; data access — `src/modules/form/lib/formService.ts`; schema — `supabase/migrations/35_forms_pipelines.sql`, extended by `supabase/migrations/40_doctor_personal_forms.sql` and `supabase/migrations/42_form_instances_global_seed_and_content.sql`
owner engine: babsbrain-2
tenant scope: org, individual (doctor-owned, migration 40), and now **global/seed** (migration 42 — see below)
consumes: `form_instances`, `form_entries`, `form_pipelines`
emits: none (no event emission wired here yet)
udr fields: none (not read by `udr.ts`)
gates: none
status: stub — **new since the previous snapshot**, directly addresses the living-system spec's own backlog line (§10: "Forms module currently equals one monthly schedule form; generalise into builder + instances + pipelines"). Schema is deliberately minimal (no conditional logic/sections/validation rules — `form_instances.schema` is a flat field-definition list; `form_pipelines.pipeline_type` is free text, not an enum, to avoid the CHECK-constraint churn `ai_action_logs.action_type` already hit twice). `FormsBuilderPanel.tsx` is first-slice only: create + list `form_instances`, no update/delete, no UI for `form_pipelines` at all. `formService.ts`'s `getFormEntries` exists but is not called by the panel yet. The one live consumer of this scaffold is M8's dual-write (a producer, not this panel) — nothing in this module's own UI surfaces `form_entries` back to a Chief yet, so "builder" and "data" exist but there is no working "instances you can actually use" loop end to end.

**Migration 42 (schema only — not applied live, see intro note) adds a third `form_instances` ownership shape**: `tenant_id IS NULL AND doctor_id IS NULL` — a genuinely global, unowned row, alongside the existing tenant-owned and doctor-owned (migration 40) shapes, via a widened owner CHECK constraint and matching SELECT/INSERT/UPDATE RLS clauses. A new `is_system_default boolean` column marks seeded rows, mirroring `org_groups`/`workforce_categories`' own convention. Seeds **5 global generic form templates** per the living-system spec §8.2's "Forms & pipelines" list, verbatim: Leave/Absence Request, Incident/Audit Report, Feedback Form, Membership/Credential Renewal, Generic Intake/Checklist Form — each a flat `FormFieldDefinition[]` schema, `is_system_default = true`. Migration 42's own header explicitly declines to seed a referral-letter or SOP/protocol-template form on the grounds that a long-form document template doesn't fit `form_instances`' flat-field shape — flagged there as the reason "Clinical & Professional Writing" still has no generic instance table (see this file's intro "biggest remaining gap" note). **Not yet wired into any UI**: `FormsBuilderPanel.tsx` was not modified by migration 42 and still only lists/creates tenant-owned instances — nothing in the panel queries for or surfaces the 5 global seed rows yet, so today they exist in the schema (once applied) but are not reachable from any face.

### M14 Integrations Layer
layer: L4
face: org-admin, doctor
path: org-admin panel — `src/modules/org-admin/components/dashboard/IntegrationsPanel.tsx`; doctor panel — `src/modules/doctors/components/DoctorIntegrationsPanel.tsx` (F19); shared data access — `src/modules/shared/lib/integrationsService.ts`; schema — `supabase/migrations/33_integrations_layer.sql`
owner engine: none (cross-cutting; feeds whichever engine the connected tool serves — see the catalog's `feeds_modules`)
tenant scope: org (`IntegrationsPanel`) and individual (`DoctorIntegrationsPanel`)
consumes: `integrations_catalog`, `integrations_connections`
emits: none
udr fields: none
gates: none
status: stub — **new since the previous snapshot**, directly addresses spec §7's "External and native tool integrations" section. 8 catalog rows seeded (statistical analyser, literature search, literature/evidence matrix, reference manager, writing space, calendar/video, e-signature, payment processor) — 3 native (already-live features re-represented as catalog entries: statistical analyser, literature/evidence matrix, writing space), 4 external stubs with no real OAuth/API flow (`auth_type: 'oauth'`, `kind: 'external'`), and Flutterwave as the one already-live platform-managed row (`auth_type: 'platform_managed'`). Both panels are **read-only**: they list the catalog and show a connected/not-connected badge — `IntegrationsPanel` infers connection purely from `auth_type === 'platform_managed'` (doesn't call `getConnectionsForTenant` at all); `DoctorIntegrationsPanel` does call `getConnectionsForDoctor` and treats a `status: 'connected'` row as connected, but nothing anywhere writes such a row, so in practice both panels always show every non-platform-managed integration as disconnected. No connect/disconnect mutation flow exists for any of the 7 non-native rows — flagged in both panels' own code comments as future per-provider work, not hidden.

### M15 Scored Rubric Primitive
layer: L4 (per its own migration header: "a generic primitive inside Forms & pipelines (L4)")
face: shared (no consuming face wired in yet — see status)
path: schema — `supabase/migrations/41_scored_rubric_primitive.sql`; engine — `src/modules/shared/lib/scoredRubricEngine.ts` (321 lines: `listRubricTemplates`, `getRubricTemplate`, `createRubricInstance`, `getRubricInstance`, `submitRubricScores`, `confirmRubricInstance`); rendering UI — `src/modules/shared/ui/RubricInstanceForm.tsx` (235 lines, standalone `React.FC`)
owner engine: none declared yet (no `agent_manifests` row references this primitive)
tenant scope: org, individual, and global (3-way ownership: `rubric_templates.tenant_id`/`.doctor_id` can independently be NULL or set — deliberately NOT the migration 25/31/40 doctor-owned-XOR-institutional CHECK, since a global template needs both columns NULL, a state that CHECK shape cannot express)
consumes: `rubric_templates`, `rubric_sections`, `rubric_items`, `rubric_instances`
emits: none
udr fields: none
gates: none — RLS is fully permissive on all 4 tables (including `rubric_instances`), same trust model as the rest of this schema, per the migration's own explicit instruction not to invent a new boundary here
status: **stub — confirmed by direct repo-wide search this pass, flagging explicitly per this task's own instruction rather than marking `stable`.** `rubric_templates`/`rubric_sections`/`rubric_items`/`rubric_instances` and the `compute_rubric_totals(p_instance_id)` SQL/PLPGSQL RPC (server-side aggregation: sums each section's scored items against `max_points`, checks `pass_threshold`, flags any zero-scored item in an `all_items_required` section, derives a fixed 3-value `recommendation` band) all exist and are internally complete. But `RubricInstanceForm.tsx` — the only rendering UI for this primitive — is imported by **nothing**: a repo-wide grep for `RubricInstanceForm` outside its own file turns up exactly one hit, a comment in `scoredRubricEngine.ts`, not an actual import. No face (Chief dashboard, doctor workspace, or otherwise) opens this form, and no seed rubric content exists in `rubric_templates` — migration 41's own header explicitly declines to seed real rubric content, deferring to Dr. Olanipekun supplying authoritative WACP/OSCE/credentialing documents per CLAUDE.md's "Sourcing module content" policy. Migration 41 also carries its own "NOT APPLIED LIVE" header (see intro note) — so today this is schema-plus-library code with zero live rows and zero consumers, the newest addition to this registry's "built but unwired" gap list (see intro "biggest remaining gap" note).

### M16 Scheduling
layer: L4
status: **scoped, not yet built.** `docs/SCHEDULING_MODULE_SCOPING.md` (new this pass) maps the living-system spec's §7/§8.2 "Scheduling" capability (duty roster, on-call, clinic sessions, branch coverage, equipment/room booking) against the app's actual existing roster features — `raw_roster_uploads`/`combined_master_rosters`/`roster_types` (migration 10, see M11 Roster Engine above) — and concludes those are a real, actively-used AI-assisted HITL document-parsing pipeline for 5 UCH-specific formats, structurally unlike Forms' "one hardcoded flat-field form" starting point, so a straight lift into a generic `form_instances`-style model would misrepresent what it actually does. The document proposes a target shape and migration paths but **deliberately writes no schema, no migration, and no application code** — confirmed on disk: no `44_scheduling_module.sql` or any migration past 43 exists, and no `src/modules/scheduling/` directory exists. Migration 42's own header independently reached the same "needs its own scoping pass first" conclusion in passing before this document did the actual pass. Nothing to register as a face/organ/spine component yet — this entry exists so the registry doesn't silently omit a capability the spec names, per this file's own §7 format.

### M17 Meetings & Actions
layer: L4
status: **gap — not built, and not found in this pass.** The living-system spec (§7) names Meetings & Actions as one of its 10 target capability modules. No `meetings`-related migration exists in `supabase/migrations/` (confirmed: highest migration on disk this pass is `43_seed_generic_research_templates.sql`, no `45_*` file), and no `src/modules/meetings/` directory exists on disk. A sibling worktree was flagged as possibly landing this module around the same time as this pass's work, but nothing under that name has merged to this branch as of this refresh — not registered as built, and not invented here. Re-check on the next registry refresh once/if it lands.

---

## L3 Spine

### S1 Database Service (de facto spine today)
layer: L3
face: shared
path: `src/lib/databaseService.ts`
owner engine: none
tenant scope: any
consumes: every table in `supabase/schema.sql` + `supabase/migrations/*`
emits: nothing directly (see S2 for the new, separate event-emission path)
udr fields: none (see S3 — the new UDR composition layer reads through this file's exported `supabase` client, not through this file's own service functions)
gates: none
status: **fragmented, unchanged in substance** — still one large god-file doing direct per-module Supabase reads/writes. New spine pieces this wave (S2/S3/S5/S6) were deliberately built *alongside* this file rather than inside it — `formService.ts`, `integrationsService.ts`, `udr.ts`, and `eventBus.ts` all import the `supabase` client this file exports rather than adding more functions to it, per each new file's own header comment (avoiding further growth of the god-file while `docs/MODULARIZATION_ARCHITECTURE.md`'s Phase 4 client-extraction hasn't started).

### S2 Event Bus
layer: L3
face: shared
path: `src/modules/shared/lib/eventBus.ts`
owner engine: none
tenant scope: any
consumes: nothing (write-only)
emits: `event_log` rows (any string; `EventType` union in this file covers §6's vocabulary for editor autocomplete only, not DB-enforced)
udr fields: none
gates: none
status: **real, but minimal — no longer absent, still far from a real bus.** Backed by `event_log` (migration 32). This is a plain typed insert wrapper (`emitEvent`) — explicitly **no pub/sub, no listeners, no in-process dispatch**, per the file's own header. Nothing in this app currently reads `event_log` back out. Confirmed exactly one real caller today: `submissionChaserAgent.ts`'s `insight.generated` emission (A1 below) — every other module (Announcements, Billing, Casebook, Dissertation, Research, Forms, Integrations) has an `EventType` reserved for it in the union but does not call `emitEvent` anywhere yet.

### S3 Unified Doctor Record (UDR)
layer: L3
face: shared
path: `src/modules/shared/lib/udr.ts`
owner engine: none
tenant scope: any
consumes: `workforce`, `doctor_profiles`, `tenants`, `research_workspaces`, `casebook_workspaces`, `submissions`, `case_reports`, `dissertations`, `dissertation_milestones`, `exam_readiness`, `user_subscriptions`
emits: nothing (pure read composition, no writes)
udr fields: `identity`, `tenant`, `instances[]`, `entries[]`, `academic`, `billing` — all real; **`insights[]` is confirmed still hardcoded to the literal empty array `[]`** (see below)
gates: none
status: **real since this wave — no longer absent, but with one specifically-checked gap.** `getUnifiedDoctorRecord(client, ref)` is a deliberate **read-only composition function**, not new storage — it queries tables that already exist and reshapes them into §5's `udr.*` shape; it performs no writes and creates no new tables, per its own header's explicit rationale (migrating every existing table into a truly generic schema would be a high-risk live-production rewrite, out of scope). Accepts either a `workforceId` or `doctorId` ref and correctly unions both when a doctor is linked to a workforce row (`workforce.doctor_id`). **Directly checked per this task's instruction**: `insights[]` is typed `UdrInsight = unknown` and the function's return statement ends with a literal `insights: []` — it does **not** read the new `insights` table (migration 37) at all, despite that table now existing and being actively written by A1/read by F18. This is a real, currently-unclosed gap: the `insights` table and `InsightsStrip.tsx` (F18) read/write it directly, bypassing this composition layer entirely, rather than `udr.ts` being the single place `insights[]` is assembled as §5 describes. Also unaddressed: `entries[]` deliberately does not expand into `research_chapters`/`clinical_case_reports` (kept at the coarser `instances[]` granularity), and `billing` only reflects `workforce_id`-scoped subscriptions, never `scope='tenant'` org-wide ones or an unlinked doctor's billing.

### S4 Tenant Config Service
layer: L3
face: shared
path: partially — `databaseService.getTenant()`/`getTenants()` + the `tenants` table's `module_flags`/`terminology_overrides`/`call_duty_rules` columns; **now also `org_groups` (migration 36)** for the delegatable-role-vocabulary slice, **and `workforce_categories` (migration 39)** for the workforce-grade-vocabulary slice
status: fragmented, **one real sub-gap narrowed this wave**. Config still exists as ad hoc columns/tables read directly by whichever face needs them (F12 `TenantCustomizationView`, `terminology.tsx`, each Edge Function's `tenantAdaptation.ts`), not a single service with its own contract — that part is unchanged. What's new: the spec's own rule 10 ("groups are org-defined vocabulary, not a fixed hierarchy") was previously violated by a genuinely global, hardcoded 4-row `roles` table duplicated in three frontend places plus a hardcoded RPC IN-list (per migration 36's own header, confirmed by reading `App.tsx` before that migration was written). Migration 36 adds tenant-scoped `org_groups` (seeded per-tenant with the 4 previous defaults as editable-but-not-deletable rows, `grants_review_approval boolean` as the one real permission bit in use today), three Chief-only SECURITY DEFINER RPCs (`chief_create_org_group`/`chief_update_org_group`/`chief_delete_org_group`), and rewires `chief_assign_user_role` to take an `org_group_id` instead of a hardcoded role-id string. Wired into `RoleDelegationPanel.tsx` (composed into F9). Migration 36 also fixes a latent bug found in the same investigation: `user_roles`' RLS was `TO authenticated` only, but this app has no Supabase Auth session for the plaintext-code flow, so `getDelegatedRoles()` had been returning zero rows unconditionally since migration 01 — widened to the app's established permissive posture.

**`workforce_categories` (migration 39) — CRUD panel now wired in, confirmed this pass.** Same pattern as `org_groups` one migration later: tenant-scoped table seeded per-tenant with the 3 legacy `Category` union values (Registrar/Senior Registrar/Medical Officer) as editable-but-not-deletable `is_system_default` rows, three Chief-only SECURITY DEFINER RPCs (`chief_create_workforce_category`/`chief_update_workforce_category`/`chief_delete_workforce_category`), and a new nullable `workforce.category_id` FK added alongside the existing free-text `workforce.category` column rather than replacing it. `CategoryManagerPanel.tsx` (`src/modules/org-admin/components/dashboard/CategoryManagerPanel.tsx`, 220 lines) is that CRUD panel — **it was standalone/not composed into any dashboard at the previous registry snapshot; it is now directly imported into `ChiefDashboardView.tsx` (F9, see above) as the "Categories" tab.** The rewire this unblocks is still a followup, exactly as flagged in CLAUDE.md's own note on migration 36-40: `WorkforceRegistryPanel.tsx` (confirmed directly, line ~92/116) still reads and edits `member.category`, the old free-text column, not `category_id` — same gap `org_groups` had before `RoleDelegationPanel`/`App.tsx`'s `canApprove` checks were rewired onto it, just not yet closed for categories. CSV export and role-delegation forms were not independently re-checked this pass but are very likely on the same old column given `WorkforceRegistryPanel.tsx`'s own state.

### S5 Integrations Layer
layer: L3
face: shared
path: `src/modules/shared/lib/integrationsService.ts`; schema `supabase/migrations/33_integrations_layer.sql`
status: **scaffold exists — no longer absent, but still not a real integrations layer.** `integrations_catalog` (reference data, 8 seeded rows) and `integrations_connections` (per-tenant-or-per-individual status, 3-way owner-shape CHECK constraint mirroring migration 30's `user_subscriptions.scope` pattern) both exist and are read by two UI panels (M14/F19). Zero real OAuth/API integration flow exists for any of the 7 non-native rows — this remains a read-only catalog/status scaffold, exactly as its own migration header describes it ("a SCAFFOLD only"). Flutterwave/Paystack remain hardcoded directly into the billing Edge Functions rather than actually routed through this layer — the `payment-processor` catalog row documents that live integration but doesn't mediate it.

### S6 Agent Manifests (new)
layer: L3
face: shared
path: schema `supabase/migrations/34_agent_manifests.sql`, seed additions in `supabase/migrations/37_insights.sql`
status: **new this wave.** A lookup/registry table (`agent_manifests`: `agent_key`, `name`, `owner_engine`, `rung`, `description`, `gates`, `tenant_scope`) intended per spec §4/§7 as the place AI-assisted actions and agents formally declare their rung. Seeded with 10 rows (migration 34) documenting the existing 4 AI Copilot Edge Functions' individual actions (verbatim action-key strings from each function's own request contract, not invented), plus 1 more row (migration 37) for the new `babsbrain2_submission_chaser` agent (A1). **Important limitation, directly checked**: confirmed via repo-wide search that `agent_manifests` is referenced only by `src/modules/shared/lib/eventBus.ts`, `submissionChaserAgent.ts`, and `InsightsStrip.tsx` (via comments/the `insights.agent_key` foreign key) — **no Edge Function (`dissertation-copilot`, `research-copilot`, `casebook-copilot`, `roster-parser`) actually reads or writes this table at runtime.** It is a static reference/documentation table today, not yet a live orchestration registry; the FK relationship from `insights.agent_key → agent_manifests.agent_key` (migration 37) is the only place a manifest row is structurally required to exist.

---

## L2 Engines (existing AI Copilot Edge Functions)

### E1 dissertation-copilot
layer: L2
face: shared
path: `supabase/functions/dissertation-copilot/index.ts`
owner engine: privybrain-2
rung: 0
tenant scope: org
consumes: `dissertations` content (client-supplied), `tenant_ai_adaptation_rules` (feature_key `academic_copilot`)
emits: `ai_action_logs` rows (not a real event, a direct table write — still not routed through `eventBus.ts`)
udr fields: none
gates: doctor edits/accepts output before save (client-side only, no formal gate record)
status: fragmented, unchanged in this pass. Now has 3 corresponding rows in `agent_manifests` (S6) documenting its actions, but the function itself does not read that table.

### E2 research-copilot
layer: L2
face: shared
path: `supabase/functions/research-copilot/index.ts`
owner engine: privybrain-2
rung: 0
tenant scope: org, individual
consumes: `research_templates` (dynamic prompt build via `_shared/researchRubric.ts`), `tenant_ai_adaptation_rules` (feature_key `research_copilot`)
emits: `ai_action_logs`
udr fields: none
gates: doctor edits/accepts output before save
status: fragmented, unchanged in this pass. 3 corresponding `agent_manifests` rows (S6), not read at runtime.

### E3 casebook-copilot
layer: L2
face: shared
path: `supabase/functions/casebook-copilot/index.ts`
owner engine: privybrain-2
rung: 0-1
tenant scope: org, individual
consumes: `casebook_templates` (via `_shared/casebookRubric.ts`), `tenant_ai_adaptation_rules` (feature_key `casebook_copilot`)
emits: `ai_action_logs`
udr fields: none
gates: doctor edits/accepts output before save
status: fragmented, unchanged in this pass. 3 corresponding `agent_manifests` rows (S6), not read at runtime.

### E4 roster-parser
layer: L2
face: shared
path: `supabase/functions/roster-parser/index.ts`
owner engine: babsbrain-2
rung: 0
tenant scope: org
consumes: `raw_roster_uploads` text, `tenant_ai_adaptation_rules` (feature_key `roster_parser`)
emits: `ai_action_logs`
udr fields: none
gates: HITL review in F10 before the parsed roster is published (manual)
status: fragmented, unchanged in this pass. 1 corresponding `agent_manifests` row (S6), not read at runtime.

---

## L1 Agents

### A1 babsbrain2_submission_chaser (Submission Chaser)
layer: L1
face: none (see F18 for its dashboard face)
path: `src/modules/shared/lib/submissionChaserAgent.ts`; manifest seed `supabase/migrations/37_insights.sql`; dedup fix `supabase/migrations/38_insights_dedup_index.sql`
owner engine: babsbrain-2
rung: **1** (per the seeded `agent_manifests` row: `agent_key = 'babsbrain2_submission_chaser'`, `owner_engine = 'babsbrain-2'`, `rung = 1`, `tenant_scope = 'org'`)
tenant scope: org
consumes: `collections` (currently-open, per tenant), `workforce` (active, per tenant), `submissions` (for the open collection), `insights` (for its own dedup check)
emits: `insights` rows (persisted, dismissible); `insight.generated` on `event_log` (best-effort, via `emitEvent` — see S2)
udr fields: writes what should conceptually be `udr.insights[]`, but writes directly to the `insights` table rather than through `udr.ts` — see S3's gap note; `udr.ts` itself does not surface this agent's output
gates: **rung 1 = "shown as suggestion"** per spec §4 — no autonomous action is taken. The manifest's own `gates` text: *"Shown as a suggestion in InsightsStrip.tsx; no autonomous action taken — a human (org admin) reads the insight and decides whether to remind/reset the member's code. Dismissing is a plain UPDATE, not a gated approval flow."*
status: stable, new — **the first real agent in this app to run end-to-end through a persisted record**: reads existing operational state → writes a persisted `insights` row → emits an `event_log` row → is read back and rendered by a UI face (F18) with a working dismiss action. This closes the previous registry's "**None exist**" finding for L1 agents, at least for this one agent.

**Scope, exactly as implemented** (confirmed by reading the source): one signal only — active workforce members with no `submissions` row yet for the tenant's currently-open `collections` row, and only once that collection's `deadline` has passed (the open/closed `status` flag and "past deadline" are independent in this app, same distinction `ChiefDashboardView.tsx` already treats separately). Not a general-purpose rules engine.

**Idempotency, worth knowing exactly**: the dedup check is deliberately *not* the same formula as `getActiveInsights`'s "active" predicate (dismissed_at IS NULL AND cooldown_until has lapsed) — a literal reading of that formula would not be idempotent, since a freshly-inserted row's `cooldown_until` is 3 days in the future and would itself fail an "active" check, causing a same-day re-run to insert a second row. Instead, the insert-time dedup skips any subject with a not-yet-superseded row (not dismissed, OR dismissed but still inside its own cooldown). `cooldown_until` is left `null` at insert time (so a brand-new insight is immediately visible in F18) and is only set 3 days out when `dismissInsight()` is called. A genuine race (two near-simultaneous runs, e.g. a fast reload remounting `InsightsStrip` before the first run's insert was visible to the second run's dedup SELECT) was found live — 18 duplicate rows for 9 actually-pending residents — and fixed in migration 38 with a partial unique index (`(tenant_id, agent_key, subject_ref) WHERE dismissed_at IS NULL`) plus switching the insert to an `upsert(..., { ignoreDuplicates: true })` against that same conflict target.

---

*End of registry. Per spec §7/rule 12: update this file in the same change whenever you touch a component it describes.*
