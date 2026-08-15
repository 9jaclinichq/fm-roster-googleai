# Academic Tracks Generalization — Scoping Proposal

Status: **scoping document only. No schema, migration, or application code was
written or changed to produce this.** Read `CLAUDE.md`, §7/§10 of
`docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md`, `docs/LIVING_SYSTEM_GAP_AUDIT.md`,
and `docs/MODULARIZATION_ARCHITECTURE.md` before acting on anything below.

---

## 0. The question this answers

The living-system spec (`PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md` §7, module row
5) describes one capability — **Research & academic tracks**: "a
dissertation, an audit/QI project, a publication, a grant, an exam or viva
track — any staged piece of academic or research work." §10's backlog line
makes the gap explicit: *"Research module currently equals one dissertation
flow; generalise into academic tracks, with the current dissertation kept as
one track template among many."*

Today this app has **three live, independently-shipped systems** that all do
some version of "staged academic work," plus a fourth smaller one, none of
which know the other three exist. This document maps what exists, proposes a
target shape, lays out migration paths with tradeoffs, and recommends one —
without writing any of it.

---

## 1. Current-state map

### 1.1 Universal Research Engine (migrations 13-14, 25, 31)

- **Tables**: `research_templates` (rubric/format templates —
  `organization_or_body`, `referencing_style`, `proposal_rubric`,
  `dissertation_rubric`, `word_count_limits` jsonb; 9 seeded global rows,
  fork-to-custom supported), `research_workspaces` (one project per
  resident/doctor — `pico_framework` jsonb, `status` lifecycle
  `proposal_draft → proposal_approved → data_collection → thesis_writeup →
  completed`, `folder_tree` jsonb, `tenant_id`/`workforce_id`/`doctor_id`),
  `research_chapters` (one row per section, `content_text`, `word_count`,
  `ai_audit_logs`), `research_correction_logs` (assessor/supervisor feedback
  tracker).
- **UI entry points**: `/workspace/research` (institutional resident) and
  `/doctor/research` (unaffiliated individual doctor, migration 25) both
  render `ResearchWorkspaceView.tsx` (`src/modules/research/components/`),
  parameterized by an `owner: {kind: 'workforce' | 'doctor', ...}` prop.
- **AI Copilot**: `research-copilot` Edge Function — `audit_draft`,
  `synthesize_literature_matrix`, `generate_table_shells` (prompts built
  dynamically per-request from the workspace's active `research_templates`
  row); Fisher's-formula sample size stays client-side, never sent to an AI
  provider.
- **RLS**: real `auth.uid() = doctor_id` boundary for doctor-owned rows
  (migration 25/31); institutional rows stay `USING (true)`.
