# Roster AI V1 — Prompt-to-Patch Proposal Layer (DISCOVER + PLAN)

Status: **Design/handoff only. No AI call, no code, no schema/migration, no live
database mutation, and no Harness implementation lifecycle were performed to
produce this document.** Current baseline: local HEAD == origin/main ==
`5345fa0`; migrations 58-79 VERIFIED_APPLIED; revision-safe Chief editing,
structured roster editing, batch patching, semantic net diff, stale-revision
rebase review, swap composition, and authenticated resident roster reads are
all live. STOP for human review before any implementation, per prompt1.txt's
own explicit instruction.

**This document supersedes, for every item it re-examines,
`WORKSPC_ROSTER_ARCHITECTURE_TENANT_CHIEF_EDITING_AI_DISCOVER_AND_PLAN_2026-08-28.md`**
(read in full before this pass, per that prompt's own "do not design from old
docs alone" instruction). That document *sketched* `RosterPatchOperation`,
`roster_revisions`, and Chief editing as **future proposals** on 2026-08-28;
all three have since been **built and are now live**, and real implementation
diverged from the sketch in specific, load-bearing ways (Section 1 lists every
discrepancy found). This document audits the **actual current code**, not the
prior plan.

---

## 1. Current roster-AI readiness audit

Verified this pass by reading actual current source, not the 2026-08-28 doc.

### 1.1 `RosterPatchOperation` — the locked patch vocabulary
`src/modules/roster-engine/lib/rosterPatch.ts`:
```ts
export type RosterSection = 'gop' | 'emergency' | 'supervision' | 'satellite';
export type ArrayAssigneeField = 'consultants' | 'residents' | 'on_call' | 'assigned';
export type SupervisionField = 'first_on_duty' | 'second_on_duty';
export type RosterPatchField = ArrayAssigneeField | SupervisionField;

export interface RosterPatchOperationAssign {
  op: 'assign'; section: RosterSection; row_index: number; field: RosterPatchField;
  workforce_id: string; reason?: string;
}
export interface RosterPatchOperationReplace {
  op: 'replace'; section: RosterSection; row_index: number; field: RosterPatchField;
  from_workforce_id: string; to_workforce_id: string; reason?: string;
}
export interface RosterPatchOperationUnassign {
  op: 'unassign'; section: RosterSection; row_index: number; field: RosterPatchField;
  workforce_id: string; reason?: string;
}
export type RosterPatchOperation =
  RosterPatchOperationAssign | RosterPatchOperationReplace | RosterPatchOperationUnassign;
```

**Discrepancy from the 2026-08-28 doc**: that doc sketched
`assign|unassign|replace|add_slot|remove_slot|set_note`, addressed by a new
`slot_id`. Reality: only **`assign`/`replace`/`unassign`** exist. Addressing
is `(section, row_index, field)` — a plain array index, not a stable id. This
is a **locked invariant, not an oversight**: `applyRosterPatch` asserts
identical array lengths before/after as a hard runtime guard (throws if
violated) precisely *because* no operation ever inserts/deletes/reorders a
row. **This directly answers prompt1.txt's own "constrain output to the
existing patch vocabulary unless compelling evidence proves a missing
primitive" instruction**: the vocabulary genuinely has no structural
add/remove/note-edit primitive today — Section 5's "unsupported instructions"
design is not a hedge, it is the accurate current boundary.

### 1.2 `applyRosterPatch`
`src/modules/roster-engine/lib/rosterPatch.ts:167`:
```ts
export function applyRosterPatch(grids: RosterGrids, operations: RosterPatchOperation[], workforce: WorkforceMember[]): ApplyPatchResult
// ApplyPatchResult = { grids: RosterGrids; diffs: PatchOperationDiff[]; errors: PatchOperationError[] }
```
Pure function (deep-clones input via `JSON.parse(JSON.stringify(grids))`, no
side effects). Per operation, in order: rejects exact-duplicate operations
within the batch; rejects an unknown `field` for the `section`; rejects an
out-of-range/non-integer `row_index`; rejects any `workforce_id` not in the
active-workforce set passed in; for `replace`/`unassign`, rejects if the
current occupant doesn't match what the operation expects (never silently
overwrites/guesses). Rejections populate `errors[]` with a human message —
the operation is **skipped, not thrown**, so the function always returns a
full result even with partial failures. Only the row-count invariant
violation is a real thrown exception — something an `assign`/`replace`/
`unassign`-only operation set can never trigger.

### 1.3 Batch application (the pending-operations queue)
`src/modules/org-admin/components/dashboard/MultiRosterManagerView.tsx`
(**not** under `roster-engine/components/` — worth noting for anyone who goes
looking there first):
- `pendingOperations: RosterPatchOperation[]` (React state) — a real batch
  queue. `addPendingOperation()` (manual form) pushes one; `addSwapToPending()`
  pushes two at once (Section 1.7).
- **Per-operation removal already exists**: `removePendingOperation(index)`
  — wired to a trash-can button in the UI. This is exactly the granularity an
  AI-proposal review needs, already built.
- `patchPreview = applyRosterPatch(currentGridsSnapshot(), pendingOperations, workforce)`
  — recomputed on every render, purely derived, never stale.
- `patchReconciliationIssues` — `computeReconciliationIssues()` re-run against
  the hypothetical post-patch grids, shown as non-blocking warnings labeled
  "FM-specific check" or "generic check" — **this panel has never blocked
  save/publish**, confirmed unchanged.
