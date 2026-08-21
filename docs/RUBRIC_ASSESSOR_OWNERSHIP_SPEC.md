# Rubric Assessor Ownership Specification (Specification-Only Slice)

Status: **decisions locked by human review (2026-08-21 revision); no
migration written or applied, no schema/RLS/code/UI change made.** The
architecture and constraint-shape decisions below are locked. Only the
CHECK migration itself, the future external-assessment primitive, and the
Registry corrections remain outstanding, each an explicitly separate future
slice. All findings below were re-verified directly against current source
immediately before writing this file — migration 41, migration 57's rubric
section, `RubricInstanceForm.tsx`, `CasebookWorkspaceView.tsx`,
`ResearchWorkspaceView.tsx`, and `scoredRubricEngine.ts` — not copied forward
from `docs/REGISTRY.md`'s own summary of them.

## Purpose

`rubric_instances` carries two separate assessor-identity columns
(`assessor_workforce_id`, `assessor_doctor_id`) with no database constraint
governing their relationship. This document exists to resolve the intended
ownership/assessor semantics of `rubric_instances` **before** any CHECK
constraint is applied, and before any future supervisor/consultant/examiner
assessment workflow is built on top of this primitive. It recommends one
model and names the exact human decision that recommendation depends on. It
does not implement anything.

---

## Current verified schema

From `supabase/migrations/41_scored_rubric_primitive.sql`:

```sql
CREATE TABLE IF NOT EXISTS rubric_instances (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  rubric_template_id uuid NOT NULL REFERENCES rubric_templates(id),
  tenant_id uuid REFERENCES tenants(id),
  subject_ref text,
  assessor_workforce_id uuid REFERENCES workforce(id),
  assessor_doctor_id uuid REFERENCES doctor_profiles(id),
  scores jsonb NOT NULL DEFAULT '{}',
  section_totals jsonb NOT NULL DEFAULT '{}',
  final_score numeric,
  recommendation text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'scored', 'confirmed')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

Confirmed facts:

- **No CHECK constraint exists between `assessor_workforce_id` and
  `assessor_doctor_id`.** Both are independently nullable FKs; the schema
  permits all four combinations (neither set, either set alone, or both set
  simultaneously).
- `subject_ref` is free text (`'<concept>:<id>'` convention, e.g.
  `research_workspace:<uuid>`), identifying **what is being assessed** (a
  case, a workspace) — it is not a person identity and carries no assessor
  information itself.
- The migration's own header (design note, quoted verbatim) already names
  this as a known gap: *"a real gap in migration 41, not introduced here"*
  (per migration 57's header, discussed below) — i.e. this was a recognized,
  deliberate omission from the start, not an oversight discovered later.
- Migration 57 added RLS (see below) that *compensates* for the missing
  exclusivity at the row-visibility level, but does not add a schema-level
  constraint.

`scoredRubricEngine.ts`'s `RubricInstance`/`CreateRubricInstanceInput` types
mirror the schema exactly and impose **no application-level validation**
either — `createRubricInstance()` inserts whatever
`assessorWorkforceId`/`assessorDoctorId` values a caller passes, with no
check that at most one (or exactly one) is set.

---

## Current verified UI usage

Two real call sites exist today, both newly confirmed live-wired (this
directly corrects `docs/REGISTRY.md`'s current text, which still says
`RubricInstanceForm.tsx` "is imported by **nothing**" — that claim is stale;
not corrected in this slice per its own explicit non-goal, see below):

- `CasebookWorkspaceView.tsx`'s `OfficialWacpCaseSelfAssessment`, wired
  against the WACP Casebook/PMR template seeded by migration 46.
- `ResearchWorkspaceView.tsx`'s `OfficialWacpSelfAssessment`, wired against
  the WACP Proposal/Dissertation templates, also seeded by migration 46.

Both call sites pass:

```tsx
assessorWorkforceId={owner.kind === 'workforce' ? owner.id : null}
assessorDoctorId={owner.kind === 'doctor' ? owner.id : null}
```

`owner` is a discriminated union (`{ kind: 'workforce' | 'doctor', ... }`)
threaded down from `App.tsx`'s session state. Because it is a discriminated
union, **exactly one of the two branches is ever non-null through these two
call sites today.** Both are explicitly named "Self-Assessment" in their own
code comments: the same person who owns the casebook/dissertation workspace
scores their own work against the official rubric — there is no
third-party/supervisor path wired in anywhere.

**What this does and does not prove:**

- It proves today's only two callers happen to construct mutually exclusive
  values, by construction of the `owner` union — not because anything in the
  primitive, the engine, or the database enforces it.
- It does **not** prove no ambiguous row currently exists. `rubric_instances`
  has always had fully permissive RLS (`USING(true)`, migration 41; narrowed
  only for the purely-doctor-claimed case by migration 57 — see below), so
  any other caller with the anon key — a future feature, a manual script, a
  direct API call — could insert or update a row with both columns set, or
  neither, without hindrance. **No live-database query was run to confirm the
  actual current row population; this document does not claim ambiguous rows
  are proven absent, only that today's two known application code paths do
  not produce them.**
- `confirmRubricInstance()` (the pipeline's own "human confirms" step, per
  migration 41's header) has **zero callers anywhere in the current
  codebase** — the UI only ever reaches `status = 'scored'`, never
  `'confirmed'`. The confirmation gate is defined in the engine but entirely
  dormant today.

---

## Current integrity gap

Migration 57 added doctor-ownership RLS to `rubric_instances` as a fourth,
distinct shape from every other doctor-owned table in this schema:

```sql
CREATE POLICY "rubric_instances_select" ON rubric_instances FOR SELECT TO anon, authenticated
  USING (tenant_id IS NOT NULL OR assessor_workforce_id IS NOT NULL OR (assessor_doctor_id IS NOT NULL AND auth.uid() = assessor_doctor_id));
