# Roster AI V1 — Final Pre-Implementation Review (Answers Only)

Status: **Design-decision review only. No code, no schema, no migration, no
AI call, no live database mutation, and no Harness implementation lifecycle
were performed to produce this document.** Baseline at time of writing: local
HEAD `753d755`, origin/main `5345fa0` (2 local doc/report commits ahead, 0
behind), migrations 58-79 VERIFIED_APPLIED, freeze ACTIVE. This document
resolves the eight open questions posed by prompt1.txt against
`WORKSPC_ROSTER_AI_V1_PROMPT_TO_PATCH_DISCOVER_AND_PLAN_2026-08-30.md`, which
remains the reviewed design and is not re-litigated except where a question
below required reading source not previously quoted verbatim. **No
implementation. STOP for human review before any implementation.**

---

## 1. Resolved provenance approach

**An RPC change is required** — the current code makes it structurally
impossible to preserve provenance any other way. Read in full for this pass,
`supabase/migrations/75_roster_revisions.sql`:

- `chief_start_roster_revision(p_admin_code)` hardcodes `source =
  'chief_manual'` at `INSERT` time (line 245) — this is the **only** place
  any RPC in this migration ever writes to the `source` column.
- `chief_save_roster_revision(p_admin_code, p_revision_id,
  p_expected_updated_at, p_gop_clinic_grid, p_emergency_call_grid,
  p_supervision_grid, p_satellite_grid, p_change_reason DEFAULT NULL)`'s
  `UPDATE` (lines 293-301) touches only the 4 grid columns, `change_reason`,
  and `updated_at` — never `source`/`source_reference`.
- `chief_publish_roster_revision(p_admin_code, p_revision_id,
  p_expected_updated_at)`'s two `UPDATE`s (lines 411-430) touch
  `combined_master_rosters`' content/`current_revision_id`/`published_at` and
  `roster_revisions.status`/`published_at`/`updated_at`/`diff_summary` — also
  never `source`/`source_reference`.

So a revision row is permanently stamped `source='chief_manual'` the moment
it is started, with **no existing code path that ever changes it**, for any
revision, AI-originated or not. Prompt1.txt's own conditional ("do not change
schema or RPC signatures unless the current code makes it impossible to
preserve provenance otherwise") is squarely triggered.

**Smallest exact RPC change**: add two optional, backward-compatible trailing
parameters to `chief_save_roster_revision` only —

```sql
CREATE OR REPLACE FUNCTION public.chief_save_roster_revision(
  p_admin_code text,
  p_revision_id uuid,
  p_expected_updated_at timestamptz,
  p_gop_clinic_grid jsonb,
  p_emergency_call_grid jsonb,
  p_supervision_grid jsonb,
  p_satellite_grid jsonb,
  p_change_reason text DEFAULT NULL,
  p_source text DEFAULT NULL,           -- NEW, optional
  p_source_reference text DEFAULT NULL  -- NEW, optional
)
```