- `applyPendingOperations()` — commits the batch to local grid state, folds
  succeeded operations into a running ledger `lastAppliedOperations`
  (everything baked in since last server sync), and keeps only **failed**
  operations (with their error) in `pendingOperations` for the Chief to
  fix/remove.
- Net diff shown to the Chief is `computeNetRosterDiff(netDiffBaseGrids,
  patchPreview.grids, workforce)` where `netDiffBaseGrids` is the **last-synced
  revision** — i.e. before/after across both already-applied and still-pending
  operations in one hypothetical snapshot, never the raw operation list.

### 1.4 `computeNetRosterDiff`
`src/modules/roster-engine/lib/rosterNetDiff.ts:41`:
```ts
export function computeNetRosterDiff(base: RosterGrids, final: RosterGrids, workforce: WorkforceMember[]): NetDiffEntry[]
```
Pure structural before/after comparison with **zero awareness of which
operations produced `final`** — deliberate, since this is exactly what makes
cancel-out sequences (assign-then-unassign) collapse to "no change"
automatically, with no special-casing needed anywhere (including for AI
proposals). Emits one `NetDiffEntry` per differing `(section, row_index,
field)`, names always resolved via the workforce list, never raw IDs. The
same file also exports `computeNetReconciliationIssues(baseIssues,
finalIssues)`, classifying two already-computed `ReconciliationIssue[]` lists
into `unaffected` / `introducedByBatch` / `resolvedByBatch`.

### 1.5 Reconciliation — confirmed NOT a universal rules engine
`src/modules/roster-engine/lib/rosterReconciliation.ts:342`:
```ts
export function computeReconciliationIssues(submissions: SubmissionWithWorkforce[], workforce: WorkforceMember[], rotations: Rotation[], masterRoster: CombinedMasterRoster | null): ReconciliationIssue[]
```
Pure, read-only. Two clearly separated layers, exactly matching prompt1.txt's
own warning:
- **Generic/structural**: unrecognized rotation, rotation-vs-on-floor-status
  conflict, invalid leave range, leave period overlapping a grid appearance.
- **UCH Family Medicine-specific**, explicitly labeled as such in the file's
  own comments: `UCH_FAMILY_MEDICINE_ON_FLOOR_ADAPTER`, `checkIkolabaCoverage`
  (hardcoded facility name), `checkFloorServicePointSeniorCoverage`,
  `checkSpecialCoverageEligibility` — all hardcoded TS logic, not data-driven.

**Load-bearing discrepancy from the 2026-08-28 doc**: that doc claimed
tenant-specific rules "already live" in `call_duty_rules`/`ai_adaptation_rules`
tables, consulted by reconciliation. **Confirmed false by reading the whole
file**: neither table is referenced anywhere in
`rosterReconciliation.ts`. Whether those tables exist in some migration or
not, they are **not wired into reconciliation today**. Any AI design must
treat `computeReconciliationIssues()` exactly as it exists — a fixed,
UCH-FM-flavored deterministic function, not a generic per-tenant rules
engine — and must not invent a `call_duty_rules` integration that doesn't
exist. This directly satisfies prompt1.txt's own instruction: *"`call_duty_rules`
should not suddenly become a generic engine just because AI exists."*

### 1.6 Stale/rebase classifier
`src/modules/roster-engine/lib/rosterRebase.ts`:
```ts
export type RebaseClassification = 'REPLAYABLE' | 'CONFLICT' | 'TARGET_NO_LONGER_VALID';
export function classifyOperationsForRebase(baseGrids, latestGrids, operations: RosterPatchOperation[], workforce): RebaseOperationResult[]
export function buildRebasePreview(baseGrids, latestGrids, operations, workforce): RebasePreview
```
Triggered when `chief_save_roster_revision`/`chief_publish_roster_revision`'s
own `p_expected_updated_at` optimistic-concurrency check rejects a save
(SQLSTATE `40001`). Classifies **each operation independently** against its
own exact `(section, row_index, field)` target between `baseGrids` (what the
Chief was editing against) and freshly-fetched `latestGrids` — never
whole-roster inequality, so an unrelated edit elsewhere never blocks a
Chief's own patch. Workforce-identity invalidity (deactivated member) always
wins as `TARGET_NO_LONGER_VALID`. `buildRebasePreview` actually re-runs
`applyRosterPatch` against `latestGrids` for a real preview and computes a
real `computeNetRosterDiff` for it — nothing is auto-applied; the Chief must
explicitly `confirmRebase()`. This is a **real, already-built Chief decision
point**, not a raw error message — exactly the mechanism an AI-proposal
"revision moved before I could apply" case needs (Section 8).

### 1.7 Swap composition
`src/modules/roster-engine/lib/rosterSwap.ts:67`:
```ts
export function compileSwapToOperations(grids, targetA: SwapTarget, targetB: SwapTarget, workforce, reason?): CompileSwapResult
// CompileSwapResult = {status:'ok'; operations:[ReplaceOp, ReplaceOp]} | {status:'rejected'; reason}
```
**No new patch primitive** — a swap always compiles to exactly two
`replace` operations. Pre-validates before generating anything (identical
targets, self-swap, missing occupant at either target, checked against
**current** grid state) — a friendlier rejection than letting
`applyRosterPatch`'s own generic validation catch it later, though that
still runs as the authoritative second check. The two generated ops are
pushed into the **same** `pendingOperations` queue as any manual edit — no
separate persistence/schema concept of "swap" exists anywhere.

