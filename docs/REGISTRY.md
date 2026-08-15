# PrivyDoc Workspace — Component Registry

Per `docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md` §7. This is a snapshot of what
actually exists on disk as of this audit (branch `worktree-agent-aca09f03430a0109b`,
based on `main` @ `0145357`, mid-way through the "Phase 3" frontend
modularization pass — see `docs/MODULARIZATION_ARCHITECTURE.md`). Every path
below was confirmed against the real file tree, not guessed. Update this file
in the same change whenever you touch a component it describes (rule 12).

Status legend: `stable` = works, matches its current scope; `fixing` = mid-move
in the modularization pass; `fragmented` = still split across the old
`src/components/` and new `src/modules/` trees, or doing one god-file's worth
of unrelated things; `stub` = scaffolding exists but no real behavior yet.

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
status: stable — **but see gap audit**: renders institutional-flavored copy pre-login because `TerminologyProvider` (mounted higher in the tree) defaults to `DEFAULT_TENANT_ID` (UCH) until a session exists, so `t('member','Resident')`/`t('admin','Chief Resident')` fallbacks resolve to UCH's actual overrides, not neutral copy. Violates spec rule 6 ("neutral until known").

### F2 Resident/Member Login
layer: L5
face: landing
path: `src/modules/auth/components/ResidentLoginView.tsx`
owner engine: none
tenant scope: org
consumes: `tenants` (active list, migration 26), `workforce` (by tenant), terminology overrides
emits: none (writes session to localStorage client-side only, not an event)
udr fields: none (no UDR exists — see L3)
gates: none
status: stable — already does tenant → member → code → registered-email order (migration 26). Tenant picker only renders when >1 active tenant exists, which is today's real single-tenant deployment state, not a code gap.

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
status: stable — **contrary to what this audit was briefed to expect**, this is NOT a bare waiting-room anymore. Migration 25 + this component already surface entry cards into personal Research and Casebook workspaces for an unaffiliated doctor. See gap audit for what's still missing (no AI Copilot / no logbook on personal workspaces, by design).

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
status: fragmented — still under `src/components/`, not moved into any `src/modules/` org-admin/operator-admin location. Not yet split from a single file the way `ChiefDashboardView` is being split.

### F9 Org-Admin: Chief Dashboard (root shell)
layer: L5
face: org-admin
path: `src/components/ChiefDashboardView.tsx`
owner engine: none
tenant scope: org
consumes: `workforce`, `collections`, `submissions`, `settings`, `user_roles`
emits: none
udr fields: none
gates: Chief session
status: **fragmented/fixing** — confirmed still present at `src/components/ChiefDashboardView.tsx` as a single ~1900-line file (per its own lazy-import comment in `App.tsx`) covering workforce CRUD, submissions table, CSV export, subadmin role assignment, and roster editing entry points all in one component. `src/modules/org-admin/` does **not** exist yet in this worktree — the Phase 3 modularization commits landed for `auth`/`casebook-logbook`/`research`/`dissertation`/`consultant-review`/7 small modules/`shared`, but Chief-dashboard/SaaS-operator/template-manager/tenant-customization were not part of that batch. Being split into `org-admin/dashboard/` panels is the stated direction, not yet started.

### F10 Org-Admin: Multi-Roster Manager (HITL roster editor)
layer: L5
face: org-admin
path: `src/components/MultiRosterManagerView.tsx`
owner engine: babsbrain-2 (via `roster-parser`)
tenant scope: org
consumes: `raw_roster_uploads`, `combined_master_rosters`, `roster_types`, `workforce`
emits: none
udr fields: none
gates: Chief session
status: fragmented — same pattern as F9: still in `src/components/`, while its backing lib (`uchRosterParser.ts`) already moved to `src/modules/roster-engine/lib/`. The module's own `components/` directory does not exist — `roster-engine` is lib-only today.