with the `UPDATE` changed from `change_reason = COALESCE(p_change_reason,
change_reason)` to additionally set `source = COALESCE(p_source, source)`,
`source_reference = COALESCE(p_source_reference, source_reference)`. No
`CHECK` constraint change needed — the table's existing `CHECK (source IN
('chief_manual', 'external_import', 'ai_proposal'))` already rejects anything
else at the `UPDATE` itself, so an invalid value the client might pass is
caught by the database, not new application code. Every existing caller
(today's manual save, with no 9th/10th argument) is unaffected — Postgres
resolves the call by the existing 8-argument signature via `DEFAULT NULL`,
and `COALESCE(NULL, source)` is a no-op.

**Why `chief_save_roster_revision`, not `chief_publish_roster_revision`**:
publish only promotes what a revision row already holds — it never resets
`source`/`source_reference` on the `roster_revisions` row itself (only
`combined_master_rosters`, which has no such column at all, per migration
75's own schema). Stamping provenance at save time means it is already
correct by the time publish runs, with zero publish-side change.

**Mixed manual+AI revision labeling** (the one substantive judgment call):
if *any* operation folded into a given save call originated from an accepted
AI proposal, that save call passes `p_source='ai_proposal'` and
`p_source_reference=<the originating instruction text>` for the **whole**
revision row — `source` is revision-row granularity, not per-operation
granularity, and finer-grained "which specific operations were AI-sourced"
is not tracked by this column at all (Section 15's file list below adds no
new column for it either — see "Explicitly deferred" at the end of this
document). A later manual-only save on the same revision does **not**
overwrite `source` back to `chief_manual` (the client only ever passes
`p_source` when the save includes at least one AI-originated operation;
omitting it — passing `NULL` — leaves the column exactly as `COALESCE`
already guarantees).

`source_reference` carries the Chief's original natural-language instruction
text (the same text sent to the model), bounded to a sane length
client-side before sending (matching the 2000-char discipline
`tenant_ai_adaptation_rules.adapted_prompt_overrides` already applies
elsewhere in this codebase) — never a JSON blob, never the model's raw
response.

---

## 2. Final Edge Function request/response schema

**Function name**: `supabase/functions/roster-patch-proposal/`

### Request body

```ts
interface RosterPatchProposalRequest {
  admin_access_code: string;   // NOT tenant_id — see tenant-derivation note below
  instruction: string;         // the Chief's raw natural-language text
  roster_context: {
    section: RosterSection;                // 'gop' | 'emergency' | 'supervision' | 'satellite'
    row_index: number;
    date_or_day: string | null;
    label: string | null;                  // clinic_type / shift / facility — null for supervision
    current: Record<RosterPatchField, string[] | null>; // by DISPLAY NAME, never workforce_id
  }[];
  workforce_context: { display_name: string; category: 'Registrar' | 'Senior Registrar' | 'Medical Officer' }[];
}
```

**Tenant derivation, corrected from `roster-parser`'s own precedent**: every
existing Edge Function that touches tenant data (`roster-parser`,
`dissertation-copilot`, `casebook-copilot`) accepts an optional
**client-supplied** `tenant_id` and only uses it to gate an AI-quota RPC call
— confirmed by fresh re-read of `roster-parser/index.ts` line 236
(`if (body.tenant_id) { ... }`). This is explicitly the "looser" pattern the
reviewed design doc (Section 1.9) already flagged as unsuitable for a new
AI-facing surface. This function does **not** accept `tenant_id` from the
client at all. Instead, mirroring the `settings` lookup every `chief_*` RPC
already does inline (e.g. `SELECT s.tenant_id, s.current_collection_id FROM
settings s WHERE s.admin_access_code = p_admin_code`,
`chief_start_roster_revision`, migration 75), the Edge Function performs the
**exact same lookup via a service-role REST call** to
`${SUPABASE_URL}/rest/v1/settings?admin_access_code=eq.<code>&select=tenant_id,current_collection_id`
— the identical mechanism `_shared/tenantAdaptation.ts`'s
`fetchTenantAdaptationPromptOverride` already uses for its own service-role
table read, so this introduces no new technique, only a new query. An
invalid/unmatched code returns 0 rows, and the function responds `401
invalid_admin_code` before any model call. **No new RPC is needed for this**
— a direct service-role REST read against `settings` (already-readable via
existing RLS-bypassing service role, same posture as every existing
tenant-scoped Edge Function query) is sufficient and smaller than adding one.

**Never in the request body, structurally**: `workforce_id` (or any
UUID), `resident_code`, `tenant_id`, `doctor_profiles` fields, billing/plan
data. `roster_context`/`workforce_context` are constructed **client-side**
by the Chief's already-open `MultiRosterManagerView` session from data it
already holds (the current grids + `databaseService.getWorkforce`), so no new
server-side roster fetch is introduced either.

### Response body

```ts
type RosterPatchProposalResponse =
  | { status: 'ok'; proposal: ProposedRosterPatch; provider: 'openai' | 'gemini' }
  | { status: 'quota_exceeded'; message: string; resets_at: string | null }   // 429
  | { status: 'invalid_admin_code' }                                          // 401
  | { status: 'invalid_request'; message: string }                            // 400
  | { status: 'schema_invalid'; message: string }                             // 502 — model output failed server-side validation (Section 4)
  | { status: 'provider_unavailable' };                                       // 503 — both OpenAI and Gemini failed/unconfigured
