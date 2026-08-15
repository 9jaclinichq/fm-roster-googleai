# Scheduling Module Generalization — Scoping Proposal

Status: **scoping document only. No schema, migration, or application code was
written or changed to produce this.** Read `CLAUDE.md`, §7/§8.2 of
`docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md`, `docs/LIVING_SYSTEM_GAP_AUDIT.md`,
`docs/REGISTRY.md`, and `docs/MODULARIZATION_ARCHITECTURE.md` before acting on
anything below. This document deliberately mirrors the structure and voice of
`docs/ACADEMIC_TRACKS_GENERALIZATION_PROPOSAL.md` — same question shape
("generalize a live, real feature into the spec's capability model"), applied
to a structurally different module.

---

## 0. The question this answers

The living-system spec (`PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md` §7, module row
3) describes **Scheduling** as: "duty roster, on-call, clinic sessions, branch
coverage, equipment/room booking — whatever unit of time or resource the org
schedules." §8.2's seed-template bullet list names five concrete instance
shapes the capability should eventually support: a duty roster template with
per-cadre colour coding; a priority/on-call/supervision list "generated as a
pipeline output from a duty roster's data rather than entered separately";
emergency/outstation coverage rosters realignable month to month; a
clinic/session allocation roster; a booking/room roster.

Migration 42's own header (2026-08-15, written by a sibling agent in the same
session's wave) already looked at this exact question in passing and
deliberately punted on it: *"Scheduling (no generic instance table exists;
this app's roster features — `combined_master_rosters`/`raw_roster_uploads` —
are an admin document-parsing pipeline, not an instance-based module) ...
need[s] its own module-scoping pass first."* This document is that pass.

Unlike Forms (§7 row 2, generalized in migrations 35/40/42 — one hardcoded
flat-field form cleanly lifted into `form_instances`/`form_entries`/
`form_pipelines`), Scheduling's existing implementation is not a simple
manual-entry flow. It is a real, actively-used, AI-assisted HITL (human-in-
the-loop) document-parsing pipeline covering 5 distinct UCH-specific roster
document formats, with its own deployed Edge Function and a dedicated
dashboard tab. This document maps what exists, proposes a target shape,
lays out migration paths with tradeoffs, and recommends one — without writing
any of it.

---

## 1. Current-state map

### 1.1 Schema: `raw_roster_uploads` and `combined_master_rosters` (migration 10, `10_multi_roster_engine.sql`)

