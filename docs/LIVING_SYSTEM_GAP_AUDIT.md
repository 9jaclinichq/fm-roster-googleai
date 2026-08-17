# Living-System Gap Audit

Read-only audit checking `docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md` against the
actual current code and `supabase/migrations/` (through migration 31), in this
worktree (`worktree-agent-aca09f03430a0109b`, based on `main` @ `0145357`).
Every claim below was confirmed by reading the relevant file or migration —
none of this is inferred from CLAUDE.md's prose alone, though several findings
below show CLAUDE.md itself is now stale in specific, citable ways.

Companion document: `docs/REGISTRY.md` (component-level detail per file/table).

---

## 1. Tenancy skeleton (spec §2)

**Claim under test**: "Every row in every table carries `tenant_id`. RLS
enforces it. No cross-tenant reads, ever."

**Finding: false on both counts, in different ways for different tables.**

- **`settings` DOES now carry `tenant_id`** (migration 23,
  `23_per_tenant_chief_admin_code.sql` line 62) — CLAUDE.md's own SaaS
  Multi-Tenancy section still says "`settings` and `submissions` deliberately
  do **not** have `tenant_id` yet," which is stale for `settings` specifically.
  It's `NOT NULL` and `UNIQUE`, and every Chief-gated RPC now resolves
  `tenant_id` from `settings.admin_access_code` server-side.
- **`submissions` genuinely still has no `tenant_id` column**, confirmed
  against `supabase/schema.sql` (line 44) — that half of CLAUDE.md's claim is
  accurate today. Tenant scoping for a submission is only derivable by joining
  through `workforce_id` → `workforce.tenant_id`, never by filtering the row
  itself.
- **10 of the original 12 core tables got `tenant_id` in migration 11**
  (`workforce`, `collections`, `combined_master_rosters`, `announcements`,
  `knowledge_packs`, `dissertations`, `case_reports`, `exam_readiness`,
  `viva_simulations`, plus net-new `call_duty_rules`) — confirmed by direct
  `ALTER TABLE ... ADD COLUMN tenant_id` statements, all `NOT NULL` with a
  backfilled default to the seeded UCH tenant.
- **Every table created from migration 13 onward that's meant to be
  tenant-scoped does carry its own `tenant_id`**: `research_templates`,
  `research_workspaces`, `casebook_templates`, `casebook_workspaces`,
  `clinical_logbooks`, `admin_logbook_parsing_queue`, `tenant_ai_usage`,
  `tenant_ai_adaptation_rules`, `guest_review_invites`, `user_subscriptions`,
  `viva_vignettes` — all confirmed by direct column grep.