### 1.8 Revision save/publish services
`src/modules/roster-engine/lib/rosterRevisionService.ts` — 4 functions, each
a thin wrapper over one Chief-admin-code-verified RPC:
```ts
startRevision(adminCode): Promise<RosterRevision>                                          // chief_start_roster_revision
saveRevision(adminCode, revisionId, expectedUpdatedAt, grids, changeReason?): Promise<RosterRevision>  // chief_save_roster_revision
discardRevision(adminCode, revisionId): Promise<RosterRevision>                             // chief_discard_roster_revision
publishRevision(adminCode, revisionId, expectedUpdatedAt): Promise<RosterRevision>          // chief_publish_roster_revision
```
`combined_master_rosters` remains a single untouched published row —
`chief_publish_roster_revision` is, per migration 75's own comment, "the ONLY
function that ever writes to `combined_master_rosters` as part of the
revision lifecycle," one atomic UPDATE; resident-facing RPCs stay completely
unaware revisions exist.

**`roster_revisions` confirmed live, migration 75**, exact columns:
```sql
CREATE TABLE IF NOT EXISTS roster_revisions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  collection_id uuid NOT NULL REFERENCES collections(id),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  revision_number integer NOT NULL,
  status text NOT NULL CHECK (status IN ('editing', 'published', 'superseded', 'discarded')),
  gop_clinic_grid jsonb NOT NULL DEFAULT '{}'::jsonb,
  emergency_call_grid jsonb NOT NULL DEFAULT '{}'::jsonb,
  supervision_grid jsonb NOT NULL DEFAULT '{}'::jsonb,
  satellite_grid jsonb NOT NULL DEFAULT '{}'::jsonb,
  based_on_revision_id uuid REFERENCES roster_revisions(id),
  source text NOT NULL DEFAULT 'chief_manual' CHECK (source IN ('chief_manual', 'external_import', 'ai_proposal')),
  source_reference text,
  changed_by text NOT NULL DEFAULT 'chief',
  change_reason text,
  diff_summary jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  published_at timestamptz,
  CONSTRAINT unique_roster_revision_number_per_collection UNIQUE (collection_id, revision_number)
);
```
**`source = 'ai_proposal'` and `source_reference` already exist** in the
schema — confirming prompt1.txt's own claim that provenance headroom is
already there. **No RPC currently sets `source` to anything but the default
`'chief_manual'`** — this is real, currently-unused headroom, not a built
feature (Section 9 addresses exactly how V1 should use it).

**Discrepancy from the 2026-08-28 doc**: it sketched 3 revision statuses
(`editing`/`published`/`superseded`); reality has **4** — `'discarded'` was
added.

**The disclosed `saveDraft()`-silent-overwrite defect is confirmed FIXED**:
`saveDraft()`/`publish()` in `MultiRosterManagerView.tsx` now route through
`rosterRevisionService` whenever `masterRoster.status === 'published'` —
`combined_master_rosters` is never touched mid-edit; only a fresh/never-yet-
published collection still uses the old direct-UPDATE path (correctly, since
nothing exists yet to protect).

### 1.9 Workforce identity/name sources
`src/modules/roster-engine/lib/identityResolver.ts`:
```ts
export type IdentityResolution =
  | { status: 'resolved'; workforceId: string }
  | { status: 'unresolved' }
  | { status: 'ambiguous'; candidateWorkforceIds: string[] };

export function normalizeForComparison(name: string): string
export function resolveParsedNameToWorkforceId(parsedName: string, workforce: WorkforceMember[]): IdentityResolution
export function resolveParsedNamesToWorkforceIds(parsedNames: string[], workforce: WorkforceMember[]): BatchIdentityResolution
```
Normalization: trim/collapse whitespace, strip a leading `"FM –"`-style
specialty prefix, strip a leading `"Dr"/"Dr."`, lowercase — nothing more.
**Matching is exact string equality after normalization only — zero fuzzy
matching**, a deliberate, documented design choice. 0 matches → `unresolved`;
1 → `resolved`; 2+ → `ambiguous` with every candidate ID returned, **never
auto-picked**. The function itself is **not tenant-aware** — it does not
filter by `tenant_id`/`active`; the caller must pass an already-scoped
`workforce` array. This is **exactly** the mechanism prompt1.txt's own
"Identity resolution" section describes needing — already built, already
correctly three-way (resolved/unresolved/ambiguous), reusable unchanged.

Chief UI workforce fetch: `MultiRosterManagerView.tsx` calls
`databaseService.getWorkforce(tenantId)` — a plain client-side Supabase read
using the Chief's session-cached `tenantId` (set once at login, **not
re-verified per read call**), relying on `workforce`'s permissive
`USING(true)` RLS. This is looser than the `chief_*` RPC pattern (re-derive
tenant fresh from `admin_access_code` every call). **Any new AI-facing RPC
must follow the stricter `chief_*` pattern**, not copy this read's looser
one — flagged explicitly in Section 8's security section.

### 1.10 Roster section configuration/presentation
No change since migration 74/79 (already live-verified this session). Stable
`section` key vocabulary is exactly 4 values: `gop`, `emergency`,
`supervision`, `satellite`. Chief-configurable labels/colors live in
`roster_section_config`, read/written via `chief_get_roster_section_config`/
`chief_upsert_roster_section_config` (admin-code-gated), resolved client-side
via `resolveRosterSectionPresentation`. **The AI design must address content
exclusively by these 4 stable keys, never a display label** (labels are
tenant-configurable and cosmetic) — satisfied by construction, since
`RosterPatchOperation.section` already is this exact union.

