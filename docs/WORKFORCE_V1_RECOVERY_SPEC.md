# Workforce V1 Recovery Specification (Slice 3 — DISCOVER + PLAN)

Status: **proposed, unreviewed. Not committed. No code/schema/migration written.**
Scope authority: `docs/WORKSPC_PRODUCT_CONSTITUTION.md` M4 (submissions ↔ roster).
Revision 2 (2026-08-20): revised per the locked Slice 3 decisions below —
Option A only, deterministic conservative rotation matching, surfaced inside
the existing `MultiRosterManagerView` workflow, explicit source-of-truth
model, precise leave-declaration language, `prepareGridForResidentAssignment`
left untouched.

This is a specification for human review, per M4's explicit requirement: *"Produce
a dedicated recovery specification before implementation."* **Option A — read-only
reconciliation inside the existing roster workflow — is the approved first
implementation direction.** Nothing in this document has been built.

---

## 1. The two pipelines, precisely, as they exist today

### Pipeline A — Workforce collection / submissions (fully live, fully working)

1. A resident logs in (`ResidentLoginView.tsx`, tenant → member → access code).
2. `ResidentFormView.tsx` collects, for the currently-open `collections` cycle:
   `current_rotation` / `next_rotation` (free text, picked from a `rotations`
   dropdown seeded with 10 named rotations — `Family Medicine Clinic`,
   `Internal Medicine`, `Paediatrics`, `Obstetrics & Gynaecology`, `Surgery`,
   `Emergency Medicine (A&E)`, `Community Health`, `Psychiatry`, `Geriatrics`,
   `Orthopedics`), plus `taking_leave` / `leave_type` / `leave_start` /
   `leave_end` / `leave_applied` / `leave_document_urls`.
3. `databaseService.submitRoster()` writes one row to `submissions`
   (`collection_id`, `workforce_id`, the above fields), emits `entry.submitted`/
   `entry.updated`, and best-effort mirrors the payload into `form_entries`
   (unread by anything — see `docs/REGISTRY.md` M8/M13).
4. `SubmissionsPanel.tsx` lets the Chief review/search/export what was submitted.
5. `WorkforceRegistryPanel.tsx` manages the `workforce` roster itself (name,
   category, `active`, `on_floor`) — separately from any given month's submission.

**Precise semantics of the leave fields, confirmed by reading the form UI**:
`taking_leave` is the resident's own declaration of intent to be on leave this
cycle. `leave_applied` answers the resident-facing question *"Have you applied
to the department?"* — a self-reported yes/no about whether a separate,
formal leave application was made elsewhere. **Neither field, nor any other
column on `submissions`, represents departmental/Chief approval of that
leave.** There is no `leave_approved` or equivalent anywhere in this schema.
This is member-declared, planned leave — not confirmed or approved leave —
and Option A must describe it that way.

### Pipeline B — Roster upload → parse → review → publish (fully live, fully working)

1. An admin pastes/uploads one of 5 named roster document types
   (`roster_types`: combined GOP, consultant GOP, A&E, supervision, satellite) —
   these are documents a **consultant or admin authors elsewhere**, not resident
   input. Each upload becomes an append-only row in `raw_roster_uploads`.
2. `uchRosterParser.ts` structures the raw text into one of 4 grid shapes
   (`GopClinicGrid` / `EmergencyCallGrid` / `SupervisionGrid` / `SatelliteGrid`),
   via the `roster-parser` Edge Function (LLM) with a deterministic heuristic
   fallback. Both paths are explicitly HITL: migration 10's own header states
   *"nothing anywhere in this schema records which resident covers which... that
   assignment doesn't exist as data, only as something a Chief decides... The
   parser structures what the consultant/admin documents already say; it does
   not invent resident assignments that aren't in the source documents."*
3. `MultiRosterManagerView.tsx` is the Chief's merge workspace: one
   `combined_master_rosters` row per `collection_id` (a real, already-present
   foreign key, `UNIQUE(collection_id)`), holding the 4 grids as jsonb, through
   a `draft → chief_review → published` lifecycle. Publishing posts the pinned
   `#Roster` announcement.

