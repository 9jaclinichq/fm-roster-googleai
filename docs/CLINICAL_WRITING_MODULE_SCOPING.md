# Clinical & Professional Writing Module Generalization — Scoping Proposal

Status: **scoping document only. No schema, migration, or application code was
written or changed to produce this.** Read `CLAUDE.md`, §7/§8.2 of
`docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md`, `docs/REGISTRY.md`, and
`docs/LIVING_SYSTEM_GAP_AUDIT.md` before acting on anything below. This
document deliberately mirrors the structure and voice of
`docs/SCHEDULING_MODULE_SCOPING.md` and `docs/ACADEMIC_TRACKS_GENERALIZATION_PROPOSAL.md`
— same question shape ("generalize a spec module against real existing
features"), applied to a third, structurally different module.

---

## 0. The question this answers

The living-system spec (`PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md` §7, module row
4) describes **Clinical & professional writing** as: "case write-ups,
clerking templates, SOPs, protocols, referral letters, any structured
clinical document a doctor drafts," owner engine PrivyBrain-2. §8.2's seed
bullet under the same heading names three concrete instance shapes: "a
structured clerking template (shared with the case template above), referral
letter, SOP/protocol template."

Migration 42's own header (2026-08-15, written by a sibling agent in the same
wave that generalized Forms) already looked at this exact question in
passing and deliberately declined to act: *"'Clinical & professional
writing' has no generic instance table of its own yet —
`DissertationAssistantView.tsx`/`CasebookBuilderView.tsx`/
`CasebookWorkspaceView.tsx` remain three separate hardcoded features with no
builder+instances model the way Forms now has one... These two seeds need
that module's own generic document-template table (something closer to a
'content_blocks'/sections model) before they can be seeded properly."*
`docs/REGISTRY.md`'s own intro calls this "the single largest structural
gap" left in the app as of its last refresh. This document is that follow-up
pass.

Unlike Meetings & Actions (migration 45 — confirmed a genuine blank slate,
no prior table or feature to reconcile against) and unlike Scheduling
(migration 10's 5-format AI roster parser — one real, live, heavily-used
feature that had to be read against the spec and deliberately left
untouched), Clinical Writing is **mixed**: part of it (referral letters,
SOPs/protocols, clerking templates) is a genuine blank slate exactly like
Meetings; part of it (case write-ups) already has not one but *two* real,
live, differently-mature implementations that the spec's own first named
example ("case write-ups") arguably already describes. This document maps
what exists, proposes a target shape for the genuinely-missing piece,
resolves the case-write-up boundary question explicitly, lays out migration
paths with tradeoffs, and recommends one — without writing any of it.

---

## 1. Current-state map

### 1.1 `clinical_case_reports` (migration 15, extended 16/25/31) + `CasebookWorkspaceView.tsx`

The richer of two live case-write-up engines. Full clinical write-up per case
(1-15, framework-dependent): demographics, history, examination,
PCCM/biopsychosocial formulation, genogram/Family-APGAR/Ecomap/Duvall-stage
family-tools data, management plan, discussion, Vancouver references, plus
AI-generated `rubric_scores` and `defense_questions`. Sits inside a
`casebook_workspaces` container (one portfolio per resident/doctor, stamped
with a `page_count_target` from its `casebook_templates` framework —
WACP_PMR_10 / WACP_CASEBOOK_15 / NPMCN_CASEBOOK_15 / GENERIC_10 /
CUSTOM_CLINICAL).

- **Read directly from `CasebookWorkspaceView.tsx`** (confirmed this pass):
  six fixed content tabs per case (Demographics & History / Examination /
  PCCM / Family Tools / Management / Discussion & References), driven off a
  real-time client-side rubric validator (`caseRubricEngine.ts`) checking
  reference formatting, figure-starting-sentence violations, and PCCM
  component completeness against the active template — independent of the
  `casebook-copilot` Edge Function's own server-side scoring.
- **Ownership**: three-way — institutional (`workforce_id` via
  `casebook_workspaces`) or doctor-owned (`doctor_id`, migration 25). RLS is
  a **real** `auth.uid() = doctor_id` boundary on the doctor-owned rows,
  extended to this table's own child-table join in migration 31 (per
  CLAUDE.md's Security Notes, live-verified via `SET ROLE`/`set_config`
  simulation) — institutional rows stay `USING (true)`.