- **But a real, un-flagged class of gap exists: child/log tables that rely on
  join-based scoping instead of carrying `tenant_id` themselves.** Confirmed
  to have **no** `tenant_id` column at all: `roles`, `user_roles`, `rotations`,
  `file_uploads`, `announcement_reads`, `dissertation_milestones`,
  `consultant_reviews`, `knowledge_pack_items`, `ai_action_logs`,
  `resident_activity_logs`, `compliance_nudges`, `roster_types`,
  `raw_roster_uploads`, `research_chapters`, `research_correction_logs`,
  `clinical_case_reports`, `payment_events`, `doctor_profiles`,
  `saas_operator_logs`, `submissions`. Most of these are legitimate child
  rows of a tenant-scoped parent (e.g. `research_chapters` joins
  `research_workspaces`), which is a defensible denormalization choice — but
  it means spec rule 2's literal "every row in every table carries
  `tenant_id`" is not true today, and RLS on almost all of them is `USING
  (true)`, so join-based scoping is enforced by application code, not by the
  database.
- **`rotations` is a single global table with no `tenant_id` at all**
  (`01_rbac_and_rotations.sql` line 122), seeded once with Family-Medicine-
  specific postings ("Family Medicine Clinic," "Paediatrics," "O&G," ...).
  Every tenant, present or future, shares the exact same rotation dropdown.
  This is a concrete, load-bearing instance of the "never hard-code an
  organisation type" violation (spec rule 10) sitting directly in the schema,
  not just in copy.
- **RLS is real (auth.uid()-scoped) for only a small, named set of tables**:
  `doctor_profiles` (migration 18), `research_workspaces`/`casebook_workspaces`
  (migration 25, doctor-owned split), and their child tables
  `research_chapters`/`research_correction_logs`/`clinical_case_reports`
  (migration 31). Every other table — including every table listed above with
  a `tenant_id` column — is `USING (true) WITH CHECK (true)` for `anon`,
  confirmed against CLAUDE.md's own Security Notes and spot-checked in
  `schema.sql`. So "RLS enforces it" is true for roughly 6 tables and false
  for the remaining ~45.

**Net**: the tenancy skeleton is real and mostly complete at the *column*
level for the tables that matter to the current 10 modules, but RLS
enforcement is the exception, not the rule, and `submissions`/`rotations`
are concrete un-scoped holes — one of which (`rotations`) is also a
hard-coded-organization-type violation.

---

## 2. Login order / tenant-first landing (spec §10)

**Claim under test**: CLAUDE.md's own "Backlog: institution-first / self-serve
org flow" section says (as of 2026-08-14) this was explicitly **not** built.

**Finding: that CLAUDE.md section is now stale — most of it is already
built**, confirmed by reading the actual components:

- `AuthLandingView.tsx` (F1 in registry) already presents the org-vs-
  individual choice neutrally at `/login`, with no hostname-based
  pre-highlighting (the B2C/B2B domain split was retired per CLAUDE.md's
  Branding section, and confirmed absent from `getActiveBrand()`'s current
  callers).
- `ResidentLoginView.tsx` already implements tenant → member → code order
  (migration 26, `26_workforce_email_and_org_login.sql`): it loads the active
  tenant list, shows a tenant dropdown when more than one tenant exists, then
  the member picker, then access code, then a registered-email check. Order
  matches the backlog's ask exactly.
- A self-serve "create a new organization" flow **does exist**:
  `AdminPortalChooserView.tsx` (F5) links to `/organization/new`, which
  renders `CreateOrganizationView.tsx` (F6), calling the
  `create_tenant_self_serve` RPC from migration 24
  (`24_self_serve_tenant_creation.sql`). CLAUDE.md's SaaS Multi-Tenancy
  section already documents this migration; only the Branding section's
  "Backlog" note is out of date.

**What is genuinely still not built** (confirmed by route inspection in
`App.tsx`): item 3 of that same backlog — "repointing `/#admin`-style entry
points at a single 'workspace admin panel'." `/chief/login` (org-scoped) and
`/saas-operator` (platform-scoped) remain two separate route trees with
separate session models (`isChiefAuthenticated` vs. the operator's own login
gate inside `SaaSOperatorConsoleView`), not one unified panel.

**One real, newly-confirmed gap this section did surface**: the tenant
dropdown in `ResidentLoginView.tsx` only renders when `tenants.length > 1`.
With today's single seeded tenant, a user never actually sees the "select
your institution" step in practice — so while the code path exists and is
correct, it is functionally untested by real usage yet. Not a code defect,
just worth knowing before assuming this is battle-tested against a genuine
multi-tenant login flow.