**This pipeline remains authoritative and unchanged by Option A** — see §7.

---

## 2. The exact disconnect (verified by source, not inferred)

Both pipelines are scoped to the same `collections` cycle
(`submissions.collection_id`, `combined_master_rosters.collection_id`,
`UNIQUE`) — **the join key already exists in the schema and requires no new
column or migration.** It is simply never used.

Confirmed by direct grep: `MultiRosterManagerView.tsx` and the `roster-parser`
Edge Function contain **zero references to `submissions`**.

- **`workforce.on_floor`** is the one signal `MultiRosterManagerView.tsx`
  actually uses to decide who's available for GOP/A&E/satellite duty this
  month (`onFloorResidents = workforce.filter(w => w.on_floor)`). It is a
  **manually toggled boolean** — one click flips it — with **no connection
  whatsoever** to that resident's own submitted
  `current_rotation`/`taking_leave`/`leave_start`/`leave_end` for the same
  collection cycle.
- An unused seam already exists in this area: `uchRosterParser.ts` exports
  `prepareGridForResidentAssignment(grid, onFloorResidents)`. **Per the
  locked decision in §5 below, this specification does not propose wiring
  it** — noted here only as prior context, not as part of Option A's design.
- **Leave dates are never checked against the published roster at all.**
  There is no code path, in either direction, that flags "this resident is
  on the roster for a date inside their own submitted leave range."

**Net**: two pipelines share a free, unused join key and no application logic
connects them. Option A's entire job is to compute and surface that missing
cross-reference — read-only, in place, evidence-shown.

---

## 3. Source-of-truth model (governs all of Option A)

Three distinct kinds of state exist today, and Option A must keep them
distinct rather than silently ranking one above another:

| State category | What it is | Where it lives | Who controls it |
|---|---|---|---|
| **Member-declared state** | What a resident says about themselves for this cycle: current/next rotation, whether they're taking leave, leave dates, whether they've applied to the department | `submissions` | The resident, at submission time; may be stale the moment circumstances change |
| **Organisational state** | What the department's own registry currently says about a member | `workforce` (`on_floor`, `active`, `category`) | Admin/Chief, updated whenever they choose |
| **Roster state** | What has actually been drafted or published for this cycle | `combined_master_rosters` grids, sourced from `raw_roster_uploads` | Consultant-authored documents + Chief's HITL merge |

**Option A reconciles these three and surfaces discrepancies. It does not
decide which one is "correct."** A mismatch between member-declared and
organisational state does not mean the organisational record is wrong — the
member's declaration might be outdated, mistaken, or itself the thing that
needs following up. The reverse is equally true. Discrepancy language must
name a *conflict between two states*, never assert that one side is an error.

**Required phrasing pattern**: *"Submitted rotation conflicts with current
workforce status"* — not *"Workforce status is wrong."* Every issue rendered
by Option A follows this pattern: name both states, name the conflict, do not
adjudicate.

---

## 4. Rotation/on-floor matching: deterministic, tenant-specific, conservative

**Locked constraints**:
- Deterministic matching only. No fuzzy string matching, no LLM inference.
- No schema redesign of `rotations` in this slice.
- `Family Medicine Clinic = on_floor` is **not** encoded as a universal
  Workspc rule — it is explicit, tenant-scoped compatibility logic for the
  current V1 tenant (UCH Family Medicine) only.
- Anything that cannot be confidently mapped is classified **Needs Review /
  Unknown** — never guessed at.

**Proposed mechanism**: a small, explicit, tenant-scoped adapter — a literal
lookup, not a general rule engine — mapping known rotation names to an
on-floor expectation, for this tenant only:

```
UCH_FAMILY_MEDICINE_ON_FLOOR_ROTATIONS = ['Family Medicine Clinic']
```

Matching logic per submission's `current_rotation`:
- Exact, case-sensitive match against a name in this tenant's known-rotation
  list (whether on-floor or not — i.e., the full 10-name seeded list, not
  just the on-floor one) → confidently classified as either "expected
  on-floor" or "expected outside rotation."