### 1.11 Existing AI/LLM infrastructure — the load-bearing finding
**No AI SDK dependency in `package.json`.** All AI calls are raw `fetch()` to
REST endpoints from **Deno Edge Functions** (`supabase/functions/`), never
from client code. Functions found: `dissertation-copilot`, `casebook-copilot`,
`research-copilot`, `roster-parser` (+ non-AI payment functions), plus
`_shared/` (`casebookRubric.ts`, `researchRubric.ts`, `tenantAdaptation.ts`).

**No shared AI-provider abstraction exists** — `roster-parser/index.ts` and
`dissertation-copilot/index.ts` each independently define their **own**
`callOpenAI`/`callGemini` functions, same shape, literally duplicated per
function. This is a real, disclosed gap (addressed in Section 10).

**`roster-parser` is the closest existing precedent** — it already parses
free text into structured roster JSON:
- Client invokes via `supabase.functions.invoke('roster-parser', { body: {
  roster_type, text, tenant_id } })`.
- Edge Function checks tenant AI quota first
  (`check_and_increment_tenant_ai_quota` RPC, migration 11) — 429
  `quota_exceeded` if over limit.
- Applies a tenant-specific prompt override via the **one genuinely shared
  piece of AI infra that exists**, `_shared/tenantAdaptation.ts`:
  `fetchTenantAdaptationPromptOverride(url, serviceKey, tenantId, featureKey)`
  + `appendTenantAdaptationOverride(basePrompt, extra)` — reads
  `tenant_ai_adaptation_rules.adapted_prompt_overrides.extra_instructions`
  (max 2000 chars, framed explicitly as *"additional guidance... never
  overrides the safety/honesty/human-review framing above"*).
  `feature_key='roster_parser'` is already registered — directly reusable
  under a new `feature_key` for this new feature.
- Calls OpenAI (`gpt-4o-mini`, `response_format: {type:'json_object'}`, temp
  0.1) first, falls back to Gemini (`gemini-flash-latest`,
  `responseMimeType: 'application/json'`, temp 0.1) if OpenAI fails/unconfigured.
- **No schema validation of the model's JSON output on the server today** —
  just `JSON.parse(content)`, forwarded to the client as opaque `result`. All
  structural validation happens client-side after receipt. **This is a real
  gap this new feature must not repeat** — a prompt-to-patch proposal feeds a
  much higher-stakes destination (`applyRosterPatch`) than roster-parser's
  "show it to a human" endpoint, so server-side schema validation before
  ever returning to the client is new, necessary work (Section 6).
- System prompt already establishes the exact HITL framing this feature
  needs: *"Extract ONLY what the source text actually states — never
  invent... put anything ambiguous in `unparsed_notes` instead of guessing."*
- **Critically: the model call receives NO workforce/tenant IDs at all** —
  pure text-in/JSON-out; identity resolution happens **entirely client-side
  afterward** via `identityResolver.ts`. This is the strongest possible
  precedent for prompt1.txt's own "should the model emit workforce IDs
  directly, or symbolic references resolved deterministically after
  generation — prefer the safer option" question: **the answer is already
  established practice in this codebase** (Section 4/5).

**Agent files** (`rubricComplianceAgent.ts`, `submissionChaserAgent.ts`,
`meetingActionAgent.ts`) are **not LLM-calling** — deterministic rung-1
"Reasoning" agents (per `docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md`'s
intelligence ladder) that read precomputed state and write one `insights`
row. No prompt, no model call. Architecturally unrelated to this feature's
shape, which is closer to the synchronous, human-triggered, human-reviewed
Edge-Function precedent (`roster-parser`).

---

## 2. Exact prompt-to-patch architecture

```
Chief NL instruction (in an open 'editing' revision)
  → roster-patch-proposal Edge Function call
      (tenant AI quota check; tenant prompt-override; model call; SERVER-SIDE schema validation)
  → ProposedRosterPatch  (symbolic — subject_name, never workforce_id; Section 3/4)
  → client-side identity resolution (identityResolver.ts, UNCHANGED)
      resolved  → converted to real RosterPatchOperation (now carrying a real workforce_id)
      ambiguous/unresolved → excluded from the acceptable set, shown with explanation
  → binding check: does the base revision (id + updated_at) still match what the
      proposal was generated against? (Section 8)
      unchanged → proceed directly
      changed   → run buildRebasePreview (rosterRebase.ts, UNCHANGED) against the new base first
  → Chief reviews: interpreted instruction, resolved operations + live net diff/reconciliation
      preview (applyRosterPatch + computeReconciliationIssues + computeNetRosterDiff, ALL UNCHANGED),
      unresolved/unsupported items shown separately
  → Chief accepts all / accepts a subset / discards
  → accepted operations pushed into the EXISTING pendingOperations queue — zero new state model
  → existing Save Draft / Publish / stale-rebase-review flow, COMPLETELY UNCHANGED
```

**AI never directly writes the live/published roster, by construction**: its
only output ever touches client-side `pendingOperations` state — the exact
same state a manual edit populates — which itself never persists anywhere
until the existing, unmodified save/publish code path runs. There is no code
path from the new Edge Function to any database write.

---

## 3. Model input context (privacy/data-minimization)

Sent to the model, tenant-scoped, per proposal request:
- The Chief's raw instruction text.
- **Roster context**: for each of the 4 sections, every row's `row_index`,
  `date_or_day`, its type-specific label (`clinic_type`/`shift`/`facility` —
  none for supervision), and its current assignees **by display name**
  (never workforce_id) per field.
- **Workforce context**: `{ display_name, category }` for the tenant's
  active workforce (server-derived tenant, matching the `chief_*` RPC
  pattern — never the client's own cached `tenantId`, per Section 1.9's
  flagged gap). `category`/cadre is included specifically because
  prompt1.txt's own example ("put a senior resident in A&E Friday")
  requires the model to know who is senior — this is the one piece of
  context beyond current-occupant names that the examples genuinely require.

**Never sent**: `workforce_id` (UUIDs), `resident_code`, `admin_access_code`,
doctor emails, `doctor_profiles` rows, tenant billing/plan data, any
account/session identifier, any other tenant's data. The workforce array
used for identity resolution **after** the model responds is the same
already-tenant-scoped array the Chief UI already holds — never sent to or
trusted from the model itself.

---

## 4. Identity resolution design

- **Exact/unique matches resolve automatically** — reusing
  `identityResolver.ts` unchanged: normalize the model's `subject_name` text
  the same way ingested roster names are normalized today, match against the
  tenant-scoped workforce array already in the Chief's session.
- **Ambiguous names remain unresolved** — `identityResolver.ts` already
  returns `ambiguous` with every candidate ID, never auto-picks. V1 does
  **not** build a disambiguation-picker UI (deferred, Section 15) — an
  ambiguous/unresolved operation is simply excluded from the acceptable set,
  with a message directing the Chief to the **existing manual composer
  form** if they want to add it themselves.
- **AI never guesses between two people** — enforced structurally: the
  conversion step from symbolic operation to real `RosterPatchOperation`
  only proceeds on a `resolved` outcome; there is no code path that takes an
  `ambiguous`/`unresolved` result and picks one anyway.
- **Tenant scope is server/application-derived** — the new Edge Function
  must derive tenant from the Chief's verified admin code every call
  (mirroring every `chief_*` RPC's own pattern), never accept a
  client-supplied `tenant_id`, and never accept one from the model's own
  output (the schema has no tenant field at all, Section 6).
- **Workforce identity resolution is distinct from role/category
  interpretation**: `identityResolver.ts` only ever answers "which
  `workforce_id` does this name refer to." A request like "put a senior
  resident in A&E Friday" additionally requires the model to select *which*
  senior resident from the `category`-annotated context (Section 3) — this
  selection is the model's own proposal (a `subject_name` in its output,
  same as any other), still subject to the identical resolved/ambiguous/
  unresolved check afterward. The model never has authority to decide
  role/category eligibility beyond proposing a name; nothing in
  `computeReconciliationIssues()` is bypassed for AI-sourced operations.

---

## 5. Unsupported instructions

The existing patch vocabulary (Section 1.1) has no primitive for: adding or
removing a structural roster row, changing a date, inventing a new section,
modifying leave records, changing workforce records, changing tenant rules,
or vague non-operational requests ("make the roster fairer"). **V1's own
structured-output schema (Section 6) has no slot for any of these** — the
model is asked to place anything it cannot express in the real vocabulary
into an explicit `unsupported_requests: string[]` field, never to invent a
patch operation that doesn't exist. This is enforced twice: by the schema
itself (no field exists to smuggle a structural change through) and by
server-side validation (Section 6) rejecting any operation whose `op`/
`section`/`field` falls outside the closed, known sets.

---

## 6. Structured output schema (AI's raw contract, pre-identity-resolution)

```ts
interface ProposedRosterPatch {
  interpreted_instruction: string;
  operations: SymbolicOperation[];
  referenced_names: string[];      // every person-name string extracted, regardless of resolution outcome — for audit/display
  unresolved_ambiguity: string[];  // free-text notes on anything the MODEL itself flagged as unclear (distinct from identity ambiguity, resolved deterministically afterward)
  unsupported_requests: string[];  // parts of the instruction with no existing patch primitive
  assumptions: string[];           // assumptions requiring explicit Chief confirmation
  rationale: string;               // short human-readable explanation of the overall proposal
}

type SymbolicOperation =
  | { op: 'assign';   section: RosterSection; row_index: number; field: RosterPatchField; subject_name: string; reason?: string }
  | { op: 'unassign'; section: RosterSection; row_index: number; field: RosterPatchField; subject_name: string; reason?: string }
  | { op: 'replace';  section: RosterSection; row_index: number; field: RosterPatchField; from_subject_name: string; to_subject_name: string; reason?: string }
  | { op: 'swap';     target_a: { section: RosterSection; row_index: number; field: RosterPatchField };
                       target_b: { section: RosterSection; row_index: number; field: RosterPatchField };
                       subject_a_name: string; subject_b_name: string; reason?: string };
```

This is the **smallest possible delta** from the real `RosterPatchOperation`
(Section 1.1): identical `op`/`section`/`row_index`/`field` shape, with only
`workforce_id`/`from_workforce_id`/`to_workforce_id` replaced by raw
`*_name` text fields, plus one additional `swap` kind that maps directly to
calling the **existing** `compileSwapToOperations()` (Section 1.7,
unchanged) after its two subject names resolve — reusing that function's own
occupancy pre-validation rather than asking the model to emit two raw
`replace` operations itself.

**Deliberately omitted**: a numeric "confidence" field. Prompt1.txt names
this "only if useful" — judged not useful for V1: the resolved/unresolved/
ambiguous three-way split from `identityResolver.ts` already carries the
load-bearing signal, and an uncalibrated LLM-reported confidence number has
no concrete consumer in the V1 review UI. Reconsider only if a specific
future need for it is identified.

### Server-side (Edge Function) validation, before returning to the client
Reject, before ever returning success:
- Any JSON that fails to parse or match the exact schema shape above
  (unknown keys, wrong types, extra fields) — Zod or equivalent.
- Any `op` outside `assign|unassign|replace|swap`.
- Any `section` outside the 4 known keys (`gop`/`emergency`/`supervision`/
  `satellite`).
- Any `field` outside the valid set for that `section` (mirrors the same
  field-validity table `applyRosterPatch` already encodes).
- Any extra/authority-bearing field the schema doesn't define (there is no
  `workforce_id`, `tenant_id`, or roster-snapshot field in the schema at
  all, so none can appear without already failing "unknown key").