### F11 Org-Admin: Template Manager
layer: L5
face: org-admin
path: `src/components/TemplateManagerView.tsx`
owner engine: none
tenant scope: org
consumes: `casebook_templates`, `research_templates`, `viva_vignettes`, `tenants.plan_type`
emits: none
udr fields: none
gates: Chief session; plan-gated (migration 29 — `free_seeded` tenants blocked from create/update)
status: fragmented — one screen that is a builder for **three different L4 organs** (casebook-logbook, research, viva-simulator) at once. Architecturally this is fine for an L5 face (faces may call any RPC), but it means there is no single "builder" sub-surface owned by any one module — worth flagging against spec §7's "every module ships four things: builder / instances / data / pipelines" since here the builder lives outside all three modules.

### F12 Org-Admin: Tenant Customization
layer: L5
face: org-admin
path: `src/components/TenantCustomizationView.tsx`
owner engine: none
tenant scope: org
consumes: `tenants` (module_flags, call_duty_rules, terminology_overrides, tenant_ai_adaptation_rules)
emits: none
udr fields: none
gates: Chief session
status: stable — closest existing thing to a real "tenant config service" (part of the L3 spine per spec §7), but it is a single UI screen writing directly to `tenants` columns/child tables, not a spine service other faces/modules call through.

### F13 Org-Admin: Tenant Upgrade Checkout
layer: L5
face: org-admin
path: `src/components/TenantUpgradeCheckoutModal.tsx`
owner engine: none
tenant scope: org
consumes: none
emits: none (calls `payment-checkout` Edge Function directly with `scope: 'tenant'`)
udr fields: none
gates: Chief session
status: stable