- Any value **not** found in the tenant's known-rotation list at all
  (free-text drift, typo, a rotation added after this adapter was written,
  a different tenant's vocabulary) → **Needs Review / Unknown**. Never
  inferred, never defaulted to either state.
- This adapter is explicitly documented in code (when implemented) as
  tenant-specific compatibility logic for UCH's current rotation vocabulary,
  not a platform rule — and flagged as a candidate for a future
  organisation-configurable mapping (e.g. a per-tenant table or
  `tenants.module_flags` entry) once more than one tenant needs this
  reconciliation. That generalisation is explicitly **not** part of this
  slice.
- Matching against `current_rotation_id` (the FK already backfilled by
  migration 01) vs. the free-text `current_rotation` column: **use
  `current_rotation_id` when present, falling back to an exact free-text
  match against `rotations.name` only when `current_rotation_id` is null**
  (covers submissions predating the FK backfill). This is still exact/
  deterministic matching — id-based when possible, exact-string-based
  otherwise — not fuzzy matching in either case.

---

## 5. `prepareGridForResidentAssignment()` — explicitly not wired in this slice

This existing, currently-unused function is **not** part of Option A. It is
not wired "because it already exists." Option A is read-only and does not
touch grid contents at all, so it has no natural call site for a function
whose entire purpose is staging residents into grid slots for assignment.

Documented here as a **possible future seam**, only for a later Option B or
an assignment-assistance slice — subject to its own separate review of:
its semantics (does "attach an empty residents slot" still match whatever
Option B/assignment design is eventually proposed?), and its profession-
neutral applicability (`GopClinicGrid`/`WorkforceMember` types are UCH-shaped
today; any future reuse needs its own check against the Constitution's
multi-professional-neutrality principle, not an assumption that this
function already satisfies it).

---

## 6. Option A — exact specification

### 6.1 Behavior

A read-only reconciliation check, computed for the active collection cycle,
surfaced inside the existing `MultiRosterManagerView.tsx` workflow at the
point where the Chief is preparing/reviewing the roster. **No automatic
writes of any kind** — not to `workforce.on_floor`, not to any grid, not to
`submissions`.

### 6.2 Exact data sources / read paths

| Read | Source | Purpose |
|---|---|---|
| Active collection | `collections` (status = `open`, or whichever collection `combined_master_rosters` for this view is scoped to) | Anchors the reconciliation to the same cycle the Chief is viewing |
| Member-declared state | `submissions` WHERE `collection_id` = active collection — `workforce_id`, `current_rotation`, `current_rotation_id`, `taking_leave`, `leave_type`, `leave_start`, `leave_end`, `leave_applied` | The resident's own declaration for this cycle |
| Organisational state | `workforce` — `id`, `full_name`, `active`, `on_floor`, `category` | The department's current registry state |
| Rotation vocabulary | `rotations` — `id`, `name` | Resolves `current_rotation_id`/`current_rotation` against the tenant's known rotation names (§4) |
| Roster state | `combined_master_rosters` WHERE `collection_id` = active collection — the 4 grid jsonb columns | What's actually been drafted/published this cycle, for the leave-overlap check |

All reads are against tables already permissively readable by the Chief
session today — no RLS change, no new table, no migration.

### 6.3 Discrepancy rules (issue types)

1. **Rotation conflicts with workforce status** *(only when the rotation
   maps confidently — §4)*:
   - Submitted rotation maps to "expected on-floor" but `workforce.on_floor
     = false` → *"Submitted rotation conflicts with current workforce
     status: [Name] submitted `Family Medicine Clinic` but is marked not
     on-floor."*
   - Submitted rotation maps to "expected outside rotation" but
     `workforce.on_floor = true` → *"Submitted rotation conflicts with
     current workforce status: [Name] submitted `Paediatrics` but is marked
     on-floor."*
2. **Submitted state cannot be confidently interpreted** — `current_rotation`
   (and `current_rotation_id`, if set) does not resolve to a known entry in
   this tenant's rotation vocabulary → *"Needs Review: [Name]'s submitted
   rotation `[value]` could not be matched to a known rotation for this
   organisation."* No on-floor comparison is attempted for this member.
3. **Leave period overlaps a draft/published roster assignment**
   *(implemented only if achievable from existing data with no schema
   change — confirmed achievable, see §6.4)*: a member's `submissions.
   leave_start`–`leave_end` range overlaps a date this member's name appears
   against in any of the 4 `combined_master_rosters` grids for this cycle →
   *"Leave period overlaps a draft roster assignment: [Name] declared leave
   [start]–[end]; appears in the [grid name] on [date]."* **Always phrased
   as declared leave** (§1, §3) — never "approved leave."
4. **No submission on record** — an active workforce member has no
   `submissions` row for the active collection. This duplicates a signal the
   existing `submissionChaserAgent` (A1) already surfaces as an insight;
   Option A may either omit this case (relying on the existing insight) or
   include it for completeness inside the same checklist — a decision for
   the PLAN step, not fixed here, since it's not a new capability either way.

Each issue carries: **issue type** (one of the 4 above), the **evidence**
(the exact submitted value(s) and the exact organisational/roster value(s)
being compared), and **which member** it concerns. No issue is auto-resolved,
dismissed, or written anywhere — reading the checklist is the only way it's
acted on, exactly like the existing roster-parser's `unparsed_notes`
convention this app already uses elsewhere.

### 6.4 Leave-conflict detection — feasibility confirmed

Achievable entirely from existing data, no schema change: `submissions.
leave_start`/`leave_end` (already present) and each grid's per-slot
`date_or_day` fields (already present in `GopClinicSlot`/`EmergencyShift`/
`SupervisionDuty`/`SatellitePosting`, per `src/types.ts`) are both read-only
comparisons against data that already exists. Matching a grid slot's
`date_or_day` (which may be a day name like `"Monday"` rather than a full
date, per `uchRosterParser.ts`'s own day-header parsing) against a leave date
range requires resolving day-names to actual calendar dates using the
collection's own month/year (`combined_master_rosters.month`/`.year`) — a
pure computation, not a data-model gap. Included in Option A's first slice.

### 6.5 Exact UI insertion point

Inside `MultiRosterManagerView.tsx` — **not a separate page or route**. Per
the required shape:
- A **summary count** of detected issues (e.g. "3 issues need review"),
  visible at the top of the existing roster-preparation view, near where the
  on-floor/not-on-floor resident lists already render (lines ~131,
  ~383–387 today).
- An **expandable member-level checklist** — collapsed by default (matching
  this codebase's existing `ActivityLogPanel.tsx` collapsed-detail
  convention), one entry per affected member, expanding to show issue
  type(s) and evidence for that member.
- Positioned so the Chief sees it while preparing/reviewing the roster for
  the same cycle, not on a separate dashboard tab.

### 6.6 Edge cases

- A member with **multiple issues** (e.g. an unmatchable rotation *and* a
  leave/roster overlap) shows both under their own checklist entry — issues
  are not deduplicated into one generic flag.
- A member **inactive** in `workforce` (`active = false`) but with a
  submission on record for the cycle: still reconciled — an inactive member
  submitting is itself informative, not suppressed.
- **No `combined_master_rosters` row yet** for the active collection (roster
  prep hasn't started): rotation/on-floor checks (issue type 1–2) still run;
  leave/roster overlap checks (issue type 3) simply have nothing to compare
  against yet and produce no findings — not an error state.
- **Multiple submissions across cycles**: only the active collection's
  `submissions` rows are considered; historical cycles are out of scope for
  this check.
- **A rotation value that matches the tenant vocabulary but has no defined
  on-floor expectation** (e.g. a future 11th rotation added to `rotations`
  without updating the adapter in §4): treated as Needs Review / Unknown,
  same as an unmatched value — the adapter list, not the `rotations` table
  membership alone, decides confident classification.

### 6.7 Verification / acceptance criteria

No automated test suite exists (`docs/TESTING_AND_VERIFICATION.md`) — manual
verification against a real or seeded collection cycle:
1. A member submitting `Family Medicine Clinic` while `on_floor = false` in
   `workforce` produces exactly one rotation-conflict issue, correctly
   worded per §3's phrasing rule.
2. A member submitting a rotation outside the tenant's known 10-name list
   produces exactly one Needs Review / Unknown issue, and no rotation-
   conflict issue.
3. A member with a declared leave range overlapping a date they appear
   against in any published/draft grid produces exactly one leave-conflict
   issue, worded as *declared* leave, not approved leave.
4. A member with fully consistent state (rotation matches `on_floor`, no
   leave overlap) produces zero issues.
5. Confirm no write occurs anywhere — `workforce.on_floor`,
   `combined_master_rosters`, and `submissions` are all byte-identical
   before and after opening/expanding the checklist.
6. `npm run verify` (typecheck + build) passes.

### 6.8 Explicit non-goals

- Does not write to `workforce.on_floor`, any grid, or `submissions`.
- Does not call or wire `prepareGridForResidentAssignment()` (§5).
- Does not implement Option B (write-through defaults) — deferred to its own
  future DISCOVER → PLAN → HUMAN REVIEW cycle, only after Option A has run
  through at least one real cycle and reliability/override/timing/exception
  patterns are understood (§8).
- Does not replace, wrap, or bypass the roster upload → parse → merge →
  publish pipeline in any way.
- Does not auto-generate roster assignments.
- Does not modify schema, migrations, RLS, or auth.
- Does not generalise the `rotations` model or make the on-floor mapping
  organisation-configurable — it remains explicit, tenant-specific
  compatibility logic for UCH only, clearly documented as such (§4), with
  generalisation named as future work, not attempted here.
- Does not create a new page/route/nav entry.

---

## 7. Preserve current roster path

The existing roster upload → parse → human merge/review → publish path
remains **authoritative and unchanged** by Option A. Nothing above modifies
`raw_roster_uploads`, the `roster-parser` Edge Function, `uchRosterParser.ts`,
the grid jsonb shapes, or the `draft → chief_review → published` lifecycle.
Option A adds a read-only checklist next to that workflow; it does not sit in
its critical path, and the roster can be prepared, reviewed, and published
exactly as today even if every reconciliation issue is ignored.

---

## 8. Option B — explicitly deferred, not scoped here

Write-through/default mutation (e.g. deriving `on_floor` from submitted
state) is **not implemented or scoped in this slice**. It may be scoped only
after Option A has been used through at least one real workforce/roster
cycle, and only once there is real evidence about:
- reliability of submitted rotation state (how often it's accurate/current),
- legitimate admin overrides (cases where a Chief correctly overrides
  submitted state and why),
- timing changes after submission (rotations/leave changing after a member
  submits but before roster prep),
- exception workflows (what happens today when these are caught manually).

Option B requires its own separately reviewed DISCOVER → PLAN → HUMAN REVIEW
cycle. Not proposed further here.

---

## 9. Proposed smallest implementation slice

A single, self-contained follow-up slice (not this document, and not
implemented here):
1. A read-only reconciliation function (new file, e.g. under
   `src/modules/org-admin/lib/` or `src/modules/roster-engine/lib/`) that
   takes the active collection's `submissions`, `workforce`, `rotations`,
   and `combined_master_rosters` rows and returns the issue list per §6.3.
2. A small UI addition inside `MultiRosterManagerView.tsx` (or a tightly
   coupled sibling component it renders) implementing the summary count +
   expandable checklist per §6.5.
3. No new table, no migration, no RLS change, no new route.
4. Manual verification per §6.7.

This is proposed as the next PLAN step, subject to separate human review
before any code is written.

---

Stopping here per Slice 3's instruction. No source, schema, or migration was
edited to produce this document. Not committed. Awaiting human review before
any further PLAN or implementation step proceeds.