```

`ProposedRosterPatch` is defined in full in Section 3. Every non-`ok` variant
is a plain, small, structurally distinct shape (discriminated by `status`) —
no arbitrary error string standing in for a typed outcome, matching this
function's own higher-stakes destination relative to `roster-parser`'s plain
`{ error: string }` shape.

---

## 3. Final symbolic operation schema (`ProposedRosterPatch`)

Locked, unchanged from the reviewed design doc's Section 6 (re-verified this
pass against the real `RosterPatchOperation`/`SwapTarget` shapes in
`rosterPatch.ts`/`rosterSwap.ts` — confirmed still the smallest possible
delta):

```ts
interface ProposedRosterPatch {
  interpreted_instruction: string;
  operations: SymbolicOperation[];
  referenced_names: string[];
  unresolved_ambiguity: string[];   // model's own "this part is unclear" notes
  unsupported_requests: string[];   // parts with no existing patch primitive
  assumptions: string[];
  rationale: string;
  outcome: 'valid' | 'ambiguous_identity' | 'unsupported_instruction' | 'needs_clarification';
}

type SymbolicOperation =
  | { op: 'assign';   section: RosterSection; row_index: number; field: RosterPatchField; subject_name: string; reason?: string }
  | { op: 'unassign'; section: RosterSection; row_index: number; field: RosterPatchField; subject_name: string; reason?: string }
  | { op: 'replace';  section: RosterSection; row_index: number; field: RosterPatchField; from_subject_name: string; to_subject_name: string; reason?: string }
  | { op: 'swap';     target_a: { section: RosterSection; row_index: number; field: RosterPatchField };
                       target_b: { section: RosterSection; row_index: number; field: RosterPatchField };
                       subject_a_name: string; subject_b_name: string; reason?: string };