### F14 Compliance Nudges (embedded doctor-face panel)
layer: L5
face: doctor
path: `src/components/ComplianceNudgesView.tsx`
owner engine: babsbrain-2 (conceptually — "submission chaser" per spec §7, but not actually agent-driven; it's a synchronous client-side derivation, not an agent write)
tenant scope: individual (per-resident)
consumes: `dissertations`, `case_reports`, `exam_readiness`, `settings`, `collections` (via `deriveNudges`)
emits: none
udr fields: none
gates: none
status: fragmented — still in `src/components/`, embedded (compact mode) inside `src/modules/form/components/ResidentFormView.tsx`. Logic that conceptually belongs to BabsBrain-2 is computed client-side in a React component, not by any engine/agent.

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
status: stable — fully retrofitted through `useTerminology()`, no offenders found.

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
status: `LoadingShell` stable. `DevHelper` — **flagged in CLAUDE.md as the single highest-priority security finding**: mounted unconditionally, no `import.meta.env.DEV` guard found in this worktree at the point it's rendered in `App.tsx` line ~353 (`onSelectResident={handleSelectResidentFromHelper}`). Not re-verified line-by-line in this pass since CLAUDE.md already tracks it; still present as `DevHelper`, still excluded from the terminology retrofit by design.

---

## L4 Organs (current `src/modules/` folders + still-fragmented equivalents)

### M1 Announcements
layer: L4
face: doctor, org-admin
path: `src/modules/announcements/components/AnnouncementBoardView.tsx`
owner engine: babsbrain-2 (target)
tenant scope: org
consumes: `announcements` (tenant-scoped, migration 11), `announcement_reads`
emits: none today (spec wants `module.configured`/broadcast events — not implemented)
udr fields: none (no UDR)
gates: none
status: fragmented — module has no `builder` component of its own; announcement authoring appears to live inside `ChiefDashboardView.tsx` (unconfirmed exact line, not traced in this pass), not in `src/modules/announcements/`. **Gap vs spec**: maps toward target capability #8 "Messages & broadcasts," but today it is one fixed announcement-category enum (see migration 03's admin announcement category), not a generic instance/pipeline model.

### M2 Auth (see L5 Faces F1–F5 above)
This "module" is entirely L5 faces (login/landing screens), not an L4 organ with builder/instance/data/pipeline shape. Registered under Faces, not here, to avoid a duplicate entry.

### M3 Billing
layer: L4
face: doctor, org-admin
path: `src/modules/billing/components/UpgradeCheckoutModal.tsx`, `src/modules/billing/lib/useWorkspaceQuota.ts`
owner engine: babsbrain-2 (target — "payment watcher")
tenant scope: individual (per-resident quota) and org (tenant plan)
consumes: `ai_action_logs`, `user_subscriptions`, `tenants.plan_type`
emits: none (spec wants `payment.succeeded`/`plan.changed` — not implemented as events, only DB writes from the webhook)
udr fields: none
gates: payment confirmation (external, Flutterwave/Paystack hosted checkout)
status: stable — the closest-to-generic module today: one flat plan (`free`/`pro_unlimited`), two scopes (`workforce`/`tenant`) sharing one `user_subscriptions` table and one Edge Function pair. **Gap vs spec**: no per-module or per-seat pricing (deliberately rejected by the user, see CLAUDE.md), so target #10 "seat management" is not built.

### M4 Casebook & Logbook
layer: L4
face: doctor, org-admin
path: `src/modules/casebook-logbook/components/{CasebookBuilderView,CasebookWorkspaceView}.tsx`, `src/modules/casebook-logbook/lib/{caseRubricEngine,casebookCopilot,familyTools}.ts`
owner engine: privybrain-2
tenant scope: org (institutional) and individual (doctor-owned workspaces, migration 25)
consumes: `casebook_templates`, `casebook_workspaces`, `clinical_case_reports`, `clinical_logbooks`, `case_reports` (old MVP)
emits: none (spec wants `track.stage.advanced`/`writing.reviewed` — not implemented)
udr fields: none
gates: AI Copilot actions require doctor review before save (client-side, no formal gate record)
status: stable, but **two separate hardcoded flows, not one generic capability** — `CasebookBuilderView` (old 15-slot MVP, `case_reports`) and `CasebookWorkspaceView` (new WACP/NPMCN PMR portfolio, `clinical_case_reports`) are deliberately kept independent (CLAUDE.md's own "SCOPE DECISION"), not unified as one "academic tracks" instance model. **Gap vs spec**: maps to target #4/#5; framework_type is a fixed 5-value enum (`WACP_PMR_10`, `WACP_CASEBOOK_15`, `NPMCN_CASEBOOK_15`, `GENERIC_10`, `CUSTOM_CLINICAL`), not an open builder for arbitrary track types.

### M5 Consultant / Co-Resident Review
layer: L4
face: doctor
path: `src/modules/consultant-review/components/{ConsultantReviewView,GuestReviewView}.tsx`
owner engine: none (approval workflow, not AI-driven)
tenant scope: org
consumes: `consultant_reviews`, `guest_review_invites`
emits: none (spec has no explicit "review" event; closest is `entry.reviewed`, not wired)
udr fields: none
gates: subadmin role check (`canApprove`), guest-link token
status: stable — does not map cleanly to any of the spec's 10 named modules; it's an approval/sign-off capability that today is bolted onto Casebook/Dissertation submissions rather than being its own generic "approvals" primitive. One retrofit gap: its own panel heading ("Consultant Review Workspace") is hardcoded, not routed through `t('senior_reviewer', ...)` — see gap audit's terminology section.

### M6 Dissertation Assistant
layer: L4
face: doctor
path: `src/modules/dissertation/components/DissertationAssistantView.tsx`, `src/modules/dissertation/lib/academicCopilot.ts`
owner engine: privybrain-2
tenant scope: org (institutional resident only — no doctor-owned path)
consumes: `dissertations`, `dissertation_milestones`
emits: none
udr fields: none
gates: none
status: stable — **one hardcoded dissertation-tracking flow**, not folded into the newer, more generic `research` module's template system. **Gap vs spec**: this and `research` both partially implement target #5 "Research & academic tracks" as two separate, non-unified tools — a real fragmentation the spec's "one rule that matters most" calls out directly.

### M7 Exam Readiness
layer: L4
face: doctor
path: `src/modules/exam-readiness/components/ExamReadinessView.tsx`
owner engine: babsbrain-2 (target — compliance checker)
tenant scope: org
consumes: `exam_readiness` (fixed named columns, migration 05)
emits: none
udr fields: none
gates: none
status: stable — **deliberately not generalized** (CLAUDE.md: "DELIBERATELY SKIPPED, not an oversight" — its 4 pillars mirror actual WACP/NPMCN college requirements, not a program-specific choice). Does not map to any of the spec's 10 target modules as a distinct capability; closest is target #6 "Learning & development" but the spec's own module list doesn't carve out a dedicated "certification eligibility" capability either. Worth a conversation before assuming this needs a registry slot of its own long-term.

### M8 Forms (monthly roster submission)
layer: L4
face: doctor, org-admin
path: `src/modules/form/components/{ResidentFormView,ResidentActivityGraph}.tsx`
owner engine: babsbrain-2
tenant scope: org
consumes: `submissions`, `collections`, `rotations`
emits: none
udr fields: none
gates: none
status: stable but **the single clearest example of a use-case wearing a module's clothes** (spec rule 9): this is one hardcoded monthly rotation/leave form, not a form builder + instances + pipelines system. `rotations` (the dropdown source) is itself a single global, non-tenant-scoped table seeded with Family-Medicine-specific postings (see gap audit's Tenancy section) — a second, compounding hardcoding. The form→roster pipeline exists (`MultiRosterManagerView` consumes `submissions`) but is not modeled as a first-class "pipeline" entity; it's just another view reading the same table.

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
status: stable — already has both a builder (`KnowledgePackManagerView`) and an instance/consumption view (`KnowledgeLibraryView`), making it structurally closer to the spec's builder/instance split than most modules. **Gap vs spec**: content type is still fixed ("knowledge pack" with fixed item shape), not a generic document/resource capability, and doesn't map to any of the spec's 10 named modules directly (closest: target #6 "Learning & development").

### M10 Research Engine
layer: L4
face: doctor, org-admin
path: `src/modules/research/components/ResearchWorkspaceView.tsx`, `src/modules/research/lib/{folderStructure,researchCopilot,rubricEngine,templateEngine}.ts`
owner engine: privybrain-2
tenant scope: org (institutional) and individual (doctor-owned, migration 25 — confirmed live in `App.tsx`'s `/doctor/research` route, `owner.kind: 'doctor'`)
consumes: `research_templates`, `research_workspaces`, `research_chapters`, `research_correction_logs`
emits: none
udr fields: none
gates: none
status: stable — **the module closest to the spec's target shape today**: `research_templates` is genuinely forkable/org-customizable (WACP/NPMCN/ICMJE/STROBE/CONSORT/PRISMA/CARE/University/Custom, `templateEngine.ts`), and both institutional and individual-doctor ownership paths are real and RLS-differentiated (migrations 25/31). **Gap vs spec**: still hardcoded to one "research proposal/dissertation" track shape (fixed `research_chapters` section keys `ch1_intro`…`ch5_discussion`), not a fully generic "academic track" that could also model a CME log or exam-prep track per target #5's own description.

### M11 Roster Engine
layer: L4
face: org-admin
path: `src/modules/roster-engine/lib/uchRosterParser.ts` (lib only — see F10 for the UI, still in `src/components/`)
owner engine: babsbrain-2
tenant scope: org
consumes: `raw_roster_uploads`
emits: none
udr fields: none
gates: HITL review before publish (manual, in `MultiRosterManagerView`)
status: fragmented — no `components/` directory exists under this module; its face (F10) never moved out of `src/components/`. **Gap vs spec**: parser is hardcoded to 5 specific UCH document formats (Combined GOP, Consultant GOP, A&E Emergency Call, Afternoon/Priority/Saturday Supervision, Satellite Outposts) — a textbook case of target #3 "Scheduling" being one organization's workflow instead of a generic pattern.

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
status: stable — vignette *content* is now tenant-customizable via the Template Manager (F11) since migration 28, closing the gap CLAUDE.md's own "Module admin-content build-out" section flagged as "scoped, not built." **Gap vs spec**: the practice-session flow itself (`OralExamSimulatorView`) is still a fixed component, and `viva_simulations` stores scores only — no session transcript/replay model.

---

## L3 Spine

### S1 Database Service (de facto spine today)
layer: L3
face: shared
path: `src/lib/databaseService.ts`
owner engine: none
tenant scope: any
consumes: every table in `supabase/schema.sql` + `supabase/migrations/*`
emits: nothing (no event bus exists — see below)
udr fields: none (no UDR exists)
gates: none
status: **fragmented** — this is one large file doing direct per-module Supabase reads/writes (a god-service, not a spine). It has none of the 8 spine components the spec names in §7 ("event bus, UDR, tenant config service, rules console, notification dispatcher, audit stream, access-code service, integrations service"). It is the closest thing that exists to a spine only in the sense that every module already funnels its I/O through one file — a real, useful precedent to build the actual spine on top of, not a spine itself.

### S2 Event Bus
layer: L3
face: shared
path: **not present in this worktree** (checked: `src/modules/shared/lib/` does not exist — only `src/modules/shared/{config,ui}` do, plus `terminology.tsx` directly under `shared/`)
status: **absent** — no `event_log` table in `supabase/schema.sql` or any of the 31 migrations, no `eventBus.ts` file anywhere in `src/`. Confirmed not present as of this audit; a sibling agent may be building this on a separate branch/worktree, which this audit cannot see (expected and fine — not double-counted as "done").

### S3 Unified Doctor Record (UDR)
layer: L3
face: shared
path: **not present in this worktree**
status: **absent** — no `udr.ts`, no `unified_doctor_record` table or equivalent. `WorkforceMember`/`DoctorSession` in `src/types.ts` and `App.tsx` are the closest existing identity shapes, but neither aggregates `instances[]`/`entries[]`/`pipelines[]`/`insights[]` the way `udr.*` in spec §5 describes. Greenfield work, not yet begun in this worktree.

### S4 Tenant Config Service
layer: L3
face: shared
path: partially — `databaseService.getTenant()`/`getTenants()` + the `tenants` table's `module_flags`/`terminology_overrides`/`call_duty_rules` columns
status: fragmented — config *exists* and is real (module toggles, terminology, AI-rigor tuning all read live tenant config), but it's exposed as ad hoc columns on `tenants` read directly by whichever face needs them (F12 `TenantCustomizationView`, `terminology.tsx`, each Edge Function's `tenantAdaptation.ts`), not a single service with its own contract.

### S5 Integrations Layer
layer: L3
face: shared
path: **not present**
status: **absent** — no `integrations.catalog`/`integrations.connections` tables, no integrations UI. Zero integrations from spec §7's seed list (statistical analyser, literature search, reference manager, writing space, calendar/video, e-signature) are wired; Flutterwave/Paystack are hardcoded into the billing Edge Functions directly rather than modeled as a catalog entry, which is itself a minor deviation from "an integration writes into the UDR through the same shape as any native module output."

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
emits: `ai_action_logs` rows (not a real event, a direct table write)
udr fields: none
gates: doctor edits/accepts output before save (client-side only, no formal gate record)
status: fragmented — actions are `vancouver_format` (formatting, rung 0), `methodology_check` (guideline audit, rung 0 per this registry's convention), `extract_ddx` (extraction, rung 0). OpenAI→Gemini→heuristic fallback, deployed and live-verified per CLAUDE.md. Not wired to any common agent-manifest/rung-declaration system — rung above is inferred from behavior, not read from a manifest, because no manifest format exists yet.

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
status: fragmented — actions `audit_draft`, `synthesize_literature_matrix`, `generate_table_shells`, all rung 0 (audit/draft-style, no autonomous scoring gate or cross-tenant action). Same fallback architecture as E1.

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
status: fragmented — `audit_case` produces a real WACP 100-point / PMR 7-step numeric score (closer to rung 1 "reasoning/scoring" than a plain draft), `generate_defense_questions` and `parse_logbook_curriculum` are rung 0. Flagged as the one Edge Function whose primary action arguably already crosses into rung 1 without any formal rung declaration or cooldown record.

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
gates: HITL review in `MultiRosterManagerView` before the parsed roster is published (manual, not a formal agent-action-proposed/executed pair)
status: fragmented — structures the 5 UCH-specific document formats into `combined_master_rosters`; pure extraction, no conflict detection despite being the module most in need of it (target #3 "Scheduling" names "roster.conflict.detected" as an event this kind of engine should emit — not implemented).

---

## L1 Agents

**None exist.** No file in this repo declares an agent manifest (rung, cooldown, `agent.action.proposed`/`executed` emission) as described in spec §4/§7. The 4 Edge Functions above are static/reasoning-rung *helpers* invoked synchronously by a UI action — not autonomous agents with their own record, policy, or cooldown. This is a real, confirmed gap, not an oversight in this audit.