- **Data maturity**: real feature, real users. Two full PR-merged, browser-
  verified rounds (PR #8 and the doctor-workspace follow-up); AI Copilot
  live-verified against real OpenAI responses; used by both institutional
  residents and individual doctors today. This is the **most actively
  developed** of the three systems and the one the living-system spec's own
  vocabulary ("template", "workspace", "PICO framework", "rubric") already
  matches most closely — it is the closest existing thing to what §7 wants
  the whole capability to look like.

### 1.2 Dissertation Assistant (migration 04, era-01)

- **Tables**: `dissertations` (one row per resident — `title`, `stage`
  fixed-enum CHECK across 9 named WACP stages from `Topic Registration` to
  `Final Submission`, `supervisor_name`, `UNIQUE(workforce_id)` — **one
  dissertation per resident, hard cap**), `dissertation_milestones` (one row
  auto-seeded per stage via trigger on insert — `status`
  draft/in_review/approved, `document_url`, `supervisor_feedback`).
- **UI entry point**: `/workspace/dissertation` only —
  `DissertationAssistantView.tsx` (`src/modules/dissertation/components/`).
  **No `/doctor/dissertation` route exists** — unlike Research and Casebook,
  this system was never extended to individual doctors.
  `tenant_id`/`doctor_id` were never added to either table (migration
  11/18/25 never touched them) — it predates the multi-tenant/doctor-identity
  work entirely.
- **AI Copilot**: `dissertation-copilot` Edge Function (formerly
  `academic-copilot`), via `src/modules/dissertation/lib/academicCopilot.ts`
  — guideline check, Vancouver citation formatting, differential-diagnosis
  extraction. Deliberately **ungated** by the AI quota system (CLAUDE.md's
  Billing section: "the original dissertation-copilot types are deliberately
  ungated").
- **Data maturity**: real but structurally thinner and un-extended. Fixed
  9-stage pipeline, no template system, no rubric, one dissertation per
  resident by DB constraint, no tenant scoping, no doctor-identity path. It
  predates every later architectural decision the other two systems already
  incorporate (templates, tenant_id, doctor_id, folder taxonomy). This is the
  system CLAUDE.md itself calls out (via the living-system spec's backlog
  line) as "one dissertation flow" that the Research Engine's own
  `research_templates.organization_or_body` already includes a
  `dissertation_rubric` field for — i.e., the Research Engine's data model
  already has room to describe what this table does, using a richer shape.

### 1.3 Casebook & Clinical Logbook Engine (migrations 15-16, 25, 31)

- **Tables**: `casebook_templates` (framework/rubric templates —
  `framework_type` WACP_PMR_10/WACP_CASEBOOK_15/NPMCN_CASEBOOK_15/
  GENERIC_10/CUSTOM_CLINICAL, `thematic_distribution` jsonb, scoring rubric
  jsonb, 4 seeded global templates), `casebook_workspaces` (one portfolio
  per resident/doctor, `page_count_target` stamped from the framework),
  `clinical_case_reports` (one row per case 1-15 — demographics, history,
  PCCM/biopsychosocial formulation, genogram/family-tools data, management
  plan, discussion, references, AI `rubric_scores`, `defense_questions`),
  `clinical_logbooks` (procedure/competency/station tracking with
  supervisor sign-offs), `admin_logbook_parsing_queue` (Chief-uploaded raw
  text for AI curriculum extraction).
- **UI entry points**: `/workspace/casebook-logbook` and
  `/doctor/casebook-logbook` (doctor route has no AI Copilot, no logbook
  sign-off — `canManageLogbooks={false}`), both `CasebookWorkspaceView.tsx`.
- **AI Copilot**: `casebook-copilot` Edge Function — `audit_case` (WACP
  100-point / PMR 7-step scoring), `generate_defense_questions`,
  `parse_logbook_curriculum`.
- **Data maturity**: real, richest single write-up model of the three (full
  clinical write-up + 4 embedded Family Medicine tools: genogram, Family
  APGAR, Ecomap, Duvall's life-cycle stage). Deliberately kept **alongside**,
  not replacing, 1.4 below — see that migration's own header, cited
  verbatim in CLAUDE.md: "sits alongside the original Casebook Builder, not
  replacing it."

### 1.4 Casebook Builder — legacy MVP (migration 04)

- **Table**: `case_reports` — one row per case, `case_number` **DB-level
  `CHECK (case_number BETWEEN 1 AND 15)`**, `patient_initials`, `diagnosis`,
  `category`, `status` (draft/pending_supervisor/approved), `document_url`.
  Flat, no rubric, no template, no AI-scored fields.
- **UI entry point**: `/workspace/casebook` only (`CasebookBuilderView.tsx`,
  `src/modules/casebook-logbook/components/` — co-located with 1.3 in the
  module map, but a fully separate table and component). No doctor route.
- **AI**: shares `academicCopilot.ts` (the Dissertation Assistant's client),
  not `casebook-copilot` — i.e. it calls the *other* system's AI function,
  a cross-wire that predates the casebook-copilot split.
  `tenant_id` was added in migration 11 (it's one of the original 10 tables),
  so unlike Dissertation Assistant it *is* tenant-scoped — but still has no
  `doctor_id` path.
- **Data maturity**: real but the simplest of the four — a flat 15-slot
  form with no rubric or AI-native scoring. CLAUDE.md's own Module
  admin-content section records it as "SHIPPED" for one wiring fix
  (tenant-configurable case count) and nothing structural since. This is
  the "MVP that a newer, richer engine grew up alongside" case, explicitly
  and intentionally, not an oversight.

### 1.5 Summary table

| System | Tables | Doctor route? | Template system? | AI Edge Fn | Tenant-scoped? |
|---|---|---|---|---|---|
| Research Engine | 4 | yes | yes (9 seeded, forkable) | `research-copilot` | yes (+ doctor_id) |
| Dissertation Assistant | 2 | **no** | no (fixed 9-stage enum) | `dissertation-copilot` | **no** |
| Casebook & Logbook Engine | 5 | yes | yes (4 seeded, WACP/NPMCN) | `casebook-copilot` | yes (+ doctor_id) |
| Casebook Builder (legacy) | 1 | no | no | shares dissertation's | yes (no doctor_id) |

The asymmetry is the headline finding: Research and Casebook-Logbook already
share the same shape (template → workspace → content rows → AI copilot →
doctor+tenant identity split). Dissertation Assistant and Casebook Builder
are both older, flatter, and structurally behind — which is exactly why §5
below proposes starting there rather than with the two systems that are
already closest to "done."

---

## 2. What "one generic capability" would require

A target schema generalizing all four into the builder/instance/pipeline
pattern the living-system spec already established for Forms
(`docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md` §7; concretely scaffolded in
`supabase/migrations/35_forms_pipelines.sql` — see §3.4 below, which reuses
that exact precedent). Field lists only — no SQL, no types, no RLS policy
text. This is a shape for a human to turn into a real migration later, not a
migration.

### 2.1 `track_templates` (generalizes `research_templates` +
`casebook_templates` + Dissertation Assistant's hardcoded 9-stage enum +
Casebook Builder's hardcoded 15-slot rule)

- `id`, `tenant_id` (nullable — global seeded templates stay tenant-null,
  same convention as today), `created_by_workforce_id` / `created_by_doctor_id`
- `track_kind`: the generic discriminator — `dissertation` | `casebook` |
  `qi_audit` | `publication` | `grant` | `exam_viva` | `custom` (open enum,
  extendable without a migration if stored as free text + an admin-curated
  suggestion list, mirroring migration 35's "avoid CHECK-constraint churn"
  reasoning)
- `name`, `organization_or_body` (WACP/NPMCN/ICMJE/STROBE/CONSORT/PRISMA/
  CARE/University/Custom — reused verbatim from `research_templates`)
- `stage_definitions` jsonb — an ordered list of named stages (generalizes
  Dissertation Assistant's fixed CHECK enum into data: `[{key, label,
  order}]`), each stage optionally carrying its own sub-content shape
  (a case slot, a chapter, a milestone) rather than one fixed content model
  for the whole track
- `content_unit_shape` jsonb — what one "item" within a stage looks like:
  for a dissertation, a chapter; for a casebook, a case write-up (with the
  full clinical/PCCM/family-tools shape `clinical_case_reports` already
  has); for a QI audit, an audit cycle. This is the field that lets one
  table serve write-ups as different as a dissertation chapter and a
  15-case casebook — same idea as `research_templates.dissertation_rubric`
  vs `proposal_rubric` already being two shapes in one row, generalized
  further.
- `scoring_rubric` jsonb (reused shape from both existing rubric jsonb
  columns — WACP-domain-points or PMR-checklist or word-count-cap, already
  proven to coexist in one column type across two systems)
- `referencing_style`, `word_count_limits`/`page_count_target` (reused
  verbatim)
- `is_public`, `is_active`, `created_at`

### 2.2 `track_instances` (generalizes `research_workspaces` +
`casebook_workspaces` + `dissertations` + implicit Casebook Builder "session")

- `id`, `tenant_id`, `owner_workforce_id` / `owner_doctor_id` (the existing
  doctor/institutional split, reused verbatim — this is already a solved
  problem, migration 25)
- `template_id` → `track_templates`
- `track_kind` (denormalized copy of the template's, for cheap filtering
  without a join — matches this repo's existing denormalization precedent,
  e.g. `casebook_workspaces.page_count_target` stamped at creation)
- `title` (generalizes `pico_framework`'s title field and `dissertations.title`)
- `status` — a generic staged lifecycle, e.g. `draft → in_progress →
  under_review → completed`, with the template's `stage_definitions`
  providing the actual named checkpoints within `in_progress`
  (`current_stage_key` column pointing at one of `stage_definitions`)
- `metadata` jsonb — track-kind-specific extra fields that don't deserve
  their own column (PICO framework detail, supervisor_name, folder_tree)
- `created_at`, `updated_at`

### 2.3 `track_content_items` (generalizes `research_chapters` +
`clinical_case_reports` + `case_reports` + `dissertation_milestones`)

- `id`, `instance_id` → `track_instances`
- `item_key` (e.g. `ch1_intro`, `case_03`, `milestone_ethical_clearance` —
  free text keyed against the template's `stage_definitions`/
  `content_unit_shape`, not a fixed enum)
- `content` jsonb — the actual write-up, shaped per `content_unit_shape`
  (this is where a chapter's `content_text`/`word_count` and a case
  report's full clinical/genogram/family-tools payload both fit, as
  different jsonb shapes under one column, same pattern `research_templates`
  already uses for `proposal_rubric` vs `dissertation_rubric`)
- `status` (draft/in_review/approved — reused verbatim, all four systems
  already use compatible status vocabularies)
- `ai_scores` jsonb, `ai_audit_log` jsonb (generalizes `rubric_scores`,
  `defense_questions`, `ai_audit_logs`)
- `document_url` (generalizes `document_url` on both legacy tables)
- `created_at`, `updated_at`

### 2.4 `track_correction_logs` (generalizes `research_correction_logs`
directly; casebook/dissertation have no equivalent today — new capability,
not just a rename)

- `id`, `instance_id`, `comment_source`, `action_taken`, `status`
  (reused verbatim from `research_correction_logs`)

### 2.5 What stays untouched even under full generalization

- `clinical_logbooks` / `admin_logbook_parsing_queue` — sign-off tracking
  and curriculum-parsing queue are procedural/competency tracking, not
  "staged academic write-up" content; the living-system spec's own module
  table separates "Research & academic tracks" (row 5) from "Learning &
  development" (row 6, CME/CPD/skills sign-off) — logbooks arguably belong
  there, not folded into this generalization at all. Flagged as a **separate
  open question**, not decided by this document.
- The 4 AI Copilot Edge Functions' actual prompt-building logic
  (`researchRubric.ts`/`casebookRubric.ts`) — even under a fully generic
  schema, WACP-casebook scoring and dissertation-guideline checking are
  different prompts/rubrics by nature, not something schema unification
  collapses into one function.

---

## 3. Migration paths, with tradeoffs

### 3.1 (a) Full data migration

Move all rows from `dissertations`/`dissertation_milestones`/`case_reports`/
`research_workspaces`/`research_chapters`/`casebook_workspaces`/
`clinical_case_reports` into the new `track_templates`/`track_instances`/
`track_content_items` shape; drop the old tables; rewrite all 4 frontend
views and 4 AI Edge Functions to read/write the new shape.

- **Pros**: the only path that actually reaches "one capability" the spec
  describes. Removes the duplicated identity-split logic (doctor/tenant
  ownership) currently implemented independently in Research and Casebook.
  Eventually lets a Chief define a QI-audit or publication track template
  without a new migration — the actual point of generalizing.
  Simplifies `docs/MODULARIZATION_ARCHITECTURE.md`'s eventual `databaseService.ts`
  split (one `academicTracksService.ts` instead of three parallel slices).
- **Cons — and they are severe, not cosmetic**:
  - **Real production data migration risk.** `research_workspaces`/
    `casebook_workspaces` hold real residents' and real individual doctors'
    real academic work — PICO frameworks, chapter drafts, full clinical
    write-ups with AI-generated rubric scores and defense questions,
    genogram/family-tools structured data. A migration bug here doesn't
    corrupt test data; it corrupts someone's dissertation draft or
    WACP casebook submission mid-cycle.
  - **Breaks every AI Copilot Edge Function's request/response shape**
    simultaneously — `research-copilot`, `casebook-copilot`,
    `dissertation-copilot` would all need coordinated rewrites and
    redeploys, and CLAUDE.md's own AI section shows how much manual
    curl/browser verification each one already needed individually; doing
    all three/four at once multiplies that surface.
  - **Breaks every frontend view** (`ResearchWorkspaceView`,
    `CasebookWorkspaceView`, `DissertationAssistantView`,
    `CasebookBuilderView`) simultaneously, with no automated test suite to
    catch a broken runtime path — `MODULARIZATION_ARCHITECTURE.md`'s own
    rollout-phases section explicitly calls this exact risk out as the
    reason it phases *component relocation* (a much smaller, purely
    mechanical change) instead of doing it in one pass.
  - **RLS regression risk.** Migration 25/31's `auth.uid() = doctor_id`
    policies are real, hard-won security boundaries (verified via
    `SET ROLE`/`set_config` simulation per CLAUDE.md's Security Notes) —
    collapsing 3 tables' worth of RLS policies into one new table's policy
    needs the same rigor repeated, not assumed to carry over.
  - **No rollback path** once old tables are dropped, in a repo with no
    migration-runner and no automated tests — "re-run the SQL in the
    Supabase dashboard" (CLAUDE.md's own description of this repo's
    migration process) is not something you want to be doing under
    pressure after a bad data migration on a live app.
  - Dissertation Assistant's `UNIQUE(workforce_id)` one-dissertation cap
    and Casebook Builder's `CHECK(case_number BETWEEN 1 AND 15)` are real
    constraints some part of the current UI/UX may implicitly depend on
    (e.g. "your one dissertation" framing in the Dissertation Assistant UI)
    — generalizing away the cap is a product decision, not just a schema one.

### 3.2 (b) Additive/parallel

Build `track_templates`/`track_instances`/`track_content_items` alongside
all 4 existing systems, touching zero existing routes/tables. A *new*
resident or Chief creating a *new* track (e.g. a QI audit or publication —
kinds none of the 4 existing systems support today) uses the new generic
model; existing dissertations/casebooks/research workspaces keep living in
their current tables and views, untouched, indefinitely.

- **Pros**: zero migration risk — nothing is moved, nothing can be lost.
  Matches this repo's own established precedent exactly:
  - CLAUDE.md's Casebook & Logbook Engine section, verbatim: *"sits
    alongside the original Casebook Builder, not replacing it... an
    explicit choice made with the user rather than silently colliding two
    'casebook' concepts or migrating existing resident data."*
  - `supabase/migrations/35_forms_pipelines.sql` (already written, not yet
    applied) does exactly this for the Forms module: new
    `form_instances`/`form_entries`/`form_pipelines` tables scaffolded
    alongside the untouched `submissions`/`collections` flow, with the
    migration's own header stating the live path "is NOT rewired... That
    rewire is a materially bigger follow-up... deliberately out of scope."
    This is the single closest precedent to what (b) would look like for
    academic tracks, written by a sibling effort in this same session.
  - Immediately unlocks new track kinds (QI audit, publication, grant,
    exam/viva) the spec explicitly wants, without touching anything live.
- **Cons**: never actually converges. Four (now five, counting the new
  generic model) places to look for "a resident's academic work." Does not
  reduce the actual duplication the spec is complaining about — it adds to
  it. A future engineer (or PrivyBrain-2, per the living-system spec's own
  L2 engine that's supposed to read academic-track progress) still has to
  know about 5 separate table families to answer "what is this doctor
  working on academically."

### 3.3 (c) View-layer generalization only

Keep all 4 systems' tables exactly as-is. Build one read-only composition
layer — modeled on the pattern the spec's own §5 (`udr.ts` — unified doctor
record) already names, and on this repo's existing precedent of composing
reads across tables without moving data (e.g.
`getTenantUsageBreakdown()` joining `tenants`/`tenant_ai_usage`/`workforce`/
`submissions` client-side, per CLAUDE.md's Billing section) — that queries
all 4 tables and presents them as a single "academic tracks" list to
whatever UI or engine wants it (a future Dashboard tile, PrivyBrain-2,
`docs/REGISTRY.md`'s UDR concept if/when built).

- **Pros**: real user-facing unification (a single "My Academic Tracks"
  view is achievable) with **zero schema risk** — no migration, no RLS
  change, no Edge Function rewrite, no dropped table. Every existing view
  and Edge Function keeps working exactly as today; the new layer is
  strictly additive read logic. Cheapest of the three by a wide margin, and
  reversible (delete the composition file, nothing else changes).
- **Cons**: doesn't solve the underlying fragmentation for anyone querying
  the DB directly, writing a new Edge Function, or building a new track
  kind (a QI audit still has nowhere generic to live — you'd need one of
  (a)/(b) eventually for genuinely new track kinds, this only unifies
  *reading* the 4 that already exist). Each system's AI Copilot stays
  separately implemented, separately prompted, separately quota-tracked.
  The four different `status`/stage vocabularies (Research's 5-stage
  lifecycle, Dissertation's 9-stage CHECK enum, Casebook's rubric-driven
  completion, Casebook Builder's 3-state flat status) would need a
  best-effort mapping into one normalized "stage" concept for display,
  which is itself a small design decision (not a schema one) that has to
  be made carefully so it doesn't misrepresent what's actually true in each
  underlying table.

### 3.4 Note on precedent already in this worktree

`supabase/migrations/35_forms_pipelines.sql` exists in this worktree
(written by a sibling agent in this session's wave, migrations 32-36,
covering event log / integrations layer / agent manifests / forms
generalization / org-defined groups — none of them applied live per that
migration's own header) and is the closest real precedent for this exact
question, already answered the same way this document leans: additive
scaffold, old live path untouched, explicit "materially bigger follow-up,
deliberately out of scope" framing for the actual rewire. Whatever this
document recommends should be read alongside that file, not in isolation —
they are the same category of decision made in the same session.

---

## 4. Recommendation

**(c) now — build the view-layer composition only — with (b) reserved for
the first time a genuinely new track kind (QI audit, publication, grant,
exam/viva) is actually requested, and (a) not attempted until/unless a
specific, concrete need demands true schema unification (e.g. a future
cross-track reporting requirement that (c)'s client-side composition can't
serve fast enough, or a decision to sunset one of the 4 legacy systems
outright).**

Justification against this repo's own stated values:

- **"No silent scope creep" / "surgical fixes" (CLAUDE.md's AI Philosophy).**
  (a) is the opposite of surgical — it is a coordinated rewrite across 4
  frontend views, 3 Edge Functions, and however many RLS policies, on tables
  holding real academic work for real residents and real doctors mid-cycle.
  Even framed as "generalization," it is one of the largest, highest-blast-
  radius changes this repo could make in one pass. (c) is the definition of
  surgical: net-new read code, zero existing surface touched.
- **The established additive-precedent pattern.** This repo has now made
  the "add alongside, don't merge live data" call twice on record — Casebook
  Builder vs. Casebook Engine (CLAUDE.md, explicit "explicit choice made
  with the user rather than silently colliding") and the Forms module
  (migration 35, unapplied but written the same way). A third instance of
  the same fragmentation, resolved the same way, is consistent; reaching
  for full data migration here specifically would be the outlier decision,
  not the consistent one.
  That said, (b) — a THIRD additive academic-content table family stacked
  on top of 4 existing ones — is not free of cost either, which is why this
  recommendation holds it in reserve rather than starting it now: unlike
  Forms (which had exactly one live flow to sit alongside) or Casebook
  (two), Academic Tracks already has four. A fifth, unused until a new
  track kind is actually requested, is speculative schema with no near-term
  reader — worth avoiding until there's a concrete `track_kind` nothing
  existing can serve.
- **Live app, paying-adjacent real users (Billing section).** Migration 30's
  own verification notes show how much manual, real-provider, real-checkout
  verification even a well-scoped billing change required. A full data
  migration across 3-4 academic systems, with genuinely no automated test
  suite and no migration rollback tooling, is a materially riskier
  operation than anything else documented as "live and verified" in
  CLAUDE.md to date — this is not a place to spend that risk budget without
  a specific, named reason.
- **What (c) actually delivers now**: the spec's real, immediate ask — per
  §5's UDR concept and the Dashboard module (row 1) wanting one place to see
  "academic and research work" — is a *reading* problem today. Nobody has
  asked for a Chief to define a custom QI-audit track template yet; the
  living-system spec names it as an example of the shape the capability
  *should eventually* support, not a shipped requirement. Solving the
  reading problem first, cheaply and reversibly, buys time to see whether
  the writing/template problem (which only (a) or (b) solve) turns out to
  be worth its cost.

---

## 5. If (a) or a partial (a) is later pursued: minimum safe first slice

Not recommended now (§4), but scoped here per the task brief's ask, so it
isn't reinvented from scratch if the decision changes later.

**Start with Dissertation Assistant migrating into the Research Engine's own
shape — not the new generic `track_templates`/`track_instances` model
directly.**

Reasoning:
- Dissertation Assistant is the most redundant of the four with a system
  that already exists and is already richer: `research_templates.
  organization_or_body`/`dissertation_rubric` already models "a dissertation
  under a named academic body's rubric" — the exact thing
  `dissertations`/`dissertation_milestones` hand-rolled with a fixed CHECK
  enum, no template, no tenant scoping, and no doctor-identity path.
  Migrating it into `research_workspaces` (with a `track_kind: 'dissertation'`
  discriminator column added, a much smaller schema change than the full
  §2 model) reuses machinery that's already live, already RLS-correct for
  doctor ownership, and already has a working AI Copilot pattern
  (`research-copilot`) that Dissertation Assistant's own
  `dissertation-copilot` prompts could be ported into as one more
  `research_templates.organization_or_body` variant.
- It is the **smallest real dataset** of the four (one row per resident by
  DB constraint, `UNIQUE(workforce_id)` — bounded, enumerable, easy to
  verify a 1:1 migration completed correctly row-by-row) and has **no
  doctor-identity users today** (no `/doctor/dissertation` route exists),
  so this slice would not touch any individual-doctor's data at all —
  cutting the blast radius roughly in half relative to touching Research or
  Casebook's doctor-owned rows.
- **Casebook stays separate longer, deliberately**: CLAUDE.md already
  declared the Casebook Builder / Casebook Engine split intentional and
  final ("sits alongside... not replacing it"); revisiting that specific
  decision is a separate, larger conversation this document does not
  reopen. Folding Casebook Builder into the Casebook Engine (a 2-into-1
  merge within the *same* thematic pair) would be a more natural next
  step than folding either into Research — but still not attempted without
  its own dedicated scoping pass and explicit sign-off, since it reverses a
  documented, deliberate prior decision.

Even this smallest slice would still need: a dry-run row-count/field-mapping
verification (not just "the migration ran"), an explicit rollback plan
before dropping `dissertations`/`dissertation_milestones`, a redeploy of
`dissertation-copilot`'s callers to the new shape (or a decision to retire
that Edge Function into `research-copilot`), and the same live-browser
verification rigor CLAUDE.md documents for every other schema change in
this repo. None of that is started here.

---

## 6. Explicit non-goals for now

- **No SQL, migration file, RLS policy, TypeScript type, or component was
  written or changed to produce this document.** This is scoping only.
- **No table was queried.** This worktree has no live DB credentials
  configured for this task; all data-maturity assessments in §1 are
  qualitative, reasoned from schema shape, migration history, and CLAUDE.md's
  own "manually verified" notes — not from a live row count. If a precise
  row count matters for a future go/no-go decision, that requires a
  separate pass with real Supabase credentials.
- **Nothing here is authorization to proceed with (a), (b), or (c).** Per
  CLAUDE.md's own AI Philosophy ("Silent scope creep is not acceptable... a
  schema change, a new RLS policy... must be called out explicitly, not
  slipped in as a side effect") and Security Notes ("Requires user
  confirmation before changing... before running"), any of the three paths
  above — even (c), which touches no existing table — needs its own
  explicit go-ahead from Dr. Olanipekun before a single line of
  implementation is written. This document exists to make that
  conversation possible, not to preempt it.
- **The `clinical_logbooks`/Learning & Development boundary question (§2.5)
  is flagged, not resolved.** Whether procedure/competency sign-off
  tracking belongs inside "Research & academic tracks" or "Learning &
  development" is a separate open question this document does not answer.
- **No decision is made here about retiring Casebook Builder, Dissertation
  Assistant, or any other existing system.** All four stay live and
  untouched unless and until a separate, explicit decision says otherwise.
