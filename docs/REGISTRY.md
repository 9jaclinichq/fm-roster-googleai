# PrivyDoc Workspace — Component Registry

Per `docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md` §7, now read alongside
`docs/WORKSPC_PRODUCT_CONSTITUTION.md` as the higher product-direction
authority (see that document's §0 for how the two relate; `AGENTS.md`'s
source-of-truth hierarchy governs where any of these disagree).

**Slice 2 refresh (2026-08-20)**: brought current through migration `57_
doctor_ownership_rls_newer_modules.sql` and today's `src/modules/` tree, per
the Product Constitution's Slice 2 documentation-reconciliation task. Every
fact below marked as new/changed this pass was re-verified directly against
source and migration files, not copied forward from the previous snapshot
(which stopped at migration 43). Superseded passages from that snapshot are
kept and struck through in spirit (labeled **"[43-snapshot, superseded]"**)
rather than silently deleted, per this task's own instruction to preserve
history. **This pass is source/migration-file evidence only — no live
database was queried.** Per the Product Constitution §17/M10: a migration
file existing, or its own header claiming it was applied, is not proof of
live state. Distinguish, for everything below: *what exists in code*, *what
is wired to a face*, *what has live data per prior, separately-verified live-DB
passes recorded elsewhere in this file* (there are a few, inherited from
earlier audit passes that did have live access — not repeated or re-verified
here), and *what is simply unknown live*.

Status legend: `stable` = works, matches its current scope; `fixing` = mid-move
in the modularization pass; `fragmented` = still split across the old
`src/components/` and new `src/modules/` trees, or doing one god-file's worth
of unrelated things; `stub` = scaffolding exists but no real behavior yet.

**Note on migration status (headers, not live verification)**: migrations
32–35 each carry an explicit "NOT APPLIED LIVE — a human will review and
apply the pending batch" header comment; migration 36 carries no such
disclaimer. Migration 37 says "NOT APPLIED LIVE" yet migration 38's header
describes a *live* bug it fixed in 37's own output — an internal
contradiction, reported as-is, not resolved. Migrations 41/42/44/45/48 all
say "NOT APPLIED LIVE" in their own headers. **Migration 43 states neither.**
**Migrations 51 and 57 both explicitly say they were applied live via the
untracked `.tmp-run-migration.cjs` script "immediately after being written,"**
a different and newer self-reported pattern than the earlier "written for
review, a human applies afterward" convention 44/45/48 still use. Per the
Product Constitution's M10 (migration discipline): this registry does not
attempt to reconstruct or verify actual approval/application provenance for
any of the above — every claim in this paragraph is "what the header text
says," not "what is confirmed live." `docs/WORKSPC_PRODUCT_CONSTITUTION.md`
§17 already states any future production migration/application requires
explicit human review and approval regardless of what a header claims.

**Biggest remaining gap, [43-snapshot, superseded]**: that snapshot named
"Clinical & Professional Writing has no generic instance table at all" as the
single largest structural gap. **This is now closed at the schema/service
level** — migration 48 built `clinical_document_types`/`clinical_documents`,
seeded 3 generic templates, and `src/modules/clinical-writing/` exists with a
real service and panel (see M18 below). The gap has moved, not vanished: see
"Current biggest gaps" immediately below.