-- (INSERT/UPDATE/DELETE mirror the same condition)
```

Migration 57's own header states this plainly: *"rubric_instances has two
separate assessor columns with no ownership-exclusivity CHECK at all (a real
gap in migration 41, not introduced here)."* The policy above is a
**compensating control, not a fix**: any institutional signal (`tenant_id`
set, or `assessor_workforce_id` set) keeps the row fully permissive; only a
row that is *purely* doctor-claimed (only `assessor_doctor_id` set, nothing
institutional) requires the matching `auth.uid()`. A row with **both**
`assessor_workforce_id` and `assessor_doctor_id` set is treated as
institutional-permissive by this policy (the `assessor_workforce_id IS NOT
NULL` branch is satisfied regardless of the doctor column), which means the
RLS layer does not itself distinguish "co-assessed" rows from
"institutionally visible" rows — it was written to compensate for the
*known-safe* current usage pattern (never both), not to arbitrate a
genuinely ambiguous case.

Every other doctor/institutional ownership pair in this schema
(`personal_tasks`, `wellbeing_entries`, `focus_sessions`,
`scheduling_instances`, `meeting_series`, `clinical_document_types`) has an
explicit CHECK enforcing exactly one owner is set. `rubric_instances` is the
one exception.

**One important caveat about the RLS-quoted comparison above**:
`docs/REGISTRY.md` attributes this finding to *"Product Constitution Slice
2, Decision 2."* I searched `docs/WORKSPC_PRODUCT_CONSTITUTION.md` directly
for any numbered "Decision 2" and found none — the only numbered "Decision"
text that exists anywhere is `REGISTRY.md`'s own internal "Decision 1" label
(about engine-attribution/BabsBrain-2 retirement), which is itself a
`REGISTRY.md`-authored editorial decision, not literally Constitution text.
**This attribution could not be verified and should not be treated as a
locked constitutional directive** — flagged per this task's own instruction
to report conflicts rather than silently resolve them, not corrected here
(Registry correction is an explicit non-goal of this slice).

---

## Identity-model context

`docs/INSTITUTIONAL_AUTH_MIGRATION_SPEC.md` locks a target identity model
that is directly relevant here:

- **Person** — profession-neutral core identity. Explicitly *not* equated
  with Organisation Membership or a Workforce Record.
- **Organisation Membership** — a new, distinct, profession-neutral
  primitive representing "this Person belongs to this Organisation." No
  dedicated table exists yet.
- **Workforce Record** — the existing `workforce` table row. The spec is
  explicit: reusable-with-extension for V1, but **not locked as permanently
  identical to Organisation Membership.**
- **doctor_profiles** — the existing real Supabase-Auth-backed individual
  doctor identity.
- Locked principle (quoted): *"Person is not collapsed into Organisation
  Membership, Organisation Membership is not collapsed into Workforce
  Record, and Membership is not collapsed into Workforce Record."*

`rubric_instances`'s current `assessor_workforce_id` / `assessor_doctor_id`
pair is exactly the same shape of problem the Institutional Auth spec is
designed to retire: two separate, table-specific identity columns standing
in for what is conceptually one underlying Person, distinguished only by
*which* login mechanism that Person currently uses. This is the same split
`workforce.doctor_id` already bridges at the workforce-table level.

**Flag, per this task's explicit request**: the current dual-column
assessor model on `rubric_instances` reads as **transitional debt**,
consistent with the same pattern already present everywhere else in this
schema (`created_by_workforce_id`, `workforce.doctor_id`, etc.), not a
model worth hardening into a permanent, elaborate identity abstraction of
its own. Any solution adopted now should assume it may be superseded once a
real Person/Organisation-Membership primitive exists, and should therefore
prefer the smallest reversible fix over a deep redesign.

---

## Model A — Self-assessment only

The rubric instance's owner and assessor are the same person. Exactly one
identity representation is allowed (either `assessor_workforce_id` xor
`assessor_doctor_id`, mirroring every other doctor-ownership pair in this
schema). A future supervisor-grading capability would be built as a
**separate primitive or workflow**, not layered onto this table.

## Model B — Generic assessment (subject distinct from assessor)

`rubric_instances` gains a distinct notion of *subject* (who/what is being
assessed) separate from *assessor* (who is scoring). Self-assessment becomes
the special case where subject = assessor. Supervisor/consultant assessment
uses the same primitive with subject ≠ assessor. This would likely require
new explicit subject-identity columns (e.g. `subject_workforce_id` /
`subject_doctor_id`) rather than overloading today's assessor columns to
mean two different things depending on context.

## Model C — Separate self-assessment and external-assessment primitives

Preserve `rubric_instances` exactly as today's self-assessment primitive
(closing only the existing exclusivity gap). Introduce a **separate**
assessment/review primitive later, specifically for supervisor/examiner
scoring of someone else's work. Avoids overloading today's schema with a
second meaning, at the cost of maintaining two related-but-distinct
concepts going forward.

No fourth credible model was found in current schema/source that isn't a
variant of one of the above; per the task's own instruction, none is added
merely to appear thorough.

---

## Comparative table

| | Model A — Self-assessment only | Model B — Generic assessment | Model C — Separate primitives |
|---|---|---|---|
| Semantic clarity | High — matches exactly what exists today | Lower initially — overloads one column pair with two meanings depending on context | High — each primitive has one job |
| Fit with current Casebook/Research UI | Exact fit, zero UI change needed | Requires new subject-identity plumbing through both call sites | Exact fit for today's UI; no fit yet for a future one |
| Future supervisor/consultant/examiner assessment | Not supported here — needs a separate future primitive | Directly supported by the same table | Supported, but by a new, separate table introduced later |
| Profession-neutrality | Same as today — still workforce/doctor split | Same split, just doubled (subject + assessor each need it) | Same split on both eventual primitives |
| Doctor vs workforce identity handling | Unchanged, just constrained | Unchanged, doubled | Unchanged on both primitives |
| Data integrity | Strong — a CHECK constraint closes the exact named gap | Weaker until subject columns are also constrained | Strong for self-assessment; the future primitive would need its own review |
| RLS implications | Migration 57's existing policy already assumes this shape; no RLS change needed | Migration 57's policy would need re-examination against a new subject/assessor split | No change to `rubric_instances`; a new primitive would need its own RLS design later |
| Auditability | Same as today | Slightly richer (can distinguish subject from assessor in the same row) | Same as today for self-assessment; a new primitive gets a clean audit trail of its own |
| Migration complexity | Lowest — one CHECK constraint, no column changes | Higher — new columns, data backfill decisions for existing rows | Low now (nothing changes); higher later when the second primitive is built |
| Backward compatibility | Full — today's two call sites already satisfy the constraint | Requires deciding what existing rows' "subject" should be set to | Full — nothing about today's primitive changes |
| Represents self-assessment distinctly from official assessment | No — there is no "official" assessment concept in this table at all today | Yes, natively | Yes, by having two different tables |
| Do `assessor_workforce_id`/`assessor_doctor_id` remain appropriate names? | Yes — they already mean exactly this | No — would need renaming/reinterpreting as they'd sometimes mean "subject," sometimes "assessor" | Yes for this table; the new primitive would define its own names |

---

## Constraint options (illustrative, non-applied)

**Exactly-one-of:**

```sql
-- ILLUSTRATIVE ONLY — not applied, not a migration file.
ALTER TABLE rubric_instances
  ADD CONSTRAINT rubric_instances_assessor_xor
  CHECK ((assessor_workforce_id IS NOT NULL) <> (assessor_doctor_id IS NOT NULL));