- `row_index` type-checked as a non-negative integer here; the **range**
  check (does this row actually exist) is left to `applyRosterPatch`, which
  is the only place that actually knows the current row count — this schema
  layer only guards shape, never re-derives roster truth.

**Never accepted from the model or the client at this boundary**: a
caller-supplied tenant id (no such field exists in the schema or the Edge
Function's own request contract beyond the admin-code-derived tenant), a
direct roster snapshot/JSON blob standing in for the roster (the model
never returns grid content, only symbolic operations), or any raw
`workforce_id` (Section 4 — identity resolution happens after, client-side,
never trusted from the model).

---

## 7. Deterministic validation boundary

| Layer | Owns | Can AI override it? |
|---|---|---|
| Model | NL → symbolic proposal + rationale/ambiguity flags. Nothing else. | N/A — this is its only job |
| Edge Function (new, server-side) | Schema/shape validation of the symbolic proposal (Section 6) | No — a schema-invalid response never reaches the client as a proposal |
| Client, after receipt (new, deterministic) | Identity resolution (`identityResolver.ts`, unchanged) | No — ambiguous/unresolved is never auto-picked |
| Client, existing (unchanged) | `applyRosterPatch` — row-range, field-validity, workforce-existence, occupant-match | No — a rejected operation is simply not proposable, exactly like a failed manual edit today |
| Client, existing (unchanged) | `computeReconciliationIssues` / `computeNetRosterDiff` | No — issues surface as the same non-blocking warnings manual edits already get; AI-sourced operations receive no special treatment |
| Client, existing (unchanged) | `classifyOperationsForRebase` / `buildRebasePreview` | No — reused verbatim if the base moved (Section 8) |

`call_duty_rules`/`ai_adaptation_rules` are **not** wired into reconciliation
today (Section 1.5) and this document does not wire them in — the AI gets no
special access to tenant numeric rules beyond what `computeReconciliationIssues()`
already checks for a manual edit. Tenant-specific business logic remains
exactly as adapter/domain-specific as it already is.

---

## 8. Stale/rebase interaction

An AI proposal must bind to the exact revision it was generated against —
its `id` and `updated_at` (the same optimistic-concurrency token
`saveRevision`/`publishRevision` already use). The binding is checked once,
at the moment the Chief clicks to accept operations into the queue (not
continuously):
- **Base unchanged** since generation → proceed directly to conversion +
  preview, as in Section 2.
- **Base changed** (the Chief or someone else saved a new revision state in
  the interim) → **do not silently regenerate or apply**. Instead, feed the
  proposal's resolved operations into the **existing**
  `classifyOperationsForRebase`/`buildRebasePreview` (Section 1.6, unchanged)
  against the new base, exactly as an ordinary post-save conflict already
  does. The Chief sees the same `REPLAYABLE`/`CONFLICT`/
  `TARGET_NO_LONGER_VALID` classification and decides — no new conflict UI,
  no new classifier.

This satisfies prompt1.txt's own instruction using **zero new machinery** —
the existing rebase pipeline already operates per-operation against a
specific `(section, row_index, field)` target, which is exactly the shape
an AI proposal's resolved operations already have.

---

## 9. Proposed UI (smallest Chief-facing experience)

1. Chief opens the same `MultiRosterManagerView` editing surface (an
   `editing` revision), alongside the existing manual patch-composer form —
   not replacing it.
2. One prompt box + "Generate Proposal" button.
3. On submit: loading state, call to the new Edge Function (with the same
   tenant-quota gate `roster-parser` already uses).
4. On success: renders the interpreted instruction, then each proposed
   operation with its resolved display name(s) if resolution succeeded, or
   an inline "ambiguous between X/Y" or "no match found" badge if not.
   `unsupported_requests`/`assumptions` shown as their own short lists.
5. Only **resolved** operations are checkbox-selectable (default: all
   checked); unresolved/ambiguous ones are read-only with a note to use the
   manual form instead.
6. Chief selects a subset (or all, or none) and clicks "Add to Pending
   Batch." If the base has moved (Section 8), the rebase-preview surface is
   shown here instead of a plain diff.
7. Accepted operations convert to real `RosterPatchOperation[]` and push
   into the **existing** `pendingOperations` array via the exact setter the
   manual form already uses.
8. From this point, the existing patch-preview / net-diff / reconciliation-
   warnings / per-operation removal / Save Draft / Publish flow is
   **completely unchanged** — this is the same review surface a manual edit
   or a swap already goes through.

**Not a chatbot** (one-shot prompt → proposal → review, no multi-turn
conversation state). **Not autonomous** (nothing is applied without the
Chief's explicit per-batch accept step, identical in kind to the existing
manual/swap/rebase review gates). If the AI panel fails entirely, the manual
composer form is a separate, always-present, never-disabled control — human
structured editing keeps working regardless of AI availability.

---

## 10. AI-provider boundary

No shared seam exists today (Section 1.11) — each Edge Function duplicates
its own `callOpenAI`/`callGemini`. Per prompt1.txt's own conditional ("do not
tightly couple to one vendor if a seam already exists, but do not build an
elaborate framework the repo doesn't justify"): since no reusable seam
exists yet, and this one feature alone doesn't justify extracting one, the
recommended approach is a **new Edge Function, `roster-patch-proposal`**,
that follows `roster-parser`'s exact existing shape (tenant quota check,
`tenantAdaptation` prompt override under a new `feature_key =
'roster_patch_proposal'`, OpenAI→Gemini fallback, JSON structured output) —
duplicating the same small amount of provider-call code `roster-parser`
already has, not inventing a shared module.