```

**The four required outcomes, explicit** (prompt1.txt's own instruction —
this is the one addition beyond the prior draft, which only had the
free-text arrays without a top-level discriminant):

| `outcome` | Meaning | `operations` | Typical accompanying field |
|---|---|---|---|
| `'valid'` | At least one concrete operation proposed, nothing blocked the model itself from proposing it | Non-empty | — |
| `'ambiguous_identity'` | The model itself could not tell which of two+ real people a name in the instruction refers to (rare — this is usually caught downstream by `identityResolver.ts` instead, Section 5; this outcome is for when the *instruction text itself* names an ambiguous role, e.g. "the senior registrar" with several candidates, before any name is even emitted) | May be empty or partial | `unresolved_ambiguity` populated |
| `'unsupported_instruction'` | The whole instruction (or its operative part) has no expressible patch primitive (Section 5 of the prior doc — no add/remove-row, no leave-record edit, etc.) | Empty | `unsupported_requests` populated |
| `'needs_clarification'` | The instruction is too underspecified for the model to propose anything responsibly (e.g. "fix the roster" with no target) | Empty | `assumptions` and/or `rationale` explain what's missing |

`outcome` is the model's own self-report, purely advisory for UI framing
(Section 7's "no-op/invalid" UX table branches on it) — it is **never**
trusted as an authorization signal. Every operation, regardless of the
top-level `outcome` value, still goes through full identity resolution
(Section 5) and full deterministic validation (Section 6) unconditionally.
A `'valid'`-labeled proposal with an operation naming a nonexistent person is
rejected exactly like any other — the label never bypasses a check.

**No numeric confidence field** (confirmed, unchanged from the prior
document's own reasoning): no concrete V1 consumer identified.

---

## 4. Server-side validator boundary (inside the Edge Function, before returning)

Reject, before the response ever leaves the function as anything but
`schema_invalid`:

- Any JSON that fails to parse, or does not match the exact
  `ProposedRosterPatch`/`SymbolicOperation` shape above — unknown keys, wrong
  types, missing required fields, extra fields.
- Any `op` outside `assign | unassign | replace | swap`.
- Any `outcome` outside the 4 named values.
- Any `section` outside `gop | emergency | supervision | satellite`.
- Any `field` outside the field set valid for that `section` — the exact
  same table `applyRosterPatch`'s `ARRAY_FIELDS_BY_SECTION` already encodes
  (`gop`: `consultants`/`residents`; `emergency`: `on_call`; `satellite`:
  `assigned`; `supervision`: `first_on_duty`/`second_on_duty`) — duplicated
  as a small constant in the Edge Function (Deno, no shared import across
  the client/function boundary today), not re-derived cleverly.
- `row_index` type-checked as a non-negative integer only — the **range**
  check (row actually exists) is deliberately left to `applyRosterPatch`
  client-side, the only place that holds the live row count.
- **Any field not in the schema at all** — there is no `workforce_id`,
  `tenant_id`, `admin_access_code` echo, or roster-snapshot field defined
  anywhere in `ProposedRosterPatch`/`SymbolicOperation`, so "reject unknown
  authority-bearing fields" is satisfied by construction (an unknown-key
  reject already catches anything foreign, including a hallucinated
  `workforce_id` or `tenant_id` key the model might emit unprompted).

Implementation note (non-binding on this document, informative for the
implementer): a Zod schema (or equivalent hand-rolled shape check, since Zod
is not currently a dependency of any Edge Function in this repo — confirmed,
`grep` of `supabase/functions/**` found no `zod` import) validated
immediately after `JSON.parse`, before the `jsonResponse({ status: 'ok', ... })`
branch is ever reached.

---

## 5. Client compilation sequence — confirmed exact, zero existing-module changes

```
ProposedRosterPatch (schema-validated, from the Edge Function)
  → for each SymbolicOperation:
      resolveParsedNameToWorkforceId(subject_name, tenantScopedWorkforce)   // identityResolver.ts, UNCHANGED
        resolved   → keep, carrying the real workforce_id
        ambiguous  → exclude from acceptable set, keep candidateWorkforceIds for display
        unresolved → exclude from acceptable set
  → for each resolved 'swap' operation (both subject_a_name/subject_b_name resolved):
      compileSwapToOperations(currentGrids, targetA, targetB, workforce, reason)  // rosterSwap.ts, UNCHANGED
        'ok'       → its 2 RosterPatchOperationReplace entries join the resolved set
        'rejected' → excluded, its `reason` string shown next to that proposed swap
  → resolved non-swap operations converted 1:1 to RosterPatchOperationAssign /
    RosterPatchOperationReplace / RosterPatchOperationUnassign (same op/section/
    row_index/field, subject_name(s) replaced by their resolved workforce_id(s))
  → revision-binding check (Section 8 of the prior doc, unchanged reasoning):
      base revision id+updated_at unchanged since proposal generation → proceed
      base changed → classifyOperationsForRebase / buildRebasePreview (rosterRebase.ts, UNCHANGED)
        against the new base FIRST, before anything below
  → Chief reviews the resolved operations (Section 6 below) and clicks Accept (all/subset)
  → applyRosterPatch(currentGridsSnapshot(), acceptedOperations, workforce)   // rosterPatch.ts, UNCHANGED
      → errors[] shown exactly like a failed manual edit; succeeded ones proceed
  → computeReconciliationIssues(...) against the hypothetical post-patch state  // rosterReconciliation.ts, UNCHANGED
  → computeNetRosterDiff(netDiffBaseGrids, patchPreview.grids, workforce)      // rosterNetDiff.ts, UNCHANGED
  → accepted, applyRosterPatch-succeeded operations pushed into the EXISTING
    `pendingOperations` array via MultiRosterManagerView's own existing setter — zero new state model
```

**Confirmed this pass, re-reading each named module's actual exported
signature** (not re-derived from the prior doc's prose alone):
`classifyOperationsForRebase`, `buildRebasePreview`
(`rosterRebase.ts:70`/`:133`), `computeNetRosterDiff`
(`rosterNetDiff.ts:41`), `applyRosterPatch` (`rosterPatch.ts:167`),
`compileSwapToOperations` (`rosterSwap.ts:67`), and
`resolveParsedNameToWorkforceId`/`normalizeForComparison`
(`identityResolver.ts`) all still exist with the exact signatures the prior
document described, and none is modified by this document or slice.

**No existing safety module needs modification** — confirmed by construction:
the sequence above calls each of `rosterPatch.ts`, `rosterReconciliation.ts`,
`rosterNetDiff.ts`, `rosterRebase.ts`, `rosterSwap.ts`,
`identityResolver.ts` exactly as an existing manual edit or swap already
does, with no new parameter, no new branch, and no AI-aware special case
inside any of them. The only genuinely new client-side code is the
conversion step itself (symbolic → real operation) and the Edge Function
call — both net-new files, not edits to existing ones.

---

## 6. Partial acceptance — resolved: per-operation, not all-or-nothing

**V1 allows the Chief to accept individual operations**, not only the entire
proposal — this was already specified in the prior document's Section 9 step
5 ("Only resolved operations are checkbox-selectable... Chief selects a
subset") and is confirmed here as the final decision, not revised, for two
concrete reasons specific to this codebase (not restated generically):

1. **The underlying mechanism already exists and is already exposed to the
   Chief for manual edits**: `MultiRosterManagerView.tsx`'s
   `removePendingOperation(index)` is real, wired to a trash-can button
   (prior doc Section 1.3). An all-or-nothing AI acceptance UI would be
   **more** restrictive than the manual composer sitting right next to it in
   the same view — a regression in capability the Chief would immediately
   notice, not a simplification.
2. **Ambiguous/unresolved operations are automatically excluded regardless**
   (Section 5 above) — so "all or nothing" was never actually all-or-nothing
   in the fully-resolved sense; some exclusion already happens
   unconditionally. Making the *resolved* remainder itself all-or-nothing
   would only add friction (a Chief who agrees with 4 of 5 proposed changes
   would have to discard and manually re-enter the other 4) without removing
   any real risk — deterministic validation (Section 4/5) already gates
   correctness per-operation, not per-batch.

**Smallest safe UI**: one checkbox per resolved operation (default state:
checked), a single "Add Checked to Pending Batch" button. Unresolved/
ambiguous operations render as read-only rows (no checkbox) with their
exclusion reason inline. This is not a new interaction pattern —
`MultiRosterManagerView.tsx`'s existing pending-operations list already
renders one row per operation with a per-row action (remove); the proposal
review list is the same shape with the checkbox added before conversion
rather than a delete after it.

---

## 7. No-op / invalid proposal — exact UX per case

| Case | Exact UI |
|---|---|
| **Proposal resolves to no net diff** (e.g. self-canceling accept subset, or every operation already matches current state) | `computeNetRosterDiff` naturally returns `[]` — the existing net-diff panel already renders "No changes" for an empty array (confirmed: this is not new UI, it is the same empty-state the manual composer's diff panel already shows for a no-op batch). No separate "AI proposal did nothing" message is added. |
| **Identity unresolved** (`unresolved` from `identityResolver.ts`) | That operation's row shows "No matching workforce member found for '<name>'" with no checkbox, and a static hint: "Use the manual form below to add this if you know who it should be." Never silently dropped without a visible row. |
| **Identity ambiguous** | That operation's row shows "Ambiguous: could be <name 1>, <name 2>..." (resolved via `nameById`/`workforceNameMap`, same lookup the diff panel already uses) with no checkbox and the same manual-form hint. |
| **Deterministic validation failure** (an accepted, resolved operation still fails inside `applyRosterPatch` — e.g. occupant mismatch by the time of accept) | Rendered in the exact same `errors[]` list style the manual composer already uses for a failed manual operation — no new error-display component. The operation is not added to `pendingOperations`; the Chief sees why. |
| **Reconciliation warnings** (accepted operations introduce or fail to resolve a reconciliation issue) | Exactly today's non-blocking warning banner from `computeReconciliationIssues`/`computeNetReconciliationIssues` — labeled the same "FM-specific check"/"generic check" style, never a blocking modal, no AI-specific styling. |
| **Stale revision** (base moved between proposal generation and accept-click) | The existing rebase-preview surface (`buildRebasePreview`'s `REPLAYABLE`/`CONFLICT`/`TARGET_NO_LONGER_VALID` per operation) renders in place of the plain diff, identical to today's ordinary post-save conflict flow — Section 5's compilation sequence already routes here before accept in this case. |

No case above introduces a new modal, toast system, or notification
mechanism — every row reuses either the existing pending-operations list
styling, the existing errors[] rendering, or the existing rebase-preview
component.

---

## 8. Provider boundary — reuse confirmed appropriate, re-justified

**Confirmed appropriate to reuse `roster-parser`'s exact provider/fallback
pattern** (OpenAI `gpt-4o-mini` with `response_format: {type:'json_object'}`
first, Gemini `gemini-flash-latest` with `responseMimeType:
'application/json'` as fallback, both at `temperature: 0.1`), re-verified
this pass by re-reading `roster-parser/index.ts` lines 136-209 in full:

- Both provider calls are **stateless, single-turn, JSON-in/JSON-out** —
  exactly this feature's own shape (Section 9 of the prior doc: "not a
  chatbot"). No streaming, no multi-turn context, no tool-calling is used by
  `roster-parser`, so there is nothing about its provider integration that
  is roster-parsing-specific versus proposal-generation-specific; the
  **prompt content** differs, the **call mechanics** do not.
- Confirmed (again) **no shared AI-provider abstraction exists** to *not*
  reuse — `callOpenAI`/`callGemini` are private, unexported functions inside
  `roster-parser/index.ts` itself, not importable from another function
  without duplicating them; `dissertation-copilot` independently defines its
  own equivalents. Building a new function that duplicates this same ~70
  lines a third time is consistent with the existing repo convention, not a
  new inconsistency introduced by this feature.
- **Not building a generic AI orchestration framework**: no queue, no
  retry/backoff policy beyond the existing "try OpenAI, fall back to Gemini,
  else fail" one-shot chain, no multi-step agent loop, no tool use. The one
  genuinely new piece of logic this function adds beyond `roster-parser`'s
  shape is the Section 4 schema validator — data validation, not
  orchestration.

**One deliberate divergence from `roster-parser`'s own precedent**, restated
from the prior document and reaffirmed here as correct, not an inconsistency
to fix: `roster-parser` performs **zero** schema validation of the model's
JSON before returning it (`JSON.parse(content)` forwarded as opaque
`result`). This function must validate (Section 4) because its output feeds
`applyRosterPatch` (a mutation-adjacent path) rather than a "show it to a
human to retype" endpoint. This is a justified, scoped divergence, not
evidence the shared pattern itself is wrong to reuse.

---

## 9. Exact file list for the first implementation slice

**New files only** — nothing existing is edited beyond the one RPC in
Section 1:

1. `supabase/migrations/80_chief_save_roster_revision_provenance.sql` — the
   `chief_save_roster_revision` signature change from Section 1 (additive,
   backward-compatible; written for review, **not applied**, same discipline
   as migrations 66-75).
2. `supabase/functions/roster-patch-proposal/index.ts` — the new Edge
   Function: admin-code verification via service-role `settings` read
   (Section 2), tenant AI quota check (reusing
   `check_and_increment_tenant_ai_quota`, migration 11, the same RPC
   `roster-parser` already calls), tenant prompt override under a new
   `feature_key='roster_patch_proposal'` (reusing
   `_shared/tenantAdaptation.ts` unchanged), OpenAI→Gemini call (Section 8),
   schema validation (Section 4).
3. `src/modules/roster-engine/lib/rosterPatchProposalService.ts` (new file,
   e.g. `generateRosterPatchProposal(adminCode, instruction, rosterContext,
   workforceContext)`) — thin client wrapper calling
   `supabase.functions.invoke('roster-patch-proposal', ...)`, matching the
   existing thin-wrapper convention of `rosterRevisionService.ts`.
4. `src/modules/roster-engine/lib/rosterPatchProposalCompiler.ts` (new file)
   — the Section 5 conversion logic (symbolic → resolved
   `RosterPatchOperation[]`), calling `identityResolver.ts` and
   `rosterSwap.ts` unchanged; kept as its own file rather than inlined into
   the view component so it is independently unit-testable per Section 10's
   verification matrix, without a real model call or a rendered UI.
5. One small addition inside `MultiRosterManagerView.tsx` (or a small
   sibling component it renders, implementer's choice at build time) — the
   Section 6 prompt box / "Generate Proposal" button / per-operation
   checkbox review list / "Add Checked to Pending Batch" button, wired to
   the existing `pendingOperations` setter.

**Explicitly zero changes to**: `rosterPatch.ts`, `rosterReconciliation.ts`,
`rosterNetDiff.ts`, `rosterRebase.ts`, `rosterSwap.ts`, `identityResolver.ts`,
`chief_start_roster_revision`, `chief_discard_roster_revision`,
`chief_publish_roster_revision`, any resident-facing RPC, `roster-parser`,
`dissertation-copilot`, `casebook-copilot`, `research-copilot`,
`_shared/tenantAdaptation.ts`.

## Migration: **YES, one, narrowly scoped**

Confirmed via Section 1's audit: migration 80 (additive
`chief_save_roster_revision` parameters only) is genuinely required to
preserve provenance — it is not avoidable by a client-side-only or
Edge-Function-only design, because `source`/`source_reference` live on a row
only a `SECURITY DEFINER` RPC can write (`roster_revisions` has RLS enabled
with zero policies, migration 75). This is the **only** schema/migration
touch in this slice — no other new table, column, or RPC. Per policy, this
migration is written for review only; it is **not applied** while the
freeze is ACTIVE, and would need its own separately-approved deploy task,
mirroring migrations 66-79's own established discipline.

---

## 10. Verification plan

All deterministic, no real model call required — the model's output is
simulated as a fixture `ProposedRosterPatch` in every case, exactly as the
prior document's Section 14 matrix already specified. Restated here as the
concrete plan for this slice's own `npm run verify:*` addition (new script,
e.g. `verify-roster-patch-proposal.ts`, following this repo's existing
dependency-free verify-script convention — see
`scripts/verify-roster-patch.ts` for the closest sibling — run via `tsx`,
not `node`, matching that script's own convention):

1. Schema validator rejects: unknown `op`, unknown `section`, unknown `field`
   for a given `section`, non-integer/negative `row_index`, an unknown extra
   key (including a hallucinated `workforce_id` or `tenant_id`), an unknown
   `outcome` value, a malformed/non-JSON body.
2. Schema validator accepts a minimal valid `assign`/`replace`/`unassign`/
   `swap` proposal shape for each of the 4 sections' valid fields.
3. Compiler: a uniquely-resolvable `subject_name` → real
   `RosterPatchOperationAssign`/`Replace`/`Unassign`, verified against a
   fixture workforce array.
4. Compiler: an ambiguous or unresolved `subject_name` is excluded from the
   compiled set, with the original symbolic operation retained for display
   (not silently dropped from all output).
5. Compiler: a resolved `swap` operation calls `compileSwapToOperations` and
   both its `'ok'` and `'rejected'` outcomes propagate correctly.
6. End-to-end fixture: a full `ProposedRosterPatch` fixture → compiled
   operations → `applyRosterPatch` → `computeReconciliationIssues` →
   `computeNetRosterDiff`, asserting the final grids/diff match hand-computed
   expected output for at least one case per operation kind.
7. Stale-revision fixture: compiled operations run through
   `classifyOperationsForRebase` against a deliberately-mismatched
   `latestGrids` fixture, asserting `REPLAYABLE`/`CONFLICT`/
   `TARGET_NO_LONGER_VALID` classify as expected.
8. Provenance fixture: a `chief_save_roster_revision` call fixture (against
   the migration 80 signature, exercised as a plain SQL/pg fixture per this
   repo's existing migration-verification convention, e.g.
   `scripts/verify-migration-79.cjs`'s shape) confirming the 8-argument
   legacy call still succeeds unchanged, and the 10-argument call sets
   `source`/`source_reference` as expected.
9. No-live-write assertion: confirm by code inspection (not a runtime test)
   that no code path added in this slice calls `saveRevision`/
   `publishRevision`/any RPC other than the new `roster-patch-proposal`
   Edge Function invocation — the same structural argument the prior
   document's Section 14 already made, re-confirmed against the actual new
   file list in Section 9 above once those files exist.

`npm run verify` (the existing `tsc --noEmit` pass) must also pass against
the new files once written, per this repo's standing `CLAUDE.md` convention.

---

## 11. Final implementation prompt

*For a future, separately-approved implementation task. Not authorized by
this document. Copy verbatim as that task's scope statement if/when a human
approves starting it:*

> Implement Roster AI V1: Prompt-to-Patch Proposal Layer, first slice, per
> `WORKSPC_ROSTER_AI_V1_PROMPT_TO_PATCH_DISCOVER_AND_PLAN_2026-08-30.md` and
> `WORKSPC_ROSTER_AI_V1_FINAL_PREIMPLEMENTATION_REVIEW_2026-08-30.md`
> (Sections 1-10 of the latter are binding: exact provenance approach via a
> new, additive `chief_save_roster_revision` signature; exact Edge Function
> request/response schema with admin-code-derived tenant, never a
> client-supplied `tenant_id`; the exact locked `ProposedRosterPatch`/
> `SymbolicOperation` schema including the 4-value `outcome` field; the exact
> server-side validator boundary; the exact client compilation sequence
> reusing `identityResolver.ts`/`rosterSwap.ts`/`rosterPatch.ts`/
> `rosterReconciliation.ts`/`rosterNetDiff.ts`/`rosterRebase.ts` completely
> unchanged; per-operation partial acceptance; the exact failure-state UX
> table; and the exact file list in Section 9, including migration 80
> written-but-not-applied).
>
> Scope: create exactly the 5 files listed in Section 9 (1 migration file,
> written only — never apply it; 1 Edge Function; 1 client service; 1
> compiler module; 1 UI addition to `MultiRosterManagerView.tsx`), plus one
> new verification script per Section 10. Zero edits to any file in this
> document's "Explicitly zero changes to" list. No AI API call may be made
> during implementation itself — all verification is fixture-based, per
> Section 10. No migration is applied. No push. No deployment. Freeze
> remains ACTIVE throughout. Run the full DOCUMENTATION_GOVERNANCE-adjacent
> (this will be a `PRODUCT_FEATURE`-class, not `DOCUMENTATION_GOVERNANCE`)
> Harness lifecycle: DISCOVER → PLAN → HUMAN REVIEW → IMPLEMENT → VERIFY →
> DIFF REVIEW → commit → report → STOP before requesting migration-apply or
> deploy approval separately.

---

## Explicitly deferred (unchanged from the prior document, restated for completeness)

Per-operation AI-vs-manual provenance tracking finer than revision-row
`source`/`source_reference`; an inline ambiguous-identity disambiguation
picker; wiring `call_duty_rules`/`ai_adaptation_rules` into
`computeReconciliationIssues`; a shared cross-function
`_shared/aiProvider.ts`; `EventType` extension for
`agent.action.proposed`/`agent.action.executed`; any autonomous multi-step
agent behavior or chatbot conversation state. None of these block the first
implementation slice above.

---

*No code, schema/migration application, AI call, live database mutation, or
Harness implementation lifecycle was performed to produce this document.
STOP for human review before any implementation.*