```

Protects: guarantees every row has *exactly* one assessor identity —
matches every other doctor-ownership pair in this schema exactly, and
matches both current real call sites' actual behavior today. Fails to
express: a row with *neither* assessor set is **rejected** by this
constraint — but the current schema and both real call sites can
legitimately produce `subject_ref`-only, tenant-scoped, unassessed draft
rows in principle (nothing in today's two callers actually does this, but
the column being nullable at all suggests it was meant to be possible). This
constraint would need confirming that "every instance must always have an
assessor from creation" is actually the intended invariant, not just today's
incidental behavior.

**At-most-one-of:**

```sql
-- ILLUSTRATIVE ONLY — not applied, not a migration file.
ALTER TABLE rubric_instances
  ADD CONSTRAINT rubric_instances_assessor_not_both
  CHECK (NOT (assessor_workforce_id IS NOT NULL AND assessor_doctor_id IS NOT NULL));
```

Protects: guarantees a row is never *simultaneously* claimed by both a
workforce identity and a doctor identity — closes the specific ambiguity
this document exists to address, without forcing an assessor to be present
at all (a row with both null remains legal). Fails to express: does nothing
to prevent or flag a row with **neither** assessor set, which may itself be
a data-quality gap worth separately deciding on (e.g., should an unassessed,
un-owned `rubric_instances` row be allowed to exist indefinitely?) — that
question is out of scope for this document and not decided here.

---

## RLS/security implications

Neither constraint option changes migration 57's RLS policy text — both
still leave a row with `assessor_workforce_id` set (institutional) fully
permissive, and only a purely-doctor-claimed row gated on `auth.uid()`. If
**Model A** is adopted, migration 57's policy condition remains exactly
correct as written (it already assumes the exactly-one-of shape informally).
If **Model B** is adopted, migration 57's policy would need re-examination:
a row with a distinct subject and assessor changes what "purely doctor
claimed" should mean (claimed by the *assessor*, or by the *subject*, or
both) — this is not decided here and would need its own review before any
RLS change. If **Model C** is adopted, `rubric_instances`'s own RLS is
unaffected; a new external-assessment primitive would need entirely new RLS
designed from scratch, not inherited from this table.

None of this closes the deeper, already-known limitation that
`rubric_instances` RLS is not a real security boundary for institutional
rows (permissive by design, per migration 41's own header) — that remains
explicitly out of scope for this document, as it was for migrations 41 and
57 before it.

---

## Migration/backward-compatibility considerations

- **Model A (exactly-one-of or at-most-one-of)**: fully backward compatible
  with both current live call sites — neither has ever produced a row
  violating either constraint shape. No data backfill is anticipated to be
  necessary, though this cannot be confirmed without a live read (see
  Current integrity gap above) — a real migration, if approved later, would
  need to check existing rows for violations before adding either
  constraint, exactly as `docs/DATABASE_AND_SECURITY.md`'s migration-work
  requirements already mandate (current schema discovery, rollback plan,
  verification plan using disposable data only, human review, separate
  approval before applying anywhere live).
- **Model B**: not backward compatible without a design decision on what
  value existing rows' new subject columns should take, and how a rendering
  UI distinguishes "assessing myself" from "assessing someone else" — a
  larger, slower-moving change.
- **Model C**: fully backward compatible today (no change to the existing
  primitive) — complexity is deferred entirely to whenever a real
  supervisor-assessment need is confirmed and scoped.

---

## Recommendation (final, human-locked 2026-08-21)

**Long-term architecture is Model C: `rubric_instances` remains, permanently,
a SELF-ASSESSMENT primitive** (Model-A-like semantics — assessor = the
workspace/case owner), **with any future supervisor, consultant, examiner,
or other official third-party scoring built as a separate, new
external-assessment/review primitive**, never layered onto this table.
Model A is therefore not "the entire future assessment architecture" —
it describes what this one table is and will remain; Model C describes the
overall system shape once a third-party assessment need exists. This
document does not implement that future primitive; it is an explicitly
separate, not-yet-scoped future slice.

**Immediate integrity constraint: at-most-one-of, not exactly-one-of**,
applied later as its own separately reviewed migration — not in this slice:

```sql
-- ILLUSTRATIVE ONLY — not applied, not a migration file.
ALTER TABLE rubric_instances
  ADD CONSTRAINT rubric_instances_assessor_not_both
  CHECK (
    NOT (
      assessor_workforce_id IS NOT NULL
      AND assessor_doctor_id IS NOT NULL
    )
  );