Cleanly separated steps (already separable by the existing precedent's own
shape):
1. **Prompt construction** — new: a tenant-scoped roster-context +
   instruction template (Section 3).
2. **Model call** — reused: `roster-parser`'s exact two-tier fallback shape.
3. **Structured-output parsing** — new: unlike `roster-parser`, this
   function must schema-validate before returning (Section 6) — a
   deliberate, disclosed departure from the existing precedent, justified by
   this feature's much higher-stakes destination (`applyRosterPatch`).
4. **Identity resolution** — reused, unchanged, client-side only
   (`identityResolver.ts`) — never done in the Edge Function, mirroring
   `roster-parser`'s own established practice of keeping the model blind to
   real IDs.
5. **Deterministic roster validation** — entirely existing, unchanged,
   client-side (`applyRosterPatch`/`computeReconciliationIssues`/
   `computeNetRosterDiff`).

**Deferred, not V1**: extracting a genuine `_shared/aiProvider.ts` used by
`roster-parser` and this new function together — a reasonable later
refactor once 3+ functions share the identical duplicated pattern, not
blocking here.

---

## 11. Privacy / data-minimization rules

Restated precisely from Section 3: send tenant-scoped roster row context
(row_index/date/label/current occupant display names) and workforce
`{display_name, category}` for the active tenant only. Never send
`workforce_id`, `resident_code`, `admin_access_code`, doctor emails,
`doctor_profiles` content, billing/plan data, or any other tenant's data.
The instruction text itself is the only truly free-text content sent — no
mechanism should append unrelated Chief profile data to the prompt. The
tenant prompt-override text (`tenant_ai_adaptation_rules`) is bounded to
2000 chars and explicitly framed as non-authoritative guidance, per the
existing `_shared/tenantAdaptation.ts` contract — reused, not re-designed.