- **Data maturity**: per CLAUDE.md's own "Manually verified" note, a full
  resident-session browser walkthrough exercised every field, both AI
  Copilot actions against real OpenAI responses, and confirmed persistence
  across a full page reload; merged to `main` via PR #9. This is not a stub
  — it is one of the most actively built-out features in the app.

### 1.2 `case_reports` (migration 04) + `CasebookBuilderView.tsx`

The older, simpler 15-slot MVP: `case_number` (DB-level `CHECK BETWEEN 1 AND
15`), `patient_initials`, `diagnosis`, `category`, `status`
(draft/pending_supervisor/approved), `document_url`. No rubric, no template,
no AI-native scoring fields. Tenant-scoped (migration 11) but no `doctor_id`
path. Its one AI action — differential-diagnosis extraction — is a
non-persisted scratch tool that calls `academicCopilot.ts` (imported
directly from `../../dissertation/lib/academicCopilot`, confirmed at
`CasebookBuilderView.tsx` line 3) rather than `casebookCopilot.ts` — the
cross-wire CLAUDE.md's own §1.4 already documents as predating the
casebook-copilot split. Per CLAUDE.md's own "SCOPE DECISION," this table and
view are kept alongside 1.1 deliberately, not replaced by it — "sits
alongside the original Casebook Builder, not replacing it... an explicit
choice made with the user."

### 1.3 `DissertationAssistantView.tsx` + `dissertations`/`dissertation_milestones` (migration 04) — reasoned through, not assumed