```

Reasoning: today's only two real callers, and the product's only stated use
("Official WACP Self-Assessment," named as such in both call sites' own
code) are self-assessment. This requires no UI or column change at all — it
only closes the existing gap. The **at-most-one-of** shape is preferred over
exactly-one-of because it protects against the one scenario that is
actually a live risk today (a future caller accidentally setting both
columns, producing an ambiguously-owned row) without forcing an assumption
about whether every instance must always have an assessor from the moment
it's created. **Exactly-one-of is explicitly deferred, not rejected**: it
should only be reconsidered if later evidence shows NULL/NULL rows are
actually invalid for this table's intended use (e.g. if drafts are never
meant to exist without an assessor). The live check below found zero
NULL/NULL rows today, but zero observed instances of a state is not the same
as proof that state is disallowed — that is a separate product decision, not
made here.

Given the Identity-model context above, this is deliberately the smallest,
most reversible fix: it does not attempt to harden today's two-column split
into a permanent generic-assessment model. **`assessor_workforce_id` /
`assessor_doctor_id` are transitional identity representation — the same
workforce/doctor login-mechanism split already bridged elsewhere in this
schema (e.g. `workforce.doctor_id`) — not necessarily the permanent, generic
Person model.** Once `docs/INSTITUTIONAL_AUTH_MIGRATION_SPEC.md`'s
Person/Organisation Membership primitive exists, this pair (and the
CHECK constraint proposed here) may be superseded by a single Person
reference; nothing in this recommendation should be read as locking the
two-column shape in permanently. Model B (generic assessment via new subject
columns on this same table) is not recommended now — it would commit schema
shape ahead of both a confirmed supervisor-assessment product need and the
identity migration that would likely reshape it anyway.

---

## Live verification results (Decision 3, executed 2026-08-21)

A read-only aggregate query was run against live `rubric_instances`,
scoped to counts only — no row content, IDs, scores, or PII retrieved:

| total | workforce_only | doctor_only | both_set | neither_set |
|---|---|---|---|---|
| 5 | 5 | 0 | 0 | 0 |

- **No existing row violates at-most-one-of** (`both_set = 0`).
- **No NULL/NULL rows currently exist** (`neither_set = 0`) — today's live
  data happens to also satisfy exactly-one-of, but this is incidental to
  today's usage pattern, not a reason to reopen Decision 2: the locked
  rationale for preferring at-most-one-of (not forcing an assessor-at-creation
  assumption that hasn't been independently confirmed as a real product
  requirement) stands independent of what today's small row count happens to
  contain.
- **This live evidence creates no reason to reconsider the locked
  decisions.** It is a clean, additional confirmation that the at-most-one-of
  migration (when written and separately approved) can be applied with no
  pre-migration data remediation needed.

---

## Locked human decisions (2026-08-21 revision)

1. **Architecture (locked)**: `rubric_instances` remains a self-assessment
   primitive indefinitely. Current Casebook and Research rubric usage
   continues to represent a person assessing their own work. Any future
   supervisor/consultant/examiner/official third-party assessment is a
   separate external-assessment/review primitive, not layered onto this
   table. The future primitive is explicitly not implemented in this slice.
2. **Immediate integrity constraint (locked)**: at-most-one-of, not
   exactly-one-of. Not applied as a migration in this slice.
3. **Live verification (authorized and executed)**: read-only aggregate
   query only, see results above. No mutation performed.

---

## Non-goals

This document does not, and this slice did not:

- Write or apply a migration file.
- Apply any CHECK constraint to the live or local schema.
- Change any application code, UI, or RLS policy.
- Implement Institutional Auth.
- Implement the future external-assessment/review primitive (Model C's
  third-party-scoring capability).
- Correct `docs/REGISTRY.md`'s stale "imported by nothing" claim, or its
  unverifiable "Product Constitution Slice 2, Decision 2" citation — both
  remain flagged above as documented follow-up debt for a future
  governance-hygiene pass, not fixed here.
- Push, deploy, or apply any migration.

The one action this slice *did* take, by explicit human authorization, is
the narrowly-scoped read-only aggregate query in "Live verification results"
above — no row content, IDs, scores, or PII were read, and no mutation of
any kind was performed.

## Future implementation slices (decisions locked, none implemented here)

1. ~~A live, read-only query confirming no existing `rubric_instances` row
   has both `assessor_workforce_id` and `assessor_doctor_id` set.~~ **Done
   2026-08-21** — see Live verification results above: 0 rows violate
   at-most-one-of, 0 rows are NULL/NULL.
2. A narrowly-scoped migration adding the at-most-one-of CHECK constraint,
   following `docs/DATABASE_AND_SECURITY.md`'s migration-work requirements
   in full (rollback plan, RLS impact analysis already partly covered
   above, human review before writing SQL, separate approval before
   applying anywhere live). **Not written or applied in this slice.**
3. The Model C external-assessment/review primitive for future
   supervisor/consultant/examiner grading — an entirely new primitive with
   its own schema, RLS, and UI, scoped and reviewed separately when a real
   product need is confirmed. **Not scoped or implemented in this slice.**
4. Optionally, a follow-up decision (separately reviewed, not assumed here)
   on whether to also require at least one assessor be set at submission
   time (`status` moving past `'draft'`), as an application-level check
   rather than a schema-level one, since `submitRubricScores()` is the
   natural choke point for that rule if wanted.
5. A future governance-hygiene pass to correct `docs/REGISTRY.md`'s stale
   "imported by nothing" claim and its unverifiable "Product Constitution
   Slice 2, Decision 2" citation (see Non-goals below) — **not corrected in
   this slice.**