No sibling-branch duplication risk observed: this worktree's `AuthLandingView`/
`ResidentLoginView`/`CreateOrganizationView` are already on `main` (commit
history predates this audit's branch point), not something a sibling agent
is currently building from scratch.

---

## 3. Individual doctor personal workspaces (spec §1, §7)

**Claim under test**: does `DoctorHomeView.tsx` surface real entry points, and
do `ResearchWorkspaceView`/`CasebookWorkspaceView` actually branch on
`owner.kind`?

**Finding: yes to both — the frontend half is real, not a stub.**

- `DoctorHomeView.tsx` (F7) has moved past "bare waiting-room" (its own code
  comment documents this explicitly: "Until migration 25 this was a bare
  waiting-room screen with zero features"). It now renders two real
  navigation cards — "Personal Research Workspace" and "Personal Casebook" —
  linking to `/doctor/research` and `/doctor/casebook-logbook`.
- `App.tsx` (lines ~573–599) confirms both routes render
  `ResearchWorkspaceView`/`CasebookWorkspaceView` with
  `owner={{ kind: 'doctor', ... }}`, and an already-linked resident hitting
  either `/doctor/*` route is redirected to the institutional `/workspace/*`
  equivalent instead — avoiding an ambiguous dual-workspace state, exactly as
  CLAUDE.md describes.
- Backend RLS for this split is real: migration 25 gave
  `research_workspaces`/`casebook_workspaces` an `auth.uid() = doctor_id`
  policy for doctor-owned rows, and migration 31 extended the same
  join-based policy to their child tables (`research_chapters`,
  `research_correction_logs`, `clinical_case_reports`) — confirmed present in
  CLAUDE.md's Security Notes and consistent with the doctor-owned/
  institutional split described there.

**What's explicitly, deliberately limited** (by design, not oversight): a
personal doctor workspace has no AI Copilot access and no logbook
sign-off tracking — `DoctorHomeView.tsx`'s own copy says so
("AI Copilot and logbook tracking aren't available on personal workspaces
yet"), and `CasebookWorkspaceView` is passed `canManageLogbooks={false}` on
the `/doctor/*` route in `App.tsx`.

---

## 4. Terminology/copy audit (spec §10 last bullet)

A dedicated sub-agent grepped `src/` for hardcoded "Resident"/"Chief
Resident"/"Consultant"/"ward"/"Rotation" outside `terminology.tsx` and
`DevHelper.tsx`. Full file:line list below; summary first.

**CLAUDE.md's claim** ("`useTerminology()` now covers every user-facing
role-word label across the main login flow, `Navbar`, `ChiefDashboardView`,
`MultiRosterManagerView`, `ConsultantReviewView`/`GuestReviewView`") **holds
for the literal words "Resident"/"Chief Resident"/"Residents"** — every
occurrence in `AuthLandingView`, `ResidentLoginView`, `ChiefLoginView`,
`Navbar`, `GuestReviewView` is clean, and the flagged instances in
`ChiefDashboardView`/`MultiRosterManagerView` are correctly routed through
`t()`. **But the retrofit never touched "Rotation," "Consultant," or "ward"**
— just as hospital-specific per spec §10's own example list — leaving real
offenders in files CLAUDE.md describes as fully retrofitted:

- `src/modules/form/components/ResidentFormView.tsx` — **not in the
  retrofitted list at all**: lines 242, 247 (validation errors), 317, 403
  (error/empty-state copy), 427, 444, 450 (field labels, including a literal
  hardcoded "ward").
- `src/components/ChiefDashboardView.tsx` — role-word instances are clean,
  but lines 64, 66 (dropdown role labels), 240–241 (CSV headers), 983–984
  (table headers), 1555, 1773, 1777, 1902, 1914 hardcode "Rotation"/
  "Consultant."
- `src/components/MultiRosterManagerView.tsx` — same pattern: lines 44, 381,
  520 hardcode "Consultant"/"Rotation" despite correct `t()` use elsewhere in
  the same file.
- `src/modules/consultant-review/components/ConsultantReviewView.tsx` — line
  102, the panel's own `<h2>` heading ("Consultant Review Workspace"), is
  hardcoded, never routed through `t('senior_reviewer', ...)`.
- `src/modules/doctors/components/DoctorHomeView.tsx` line 35 and
  `src/components/TenantCustomizationView.tsx` line 14 — one-line misses,
  "Chief Resident" and "Residents" respectively, in components outside the
  original retrofit's scope.

**Clean** (spot-checked, no offenders): `AuthLandingView.tsx`,
`ChiefLoginView.tsx`, `Navbar.tsx`, `GuestReviewView.tsx`,
`TemplateManagerView.tsx`, `SaaSOperatorConsoleView.tsx`,
`ComplianceNudgesView.tsx`, `TenantUpgradeCheckoutModal.tsx`,
`DoctorAuthView.tsx`, `CreateOrganizationView.tsx`,
`AdminPortalChooserView.tsx`, `App.tsx`, `databaseService.ts` (identifiers/
comments only — no user-facing strings).

**Severity**: low-to-moderate. Nothing here breaks functionality, but a
tenant that overrides `rotation`/`senior_reviewer` in `terminology_overrides`
will still see "Rotation"/"Consultant" leak through on the submission form,
the Chief dashboard's CSV export and tables, the roster editor, and the
review panel's own title — the exact surfaces CLAUDE.md claims are fully
tenant-vocabulary-aware.

---

## 5. Groups (spec §2)

**Claim under test**: "Groups are org-defined vocabulary, not a fixed
hierarchy... No module hard-codes a group name."

**Finding: false — groups are a fixed, global, hardcoded enum, not org-defined
vocabulary, anywhere in the current codebase.**

- `src/types.ts` line 3: `export type RoleId = 'super_admin' | 'hod' | 'rtc'
  | 'cme_coord' | 'consultant' | 'resident';` — a closed TypeScript union.
- The backing `roles` table (`01_rbac_and_rotations.sql` lines 49–62) is a
  single global table (no `tenant_id`) seeded once with exactly these 6 rows
  ("Head of Department," "Rotation/Training Coordinator," "CME Coordinator,"
  "Consultant," "Resident," "Super Admin") — every tenant that exists or ever
  will share the identical role list.
- `App.tsx` line 69 hardcodes the same set again independently:
  `const SUBADMIN_ROLE_IDS = ['hod', 'rtc', 'cme_coord', 'consultant',
  'super_admin'];`
- `ChiefDashboardView.tsx` lines 64/66 hardcode the same role options a third
  time in a dropdown (`{ value: 'rtc', label: 'Rotation/Training
  Coordinator' }`, `{ value: 'consultant', label: 'Consultant' }`).

There is no UI, RPC, or table anywhere that lets an org admin define its own
group/role vocabulary (e.g. "north branch/south branch," "associates/
partners" per spec §2's own examples) — this is a direct, three-times-over
violation of spec rule 10, not a partial gap. Building this would require a
schema change (an org-scoped `tenant_roles` table replacing the global
`roles` table) and is out of scope for this read-only audit to attempt.

---

## 6. Integrations layer, event bus, UDR, agent rungs

Confirmed **zero prior implementation** of all four, in this worktree:

- **Event bus**: no `event_log` table in `schema.sql` or any of the 31
  migrations; no `eventBus.ts` anywhere under `src/`.
- **UDR**: no `udr.ts`, no unified-record table or type. `WorkforceMember`/
  `DoctorSession` (`src/types.ts`, `App.tsx`) are the closest existing
  identity shapes but don't aggregate `instances[]`/`entries[]`/
  `pipelines[]`/`insights[]` as spec §5 describes.
- **Integrations layer**: no `integrations.catalog`/`integrations.connections`
  tables or UI; Flutterwave/Paystack are called directly from the billing
  Edge Functions, not modeled as catalog entries.
- **Agent rungs / manifests**: no file declares an agent manifest (rung,
  cooldown, `agent.action.proposed`/`executed` pair). The 4 AI Copilot Edge
  Functions are synchronous request/response helpers invoked by a UI button
  click, not autonomous agents with their own record.

This worktree cannot see whether a sibling agent has landed any of this on a
different branch/worktree — per this task's own briefing, that's expected and
correctly out of scope here. Reported as "not present as of this audit,"
not as "not being worked on."

---

## Summary of the single biggest gap

**Groups/role vocabulary (§5 above) is the sharpest, most concrete violation
of the spec's central design rule.** It isn't a missing feature so much as
architecture pointed the wrong way: a single global `roles` table with 6
hardcoded IDs, duplicated independently in three separate files
(`types.ts`, `App.tsx`, `ChiefDashboardView.tsx`), directly contradicts spec
§2's explicit rule that groups are "org-defined vocabulary, not a fixed
hierarchy" — the same rule the spec calls out by name as "the one rule that
matters most" when applied to modules. Every other gap in this audit
(hardcoded rotations list, two parallel research/dissertation flows, missing
event bus/UDR/integrations layer) is either already flagged in CLAUDE.md or
is greenfield work nobody claimed was done. This one is neither: it's live,
production code that actively enforces the opposite of what the architecture
document requires, sitting underneath every module that has any notion of
"who can approve what" (Chief dashboard subadmin assignment, Consultant
Review gating, Casebook logbook sign-off permissions all key off this exact
fixed enum).

---

## Addendum (2026-08-17) — re-audit through migration 54, in response to "is this 100% implemented"

This audit predates migrations 32-54 and is stale in specific, citable ways below. Re-verified
directly against `main`'s live schema and code (not against this file's own earlier claims, and not
against CLAUDE.md's summary either, which itself stops narrating new work at migration 40 despite
migrations 41-54 being live). **Overall: roughly 45-60% of the spec is implemented, unevenly** —
some areas are genuinely close to done, others (an event bus that's actually used, autonomous agents
above rung 1, a real integrations layer) are still close to 0%.

**Correction to a claim made earlier the same day this addendum was written**: `settings` was
believed to still be a hard global singleton (`id integer CHECK (id=1)`), blocking any isolated
per-tenant Chief credential. That was checking the base `supabase/schema.sql` file instead of the
live migrated schema — migration 23 (`23_per_tenant_chief_admin_code.sql`) actually converted it to
`id uuid PRIMARY KEY`, added `tenant_id uuid UNIQUE NOT NULL`, and gave `admin_access_code` its own
`UNIQUE` constraint, all applied live and confirmed via `information_schema` + `verify_chief_login`'s
real body (`SELECT s.tenant_id, t.name FROM settings s JOIN tenants t ... WHERE s.admin_access_code =
p_code`). **Always check the live migrated schema/DB, never the base `schema.sql` file alone** — it
does not reflect every later migration's `ALTER TABLE`.

**§2 Tenancy — ~65%.** Settings correction above aside, `submissions` still has no `tenant_id`
(unchanged). RLS is still `USING(true)` on the large majority of tables, including every table added
by migrations 41-54 (`scheduling_*`, `meeting_*`, `clinical_document_types`, `rubric_*`) — only 4 real
`auth.uid()`-scoped boundaries exist anywhere (doctor_profiles; research/casebook doctor-owned rows;
form_instances/entries doctor-owned rows; personal_tasks/wellbeing_entries/focus_sessions doctor-owned
rows). Spec §2's "RLS enforces it. No cross-tenant reads, ever" is not true today for the great
majority of tables — this is the single largest security-shaped gap in the whole spec, not a cosmetic
one.

**§3 Five-layer anatomy — ~70%.** Structure genuinely maps to Faces/Organs; confirmed real
"module imports module" violations (not Face-composing-Organs, which is fine): `CasebookWorkspaceView`/
`ResearchWorkspaceView` import `billing/lib/useWorkspaceQuota` directly; `CasebookBuilderView` imports
`dissertation/lib/academicCopilot` directly; `ResidentFormView` imports `org-admin/ComplianceNudgesView`
directly; `DoctorFormsBuilderPanel` imports `form/lib/formService` directly. Small, fixable, not
structural.

**§4 Intelligence ladder — declared correctly, but the ladder has no upper rungs.** All 13 rows in
`agent_manifests` are rung 0 or rung 1. Zero rung 2 (Acting), rung 3 (Deciding), or rung 4 (Learning)
agents exist anywhere — no auto-actions, no approve/deny gate has ever actually been exercised, no
policy-tuning loop. "Gates before autonomy" (working rule 7) is untested in practice, not violated —
there's simply nothing above rung 1 yet to gate.

**§5 UDR — ~50%.** `udr.ts`'s own header is candid: a deliberate read-only composition layer, not
the spec's generic schema, to avoid a real data migration. Missing entirely: `udr.pipelines[]`,
`udr.meetings[]` (despite a real `meetings` table existing since migration 45), `udr.audit[]`.
`udr.instances[]`/`udr.entries[]` cover only the pre-41 modules (research/casebook workspaces,
submissions, case reports) — never extended to cover `scheduling_*`, `meeting_*`,
`clinical_document_types`, or `rubric_*` after those modules shipped. The spine was not kept in sync
with the organs built on top of it.

**§6 Event vocabulary — ~5%.** Live `event_log` has exactly 2 rows, both `insight.generated`. Of the
~24 named events in the spec, only that one has ever actually fired. `eventBus.ts` exists as real,
usable infrastructure; it is essentially not called from the real user-action paths that should be
calling it.

**§7 The 10 modules — ~55-65%, very uneven.** Forms & pipelines (~85%, genuinely generic — an org
admin can create a second, different form instance today, confirmed in code), Billing & plans (~85%,
mature), Research & academic tracks (~75-80%, real multi-template selection) are the most complete.
Scheduling (~60%), Clinical & professional writing (~70%), Meetings & actions (~75%) exist as solid,
real, additively-built org-side scaffolds (migrations 44/45/48) — but each coexists *alongside* an
older hardcoded single-use-case system rather than replacing it (`MultiRosterManagerView`'s 5
UCH-specific roster parsers are untouched; two parallel research/casebook flows still exist). **Learning
& development is 0% — does not exist at all**, no table, no component, no concept. Messages &
broadcasts and Profile & memberships are mid-progress, matching this file's earlier sections above.
The 3 newest modules (Scheduling/Meetings/Clinical Writing) have zero individual-doctor-side builder
UI — org-admin-only today, confirmed via grep (no references from `DoctorHomeView`'s tree).

**Customisation tooling — not unified.** Implemented as N separate per-module builder components
(`FormsBuilderPanel`, `TemplateManagerView`, `SchedulingBuilderView`, `MeetingsPanel`,
`ClinicalWritingPanel`), not the spec's "one customisation engine, exposed with different scopes."
Each is internally reasonable; there is no shared abstraction across them.

**Integrations layer — ~10%.** `integrations_catalog` is genuinely seeded (8 rows, exceeds the spec's
5). `integrations_connections` has zero rows and zero UI referencing it anywhere in `src/` — no
connect/disconnect flow exists for any of the 8 catalog entries. Flutterwave is wired directly into
billing, not through this model at all. This is the component furthest from spec.

**§8.1 Scored Rubric primitive — schema+UI done, ~0% real usage, and NOT replacing the old
hardcoded engines it was meant to generalize.** `rubric_templates/sections/items/instances` +
`compute_rubric_totals()` exist live (migration 41) with a real 3-state ownership model
(global/tenant/doctor) and 3 seeded WACP templates (exceeds the spec's ask of 2), wired into real UI
(`RubricInstanceForm.tsx`). But `rubric_instances` has 0 rows — never used by a real assessor yet.
Worse: `caseRubricEngine.ts` and `rubricEngine.ts` still contain hardcoded
`framework_type === 'WACP_PMR_10'`-style branches and a hardcoded `AFRICAN_LITERATURE_ORGS` set,
un-replaced — the generic primitive was built *additively*, violating working rule 9's "never
hard-code a use case" for these two specific files.

**§8.2 Global seed template library — done for Forms/Clinical Writing/Meetings, not done for
Scheduling.** Forms & pipelines has all 5 spec'd generic templates seeded and marked
`is_system_default`. Clinical Writing has 3. Meetings has 1 (minimal but present). **Scheduling has
none** — `scheduling_instances` contains exactly one row, literally named "Wiring verification test."
The table/UI shipped; the actual seed-content task for this module was never completed.

**§8.3 Personal instances for Dr. Olanipekun — not done, despite a migration file named for
exactly this purpose.** `47_seed_olanipekun_real_workspace_content.sql` exists in the migrations
folder; his `doctor_profiles` row is real and live; but `research_workspaces`/`casebook_workspaces`
both return **zero rows** for his `doctor_id`. None of the described content (the dissertation title,
the stroke-case casebook entry) was ever actually inserted. Concrete, easily-closeable gap.

**Working rule 10 (no hardcoded vocabulary) — 28 files still contain literal
`Resident`/`WACP`/`NPMCN` strings.** Most are `t('member', 'Resident')`-style terminology-wrapped
fallback defaults, which is the accepted pattern from this session's earlier terminology retrofit —
but the two rubric-engine files above are genuine hardcoded domain branches, a real violation. The
terminology system's own *un-overridden default* vocabulary is also still resident-centric, which
would show through unchanged to any brand-new non-hospital tenant that never sets overrides.

**One concrete spec deviation found**: §7/§11 call for the platform operator panel at `/#admin`; the
actual live route is `/saas-operator`. Cosmetic, but worth a conscious decision (rename the route, or
update the spec) rather than leaving the mismatch unflagged.

**Scale note for whoever reads this next**: closing every gap above is not a single session's work.
The RLS-tightening item alone touches dozens of tables and needs careful per-table verification to
avoid breaking the live app (see this file's own RLS findings above and CLAUDE.md's Security Notes on
why RLS changes have historically required explicit user sign-off). Rungs 2-4 autonomous agents are
close to greenfield work. Recommend phasing rather than attempting all of this in one pass.