---

## 12. Audit/provenance approach

Reuses the **already-existing, currently-unused** `roster_revisions` columns
— no new table, no giant AI audit subsystem:
- `source = 'ai_proposal'` — set on save/publish if the resulting revision's
  accepted-and-applied operations included at least one AI-originated
  operation (client tracks per-accepted-operation origin locally; a mixed
  manual+AI revision is still most informatively labeled `'ai_proposal'`,
  with the finer-grained detail living in `change_reason`/`diff_summary`).
- `source_reference` — the original Chief NL instruction text (bounded
  length), giving a direct link from the revision row back to the literal
  prompt that produced it.
- `change_reason` — unchanged mechanism, already accepted by
  `saveRevision`/`publishRevision`.
- `diff_summary` — already computed via `computeNetRosterDiff` at publish
  time by the existing flow; unchanged.

**Open implementation question, flagged rather than assumed**: whether
`chief_save_roster_revision`/`chief_publish_roster_revision` currently
*accept* a `source`/`source_reference` override parameter, or always
persist the column default (`'chief_manual'`), was not confirmed by this
pass's audit (which focused on the concurrency parameter, `p_expected_updated_at`).
If they don't accept an override today, adding two optional,
backward-compatible parameters is the smallest schema-adjacent RPC change
this slice might need — to be confirmed precisely at implementation time,
not assumed either way here.

**Deferred, not V1**: emitting `agent.action.proposed`/`agent.action.executed`
events (the intelligence ladder's own named event vocabulary,
`docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md` §6) once `EventType` is
extended to include them — the revision row itself is sufficient minimal
provenance for V1's own correctness, mirroring the same reasoning already
applied to `organisation_memberships`' own claim provenance earlier this
project.

---

## 13. Failure modes

| Failure | Behavior |
|---|---|
| Model unavailable / timeout | Edge Function returns an error; UI shows "Could not generate a proposal right now — try again, or continue editing manually." Manual composer unaffected. |
| Malformed structured output | Caught by the Edge Function's own schema validation (Section 6) *before* returning success — never surfaces a garbled proposal to the client. |
| Ambiguous workforce identity | Excluded from the acceptable/queueable set, shown with its candidates; Chief adds manually if intended. |
| Unknown/unresolved person | Same treatment. |
| Unsupported request | Listed in the model's own `unsupported_requests`; never becomes an operation. |
| Proposal fails deterministic validation | Shown exactly like a failed manual operation today — reuses `applyRosterPatch`'s existing `errors[]` display, no new UI. |
| Proposal introduces reconciliation warnings | Shown exactly as today's non-blocking banner; AI-sourced operations get no special treatment. |
| Stale revision after proposal | Section 8 — routed through the existing rebase machinery before accept. |
| Partially acceptable batch | Chief's per-operation checkbox selection before queueing — no special-case code, only selected+resolved operations are ever converted. |
| No-op/cancelled net diff | `computeNetRosterDiff` naturally reports empty for a self-canceling accepted subset — identical to today's manual-edit behavior, no new handling. |
| Chief rejects the whole proposal | Discarded; zero operations ever reach `pendingOperations`; zero side effects. |
| Human/manual editing during AI failure | Guaranteed by construction — the AI panel is additive UI; no shared mutable state is locked by its failure. |

---

## 14. Verification matrix