Both tables were introduced together in migration 10 ("Multi-Roster Engine &
Chief HITL Merge"), alongside a `roster_types` reference table seeded with
the 5 UCH document formats (`combined_gop`, `consultant_gop`,
`accident_emergency`, `afternoon_supervision`, `satellite_outreach`) and a
`workforce.on_floor` boolean flag (current-state only, not tracked per month)
distinguishing residents currently posted in GOP from those on an outside
rotation.

**`raw_roster_uploads`** — an append-only import log; every pasted/uploaded
roster document, of any of the 5 types, gets its own row. Re-pasting a
corrected version creates a new row rather than overwriting the old one.

```
id                        uuid, PK
month                     integer, CHECK 1-12
year                      integer, CHECK 2000-2100
roster_type_id            text, FK -> roster_types(id), NOT NULL
file_name                 text
file_url                  text
raw_text_content          text
parsed_data               jsonb, DEFAULT '{}', NOT NULL
uploaded_by_workforce_id  uuid, FK -> workforce(id) ON DELETE SET NULL
created_at                timestamptz, NOT NULL
```

- **No `tenant_id` column.** Migration 11 (SaaS multi-tenancy) added
  `tenant_id` to `combined_master_rosters` but did **not** touch
  `raw_roster_uploads` — confirmed by grepping every migration that
  references either table name. This table predates multi-tenancy and was
  never retrofitted; with only one live tenant (UCH) this has had no visible
  effect, but it means the raw import log has no tenant boundary at all
  today, not even the client-enforced kind everything else has.
- **RLS**: `ENABLE ROW LEVEL SECURITY` with `SELECT`/`INSERT` policies only,
  both `USING (true)` / `WITH CHECK (true)` for `anon, authenticated` — same
  permissive-everywhere posture as nearly every table in this schema (see
  CLAUDE.md's Security Notes). **Deliberately no `UPDATE`/`DELETE` policy**
  — migration 11's own comment on a sibling append-only table calls this
  pattern out by name: *"Append-only: no UPDATE/DELETE policy, matches
  `raw_roster_uploads` pattern."* This is the one place in the roster schema
  with a real (if permissive-adjacent) posture decision baked in, not an
  oversight.
- No triggers or functions attached.

**`combined_master_rosters`** — one row per monthly collection cycle,
carrying the Chief's four merged/reviewed grids through a
draft → chief_review → published lifecycle. Publishing this is what posts
the pinned `#Roster` announcement.

```
id                    uuid, PK
collection_id         uuid, FK -> collections(id) ON DELETE CASCADE
month                 integer, CHECK 1-12
year                  integer, CHECK 2000-2100
status                text, DEFAULT 'draft', CHECK IN ('draft','chief_review','published')
gop_clinic_grid       jsonb, DEFAULT '{}', NOT NULL
emergency_call_grid   jsonb, DEFAULT '{}', NOT NULL
supervision_grid      jsonb, DEFAULT '{}', NOT NULL
satellite_grid        jsonb, DEFAULT '{}', NOT NULL
published_at          timestamptz
created_at            timestamptz, NOT NULL
tenant_id             uuid, FK -> tenants(id), NOT NULL   -- added by migration 11
UNIQUE (collection_id)
```

- **`UNIQUE(collection_id)`**: at most one master roster per monthly
  collection cycle — a real structural constraint, not just a UI convention.
- **Tenant-scoped** (unlike `raw_roster_uploads`): migration 11 added
  `tenant_id NOT NULL DEFAULT <UCH tenant>`, backfilled, then dropped the
  default's implicit safety net by making it required going forward.
- **RLS**: `SELECT`/`INSERT`/`UPDATE`, all `USING (true)` / `WITH CHECK
  (true)` — permissive, same trust model as everything else. No `DELETE`
  policy either (rows are meant to persist as a historical record once
  created, matching the `UNIQUE(collection_id)` "one per cycle" design).
- **Four grid columns, not a normalized table of assignments.** Each grid is
  a single jsonb blob per month (a whole array of slots/shifts/duties/
  postings), not one row per assignment. This is the structural fact that
  drives most of §2's reasoning below.
- No triggers or functions attached.

### 1.2 UI flow: `MultiRosterManagerView.tsx`

`src/modules/org-admin/components/dashboard/MultiRosterManagerView.tsx` (~700
lines) is a real, actively-used dashboard tab, not a stub. Four-step flow:

1. **Resident Floor Check** — toggle each workforce member's `on_floor` flag
   (only on-floor residents are draggable into the grids below).
2. **Multi-Doc Ingestion** — for each of the 5 `roster_types`, the Chief
   pastes raw text and/or uploads a file (10MB cap, `roster-documents`
   Storage bucket), then clicks **Parse**. This calls one of 5
   format-specific parser functions (`parseConsultantGop`, `parseCombinedGop`,
   `parseEmergencyRoster`, `parseSupervisionRoster`, `parseSatelliteRoster` —
   `src/modules/roster-engine/lib/uchRosterParser.ts`), writes a
   `raw_roster_uploads` row recording the import, and loads the parsed
   result into the relevant grid's local React state.
3. **HITL Visual Editor** — a drag-and-drop (with tap-to-assign fallback for
   touch, added in a recent fix per this repo's own commit history) grid
   editor across 4 tabs (GOP Clinic / A&E Emergency / Supervision /
   Satellite). The Chief drags on-floor residents onto AI-parsed slots,
   removes incorrect assignments, and manually adds slots the parser missed.
   Each grid also surfaces an `unparsed_notes` array — text the parser
   couldn't confidently structure, left for the Chief to resolve by hand.
4. **Save Draft / Publish** — `saveDraft()` writes all 4 grids back to the
   `combined_master_rosters` row (status → `chief_review` unless already
   published); `publish()` writes status → `published`, stamps
   `published_at`, and creates a pinned `#Roster` announcement.

Nothing in this schema or UI records *who is assigned where* independent of
a Chief's manual (or AI-assisted-then-corrected) decision — migration 10's
own header is explicit that there is no automatic inference of assignments,
only structuring of what a source document already says.

### 1.3 AI parsing pipeline: `roster-parser` Edge Function

Same OpenAI → Gemini → client-side-heuristic-fallback architecture as every
other AI Copilot in this app (`dissertation-copilot`, `research-copilot`,
`casebook-copilot`), deployed as its own function specifically because,
per its own header, *"roster parsing is an operational/scheduling task, not
an academic one — different domain, different prompts, no reason to couple
their deploys."* Enforces the same server-side tenant AI quota
(`check_and_increment_tenant_ai_quota`) and AI-rigor tenant-adaptation
splice (`tenantAdaptation.ts`, feature key `roster_parser`) as the other 3
Copilot functions.

Request shape (identical across all 5 formats):

```json
{ "roster_type": "combined_gop" | "consultant_gop" | "accident_emergency"
             | "afternoon_supervision" | "satellite_outreach",
  "text": "<pasted or extracted document text>",
  "tenant_id": "<uuid, optional>" }
```

Response shape differs **per format** — this is the concrete evidence for
why "one roster document" cannot be treated as one universal shape. Two
representative examples:

**Combined GOP** (`combined_gop` — matches consultants with on-floor
residents across 6 named clinic stations):
```json
{ "result": {
    "slots": [
      { "date_or_day": "Monday", "clinic_type": "Triage",
        "consultants": ["Dr. Adeyemi"], "residents": ["Dr. Okoro"] }
    ],
    "unparsed_notes": ["..."]
  },
  "provider": "openai" | "gemini" }
```
`clinic_type` is a closed set (Triage / Male Sorting / Female Sorting /
Children Sorting / Managed Care / Annexe / Other); each slot names a
day/date, 0+ consultants, and 0+ residents.

**A&E Emergency Call** (`accident_emergency` — paired evening/night on-call
shifts, no clinic-station or consultant concept at all):
```json
{ "result": {
    "shifts": [
      { "date_or_day": "Tuesday", "shift": "4pm-10pm",
        "on_call": ["Dr. Bello", "Dr. Chukwu"] }
    ],
    "unparsed_notes": ["..."]
  },
  "provider": "openai" | "gemini" }
```
`shift` is a closed 2-value enum tied to fixed clock times; there is no
`clinic_type`/`consultants` concept at all — a structurally different grid,
not a relabeled version of the GOP shape.

(The other 3 formats follow the same pattern of format-specific shapes:
`afternoon_supervision` returns `duties[]` with named `first_on_duty`/
`second_on_duty` fields per date — a role-pair structure with no per-slot
resident *list*; `satellite_outreach` returns `postings[]` keyed by a closed
facility-name set with a flat `assigned[]` list; `consultant_gop` returns the
same shape as `combined_gop` minus the `residents` field.)

Every prompt carries the same HITL instruction verbatim: extract only what
the source text states, put anything ambiguous into `unparsed_notes`, never
invent a name/date/station/assignment — a human always reviews before
anything is used.

### 1.4 Registry status and "is this real" assessment

Per `docs/REGISTRY.md`:
- **F10** (`MultiRosterManagerView.tsx`, org-admin face) — status
  "fragmented" only in the *file-location* sense (it lives under
  `org-admin/components/dashboard/`, cross-module from the lib it calls),
  not in the "is this used" sense.
- **M11 Roster Engine** (`src/modules/roster-engine/lib/uchRosterParser.ts`)
  — a real module folder already exists under this exact name, lib-only, no
  `components/` directory of its own (F10's UI lives in `org-admin`
  instead). **This means `roster-engine` is already a taken module name in
  this repo's convention** — a new generic Scheduling module needs a
  different folder name (see §5).
- **E4 `roster-parser`** — Edge Function registry entry: `owner engine:
  babsbrain-2`, `gates: HITL review in F10 before the parsed roster is
  published (manual)`, `status: fragmented, unchanged in this pass. 1
  corresponding agent_manifests row (S6), not read at runtime.` The
  "fragmented" here tracks the same module/registry bookkeeping gap as F10,
  not a claim the feature doesn't work.

Taken together: **5 distinct document-format parsers, each with its own
system prompt and response shape; a deployed, live-verified, quota-gated,
tenant-AI-rigor-tunable Edge Function; a full 4-step dashboard tab with
drag-and-drop and a touch fallback; an append-only audit log of every
import.** This is not a throwaway feature comparable to the Forms module's
single hardcoded monthly form — it is one of the more architecturally
involved AI-assisted features in the app, on the same tier of investment as
the Research Engine or Casebook & Logbook Engine. Any migration path here
carries correspondingly higher risk to a live, depended-on feature.

---

## 2. What the spec actually wants — target shape

Following the same `builder / instances / data / pipelines / agent hooks`
model §7 defines for every module, and the same Forms-module precedent
(`form_instances` / `form_entries` / `form_pipelines`, migrations 35/40/42),
a generic Scheduling module needs three analogous tables. Field lists only —
no SQL, no types, no RLS policy text; a shape for a human to turn into a real
migration later, not a migration.

### 2.1 `scheduling_instances` (the "builder" output — one named
schedule/roster for a period)

```
id                    uuid, PK
tenant_id             uuid, nullable  \  same 3-shape owner convention as
doctor_id             uuid, nullable  /  form_instances post-migration-40/42:
                                          exactly one of tenant/doctor set for
                                          an org/individual instance, or both
                                          NULL for a global seed template
name                  text            -- "August 2026 Duty Roster"
schedule_kind         text            -- free text, not a CHECK enum, same
                                          reasoning as form_pipelines.pipeline_type
                                          and migration 42's header: avoid
                                          CHECK-constraint churn while the real
                                          set (duty_roster, on_call,
                                          clinic_session, equipment_booking,
                                          room_booking, branch_coverage, ...)
                                          is still being discovered
period_start          date
period_end            date            -- a month-based UCH roster sets both
                                          to the same month; a diagnostic
                                          centre's equipment calendar might
                                          span a rolling window instead
row_definitions       jsonb           -- what a "row" in this instance's grid
                                          means: a list of {key, label,
                                          row_kind} — row_kind might be
                                          'person' (a resident/cadre),
                                          'resource' (a room/machine), or
                                          'category' (a clinic station /
                                          facility name acting as a grouping
                                          row, matching the GOP grid's
                                          clinic_type-keyed structure)
column_definitions    jsonb           -- what a "column" means: a list of
                                          {key, label} — a date, a named shift
                                          (e.g. "4pm-10pm"), a session slot
config                jsonb           -- instance-specific extras that don't
                                          deserve their own column (colour-
                                          coding rules per cadre, closed
                                          station/facility name sets, etc.)
status                text            -- draft / chief_review / published,
                                          reused verbatim from
                                          combined_master_rosters — already a
                                          proven 3-state lifecycle for exactly
                                          this kind of HITL workflow
published_at          timestamptz
created_by_workforce_id  uuid, nullable
created_at            timestamptz
```

### 2.2 `scheduling_entries` (the "data" — the actual grid, one row per
assignment)

**This is the crux design decision, reasoned through explicitly below.**
Two candidate shapes exist:

- **(A) One row per instance, one big jsonb blob** — i.e. just add a
  `grid_data jsonb` column to `scheduling_instances` and skip a separate
  `scheduling_entries` table entirely. This is what `combined_master_rosters`
  already does today (4 blob columns instead of 1, but same idea).
- **(B) One row per assignment/cell** — an `instance_id`, a `row_key`
  (matching one of `row_definitions`), a `column_key` (matching one of
  `column_definitions`), and an `assignment` jsonb payload (who/what fills
  that cell).

**(B) is the correct target shape**, for the same reason `form_entries` is
one row per submission rather than one blob column on `form_instances`: it
is what makes the data actually *queryable* as "data" in the four-things
model, not just a display blob. One row per cell lets a future cross-
instance query answer "show all of Dr. X's assignments this month across
every roster category" or "which rooms are booked Tuesday afternoon" without
deserializing and re-scanning a jsonb array client-side — the exact kind of
query a future PrivyBrain-2/BabsBrain-2 agent hook (§7's "agent hooks" row)
or a Dashboard insight tile would need. It also generalizes cleanly across
wildly different org types (a hospital's per-cadre duty grid, a diagnostic
centre's equipment booking, a clinic's session allocation) because "a cell"
is the one concept all of them share, where "a grid blob's internal shape"
is not.

```
id             uuid, PK
instance_id    uuid, FK -> scheduling_instances(id)
tenant_id      uuid, nullable       -- denormalized from the instance, for
doctor_id      uuid, nullable          cheap filtering without a join, same
                                        precedent as form_entries.tenant_id
row_key        text                 -- matches one row_definitions[].key
column_key     text                 -- matches one column_definitions[].key
row_kind       text                 -- denormalized copy of that row's
                                        row_kind ('person'/'resource'/
                                        'category'), for filtering without
                                        re-parsing the instance's
                                        row_definitions jsonb
assignment     jsonb                -- who/what is assigned: e.g.
                                        {"workforce_ids": ["..."]} for a duty
                                        slot, {"booked_by": "...", "notes":
                                        "..."} for a room booking
source         text                 -- 'manual' | 'ai_parsed' | 'imported' —
                                        mirrors the source/provider badging
                                        pattern every AI Copilot panel in
                                        this app already uses
unparsed_note  text, nullable       -- carries forward the parser's
                                        unparsed_notes concept per-cell
                                        instead of per-grid, so a note can be
                                        resolved/cleared independently
created_at     timestamptz
updated_at     timestamptz
```

### 2.3 `scheduling_pipelines` (derived outputs — reused verbatim from
`form_pipelines`' own shape)

```
id             uuid, PK
instance_id    uuid, FK -> scheduling_instances(id)
pipeline_type  text          -- free text, not CHECK-constrained, same
                                 reasoning as form_pipelines.pipeline_type
config         jsonb
created_at     timestamptz
```

§8.2's own example — *"Priority/on-call/supervision list, generated as a
pipeline output from a duty roster's data rather than entered separately"*
— maps directly onto one row here: `pipeline_type = 'roster_to_priority_list'`,
`config` naming which `row_kind`/`column_key` combinations in the parent
instance's entries feed the derived list (e.g. "all entries where `row_kind
= 'category'` and `column_key` matches today's date"). This is exactly the
same pattern the Forms module's own seed row already documents for its one
existing pipeline (`schedule_to_roster`, migration 35) — a pipeline is a
*read/compute* over an instance's existing entries, not a new import path.

### 2.4 How the 5 UCH AI-parsed formats map onto this shape

This is the part of the crux question that needed the most care, because it
is tempting to reach for "one `schedule_kind` per format" or "one
`pipeline_type` per format" and both are wrong for the same reason:

- **Not one `scheduling_instances.schedule_kind` per format.** Today, all 5
  formats feed into **one** `combined_master_rosters` row per month (4 grid
  columns, `UNIQUE(collection_id)`) — the Chief reviews GOP, A&E,
  supervision, and satellite together as one merged monthly roster, not as 4
  independent rosters. The generic model should preserve that: **one
  `scheduling_instances` row per month** (`schedule_kind = 'duty_roster'`),
  with the 4 output categories distinguished by `row_kind`/`row_key`
  conventions within that single instance's `scheduling_entries`, not by 4
  separate instances. Splitting into 5 (or 4) instances would be a
  regression from the Chief's existing single-merged-review workflow, not a
  generalization of it.
- **Not one `scheduling_pipelines.pipeline_type` per format either.** A
  "pipeline" in this model (§7's own definition, and `form_pipelines`'
  precedent) is a *derived/computed output* from an instance's already-
  entered data — e.g. `roster_to_priority_list`. Parsing a raw document
  into structured entries is the opposite direction: it's an **import**,
  not a derivation. Treating the 5 document-format parsers as 5
  `pipeline_type` rows would mean storing "how to read a document" as
  pipeline config, which is a much worse fit for jsonb than for the actual
  TypeScript/Deno code that already exists and works
  (`uchRosterParser.ts`/`roster-parser/index.ts`'s `SYSTEM_PROMPTS` map).
- **The right home for "5 formats" is upstream of both `scheduling_instances`
  and `scheduling_entries` — an import/parsing layer, analogous to but
  distinct from `raw_roster_uploads`.** The 5 formats stay exactly what they
  are today: format-specific parser functions (one per format, each with its
  own prompt and expected shape, the same way `researchRubric.ts` and
  `casebookRubric.ts` are separate per-domain code rather than one generic
  rubric engine). What changes under generalization is only the *output*
  each parser writes to — instead of setting one of 4 local React grid
  states that get saved as a `combined_master_rosters` jsonb blob, a parser's
  output would be unpacked into `scheduling_entries` rows (one GOP slot → one
  or more entries keyed by `row_key = clinic_type` (or a specific resident),
  `column_key = date_or_day`; one A&E shift → one entry keyed by
  `row_key = 'on_call'`, `column_key = date+shift`; etc.). **This unpacking
  is real, non-trivial per-format translation logic** — not a schema
  concern, an application-code concern — and is exactly the work any of
  §3's paths (b)-with-dual-write or (a) would need to write, one format at a
  time.
- Whether the raw import log itself (`raw_roster_uploads`) gets a generic
  equivalent is a separate, smaller question this document flags rather than
  resolves: it could stay exactly as-is (UCH-specific, untouched, under
  paths (b) and (c) below), since it is arguably infrastructure to an
  instance's ingestion rather than the "data" a module's `instances[]`/
  `entries[]` concept is about — the same way `research_correction_logs` is
  clearly "data" but the raw text a resident pastes into an AI prompt is not
  persisted as its own generic concept anywhere else in this app either.

---

## 3. Migration paths, with tradeoffs

### 3.1 (a) Full replacement

Migrate `combined_master_rosters`/`raw_roster_uploads` rows into the new
`scheduling_instances`/`scheduling_entries` shape; rewire
`MultiRosterManagerView.tsx` to read/write the new tables; rewrite
`roster-parser`'s 5 system prompts and response handling to emit
entries-shaped output instead of today's 4 grid shapes; retire the old
tables.

- **Pros**: the only path that reaches "one capability" the spec describes.
  Removes the asymmetry where Scheduling alone still has no
  instance/entries/pipelines shape while Forms, Research, and Casebook all
  do (to varying degrees). Makes a future non-UCH org's shift roster or
  equipment booking usable through the same tables, UI, and (eventually)
  pipeline machinery UCH's duty roster uses.
- **Cons — severe, not cosmetic**:
  - **This is the one live, monthly, AI-assisted publishing workflow a real
    Chief actually depends on today** — a botched migration here doesn't
    corrupt test data, it breaks the mechanism that posts the `#Roster`
    announcement residents check for their assignments. There is no
    automated test suite and, per CLAUDE.md, no migration-runner rollback
    tooling — "re-run the SQL in the Supabase dashboard" is this repo's
    entire recovery plan.
  - **Rewiring the Edge Function's 5 prompts simultaneously** is a larger
    surface than any single Edge Function change documented in CLAUDE.md to
    date — each of the 4 AI Copilot Edge Functions already required
    individual curl + browser live-verification when it was first built or
    materially changed; doing 5 formats' worth of prompt/response rewrites
    in one Edge Function in one pass multiplies that verification burden by
    5, not by 1.
  - **The blob→cell translation (§2.4) is real, per-format logic that has
    never been written or tested** — unlike Forms' migration (which needed
    zero data-shape translation, since `form_entries.payload` is
    intentionally schema-less), unpacking `gop_clinic_grid`'s slot array,
    `emergency_call_grid`'s shift array, `supervision_grid`'s duty-pair
    array, and `satellite_grid`'s posting array into 4 differently-shaped
    families of `scheduling_entries` rows is new code, on a live feature,
    with no prior art in this repo to lean on the way Forms could lean on
    `payload jsonb`'s total flexibility.
  - `raw_roster_uploads` has no `tenant_id` today (§1.1) — a full migration
    would force a decision (backfill a tenant_id, or leave the import log
    permanently un-migrated) that this document does not make.
  - No rollback path once old tables are dropped.

### 3.2 (b) Additive/parallel

Build `scheduling_instances`/`scheduling_entries`/`scheduling_pipelines`
alongside the existing `raw_roster_uploads`/`combined_master_rosters` tables
and `MultiRosterManagerView.tsx`, touching zero existing code. A *new*,
simpler manual/generic Scheduling builder UI (create a named instance, define
rows/columns, hand-fill or drag-fill the grid) lets other org types (a
clinic's shift roster, a diagnostic centre's equipment booking) use the
generic model immediately. UCH's existing 5-format AI-parsing pipeline keeps
running exactly as today, untouched, indefinitely — treated as a
specialized, hospital-specific implementation of the same underlying
capability, not something that needs to migrate for the module to "exist."

- **Pros**: zero migration risk to the one live roster-publishing workflow.
  Matches this repo's own established precedent exactly — CLAUDE.md's
  Casebook Builder/Casebook Engine coexistence ("sits alongside the original
  Casebook Builder, not replacing it... an explicit choice made with the
  user rather than silently colliding two concepts or migrating existing
  resident data") and migration 35's Forms scaffold (new tables built
  alongside the untouched `submissions`/`collections` flow, with the
  migration's own header calling the live rewire "a materially bigger
  follow-up... deliberately out of scope"). Immediately unlocks Scheduling
  for org types §8.2 names (clinic sessions, room/equipment booking) that
  today have literally nowhere to live in this schema — closing a real,
  currently-total gap, not just a duplication.
- **Cons**: never actually converges — UCH's own duty roster, the single
  richest real example of "scheduling" in this app, stays outside the
  generic model indefinitely unless a later pass does (c) or (a). A future
  reader (human or agent hook) asking "what is this org's schedule" still
  has to know to check two separate table families depending on which org.

### 3.3 (c) Dual-write now

Same additive schema as (b), but also make `MultiRosterManagerView.tsx`'s
`publish()` step (and/or `saveDraft()`) dual-write a translated
`scheduling_entries` representation into the new generic tables immediately
— analogous to `ResidentFormView.tsx`'s live, already-shipped `form_entries`
mirror (per `docs/REGISTRY.md`'s M8 entry: *"a best-effort, non-blocking
dual-write into `form_entries` immediately after the real `submissions`
insert succeeds ... wrapped in try/catch ... `submissions` remains the sole
source of truth and the dual-write can never block or roll back the real
submission"*).

- **Pros**: same zero-risk-to-the-live-path property as (b) (the dual-write
  is additive, non-blocking, and best-effort — a failure here cannot break
  the real publish), but the generic Scheduling module has real,
  immediately-useful UCH data from day one instead of staying empty until a
  second org onboards and starts using the new manual builder. This is
  exactly the property the Forms module's dual-write already proved works
  in this codebase.
- **Cons**: still requires writing the §2.4 blob→cell translation logic (4
  grid shapes → `scheduling_entries` rows) — the one piece of genuinely new,
  untested logic (a) also needs — just wrapped in a try/catch instead of
  being the primary write path. Materially more work than (b) for a benefit
  ((c)'s payoff is "the generic tables aren't empty") that only matters once
  something actually reads `scheduling_entries` back out — and per M8's own
  registry note, `form_entries`' dual-write already has *no consumer today*
  either ("a one-way mirror with no consumer, not yet a functioning
  pipeline"). Building the roster equivalent of that same not-yet-consumed
  mirror is lower-value here than it was for Forms, where the schema
  translation was trivial (`payload jsonb` needs no per-field mapping code
  at all) — Scheduling's translation is the expensive part regardless of
  whether it's the primary write or a mirror.

### 3.4 Note on precedent already in this repo

`docs/REGISTRY.md`'s M8 entry, and migration 35/40/42's own headers, are the
closest real precedent for this exact question and already answer it the
same way this document leans for the *first* slice: additive scaffold, old
live path untouched, dual-write held as a deliberate, separately-justified
follow-up rather than bundled into the first pass. Migration 42's header
explicitly named Scheduling as needing its own scoping pass before any of
this — this document is that pass, not a decision to proceed.

---

## 4. Recommendation

**(b) now — additive schema only, no dual-write, no rewire of
`MultiRosterManagerView.tsx` or `roster-parser` — with (c)'s dual-write
reserved for a deliberate follow-up once something actually reads
`scheduling_entries` (a Dashboard tile, a cross-instance query, an agent
hook), and (a) not attempted until/unless UCH's own 5-format pipeline is
explicitly slated for retirement or replacement.**

Justification against this repo's own stated values:

- **"No silent scope creep" / "surgical fixes" (CLAUDE.md's AI Philosophy).**
  (a) is a coordinated rewrite of the one live, monthly, AI-assisted,
  Chief-depended-on publishing workflow in this app — the least surgical
  option available, not because generalization is a bad idea, but because
  bundling it with a live feature's only implementation multiplies risk for
  no corresponding near-term benefit (no second org exists yet to serve).
  (b) is the definition of surgical: net-new tables, zero existing surface
  touched, real capability gap (clinic sessions, equipment/room booking —
  today entirely unimplementable in this schema) closed immediately.
- **The established additive-precedent pattern, applied consistently.** This
  repo has now made the "add alongside, don't touch the live path" call
  multiple times on record: Casebook Builder vs. Casebook Engine (explicit,
  user-confirmed), the Forms scaffold (migration 35, later dual-written only
  after the scaffold itself proved safe), and now this document reaching the
  same conclusion independently for Scheduling from its own risk analysis.
  Reaching for (a) or (c) here specifically, on the single most operationally
  load-bearing AI feature in the app, would be the outlier decision.
- **Risk is asymmetric in a way that favors (b) specifically over (c) too.**
  Forms' dual-write was cheap to add on top of its scaffold because
  `form_entries.payload jsonb` needed no translation code — mirroring a
  `submissions` row was a direct field copy. Scheduling's dual-write is not
  cheap: it requires writing and testing 4 new per-grid-shape translation
  functions against a live feature, for a mirror that (per Forms' own
  precedent) will likely sit unconsumed for a while after shipping. That
  translation work is real and worth doing eventually, but it is not free
  just because it's "only" a dual-write — bundling it into the *first*
  Scheduling slice repeats exactly the "large surface for a first pass" risk
  §4 is trying to avoid, just at a smaller scale than (a).
- **What (b) actually delivers now**: real, immediate coverage for org types
  the current schema cannot serve at all today (a clinic's shift roster, a
  diagnostic centre's equipment booking, a solo doctor's own session
  calendar — §7's "individual tenants get a limited subset ... scheduling
  for self"), with zero risk to UCH's live roster-publishing workflow. That
  is the actual gap migration 42 flagged ("no generic instance table
  exists"), and (b) closes it directly.

---

## 5. Minimum first slice for (b)

Not the final schema (§2 is closer to that) — this is what a first migration
and first UI pass would need to cover to be useful without overreaching.

### 5.1 Migration shape

Same 3 tables sketched in §2.1-2.3, with two deliberate first-slice
narrowings:

- **Skip the doctor-owned shape initially.** Unlike Forms/Research/Casebook,
  no individual-doctor scheduling flow exists anywhere in this app today —
  §7 does list "scheduling for self" as part of an individual tenant's
  subset, but nothing currently reads or writes doctor-scoped schedule data.
  A first migration can add `doctor_id` as a column from day one (cheap,
  avoids an `ALTER TABLE` later, mirrors `research_workspaces`' original
  nullable-columns-before-the-feature-exists precedent) without building the
  RLS/UI to actually support it yet — flagged explicitly as unbuilt, not
  silently omitted.
- **`scheduling_entries.row_kind`/`column_definitions` stay pure jsonb/text
  in this slice, no lookup tables.** A `row_kind` value like `'person'` or
  `'resource'` is just a string the builder UI interprets, not a foreign key
  into a `row_kinds` reference table — avoids schema churn while real usage
  patterns (beyond UCH's own) are still unknown, same reasoning migration
  35 gave for `form_pipelines.pipeline_type` staying free text.
- RLS: permissive `USING (true) WITH CHECK (true)` on all three tables for
  the institutional/global shapes, matching every table since migration 01;
  a real `auth.uid() = doctor_id` boundary on the doctor-owned shape only if
  and when that path is actually built (mirroring migration 25's real
  boundary, not invented speculatively here).

### 5.2 Minimal generic builder UI

A new, deliberately simple screen — **not** a second `MultiRosterManagerView`
and **not** wired to any AI parser in this first slice:

1. Create a named `scheduling_instances` row (name, `schedule_kind` free
   text, period start/end).
2. Define rows: a simple ordered list of free-text row labels (the person,
   resource, or category names for this org's grid) plus a `row_kind` picker
   (person / resource / category).
3. Define columns: a simple ordered list of free-text column labels (dates,
   shift names, session slots).
4. Fill cells: for each row×column pair, type or pick who/what is assigned
   (free text or a workforce-member picker, reusing the existing
   `databaseService.getWorkforce()` call the roster and forms modules
   already use) — no drag-and-drop, no AI parsing, no HITL review workflow.
   Those stay unique to UCH's specialized `MultiRosterManagerView.tsx` in
   this pass.
5. A simple draft/published status toggle, reusing the same 2-state (or
   3-state, matching `combined_master_rosters`) convention already proven
   for exactly this kind of workflow.

### 5.3 Where it lives

`src/modules/scheduling/` — a **new** module folder, matching this repo's
`src/modules/<domain>/` convention (`docs/MODULARIZATION_ARCHITECTURE.md`,
confirmed against the actual `src/modules/` listing: `announcements`, `auth`,
`billing`, `casebook-logbook`, `consultant-review`, `dissertation`,
`doctors`, `exam-readiness`, `form`, `knowledge-packs`, `org-admin`,
`research`, `roster-engine`, `shared`, `viva-simulator`). **Deliberately not
`roster-engine`** — that name is already taken by the UCH-specific AI-parsing
lib (`docs/REGISTRY.md`'s M11), and per §7's own naming rule ("no module
name ... may assume hospital, residency, or any other specific setting"),
`roster-engine` itself is arguably a slightly UCH-flavored name for what M11
actually is; renaming or re-scoping M11 is a separate, smaller question this
document flags but does not resolve. The new module gets its own
`components/`, `lib/`, and (once a migration is written) implicitly owns the
3 new tables — following the `form`/`research`/`casebook-logbook` precedent
of one module folder per capability, not nesting under `org-admin` the way
F10's UI currently (awkwardly, per REGISTRY.md's own "fragmented" note) does.

---

## 6. Explicit non-goals for now

- **No SQL, migration file, RLS policy, TypeScript type, or component was
  written or changed to produce this document.** This is scoping only.
- **No table was queried.** This worktree has no live DB credentials
  configured for this task; all data-maturity and schema claims in §1 come
  from reading migration files, `docs/REGISTRY.md`, and the actual
  `MultiRosterManagerView.tsx`/`uchRosterParser.ts`/`roster-parser/index.ts`
  source directly — not from live row counts. If a precise row count matters
  for a future go/no-go decision, that requires a separate pass with real
  Supabase credentials.
- **Nothing here is authorization to proceed with (a), (b), or (c).** Per
  CLAUDE.md's own AI Philosophy ("Silent scope creep is not acceptable... a
  schema change, a new RLS policy... must be called out explicitly, not
  slipped in as a side effect") and Security Notes ("Requires user
  confirmation before changing... before running"), any of the three paths
  above needs its own explicit go-ahead from Dr. Olanipekun before a single
  line of implementation is written. This document exists to make that
  conversation possible, not to preempt it.
- **The `roster-engine` module-naming tension (§5.3) is flagged, not
  resolved.** Whether M11 should eventually be renamed, folded into the new
  `scheduling` module as its UCH-specific specialization, or left exactly as
  it is, is a separate open question this document does not answer.
- **Whether `raw_roster_uploads` ever gets a generic equivalent (§2.4's
  closing paragraph) is flagged, not resolved.**
- **No decision is made here about retiring or rewiring
  `MultiRosterManagerView.tsx`, `uchRosterParser.ts`, or `roster-parser`.**
  All three stay live and untouched unless and until a separate, explicit
  decision says otherwise.