Is this "clinical writing" per the spec's row 4, or "academic writing" per
row 5 ("Research & academic tracks... a dissertation... any staged piece of
academic or research work")? The spec's own text answers this directly —
row 5 names "a dissertation" as its *first* example, and row 4 never
mentions dissertations, theses, or academic tracks at all. Reading the
actual schema confirms the fit: `dissertations.stage` is a fixed 9-value
CHECK enum walking a WACP academic milestone pipeline (`Topic Registration`
→ ... → `Final Submission`), not a clinical document at all — no patient,
no encounter, no clinical formulation anywhere in either table.
`docs/ACADEMIC_TRACKS_GENERALIZATION_PROPOSAL.md` already reached this same
conclusion independently, in full — its own §1.2 lists Dissertation
Assistant as one of the three (now four, counting Casebook Builder) live
systems competing for the **Research & academic tracks** capability, with a
concrete recommendation (§5) to eventually fold it into the Research
Engine's own template shape. **This document treats that boundary as
already settled by that sibling document and does not re-litigate it.**
`DissertationAssistantView.tsx` is out of scope for Clinical & Professional
Writing entirely — it belongs to Academic Tracks, full stop.

One nuance worth naming rather than silently skipping: `academicCopilot.ts`
(the client shared by both Dissertation Assistant and, per §1.2 above,
Casebook Builder's scratch ddx tool) does two of its three actions in
genuinely clinical territory — "differential-diagnosis extraction" reasons
over a *clinical* case, not an academic manuscript. That the same client
module backs both an academic-tracking view and a clinical scratch tool is
an existing cross-wire (flagged in CLAUDE.md's own §1.4), not evidence that
Dissertation Assistant itself is a clinical-writing feature. The document
`dissertations` tracks (a dissertation manuscript) stays academic; only one
of its three AI actions happens to also serve a clinical use elsewhere.

### 1.4 Confirmed: no referral letter / SOP / protocol / clerking-template feature exists anywhere today

Repo-wide grep for `referral letter`, `SOP`, `protocol template`, and
`clerking` (case-insensitive, across `src/` and `supabase/`) turns up
exactly these categories of hits, all already-reviewed:
- Migration 42's own header (§0 above) naming the gap.
- Three unrelated migrations (`11`, `24`, `29`) and a Paystack Edge Function
  where "protocol" means an HTTP/network protocol, not a clinical one.
- `types.ts`/`App.tsx`/`DevHelper.tsx`/`SaaSOperatorConsoleView.tsx`/
  `AnnouncementBoardView.tsx` — spot-checked, all false positives on
  substrings ("protocol" as in URL scheme, or similar), none describing a
  clinical document feature.

There is genuinely **no** table, RPC, component, or seed content anywhere in
this codebase for a referral letter, an SOP, a protocol document, or a
clerking template distinct from the two case-write-up systems above. This is
a real, total gap — not a naming mismatch against something that already
exists under a different name.

### 1.5 `knowledge_packs`/`knowledge_pack_items` (migration 08) — a reference library, not a doctor-authored document space

Worth distinguishing explicitly, per this task's own instruction. Reading
migration 08's header directly: `knowledge_pack_items` holds
Chief/admin-curated *reference* material — department guideline PDFs,
manually-pasted extracted text, indexed with a Postgres full-text
`search_vector` so `academicCopilot.ts`'s "Check Departmental Guidelines"
action can retrieve relevant excerpts (lexical keyword search, explicitly
**not** semantic/embedding-based, per that migration's own note). This is a
*library a doctor reads from*, not a *space a doctor drafts documents in* —
structurally and purposefully the opposite of what Clinical & Professional
Writing needs. No overlap, no reuse candidate.

### 1.6 Scored Rubric primitive (migration 41) — relevant, but currently unwired anywhere

`rubric_templates`/`rubric_sections`/`rubric_items`/`rubric_instances` +
`compute_rubric_totals()` (§8.1 of the living-system spec) is a real,
schema-complete, generic scored-checklist primitive — sections of scored
items, pass thresholds, a computed recommendation band. Per
`docs/REGISTRY.md`'s M15 entry, confirmed by direct repo-wide grep this
pass: it has **zero consuming faces** today. `RubricInstanceForm.tsx` is
imported by nothing outside its own file; no `rubric_templates` row exists
with real content. It is exactly the right shape for SOP/protocol sign-off
or clerking-template review scoring — `rubric_instances.subject_ref` is
deliberately free text for exactly this kind of future attachment
(`'clinical_document:<uuid>'` would fit its own documented convention
without a schema change) — but it is not yet proven against *any* real
consumer, a fact this document's §6 recommendation takes seriously rather
than glossing over.

### 1.7 Summary table

| System | Table(s) | Doctor route? | Content shape | Spec module (row) |
|---|---|---|---|---|
| Casebook & Logbook Engine | `clinical_case_reports` | yes (RLS-real) | fixed clinical fields + AI scores | #4 Clinical Writing (case write-up) |
| Casebook Builder (legacy) | `case_reports` | no | flat, no rubric | #4 Clinical Writing (case write-up) |
| Dissertation Assistant | `dissertations`/`_milestones` | no | fixed 9-stage academic pipeline | #5 Research & Academic Tracks (settled elsewhere) |
| Referral letter | — none — | — | — | #4 Clinical Writing (**genuine gap**) |
| SOP / protocol | — none — | — | — | #4 Clinical Writing (**genuine gap**) |
| Clerking template | — none — | — | — | #4 Clinical Writing (**genuine gap**) |
| Scored Rubric primitive | `rubric_*` | n/a (unowned) | generic, unwired | cross-cutting, no consumer yet |

---

## 2. What the spec actually wants — target shape

Following the same `builder / instances / data / pipelines / agent hooks`
model §7 defines for every module, and the exact 3-table convention the two
most recent real migrations in this repo already used for an identical
"generalize a spec module, mostly/fully blank slate" question — Scheduling
(migration 44: `scheduling_instances`/`scheduling_entries`/
`scheduling_pipelines`) and Meetings (migration 45: `meeting_series`/
`meetings`/`meeting_actions`) — Clinical Writing's genuinely-missing piece
needs an analogous pair of tables. Field lists only — no SQL, no types, no
RLS policy text; a shape for a human to turn into a real migration later,
not a migration.

### 2.1 Should this reuse `form_instances`' shape? No — and the reasoning goes one level past migration 42's own flag.

Migration 42's header called a long-form document "a bad conceptual fit" for
`form_instances.schema` (a flat `FormFieldDefinition[]` list — text /
textarea / number / date / boolean / select / file) without fully spelling
out *why*, beyond "it's a document, not fields to collect." Making that
concrete: `form_instances` is built for **discrete, independently-typed data
points** (a leave request's start date, a feedback form's severity
dropdown) rendered as separate inputs. A referral letter, SOP, or clerking
template is **prose organized into named sections**, where each section
itself needs multi-paragraph free text, not a single typed value — and,
critically, **the section structure itself differs by document kind**: a
referral letter's sections (referring clinician, receiving facility,
clinical summary, reason for referral, urgency) share almost nothing with an
SOP's sections (purpose, scope, equipment required, step-by-step procedure,
safety notes, review date), which again share almost nothing with a
clerking template's sections (chief complaint, history by system,
examination by system, impression, plan). Forcing all three into one flat
field list per instance would mean either (a) collapsing each into a single
giant "Body" textarea field — which throws away exactly the per-section
structure PrivyBrain-2 would need to read a document meaningfully (spec §2's
own worked example under Rung 0: "draft a case write-up section from
notes") — or (b) growing `FormFieldDefinition` a new "long-form section"
field type that behaves nothing like its five siblings, at which point it
is a different table wearing `form_instances`' name. **This confirms
migration 42's flag rather than just repeating it: the genuinely-missing
piece needs its own table family**, sized for ordered, named, prose-bearing
sections — a "content_blocks" model, per that migration's own speculation.

### 2.2 `clinical_document_types` (the "builder" output — a named, reusable document type)

```
id                       uuid, PK
tenant_id                uuid, nullable  \  same 3-shape owner convention as
doctor_id                uuid, nullable  /  form_instances (post-migration-42),
                                             scheduling_instances (migration 44),
                                             and meeting_series (migration 45):
                                             exactly one of tenant/doctor set
                                             for an org/individual-owned type,
                                             or both NULL for a global seed
name                     text            -- "Referral Letter", "SOP: Wound
                                             Dressing Change", "General
                                             Clerking Template"
document_kind            text            -- free text, not a CHECK enum, same
                                             reasoning as scheduling_instances.
                                             schedule_kind and
                                             form_pipelines.pipeline_type:
                                             avoid CHECK-constraint churn
                                             while the real set
                                             (referral_letter, sop_protocol,
                                             clerking_template, custom) is
                                             still being discovered from
                                             usage
description              text, nullable
body_template            jsonb           -- ordered content_blocks: a list of
                                             {key, label, guidance_text,
                                             placeholder_text, block_kind}.
                                             block_kind distinguishes a
                                             heading/section-label from a
                                             free-text prose block from a
                                             short single-line field (e.g. a
                                             referral letter's "Urgency"
                                             might be a short field, not a
                                             paragraph) — a small, closed set
                                             interpreted by the drafting UI,
                                             not a foreign key, same
                                             free-text-interpreted-by-the-
                                             builder-UI precedent
                                             scheduling_instances.
                                             row_definitions[].row_kind
                                             already set
is_system_default        boolean         -- parity with org_groups/
                                             workforce_categories/
                                             form_instances' own column
created_by_workforce_id  uuid, nullable
created_at               timestamptz
```

### 2.3 `clinical_documents` (the "data" — one row per actually-drafted document)

```
id                    uuid, PK
document_type_id      uuid, FK -> clinical_document_types(id)
tenant_id             uuid, nullable  -- denormalized from the type, cheap
doctor_id             uuid, nullable     filtering without a join, same
                                          precedent form_entries.tenant_id /
                                          scheduling_entries.tenant_id /
                                          meetings.tenant_id all already set
title                 text            -- "Referral: J. Adewale, 14-Aug" or
                                          "Wound Dressing Change SOP v3" —
                                          member-supplied, not derived
content               jsonb           -- populated content_blocks, same
                                          {key, value} shape as the parent
                                          type's body_template keys
status                text            -- free text (draft / final / signed),
                                          not a CHECK enum, consistent with
                                          this document's other free-text
                                          fields and with
                                          scheduling_instances.status/
                                          meetings' own lifecycle fields
subject_ref           text, nullable  -- deliberately free text, mirroring
                                          rubric_instances.subject_ref's own
                                          documented convention — lets a
                                          referral letter or clerking
                                          template optionally reference a
                                          clinical_case_reports row or any
                                          other subject without inventing a
                                          typed FK to a patient/encounter
                                          concept this app doesn't have
created_by_workforce_id  uuid, nullable
created_at            timestamptz
updated_at            timestamptz
```

### 2.4 `clinical_document_versions` — sketched as part of the target shape, not the first slice

The task brief's own framing (a doctor might redraft a protocol over time)
is real for SOPs/protocols specifically — a wound-dressing SOP gets revised
as practice changes, and a "what changed, when, by whom" history has real
clinical-governance value an in-place overwrite loses. A referral letter or
one clerking-template instance, by contrast, is normally drafted once per
patient/encounter and not meaningfully "versioned" the way a standing
protocol is. Target shape:

```
id                uuid, PK
document_id       uuid, FK -> clinical_documents(id)
version_number    integer
content           jsonb    -- full snapshot of content at this version
change_note       text, nullable
changed_by_workforce_id  uuid, nullable
created_at        timestamptz
```

Whether this ships in the first slice is addressed in §6 — flagged here as
part of the *target* shape per the task's own ask, not assumed to be
first-slice scope.

---

## 3. How case write-ups relate to this new module — the crux question

Does `clinical_case_reports`/`CasebookWorkspaceView.tsx` (and, more weakly,
`case_reports`/`CasebookBuilderView.tsx`) get folded into Clinical &
Professional Writing as one of its instance types — a case write-up *is* one
kind of structured clinical document, per the spec's own first named
example — or does it stay entirely owned by the Casebook & Logbook module
family, with the new module covering only the genuinely-uncovered document
types?

**Recommendation: stays owned by Casebook & Logbook. Clinical & Professional
Writing covers only referral letters, SOPs/protocols, and clerking
templates in this pass.** Reasoning, weighed against both sibling documents'
own resolutions of the identical-shaped question:

- **This is structurally the same question `ACADEMIC_TRACKS_GENERALIZATION_PROPOSAL.md`
  already answered for Dissertation Assistant vs. the Research Engine, and
  it reached (c) — read-only composition, zero schema/data migration —
  specifically because folding a live, richly-built, real-user-data-bearing
  feature into a new generic table is "one of the largest, highest-blast-
  radius changes this repo could make in one pass" for a benefit (a second
  org needing the generic shape) that doesn't exist yet.** `clinical_case_reports`
  is that document's `research_workspaces`: the single most mature,
  most-recently-verified, most richly-featured (genogram/APGAR/Ecomap/Duvall,
  AI rubric scoring, real `auth.uid()`-scoped RLS) content table in this
  entire audit. Migrating its rows into a generic `content` jsonb blob would
  either flatten away structure nothing else in this app has (the family
  tools data has its own real shape, not prose) or require `clinical_documents.content`
  to grow a second, incompatible shape just for this one instance type —
  defeating the purpose of generalizing at all.
- **This also matches `SCHEDULING_MODULE_SCOPING.md`'s own precedent for
  "a rich existing feature vs. a new generic model" directly**: that
  document's recommended path (b) treats UCH's 5-format AI roster parser as
  *"a specialized, hospital-specific implementation of the same underlying
  capability, not something that needs to migrate for the module to
  'exist.'"* The same framing applies here without alteration: WACP/NPMCN
  case write-ups are a specialized, richly-built implementation of "a
  structured clinical document a doctor drafts" — real, valuable, and
  **conceptually** one example of the Clinical Writing capability the
  spec's own §7 row names — without needing to live inside the new module's
  schema for that to be true.
- **CLAUDE.md's own explicit precedent reinforces the same instinct one
  more time**: the Casebook Builder / Casebook Engine coexistence itself
  ("sits alongside the original Casebook Builder, not replacing it... an
  explicit choice made with the user rather than silently colliding two
  'casebook' concepts or migrating existing resident data") is this exact
  pattern already applied once, one level down, within the same module
  family. Reapplying it a second time — Clinical Writing sitting alongside
  Casebook & Logbook rather than absorbing it — is the *consistent* call,
  not a new one.
- **What actually changes, then, is registry/documentation-level, not
  schema-level**: `docs/REGISTRY.md`'s eventual M-number for Clinical
  Writing should note that `clinical_case_reports`/`case_reports` are a
  *related, capability-adjacent* feature owned by M4 (Casebook & Logbook),
  the same way the Scheduling scoping doc flagged `raw_roster_uploads` as
  "arguably infrastructure to an instance's ingestion rather than the
  'data' a module's instances/entries concept is about" without moving it.
  A future UDR (`udr.ts`) read-composition pass, if one is ever built for
  "everything this doctor has drafted," is free to read across both
  `clinical_case_reports` and the new `clinical_documents` and present them
  together — that is exactly the kind of zero-schema-risk unification
  `ACADEMIC_TRACKS_GENERALIZATION_PROPOSAL.md`'s (c) already validated as
  low-risk and useful. Nothing in this recommendation forecloses that; it
  only forecloses a *schema* merge.

The one thing this recommendation deliberately does **not** decide: whether
a *future, lighter-weight* generic case write-up (for an org that wants
"structured clinical document, case-shaped" without WACP/NPMCN's full rubric
apparatus) should someday live in `clinical_documents` as one more
`document_kind` value. That is a real, plausible future need — flagged as an
open question in §7, not built or further scoped here.

---

## 4. Migration paths, with tradeoffs

### 4.1 (a) Full replacement / fold-in

Migrate `clinical_case_reports`/`case_reports` rows into
`clinical_documents`; rewrite `CasebookWorkspaceView.tsx`/
`CasebookBuilderView.tsx` to read/write the new shape; retire
`casebook_templates`/`casebook_workspaces` in favor of
`clinical_document_types`; rewire `casebook-copilot`'s request/response
contract.

- **Pros**: the only path that reaches literally "one capability, one
  schema" for Clinical Writing.
- **Cons — severe, matching both sibling documents' own severity language
  for the identical shape of decision**: real production data (structured
  clinical write-ups, AI-generated rubric scores, family-tools data) for
  real residents and real individual doctors; a live, PR-merged, browser-
  verified feature; a real `auth.uid()`-scoped RLS boundary (migration
  25/31) that would need re-deriving on the new table, not assumed to carry
  over; a live Edge Function (`casebook-copilot`) whose request/response
  contract would need a coordinated rewrite and redeploy; no automated test
  suite and no migration-rollback tooling in this repo (CLAUDE.md's own
  description: "re-run the SQL in the Supabase dashboard" is the entire
  recovery plan). §3 already concluded this isn't the right target relationship
  at all — this path is rejected on both migration-risk *and* design-fit
  grounds, not risk alone.

### 4.2 (b) Additive/parallel

Build `clinical_document_types`/`clinical_documents` alongside every
existing system, touching zero existing routes/tables. A *new*, simple
generic drafting UI lets an org (or individual doctor) create a referral
letter / SOP / clerking template type and draft actual documents against it
— something literally impossible in this schema today. `CasebookWorkspaceView.tsx`,
`CasebookBuilderView.tsx`, `clinical_case_reports`, `case_reports`,
`DissertationAssistantView.tsx`, `dissertations`, and `dissertation_milestones`
are all completely untouched.

- **Pros**: zero migration risk to any live feature — nothing is moved,
  nothing can be lost. Matches this session's own established
  precedent exactly: migration 44 (Scheduling) and migration 45 (Meetings)
  both landed exactly this way, in this same wave, days apart. Closes a
  real, currently-total gap (referral letters, SOPs, clerking templates
  have nowhere to live today) immediately.
- **Cons**: does not, by itself, unify "case write-ups" under one schema —
  but §3 already concluded that unification is the wrong target anyway, so
  this is not really a cost unique to this path; it is the deliberate
  outcome.

### 4.3 (c) Dual-write now — does not meaningfully apply here, unlike Forms/Scheduling

Forms' and Scheduling's dual-write option existed because a live flow
(`ResidentFormView.tsx`'s submissions, `MultiRosterManagerView.tsx`'s
grid-blob publish) already produces real data that *could* be mirrored into
the new generic tables at write time. **Clinical Writing's genuinely-missing
piece has no such source to mirror from** — there is no existing referral-
letter, SOP, or clerking-template flow anywhere to dual-write out of; per
§1.4, this part of the module is a genuine blank slate, the same
characterization migration 45 used for Meetings & Actions in full. A
dual-write only becomes a meaningful question for the *case-write-up*
relationship (§3) — and §3 already recommends against a schema-level link
there, for reasons that apply whether the link is a full migration or a
best-effort mirror. So (c) is not a live third option here the way it was
for Forms/Scheduling; noted for completeness, not carried into §5.

---

## 5. Recommendation

**(b) — additive schema only, covering referral letters, SOPs/protocols,
and clerking templates. `clinical_case_reports`, `case_reports`,
`casebook_templates`, `casebook_workspaces`, `CasebookWorkspaceView.tsx`,
`CasebookBuilderView.tsx`, `DissertationAssistantView.tsx`, `dissertations`,
and `dissertation_milestones` all stay exactly as they are, untouched,
indefinitely, per §3's boundary decision.**

Justification against this repo's own stated values and this session's own
precedent:

- **"No silent scope creep" / "surgical fixes" (CLAUDE.md's AI Philosophy).**
  (a) is a coordinated rewrite of the richest, most recently verified
  clinical content feature in the app, for a unification benefit §3 already
  concluded is not actually the right design target. (b) is the definition
  of surgical: net-new tables, zero existing surface touched, a real total
  gap (referral letters/SOPs/clerking templates have nowhere to live today)
  closed directly.
- **The established additive-precedent pattern, applied a third and fourth
  time in the same session.** Migration 44 (Scheduling) and migration 45
  (Meetings) both made this exact call — additive scaffold, zero touch to
  any live path — within the same wave of work this document is part of.
  `docs/SCHEDULING_MODULE_SCOPING.md`'s own §4 and
  `docs/ACADEMIC_TRACKS_GENERALIZATION_PROPOSAL.md`'s own §4 both reached
  the additive-or-view-only conclusion independently, from their own
  risk analyses, on structurally similar questions. Reaching for a full
  fold-in here specifically — on the one part of this module with real,
  live, PR-merged user data — would be the outlier decision, not the
  consistent one.
- **CLAUDE.md's own "sits alongside... not replacing" precedent, reapplied
  rather than reinvented.** §3 already quotes this in full; it is the same
  design instinct this repo committed to once already, one level down in
  the same module family.
- **What (b) actually delivers now**: real, immediate coverage for document
  types that are entirely unimplementable in this schema today, for any
  org — not just UCH — with zero risk to any live feature. That is the
  actual gap migration 42 flagged ("no generic instance table exists... need[s]
  that module's own generic document-template table... before they can be
  seeded properly"), and (b) closes it directly, the same way (b) closed
  the analogous gap for Scheduling and Meetings.

---

## 6. Minimum first slice for (b)

Not the final schema (§2 is closer to that) — what a first migration and
first UI pass would need to cover to be useful without overreaching.

### 6.1 Migration shape

Same two tables sketched in §2.2-2.3, with these first-slice narrowings,
matching the precedent migrations 44/45 both already set:

- **Skip `clinical_document_versions` (§2.4) in the first slice.** Real
  clinical-governance value, but it is the one part of the target shape
  with no equivalent precedent yet built in this app (Forms/Scheduling/
  Meetings all shipped their first slice without a version-history table).
  `clinical_documents.updated_at` (plain overwrite-in-place) covers the
  first slice; version history is flagged as a real, likely-needed follow-up
  for SOPs/protocols specifically, not silently dropped.
- **`doctor_id` columns exist from day one on both tables, with no real
  `auth.uid() = doctor_id` RLS boundary built yet** — exactly migration
  44's and 45's own explicit deviation, for the same reason: avoids a later
  `ALTER TABLE`, but a real doctor-owned boundary is a separate, explicit
  follow-up once a doctor-facing drafting UI is actually built. Both
  columns present, both flagged as schema-only in this pass.
- **`document_kind`, `block_kind`, and `status` all stay free text, no CHECK
  enum, no lookup table** — same reasoning `scheduling_instances.schedule_kind`
  and `form_pipelines.pipeline_type` already established: avoid
  CHECK-constraint churn while real usage patterns beyond the three named
  seed kinds are still unknown.
- RLS: permissive `USING (true) WITH CHECK (true)` on both tables, matching
  every table since migration 01 and matching migrations 44/45's own
  explicit choice not to invent a stricter posture nobody asked for in a
  first slice.
- **Do NOT wire the Scored Rubric primitive (migration 41) into this first
  slice.** Per §1.6, that primitive has zero consuming faces anywhere in
  this app today — it is itself unproven. Making Clinical Writing's first
  slice the very first real consumer of *two* unvalidated pieces of schema
  at once (the new `clinical_documents` shape *and* the Scored Rubric
  primitive) compounds risk for no corresponding near-term need — no SOP
  sign-off workflow has been requested yet. The attachment point is cheap
  to add later and requires no schema change when it is: a `rubric_instances`
  row with `subject_ref = 'clinical_document:<uuid>'`, exactly the
  convention that column already documents. Flagged as designed-for, not
  built now — the same "cheap to add later, not worth it before there's a
  real need" call `ACADEMIC_TRACKS_GENERALIZATION_PROPOSAL.md`'s own §4
  made about a different speculative table.

### 6.2 Minimal generic builder/drafting UI

A new, deliberately simple screen — not a rich-text editor, not an
e-signature flow, not AI-assisted in this first slice:

1. **Builder** (org admin, or an individual doctor for their own personal
   type): create a named `clinical_document_types` row — name,
   `document_kind` free text, an ordered list of sections (label + guidance
   text + `block_kind`: heading / paragraph / short-field). No rich-text
   formatting controls; each `paragraph` block is a plain multi-line
   textarea.
2. **Drafting** (any member): pick a document type, get one input per
   `body_template` section, fill it in, save draft / mark final. No
   AI-generated content, no guideline-check integration, no e-signature —
   those are exactly the "integrations layer" tools §7 already names for
   this module (word-processing/long-form writing space, e-signature,
   reference manager) and are deliberately deferred, per spec rule 11
   ("integrations are additive, never required... every module has a
   native fallback").
3. A simple draft/final status toggle, reusing the same free-text-status
   convention already proven across every other module's first slice.

### 6.3 Where it lives

`src/modules/clinical-writing/` — confirmed, by direct listing of every
folder currently under `src/modules/` this pass, **not already taken**:
`announcements`, `auth`, `billing`, `casebook-logbook`, `consultant-review`,
`dissertation`, `doctors`, `exam-readiness`, `form`, `knowledge-packs`,
`meetings`, `org-admin`, `research`, `roster-engine`, `scheduling`, `shared`,
`viva-simulator`. A new module gets its own `components/`/`lib/` and
(once a migration is written) owns the 2 new tables — following the
`meetings`/`scheduling` precedent of one clean module folder per capability,
not nested under `org-admin` or `casebook-logbook`.

---

## 7. Explicit non-goals for now

- **No SQL, migration file, RLS policy, TypeScript type, or component was
  written or changed to produce this document.** This is scoping only.
- **No table was queried.** This worktree has no live DB credentials
  configured for this task; every claim above comes from reading migration
  files, `docs/REGISTRY.md`, `docs/LIVING_SYSTEM_GAP_AUDIT.md`, and the
  actual `CasebookWorkspaceView.tsx`/`CasebookBuilderView.tsx`/
  `DissertationAssistantView.tsx` source directly — not from live row
  counts.
- **Nothing here is authorization to proceed with (a) or (b).** Per
  CLAUDE.md's own AI Philosophy ("Silent scope creep is not acceptable... a
  schema change, a new RLS policy... must be called out explicitly, not
  slipped in as a side effect") and Security Notes, either path needs its
  own explicit go-ahead from Dr. Olanipekun before a single line of
  implementation is written.
- **The §3 boundary decision (case write-ups stay owned by Casebook &
  Logbook) is a recommendation, not a foreclosure.** A future UDR
  read-composition layer presenting `clinical_case_reports` and
  `clinical_documents` together is explicitly left open as a low-risk
  follow-up; a schema-level fold-in is what this document argues against,
  not any form of unification whatsoever.
- **Whether a future lighter-weight, non-WACP-rubric-driven case write-up
  should live inside `clinical_documents` as one more `document_kind` (§3's
  closing paragraph) is flagged, not resolved.**
- **`clinical_document_versions` (§2.4) is sketched as target shape only —
  not part of the recommended first slice (§6.1) and not decided as
  something to build imminently.**
- **Whether/how the Scored Rubric primitive (migration 41) ever gets wired
  into SOP/protocol sign-off is flagged as a designed-for attachment point,
  not a decision to build it.**
- **No decision is made here about retiring or rewiring
  `CasebookWorkspaceView.tsx`, `CasebookBuilderView.tsx`,
  `DissertationAssistantView.tsx`, or any of their backing tables.** All
  stay live and untouched unless and until a separate, explicit decision
  says otherwise.