All of the following are deterministic, unit-testable **without any real
model call** — the model's output is simulated as a fixture `ProposedRosterPatch`
object in every case below:

| Case | Mechanism proven |
|---|---|
| Valid single assign | Symbolic `assign` with a uniquely-resolvable `subject_name` → resolves → converts to real `RosterPatchOperationAssign` → `applyRosterPatch` succeeds. |
| Valid replace | Same, both `from_subject_name`/`to_subject_name` resolvable. |
| Valid unassign | Same. |
| Swap request compiled safely | Symbolic `swap` → both subject names resolve → `compileSwapToOperations` (unchanged) called with real IDs → its own occupancy pre-check + `applyRosterPatch`'s generic check both still run. |
| Ambiguous person | `identityResolver.ts` returns `ambiguous` → operation excluded from the acceptable set, candidates shown. |
| Unknown person | Returns `unresolved` → same exclusion. |
| Unsupported structural change | Appears only in `unsupported_requests`, never as an operation — proven by the schema itself having no field to express it. |
| Malformed AI output | Edge Function schema validation rejects before returning; no proposal reaches the client. |
| Invented section | Schema validation rejects any `section` outside the 4 known keys. |
| Invented field | Schema validation rejects any `field` outside the valid set for that `section`. |
| Invalid row | Schema validation checks type only; `applyRosterPatch`'s existing range check is the authoritative rejection. |
| Cross-tenant workforce reference | Structurally impossible — identity resolution only ever runs against the Chief's own tenant-scoped workforce array; no tenant identifier exists anywhere in the schema for the model or client to supply. |
| Proposal introducing a reconciliation issue | `computeReconciliationIssues` (unchanged) surfaces it as the same non-blocking warning manual edits get. |
| No-op/cancelled proposal | `computeNetRosterDiff` naturally empty for a self-canceling accepted subset. |
| Stale revision between proposal and apply | Section 8 — `classifyOperationsForRebase`/`buildRebasePreview` (unchanged) invoked before accept. |
| Chief rejects proposal | Zero operations queued, zero side effects. |
| Chief accepts a subset | Only checkbox-selected + resolved operations convert and queue. |
| Manual structured editing remains unchanged | Proven by *not modifying* `rosterPatch.ts`/`rosterReconciliation.ts`/`rosterNetDiff.ts`/`rosterRebase.ts`/`rosterSwap.ts`/`rosterRevisionService.ts` at all in the first implementation slice. |
| No AI pathway can call revision publish directly | Structural — the new Edge Function has no database write capability of any kind (no service-role table access), and the new client code never calls `publishRevision`/`saveRevision`/any RPC other than the new proposal-generation one; confirmed by code review at implementation time (no such call to remove, since none is ever added). |

---

## 15. First implementation slice (smallest bounded handoff)

**In scope**:
- One new Edge Function, `supabase/functions/roster-patch-proposal/`,
  mirroring `roster-parser`'s shape exactly (quota check, tenant prompt
  override under `feature_key='roster_patch_proposal'`, OpenAI→Gemini
  fallback, **new** server-side schema validation before returning).
- One new client service (e.g. `generateRosterPatchProposal(...)`) in
  `src/modules/roster-engine/lib/`, calling
  `supabase.functions.invoke('roster-patch-proposal', ...)`.
- One small new UI addition to `MultiRosterManagerView.tsx` (or a small
  sibling component it renders): prompt box, "Generate Proposal" button,
  proposal review list with per-operation accept checkboxes, "Add to
  Pending Batch" button.
- Client-side conversion logic: symbolic operation → identity-resolved real
  `RosterPatchOperation` (reusing `identityResolver.ts` unchanged) and
  symbolic swap → `compileSwapToOperations` (reusing `rosterSwap.ts`
  unchanged).
- The revision-binding check + rebase fallback described in Section 8,
  reusing `rosterRebase.ts` unchanged.

**Explicitly zero changes to**: `rosterPatch.ts`, `rosterReconciliation.ts`,
`rosterNetDiff.ts`, `rosterRebase.ts`, `rosterSwap.ts`,
`rosterRevisionService.ts`, any resident-facing RPC, any existing migration.

**No autonomous apply. No publish. No background orchestration. No new
schema unless the Section 12 open question resolves to "yes, an additive
RPC parameter is needed" — everything else in this slice needs zero
migration.**

---

## 16. Explicit deferred work

- `add_slot`/`remove_slot`/`set_note` or any new patch primitive — until
  compelling evidence of real need (none found this pass).
- An inline ambiguous-identity disambiguation picker — V1 falls back to the
  existing manual form instead.
- Wiring `call_duty_rules`/`ai_adaptation_rules` into
  `computeReconciliationIssues` as a data-driven per-tenant rules layer —
  separate slice, not assumed to already exist.
- A shared cross-function `_shared/aiProvider.ts` module — until 3+
  functions justify the extraction.
- `EventType` union extension for `agent.action.proposed`/
  `agent.action.executed` — not required for V1's own correctness.
- Google Drive/Docs integration — untouched, orthogonal, already deferred by
  the 2026-08-28 document.
- Any Chief/admin RPC signature change beyond the possibly-needed
  `source`/`source_reference` override (Section 12) — genuinely open, to be
  confirmed at implementation time, not decided here.
- Any autonomous multi-step agent behavior, chatbot conversation state, or
  rung-3/4 ("Deciding"/"Learning") roster automation of any kind.

---

*No AI call, code, schema/migration, live database mutation, or Harness
implementation lifecycle was performed to produce this document. STOP for
human review before any implementation.*