**Current biggest gaps, this pass**:
1. **Institutional-table RLS remains the single largest open item** —
   `workforce`/`submissions`/`collections`/etc. are still `USING (true)` for
   any anon-key holder, unchanged by migration 57 (which only closed the
   doctor-owned half — see S1/S-tenancy notes below and
   `docs/LIVING_SYSTEM_GAP_AUDIT.md`'s addendum §2). The Product Constitution
   §14/§17 now names closing this as a precondition for onboarding a second
   real organisation, not a someday item.
2. **Three real, additively-built org-side modules (Scheduling, Meetings,
   Clinical Writing) have zero individual/member-facing surface** — each is
   wired only as a `ChiefDashboardView.tsx` tab (see M16/M17/M18), with no
   `/workspace/*` or `/doctor/*` route of its own.
3. **Personal Productivity (migration 51) is fully live and fully wired into
   navigation today** (see M19) — this is a fact, not a recommendation. The
   Product Constitution's M6 calls for it to be HIDE/FROZEN from Workforce V1
   navigation; this registry does not change navigation (out of Slice 2
   scope) but flags the gap between constitutional direction and current
   wiring explicitly, for a future navigation slice to close.

## Product disposition (Slice 2 reconciliation taxonomy)

Per the Product Constitution's Slice 1 §15: **this taxonomy is a current
planning aid, not constitutional law.** It records this pass's assessment of
each current module/capability against the Constitution's Workforce-first V1
focus, so a future navigation/scoping slice has a starting point. It does not
authorize or perform any hide/retire/build action itself.

| Module (registry ref) | Disposition | Why |
|---|---|---|
| Auth / login (M2, F1–F5, F17) | KEEP | Identity/membership entry points; V1-foundational. |
| Forms — legacy monthly submission (M8) | KEEP | The live V1 workforce-collection wedge itself. |
| Roster Engine (M11) | KEEP | The live V1 roster-publication pipeline. |
| Announcements (M1) | KEEP | Named explicitly in V1 (minimal operational Announcements). |
| Org-admin / Chief Dashboard shell (F9) | KEEP, REFACTOR later | V1-foundational shell; mixes V1 and non-V1 tabs today — splitting it is future scoping work, not this slice's. |
| Workforce categories / org groups (S4) | KEEP | Contextual-permission foundation the Constitution's §14/M3 calls V1-foundational. |
| Event bus / UDR / Agent manifests (S2/S3/S6, A1–A3) | KEEP | The real seed of ambient intelligence and A0–A1 automation (Constitution §10/§11). |
| Integrations layer (M14) | INTEGRATE (direction), KEEP (current stub) | Matches Constitution §6 directly; underbuilt, not misdirected. |
| Forms & Pipelines generalisation (M13) | KEEP | The natural target primitive for M4's submissions↔roster recovery work — not this slice's to build. |
| Scored Rubric primitive (M15) | KEEP, unwire risk | Matches Constitution's Assessments/Rubrics ownership (§5); real but zero live usage. |
| Scheduling (M16) | HIDE for V1 | Real, additive, not in V1's named list (Constitution §15); park per M7-adjacent reasoning until Workforce V1 lands. |
| Meetings & Actions (M17) | HIDE for V1 | Explicitly parked as-is per the Constitution's M7. |
| Clinical & Professional Writing (M18) | HIDE for V1, UNCERTAIN long-term | Parked per M7; also a candidate boundary question against Constitution §7 ("word processor") worth a future explicit review, not decided here. |
| Personal Productivity (M19) | RETIRE-FROM-V1-NAV — human/future slice, currently still live | Constitution M6: HIDE/FREEZE, not delete, not develop further, not in V1 nav. Currently still fully wired into nav (see M19) — a future navigation slice, not this one, closes that gap. |
| Research, Casebook & Logbook, Dissertation, Exam Readiness, Viva Simulator | KEEP, defer | Real, live, not V1's focus; Constitution §12 names Research a likely future domain. |
| Consultant / Co-Resident Review (M5) | UNCERTAIN | Parked per Constitution M12; may inform a future shared Approval primitive. |
| Knowledge Packs (M9) | UNCERTAIN | Parked per Constitution M12; needs a future build-vs-integrate call against §6. |
| Billing (M3) | KEEP, REFACTOR (business, not code) | Real and live; gates content creation today, Constitution's Free=Operate/Paid=Automate (§4) is the target model — reconciling the two is a business decision, not in this slice's scope. |
| Platform Operator Console (F8) | KEEP, REFACTOR (relocate) | Necessary; still outside `src/modules/`, unchanged since the modularisation pass. |

## Registry engine-attribution terminology (revised 2026-08-20)

Every `owner engine:` field below previously read `privybrain-2`, `babsbrain-2`, or a `(target)`
variant of one of the two, inherited verbatim from `docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md`'s L2
engine model. Per the Product Constitution's Slice 2, Decision 1: those names belong to a different,
unrelated sibling product and must not continue as active ownership labels in this registry.

Every `owner engine:` field has been revised to one of:
- **`none`**, when no real or intended in-repo AI/automation component is involved, or
- **`none — intelligence/automation layer, concretely <in-repo module/service/agent/Edge Function
  name>`**, when a real in-repo component already does the work, or
- **`none — intelligence/automation layer (target; ...)`**, when the ownership is still purely
  conceptual/aspirational and no in-repo component implements it yet.

No replacement branded engine name has been invented, per the Constitution's explicit instruction.
This is a labeling change only — no component was moved, renamed, or rewired to produce it.

**Known, deliberately unresolved, out of this slice's scope**: the `agent_manifests.owner_engine`
database column and the `agent_key` values themselves (`babsbrain2_submission_chaser`,
`babsbrain2_meeting_action_chaser`, `privybrain2_rubric_compliance_chaser`) still literally store the
old branding — quoted verbatim below (S6, A1–A3) as a factual record of current stored data, not as
an endorsed active label. Renaming those is a schema change, out of scope for a documentation-only
slice; flagged here so a future slice doesn't have to rediscover it.

---

**Governance/Registry Reconciliation pass (2026-08-21)**: brought current
through migration `65_seed_workforce_emails.sql` and today's local HEAD. This
pass adds the Priority-0 Tenant Surface security work (migrations 58–63), the
resident email/login contract (migrations 64/65), Workforce Option A
(commits `0e6cbed`/`b733d87`, no migration), and one local-only commit past
production. Every fact this pass added or changed is tagged inline with one
of the three markers below — untagged prior-pass text is unchanged by this
pass, not silently re-verified.

**Deployment-boundary tags used from this pass forward**:
- **[LIVE]** — applied to and verified against the production Supabase
  project at `origin/main @ c4d29c6`.
- **[LOCAL-ONLY]** — exists in this worktree's local git history past that
  commit, not deployed, not pushed. Do not infer it is live.
- **[PLANNED/DEFERRED]** — specified or scoped but deliberately not
  implemented yet, per an explicit locked decision.

**Deployment boundary, stated plainly**: production is **[LIVE]** `origin/main
@ c4d29c6`, migrations 58–65 manually applied/verified at that commit. Local
development HEAD sits one commit past that — **[LOCAL-ONLY]** `01bb0aa`
(tenant client-surface minimization, see S4 below). The Supabase CLI migration
ledger remains unreconciled against this linear file history (see
`docs/DATABASE_AND_SECURITY.md`); `supabase db push` remains prohibited.

**Harness inventory, current (see `docs/TESTING_AND_VERIFICATION.md` for the
full classification of each)**: `scripts/verify-tenant-surface.cjs` (static/
string tripwire, plus opt-in read-only-remote and local/test-mutation modes),
`scripts/verify-resident-email-login.cjs` (static tripwire + logic-level),
`scripts/verify-e0-containment.cjs` (static tripwire), `scripts/verify-roster-
reconciliation.ts` (logic-level). None are integration tests against a real
Postgres instance or a formal proof.

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
consumes: `tenants` — now via `list_public_tenants()` (migration 58, **[LIVE]**, see S4), not the raw `getTenants()` table read; `workforce` (by tenant), terminology overrides
emits: none (writes session to localStorage client-side only, not an event)
udr fields: none (no formal UDR write path yet — see S3)
gates: none
status: stable — already does tenant → member → code → registered-email order (migration 26). **Updated this pass — [LIVE], migrations 64/65**: `verify_resident_login()` now returns a `has_email` boolean (never the stored email value); a blank/missing email never blocks a valid-PIN login for a member whose `workforce.email` is still NULL; a seeded email must still match. `PostLoginEmailPrompt.tsx` (new component, not independently registered elsewhere in this file) offers a lightweight, dismissible post-login capture calling `resident_set_email()` — which independently re-verifies `workforce_id + resident_code + active` server-side and is the sole write path for `workforce.email`. This is explicitly transitional resident-code-based identity, not Institutional Auth. Migration 65 seeded 23 of 31 active workforce rows with a real email (Dr. Olanipekun's own row was already correct and deliberately left untouched by 65); 24 active members now have email, 7 remain unseeded by design.

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
status: **[43-snapshot figures superseded: 1,169 lines / 9 panels]** `ChiefDashboardView.tsx` is now **1,339 lines** (grown from 1,169 at the 43-snapshot) with an **18-value `activeTab` union** (`submissions | pending | workforce | announcements | roles | knowledge | roster | customization | templates | forms | integrations | categories | scheduling | meetings | clinical-writing | agents | activity | settings`, confirmed by direct read of the `useState` declaration), up from the 43-snapshot's smaller set. Directly-imported panels confirmed this pass (from `src/modules/org-admin/components/dashboard/`): `SubmissionsPanel`, `PendingResidentsPanel`, `WorkforceRegistryPanel`, `AnnouncementsAdminPanel`, `RoleDelegationPanel`, `CollectionSettingsPanel`, `FormsBuilderPanel`, `IntegrationsPanel`, `CategoryManagerPanel`, and **new this pass**: `AgentRegistryPanel` (S6) and `ActivityLogPanel` (S2). The 4 previously-confirmed lazy-loaded views (`MultiRosterManagerView`, `TenantCustomizationView`, `TemplateManagerView`, `KnowledgePackManagerView`) were not re-verified line-by-line this pass but their tabs remain in the `activeTab` union; `SchedulingBuilderView`/`MeetingsPanel`/`ClinicalWritingPanel` (M16/M17/M18) are also composed here, per those modules' own "wired into ChiefDashboardView's tab" status, not independently re-confirmed as lazy vs. eager this pass. Still not a pure composition shell — now larger than the 43-snapshot, not smaller — so still marked `fixing` rather than `stable`. Also renders **F18 `InsightsStrip`** between the KPI cards and the tab switcher, unchanged.

### F10 Org-Admin: Multi-Roster Manager (HITL roster editor)
layer: L5
face: org-admin
path: `src/modules/org-admin/components/dashboard/MultiRosterManagerView.tsx`
owner engine: none — intelligence/automation layer, concretely the `roster-parser` Edge Function (E4)
tenant scope: org
consumes: `raw_roster_uploads`, `combined_master_rosters`, `roster_types`, `workforce`
emits: none
udr fields: none
gates: Chief session
status: fragmented — **path corrected**: moved out of `src/components/` in the org-admin split, but into `org-admin/components/dashboard/`, not into its own module's `roster-engine/components/`. `roster-engine` (M11 below) is still lib-only (`uchRosterParser.ts`); this face lives in a different module's folder than the lib it calls, which is itself a cross-module import (`org-admin` face importing `roster-engine`'s lib) — not a new problem, just re-homed rather than resolved. **New this pass — [LIVE], no migration, commits `0e6cbed`/`b733d87` (Workforce Option A)**: now also renders a read-only reconciliation checklist (`src/modules/roster-engine/lib/rosterReconciliation.ts`) surfacing rotation-vs-on-floor conflicts, unmatched rotations, and declared-leave/roster-overlap discrepancies — deterministic, conservative matching, no writes anywhere. Hardened against adversarial findings (whitespace-tolerant matching, reversed-leave-range detection) with its own regression harness, `scripts/verify-roster-reconciliation.ts` (10/10 passing). Matches its own spec's (`docs/WORKFORCE_V1_RECOVERY_SPEC.md`) acceptance criteria; real-cycle validation is underway now. **Workforce Option B (write-through/derive `on_floor` from submissions) remains [PLANNED/DEFERRED]** pending that real-cycle evidence, per the spec's own §8 — not started.

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
owner engine: none — intelligence/automation layer (conceptually "submission chaser" per the living-system spec §7, itself superseded — see Decision 1 note above; **note this is a distinct, older client-side derivation, not the same code as the new L1 `submissionChaserAgent.ts` below** — the two currently coexist unmerged)
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
status: `LoadingShell` stable. `DevHelper` — **flagged in CLAUDE.md as the single highest-priority security finding**: mounted unconditionally in `App.tsx`. Not re-verified line-by-line in this pass (still present, unchanged path/behavior). **CORRECTION (2026-08-21, governance-hygiene pass) — this finding is stale.** Directly re-verified against current `App.tsx` (lines 483-490): `DevHelper` is gated behind `{import.meta.env.DEV && (<DevHelper .../>)}`, with a comment stating it is "local development builds only. Never rendered in a production/preview build, so it can't leak into a deployed site." This is not an open highest-priority security issue.

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
owner engine: none — intelligence/automation layer, concretely `submissionChaserAgent.ts` (A1)
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
owner engine: none — intelligence/automation layer (target; no in-repo agent implemented yet)
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
owner engine: none — intelligence/automation layer (target — "payment watcher" concept; no in-repo agent implemented yet)
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
owner engine: none — intelligence/automation layer, concretely `casebookCopilot.ts` (calls the `casebook-copilot` Edge Function, E3)
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
owner engine: none — intelligence/automation layer, concretely `academicCopilot.ts` (calls the `dissertation-copilot` Edge Function, E1)
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
owner engine: none — intelligence/automation layer (target — "compliance checker" concept; no in-repo agent implemented yet)
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
owner engine: none — intelligence/automation layer (target; no in-repo agent implemented yet)
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
owner engine: none — intelligence/automation layer (target; no in-repo agent implemented yet)
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
owner engine: none — intelligence/automation layer, concretely `researchCopilot.ts` (calls the `research-copilot` Edge Function, E2)
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
owner engine: none — intelligence/automation layer, concretely `uchRosterParser.ts` (calls the `roster-parser` Edge Function, E4)
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
owner engine: none — intelligence/automation layer (target; no dedicated AI Copilot lib identified in this module's own path)
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
owner engine: none — intelligence/automation layer (target; no in-repo agent implemented yet)
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
emits: none from this primitive's own engine directly; **A3 (`privybrain2_rubric_compliance_chaser`) reads `rubric_instances` and emits `insight.generated`** — see A3 below
udr fields: `udr.ts`'s `entries[]` includes `rubric_instance` rows via `fetchRubricInstances`, scoped by `assessor_workforce_id`/`assessor_doctor_id` (2026-08-17 extension — new since the 43-snapshot, see S3)
gates: **[43-snapshot superseded: "RLS is fully permissive on all 4 tables"]** — migration 57 gave all 4 tables a real doctor-owned RLS boundary: `rubric_templates` a direct 3-state check, `rubric_sections`/`rubric_items` a join-based check back to their owning template, and `rubric_instances` its own 4th shape (`tenant_id IS NOT NULL OR assessor_workforce_id IS NOT NULL OR (assessor_doctor_id IS NOT NULL AND auth.uid() = assessor_doctor_id)` — flagged in migration 57's own header as compensating for a real pre-existing gap in migration 41: `rubric_instances` has two separate assessor columns with no ownership-exclusivity CHECK constraint between them). Institutional and global-template rows remain exactly as permissive as before — only a purely doctor-claimed row now requires the matching `auth.uid()`.
status: **[43-snapshot carried forward — still real/unwired at the primitive-usage level; RLS gap above is now closed, usage gap is not]** `rubric_templates`/`rubric_sections`/`rubric_items`/`rubric_instances` and the `compute_rubric_totals(p_instance_id)` SQL/PLPGSQL RPC (server-side aggregation: sums each section's scored items against `max_points`, checks `pass_threshold`, flags any zero-scored item in an `all_items_required` section, derives a fixed 3-value `recommendation` band) all exist and are internally complete. But `RubricInstanceForm.tsx` — the only rendering UI for this primitive — is imported by **nothing**: a repo-wide grep for `RubricInstanceForm` outside its own file turns up exactly one hit, a comment in `scoredRubricEngine.ts`, not an actual import. No face (Chief dashboard, doctor workspace, or otherwise) opens this form, and no seed rubric content exists in `rubric_templates` — migration 41's own header explicitly declines to seed real rubric content, deferring to Dr. Olanipekun supplying authoritative WACP/OSCE/credentialing documents per CLAUDE.md's "Sourcing module content" policy. Migration 41 also carries its own "NOT APPLIED LIVE" header (see intro note) — so today this is schema-plus-library code with zero live rows and zero consumers, the newest addition to this registry's "built but unwired" gap list (see intro "biggest remaining gap" note).

**Known data-integrity gap — `rubric_instances` assessor ownership (per Product Constitution Slice 2,
Decision 2)**: `rubric_instances` carries two separate assessor columns, `assessor_workforce_id` and
`assessor_doctor_id`, with **no exclusivity constraint between them** — unlike every other
doctor/institutional ownership pair in this schema (`personal_tasks`, `wellbeing_entries`,
`focus_sessions`, `scheduling_instances`, `meeting_series`, `clinical_document_types` all have an
explicit CHECK enforcing exactly one owner is set). Migration 57's own header independently names
this "a real gap in migration 41, not introduced here" and compensates for it only at the RLS level
(see `gates` above), not at the schema level. No schema change or migration is made in this slice —
recorded here as a known gap with the following constraints on how it may eventually be closed:
- Intended ownership semantics must be confirmed first (can an instance legitimately have both a
  workforce assessor and a doctor assessor at once — e.g., co-assessment — or should this always have
  been an exactly-one-of pair like every sibling table?) before any constraint is designed.
- Any live/current rows must be checked through an approved process before adding a constraint —
  per earlier passes' own findings, `rubric_instances` is believed to have zero live rows, but that
  belief is itself unverified live-database state, not a basis for assuming a constraint would be
  safe to add without checking first.
- The eventual design should prevent ambiguous simultaneous assessor ownership, whatever the
  confirmed intended semantics turn out to require.
- Exact nullability/XOR rules require a separately reviewed specification — not decided here.
- **Further expansion of this assessor model is frozen** until the integrity question above is
  resolved — no new code should add a third assessor-shaped column or a new consumer that assumes
  today's two-column shape is safe to build on.
- **This is not a Workforce V1 blocker** unless Workforce Operations begins depending on this rubric
  ownership path — today it does not (Workforce V1's own path runs through `submissions`/`workforce`,
  not `rubric_instances`).

### M16 Scheduling
layer: L4
face: org-admin (no member-facing face — see gap note)
path: builder/panel — `src/modules/scheduling/components/SchedulingBuilderView.tsx`; data access — `src/modules/scheduling/lib/schedulingService.ts`; schema — `supabase/migrations/44_scheduling_module.sql`, RLS extended by `57_doctor_ownership_rls_newer_modules.sql`
owner engine: none — intelligence/automation layer (target; no in-repo agent implemented yet)
tenant scope: org, and schema-only doctor-owned (`doctor_id` column exists on `scheduling_instances`/`scheduling_entries`; no doctor-scoped UI consumes it yet)
consumes: `scheduling_instances`, `scheduling_entries`, `scheduling_pipelines`
emits: `instance.created` on `event_log`, confirmed via `schedulingService.ts`'s `createSchedulingInstance` (see S2)
udr fields: `udr.ts`'s `pipelines[]` reads `scheduling_pipelines` for the caller's tenant (extended 2026-08-17, see S3); `instances[]` deliberately does NOT include `scheduling_instances` — `udr.ts`'s own header explains why (a scheduling instance is shared tenant/doctor-scope config, not a personal record, unlike `research_workspaces`/`casebook_workspaces`)
gates: none
status: **[43-snapshot, superseded: previously "scoped, not yet built"] — now real, additive, built exactly as scoped.** `docs/SCHEDULING_MODULE_SCOPING.md`'s recommended path (b) was implemented: `raw_roster_uploads`/`combined_master_rosters`/`MultiRosterManagerView.tsx`/`uchRosterParser.ts` (M11 Roster Engine) remain completely untouched — this is a fully separate, parallel system, not a replacement or a connection to it (see the Product Constitution's M4 on why that connection is deliberately not being made yet). RLS: `scheduling_instances`/`scheduling_entries` got a real `auth.uid() = doctor_id` boundary in migration 57 (shapes (a)/(b) in that migration's header); `scheduling_pipelines` was explicitly left permissive (57's header: "no doctor-owned pipeline concept exists yet"). Wired into `ChiefDashboardView.tsx`'s `'scheduling'` tab (confirmed in the `activeTab` union, F9) — **no `/workspace/scheduling` or `/doctor/scheduling` route exists**, so this module has zero member-facing or individual-doctor-facing surface today, org-admin only. Disposition: see the product-disposition table above — HIDE for V1 (not in the Constitution's named V1 list), keep built.

### M17 Meetings & Actions
layer: L4
face: org-admin (no member-facing face — see gap note)
path: builder/panel — `src/modules/meetings/components/MeetingsPanel.tsx`; data access — `src/modules/meetings/lib/meetingsService.ts`; schema — `supabase/migrations/45_meetings_module.sql`, RLS extended by `57_doctor_ownership_rls_newer_modules.sql`; its rung-1 agent — see A2 below
owner engine: none — intelligence/automation layer, concretely `meetingActionAgent.ts` (A2) for the action-tracker intelligence; no AI Copilot for meeting content itself
tenant scope: org, and schema-only doctor-owned (same posture as M16 — `doctor_id` columns exist, no doctor-scoped UI)
consumes: `meeting_series`, `meetings`, `meeting_actions`
emits: `instance.created` (series creation), `meeting.scheduled` (occurrence creation) — both confirmed in `meetingsService.ts`; `meeting.action.owed` is **not** emitted at action-creation time (the file's own comment documents a deliberate design change: firing it at creation would be premature since most actions aren't yet overdue) — it's emitted instead by the separate `meetingActionAgent.ts` (A2) when an action is actually found overdue
udr fields: `udr.ts`'s new `meetings[]` field (2026-08-17 extension, see S3) — scoped to "meetings this person owes an action on" via `meeting_actions.owner_workforce_id`, matching spec §5's own framing; returns `[]` today since `meeting_actions` has no confirmed live rows yet (schema/path real, no known producer of real usage)
gates: none
status: **[43-snapshot, superseded: previously "gap — not built, not found"] — now real, built exactly as scoped, and the first of the newer modules to gain its own rung-1 agent.** `meeting_series`/`meetings`/`meeting_actions` all exist (migration 45), seeded with one global "Standing Departmental Meeting" template. RLS: `meeting_series`/`meetings` got the real doctor-owned boundary in migration 57; `meeting_actions` was explicitly left permissive (57's header: "has ONLY owner_workforce_id, no doctor_id column at all — no doctor-owned row shape to protect"). Wired into `ChiefDashboardView.tsx`'s `'meetings'` tab — same no-member-facing-route gap as M16. **New since the 43-snapshot**: `src/modules/shared/lib/meetingActionAgent.ts` (A2 below, migration 50) is a real rung-1 agent that reads overdue `meeting_actions` and raises a dismissible insight. Disposition: HIDE for V1 per the Constitution's M7 (explicitly named — "park Meetings/Clinical Writing/Research as-is for Workforce V1, do not perform V1-adjacent feature development in them").

### M18 Clinical & Professional Writing
layer: L4
face: org-admin (no member-facing face — see gap note)
path: builder/panel — `src/modules/clinical-writing/components/ClinicalWritingPanel.tsx`; data access — `src/modules/clinical-writing/lib/clinicalWritingService.ts`; schema — `supabase/migrations/48_clinical_writing_module.sql`, RLS extended by `57_doctor_ownership_rls_newer_modules.sql`
owner engine: none — intelligence/automation layer (target; no in-repo agent implemented yet — the living-system spec's engine-assignment convention this entry previously cited is itself superseded, see Decision 1 note above)
tenant scope: org, and schema-only doctor-owned (same posture as M16/M17)
consumes: `clinical_document_types`, `clinical_documents`
emits: `instance.created` (document-type creation), `entry.submitted` (document creation) — both confirmed in `clinicalWritingService.ts`
udr fields: `udr.ts`'s `entries[]` includes `clinical_document` rows via `fetchClinicalDocuments`, scoped by `created_by_workforce_id` (2026-08-17 extension, see S3) — a real, working read path, distinct from `instances[]`, which deliberately excludes `clinical_document_types` for the same shared-config-not-personal-record reasoning as M16's `scheduling_instances`
gates: none
status: **new entry this pass — this module did not exist in the 43-snapshot and had no registry entry at all** (migration 48 postdates it). Real, additive: `clinical_case_reports`/`case_reports`/`casebook_templates`/`casebook_workspaces`/`DissertationAssistantView.tsx`/`dissertations` are all confirmed completely untouched by this module, per its own migration header and `docs/CLINICAL_WRITING_MODULE_SCOPING.md`'s explicit recommendation to keep case write-ups owned by Casebook & Logbook rather than folding them in here. Seeded with 3 global document types (Referral Letter, SOP/Protocol Template, General Clerking Template), each a structured `body_template` of guided fields — not free-text word-processing, though it is a native long-form drafting surface. Explicitly does NOT attach to the Scored Rubric primitive (M15) in this first slice, per the migration's own header, despite `clinical_documents.subject_ref` following the same convention `rubric_instances.subject_ref` uses. Version history (`clinical_document_versions`) was explicitly skipped in this first slice — `clinical_documents.updated_at` (plain overwrite) is the only history today. Wired into `ChiefDashboardView.tsx`'s `'clinical-writing'` tab — same no-member-facing-route gap as M16/M17. Disposition: HIDE for V1 per the Constitution's M7 (named explicitly alongside Meetings/Research). Also flagged in the product-disposition table above as UNCERTAIN long-term — a native structured-document-authoring surface is close to the boundary the Constitution's §7 warns against ("a word processor"), worth an explicit future review rather than an assumption either way.

### M19 Personal Productivity
layer: L4 (folded into the `shared` module folder, not its own — see path)
face: doctor, org-admin (fully member-facing, unlike M16–M18)
path: UI — `src/modules/shared/ui/{FocusModeView,WellbeingView,PersonalTasksView,TeamDirectoryView}.tsx`; data access — `src/modules/shared/lib/{focusSessionService,wellbeingService,personalTasksService}.ts` (Team Directory needs no service — a read-only view over `workforce`); schema — `supabase/migrations/51_personal_productivity_module.sql`
owner engine: none declared
tenant scope: workforce-owned (permissive) and doctor-owned (real `auth.uid() = doctor_id` RLS boundary, confirmed in migration 51 itself — this module shipped WITH real doctor-owned RLS from day one, unlike M16–M18's schema-only doctor columns)
consumes: `personal_tasks`, `wellbeing_entries`, `focus_sessions` (Team Directory reads `workforce` directly, no new table)
emits: none confirmed (no `emitEvent` call found in any of the three service files)
udr fields: none
gates: none
status: **new entry this pass — no registry entry existed for this at the 43-snapshot** (migration 51 postdates it, and this module doesn't correspond to any of the living-system spec's 10 named capabilities at all — it was sourced from an unrelated Flutter product concept study, per the migration's own header). **Confirmed fully live-routed**, unlike M16–M18: `App.tsx` wires `/workspace/{focus,wellbeing,tasks,team}` and `/doctor/{focus,wellbeing,tasks}` (doctor routes redirect a linked doctor to the `/workspace/*` equivalent, same pattern as research/casebook), and `Navbar`/`DoctorHomeView` navigation callbacks target these routes directly — this is real, member-facing, in-nav functionality today, the only one of the four newest modules that is. Ownership shape is deliberately `workforce_id`/`doctor_id` (not `tenant_id`/`doctor_id`) since a personal task/mood entry/focus session belongs to exactly one person, never "the org" — migration 51's own header explains why this differs from every other module's ownership convention. **Constitutional flag, not acted on in this slice**: the Product Constitution's §7 names "a generic task manager" as something Workspc deliberately does not build, and its M6 explicitly calls for this module to be HIDE/FROZEN from Workforce V1 navigation — that is a navigation change, out of Slice 2's scope (Slice 2 may not modify navigation), so it is recorded here as a gap for a future slice, not fixed now.

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
path: `src/modules/shared/lib/eventBus.ts`; read-out face — `src/modules/org-admin/components/dashboard/ActivityLogPanel.tsx` via `src/modules/shared/lib/auditLogService.ts`
owner engine: none
tenant scope: any
consumes: nothing directly (still write-only at the bus level — see gap note)
emits: `event_log` rows (any string; `EventType` union in this file covers §6's vocabulary for editor autocomplete only, not DB-enforced)
udr fields: none
gates: none
status: **[43-snapshot, superseded: previously "one real caller, nothing reads it back"] — materially more real this pass, on both the write and read side.** Still a plain typed insert wrapper (`emitEvent`) — explicitly no pub/sub, no listeners, no in-process dispatch, per the file's own header; that architectural fact is unchanged. What changed: **confirmed 8 real call sites now**, not 1 — `src/lib/databaseService.ts` (`entry.updated`/`entry.submitted` in `submitRoster`, `ai.action_completed` in `logAiAction`, `tenant.provisioned` in `createTenantWithAdmin`, `instance.created` in both `createResearchWorkspace`/`createCasebookWorkspace`, `academic.signoff_recorded` in `addLogbookSignoff`), `schedulingService.ts` (`instance.created`), `meetingsService.ts` (`instance.created`, `meeting.scheduled`), `clinicalWritingService.ts` (`instance.created`, `entry.submitted`), and all three L1 agents (`submissionChaserAgent.ts`, `meetingActionAgent.ts`, `rubricComplianceAgent.ts` — `insight.generated`/`meeting.action.owed`). **`event_log` also has a real reader now**: `ActivityLogPanel.tsx` (new since the 43-snapshot, wired into `ChiefDashboardView.tsx`'s `'activity'` tab) lists recent tenant-scoped events via `auditLogService.listRecentEvents`, with a collapsible raw-payload view per row — a genuine, if simple, activity trail, closing the "nothing reads this back out" gap `eventBus.ts`'s own header still describes as future work. Still not a bus in the pub/sub sense — this is one write path plus one read face, not in-process dispatch to multiple subscribers.

### S3 Unified Doctor Record (UDR)
layer: L3
face: shared
path: `src/modules/shared/lib/udr.ts`
owner engine: none
tenant scope: any
consumes: `workforce`, `doctor_profiles`, `tenants`, `research_workspaces`, `casebook_workspaces`, `submissions`, `case_reports`, `dissertations`, `dissertation_milestones`, `exam_readiness`, `user_subscriptions`, **now also** `insights`, `clinical_documents`, `rubric_instances`, `meeting_actions`, `meetings`, `form_pipelines`, `scheduling_pipelines`
emits: nothing (pure read composition, no writes)
udr fields: `identity`, `tenant`, `instances[]`, `entries[]`, `academic`, `billing`, **`insights[]` — now real** (see below), **`meetings[]`, `pipelines[]` — new this pass, real**, `audit[]` — confirmed still always `[]`, by design (see below)
gates: none
status: **[43-snapshot, superseded: "`insights[]` hardcoded to `[]`, `meetings[]`/`pipelines[]`/`audit[]` didn't exist"] — the file's own header documents a 2026-08-17 extension that closes most of this**, independently confirmed by reading the current source, not just the header's own claim:
- **`insights[]` is now real**, not hardcoded — `fetchInsights`/`fetchInsightsForDoctor` query the `insights` table directly (migration 37/49), scoped by `workforce_id` or `doctor_id`. The workforce path has real data (Submission Chaser, A1, writes it); the doctor-scoped path is no longer merely theoretical either — `rubricComplianceAgent.ts` (A3, migration 50) is confirmed to write doctor-scoped insights in its "unlinked doctor sweep" mode, per that migration's own header.
- **`meetings[]` is new and real** (not present in the 43-snapshot at all, since Meetings didn't exist yet) — scoped to "meetings this person owes an action on" via `meeting_actions.owner_workforce_id`, matching spec §5's framing exactly. Returns `[]` in practice today since no confirmed live `meeting_actions` rows exist yet — a real path with, as far as this pass can confirm from source alone, no live producer yet.
- **`pipelines[]` is new and real** — reads `form_pipelines`/`scheduling_pipelines` scoped through the owning instance's `tenant_id`. `udr.ts`'s own header is candid that `ranAt` really means "defined/created at," not a genuine per-execution timestamp, since no per-run pipeline-execution log exists anywhere in this schema.
- **`audit[]` is confirmed still always `[]`**, and unlike the three fields above, this one has **no real backing data source at all** per the file's own header: `event_log` has no per-person actor column, so scoping it to a person is not possible without misattributing every other tenant member's events. This remains the one genuinely unclosed field in this section — not a wiring gap like the others were, but a real missing-column gap in `event_log` itself.
- `instances[]` deliberately still does NOT expand to cover `scheduling_instances`/`clinical_document_types` (see M16/M18's own udr-fields notes for why — shared config, not personal records) and still does not expand into `research_chapters`/`clinical_case_reports` at the sub-instance level (kept at the coarser `instances[]` granularity, unchanged from the 43-snapshot).
- `billing` is unchanged from the 43-snapshot: only reflects `workforce_id`-scoped subscriptions, never `scope='tenant'` org-wide ones or an unlinked doctor's billing.

### S4 Tenant Config Service
layer: L3
face: shared
path: partially — `databaseService.getTenant()`/`getTenants()` + the `tenants` table's `module_flags`/`terminology_overrides`/`call_duty_rules` columns; **now also `org_groups` (migration 36)** for the delegatable-role-vocabulary slice, **and `workforce_categories` (migration 39)** for the workforce-grade-vocabulary slice
status: fragmented, **one real sub-gap narrowed this wave**. Config still exists as ad hoc columns/tables read directly by whichever face needs them (F12 `TenantCustomizationView`, `terminology.tsx`, each Edge Function's `tenantAdaptation.ts`), not a single service with its own contract — that part is unchanged. What's new: the spec's own rule 10 ("groups are org-defined vocabulary, not a fixed hierarchy") was previously violated by a genuinely global, hardcoded 4-row `roles` table duplicated in three frontend places plus a hardcoded RPC IN-list (per migration 36's own header, confirmed by reading `App.tsx` before that migration was written). Migration 36 adds tenant-scoped `org_groups` (seeded per-tenant with the 4 previous defaults as editable-but-not-deletable rows, `grants_review_approval boolean` as the one real permission bit in use today), three Chief-only SECURITY DEFINER RPCs (`chief_create_org_group`/`chief_update_org_group`/`chief_delete_org_group`), and rewires `chief_assign_user_role` to take an `org_group_id` instead of a hardcoded role-id string. Wired into `RoleDelegationPanel.tsx` (composed into F9). Migration 36 also fixes a latent bug found in the same investigation: `user_roles`' RLS was `TO authenticated` only, but this app has no Supabase Auth session for the plaintext-code flow, so `getDelegatedRoles()` had been returning zero rows unconditionally since migration 01 — widened to the app's established permissive posture.

**New this pass — Priority-0 Tenant Surface security work, migrations 58–63, all [LIVE]**: public pre-login discovery now goes through `list_public_tenants()` (migration 58, locked projection `id, name, institution, department`, no private field ever included), consumed by both real call sites (`TenantSelectorView.tsx`, `ResidentLoginView.tsx`) — `databaseService.getTenants()` (raw `select('*')`) has zero remaining consumers outside `databaseService.ts` itself, confirmed by the harness's static grep. Chief-scoped tenant config reads/writes go through `chief_get_tenant`/`chief_update_tenant_terminology`/`chief_update_tenant_module_flags` (migration 59); platform-operator tenant creation/status/plan changes go through their own capability-checked RPCs (migrations 60/62), each independently re-verifying `shared_code`/`admin_code` server-side rather than trusting prior login state. Migration 63 **[LIVE]** dropped the permissive `tenants_insert`/`tenants_update` policies outright — no client anywhere retains a direct write path to `tenants`. `tenants_select` **remains `USING(true)`, [PLANNED/DEFERRED]** pending Institutional Auth (residents/members have no server-verifiable credential today for a real per-tenant read policy to check against) — this is the single largest remaining tenant-surface gap, not closed by any of the above.

**Local-only, not live — [LOCAL-ONLY] commit `01bb0aa`**: `databaseService.getTenant()` (the one remaining full-row consumer, still used by `terminology.tsx`/`CasebookBuilderView.tsx` pending Institutional Auth) is narrowed from `select('*')` to exactly `id, terminology_overrides, module_flags`, with a new allow-list regression guard in `scripts/verify-tenant-surface.cjs`. Classified explicitly as **tenant client-surface minimization / defense-in-depth, not database-level closure** — `tenants` has never had a `REVOKE`/column-allow-list applied (unlike `workforce`/`settings`, migration 02), so a direct anon-key query against `tenants` outside this helper can still read `paystack_subaccount_code`/`plan_type`/`status` today. See `docs/DATABASE_AND_SECURITY.md`'s Tenant-Surface Posture section.

**`workforce_categories` (migration 39) — CRUD panel now wired in, confirmed this pass.** Same pattern as `org_groups` one migration later: tenant-scoped table seeded per-tenant with the 3 legacy `Category` union values (Registrar/Senior Registrar/Medical Officer) as editable-but-not-deletable `is_system_default` rows, three Chief-only SECURITY DEFINER RPCs (`chief_create_workforce_category`/`chief_update_workforce_category`/`chief_delete_workforce_category`), and a new nullable `workforce.category_id` FK added alongside the existing free-text `workforce.category` column rather than replacing it. `CategoryManagerPanel.tsx` (`src/modules/org-admin/components/dashboard/CategoryManagerPanel.tsx`, 220 lines) is that CRUD panel — **it was standalone/not composed into any dashboard at the previous registry snapshot; it is now directly imported into `ChiefDashboardView.tsx` (F9, see above) as the "Categories" tab.** The rewire this unblocks is still a followup, exactly as flagged in CLAUDE.md's own note on migration 36-40: `WorkforceRegistryPanel.tsx` (confirmed directly, line ~92/116) still reads and edits `member.category`, the old free-text column, not `category_id` — same gap `org_groups` had before `RoleDelegationPanel`/`App.tsx`'s `canApprove` checks were rewired onto it, just not yet closed for categories. CSV export and role-delegation forms were not independently re-checked this pass but are very likely on the same old column given `WorkforceRegistryPanel.tsx`'s own state.

**CORRECTION (2026-08-21, governance-hygiene pass) — the `WorkforceRegistryPanel.tsx` gap above is closed, not open.** Directly re-verified against current source: `WorkforceRegistryPanel.tsx`'s `resolveCategoryLabel` (lines 82-91) and its edit-button handler (lines ~150-155) already resolve/edit via `member.category_id`, falling back to the legacy free-text column only for rows that predate the backfill. `ChiefDashboardView.tsx`'s `handleAddWorkforceMember`/`handleEditWorkforceMember` already persist `category_id` on every add/edit (confirmed at the `category_id: selectedCategory...` assignments in both handlers). This is not an open migration gap.

### S5 Integrations Layer
layer: L3
face: shared
path: `src/modules/shared/lib/integrationsService.ts`; schema `supabase/migrations/33_integrations_layer.sql`
status: **scaffold exists — no longer absent, but still not a real integrations layer.** `integrations_catalog` (reference data, 8 seeded rows) and `integrations_connections` (per-tenant-or-per-individual status, 3-way owner-shape CHECK constraint mirroring migration 30's `user_subscriptions.scope` pattern) both exist and are read by two UI panels (M14/F19). Zero real OAuth/API integration flow exists for any of the 7 non-native rows — this remains a read-only catalog/status scaffold, exactly as its own migration header describes it ("a SCAFFOLD only"). Flutterwave/Paystack remain hardcoded directly into the billing Edge Functions rather than actually routed through this layer — the `payment-processor` catalog row documents that live integration but doesn't mediate it.

### S6 Agent Manifests
layer: L3
face: shared
path: schema `supabase/migrations/34_agent_manifests.sql`, seed additions in `supabase/migrations/37_insights.sql` and `supabase/migrations/50_second_wave_agents.sql`; UI — `src/modules/org-admin/components/dashboard/AgentRegistryPanel.tsx`
status: **[43-snapshot carried forward, row count updated]** A lookup/registry table (`agent_manifests`: `agent_key`, `name`, `owner_engine`, `rung`, `description`, `gates`, `tenant_scope`) intended per spec §4/§7 as the place AI-assisted actions and agents formally declare their rung. Seeded with 10 rows (migration 34, the existing 4 AI Copilot Edge Functions' individual actions) + 1 row (migration 37, Submission Chaser, A1) + **2 more rows this pass (migration 50)**: `babsbrain2_meeting_action_chaser` (A2 below) and `privybrain2_rubric_compliance_chaser` (A3 below) — **13 rows total**, all rung 0 or rung 1; migration 50's own header is explicit that climbing to rung 2+ was deliberately deferred, not attempted. **Limitation carried forward, re-confirmed this pass**: still no Edge Function (`dissertation-copilot`, `research-copilot`, `casebook-copilot`, `roster-parser`) reads or writes this table at runtime — it remains a static reference/documentation table for the 3 real L1 agents (A1/A2/A3) and the `insights.agent_key` foreign key, not a live orchestration registry. `AgentRegistryPanel.tsx` (wired into `ChiefDashboardView.tsx`'s `'agents'` tab) is a read-only viewer over this table — confirmed present, not independently line-audited this pass.

---

## L2 Engines (existing AI Copilot Edge Functions)

### E1 dissertation-copilot
layer: L2
face: shared
path: `supabase/functions/dissertation-copilot/index.ts`
owner engine: none — this Edge Function is itself the concrete in-repo AI implementation
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
owner engine: none — this Edge Function is itself the concrete in-repo AI implementation
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
owner engine: none — this Edge Function is itself the concrete in-repo AI implementation
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
owner engine: none — this Edge Function is itself the concrete in-repo AI implementation
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
owner engine: none — this agent is itself the concrete in-repo implementation (its `agent_key`/`owner_engine` DB values still literally read `babsbrain2_submission_chaser`/`babsbrain-2` — see Decision 1 note above)
rung: **1** (per the seeded `agent_manifests` row: `agent_key = 'babsbrain2_submission_chaser'`, `owner_engine = 'babsbrain-2'`, `rung = 1`, `tenant_scope = 'org'`)
tenant scope: org
consumes: `collections` (currently-open, per tenant), `workforce` (active, per tenant), `submissions` (for the open collection), `insights` (for its own dedup check)
emits: `insights` rows (persisted, dismissible); `insight.generated` on `event_log` (best-effort, via `emitEvent` — see S2)
udr fields: writes what should conceptually be `udr.insights[]`, but writes directly to the `insights` table rather than through `udr.ts` — see S3's gap note; `udr.ts` itself does not surface this agent's output
gates: **rung 1 = "shown as suggestion"** per spec §4 — no autonomous action is taken. The manifest's own `gates` text: *"Shown as a suggestion in InsightsStrip.tsx; no autonomous action taken — a human (org admin) reads the insight and decides whether to remind/reset the member's code. Dismissing is a plain UPDATE, not a gated approval flow."*
status: stable, new — **the first real agent in this app to run end-to-end through a persisted record**: reads existing operational state → writes a persisted `insights` row → emits an `event_log` row → is read back and rendered by a UI face (F18) with a working dismiss action. This closes the previous registry's "**None exist**" finding for L1 agents, at least for this one agent.

**Scope, exactly as implemented** (confirmed by reading the source): one signal only — active workforce members with no `submissions` row yet for the tenant's currently-open `collections` row, and only once that collection's `deadline` has passed (the open/closed `status` flag and "past deadline" are independent in this app, same distinction `ChiefDashboardView.tsx` already treats separately). Not a general-purpose rules engine.

**Idempotency, worth knowing exactly**: the dedup check is deliberately *not* the same formula as `getActiveInsights`'s "active" predicate (dismissed_at IS NULL AND cooldown_until has lapsed) — a literal reading of that formula would not be idempotent, since a freshly-inserted row's `cooldown_until` is 3 days in the future and would itself fail an "active" check, causing a same-day re-run to insert a second row. Instead, the insert-time dedup skips any subject with a not-yet-superseded row (not dismissed, OR dismissed but still inside its own cooldown). `cooldown_until` is left `null` at insert time (so a brand-new insight is immediately visible in F18) and is only set 3 days out when `dismissInsight()` is called. A genuine race (two near-simultaneous runs, e.g. a fast reload remounting `InsightsStrip` before the first run's insert was visible to the second run's dedup SELECT) was found live — 18 duplicate rows for 9 actually-pending residents — and fixed in migration 38 with a partial unique index (`(tenant_id, agent_key, subject_ref) WHERE dismissed_at IS NULL`) plus switching the insert to an `upsert(..., { ignoreDuplicates: true })` against that same conflict target.

### A2 babsbrain2_meeting_action_chaser (Meeting Action Chaser)
layer: L1
face: none (surfaces via F18 `InsightsStrip`, same as A1)
path: `src/modules/shared/lib/meetingActionAgent.ts`; manifest seed `supabase/migrations/50_second_wave_agents.sql`
owner engine: none — this agent is itself the concrete in-repo implementation (its `agent_key`/`owner_engine` DB values still literally read `babsbrain2_meeting_action_chaser`/`babsbrain-2` — see Decision 1 note above)
rung: **1** (per its `agent_manifests` row)
tenant scope: org
consumes: `meeting_actions` (status open/in_progress, past `due_date`, for a tenant)
emits: `insights` rows (persisted, dismissible); `meeting.action.owed` on `event_log` (see S2)
udr fields: same pattern as A1 — writes what conceptually belongs in `udr.insights[]`, but directly to the `insights` table, not through `udr.ts`
gates: rung 1 = "shown as suggestion" — the manifest's own `gates` text: *"Shown as a suggestion in InsightsStrip.tsx; no autonomous action taken — a human reads the insight and follows up manually. Dismissing is a plain UPDATE."*
status: **new this pass — did not exist at the 43-snapshot.** Same shape as A1 (Submission Chaser): reads one signal (overdue `meeting_actions`), raises a dismissible insight, same dedup convention. Directly closes a gap the newer-modules audit found — `meetingsService.ts`'s `createMeetingAction` used to carry a dead, commented-out `emitEvent(..., 'meeting.action.owed', ...)` call, now superseded by this agent actually firing that event when an action is confirmed overdue (not at creation time, which the file's own comment explains would have been premature). No live `meeting_actions` rows are confirmed to exist yet (see M17), so this agent's real-world trigger condition has not been confirmed exercised — the code path is real, its live output is unverified.

### A3 privybrain2_rubric_compliance_chaser (Rubric Compliance Chaser)
layer: L1
face: none (surfaces via F18 `InsightsStrip` for the org sweep; via `UnifiedRecordView.tsx` for the doctor sweep — not independently re-verified this pass)
path: `src/modules/shared/lib/rubricComplianceAgent.ts`; manifest seed `supabase/migrations/50_second_wave_agents.sql`
owner engine: none — this agent is itself the concrete in-repo implementation (its `agent_key`/`owner_engine` DB values still literally read `privybrain2_rubric_compliance_chaser`/`privybrain-2` — see Decision 1 note above)
rung: **1** (per its `agent_manifests` row)
tenant scope: `any` — the only agent manifest with this scope value, reflecting its two run modes below
consumes: `rubric_instances` (migration 41/46) whose `recommendation` is `review_required` or `recommend_revise`
emits: `insights` rows (persisted, dismissible); `insight.generated` on `event_log` (see S2) — confirmed two separate call sites in source, one per run mode
udr fields: same pattern as A1/A2 — writes what conceptually belongs in `udr.insights[]`/`udr.entries[]` (rubric_instances also surfaces in `entries[]` directly, see S3), not through `udr.ts`
gates: rung 1 = "shown as suggestion" — the manifest's own `gates` text: *"Shown as a suggestion in InsightsStrip.tsx (org sweep) and UnifiedRecordView.tsx (doctor sweep); no autonomous action taken. Dismissing is a plain UPDATE."*
status: **new this pass — did not exist at the 43-snapshot.** Runs in two modes, confirmed via source: an org-wide sweep (`tenantId` set, `tenantId: null` not used) and an unlinked-doctor sweep (`tenantId: null` explicitly, second call site in `rubricComplianceAgent.ts`). Migration 50's own header calls this **the first real producer of a doctor-scoped `insights` row** — closing the read-path-with-no-producer gap `udr.ts`'s `fetchInsightsForDoctor` previously had (see S3). Since `rubric_instances` is confirmed to have zero live rows in earlier audit passes (see `docs/LIVING_SYSTEM_GAP_AUDIT.md`'s addendum §8.1), this agent's trigger condition is real code with, as far as this pass can confirm from source alone, nothing yet to act on.

---

*End of registry. Per spec §7/rule 12: update this file in the same change whenever you touch a component it describes.*
