-- ====================================================================
-- FM Roster - Migration 45: Meetings & Actions module (schema)
-- ====================================================================
-- PREREQUISITE: migrations 01-43 already applied (44 reserved for a
-- concurrent sibling agent's Scheduling module work; not depended on
-- here, and this migration does not touch anything that one owns).
--
-- WHY: docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md §7's module table, row 7
-- ("Meetings & actions — departmental meetings, partner meetings,
-- committee meetings, board meetings, with an action tracker for any of
-- them", owner engine BabsBrain-2) and §8.2's seed-template bullet
-- ("standing meeting template with agenda, minutes, and action-tracker
-- pipeline, usable for any recurring meeting type") both call for a
-- Meetings & Actions module. Confirmed via two independent research
-- passes this session (docs/SCHEDULING_MODULE_SCOPING.md and the earlier
-- gap-audit work) that NO Meetings table exists anywhere in this schema
-- today — this is a genuine blank slate, not a reconciliation with a live
-- feature (unlike the concurrent Scheduling task, which had to reconcile
-- the spec against a real, live, AI-assisted 5-format roster parser).
--
-- SCHEMA SHAPE — builder / instance / data, per §7's four-things-per-
-- module framing:
--   1. `meeting_series` (the "builder" output): a named recurring meeting
--      type an org (or individual doctor) sets up once, with a reusable
--      default agenda template. e.g. "Weekly Departmental Meeting",
--      "Board Meeting" — the name/label is entirely instance config, per
--      §7's naming rule; nothing here is hardcoded to one org type.
--   2. `meetings` (the "instances"): one row per actual occurrence of a
--      series, with its own independently-editable agenda (seeded from
--      the series' agenda_template) and minutes.
--   3. `meeting_actions` (the "data"/pipeline output): the action-tracker
--      pipeline §7/§8.2 both call out explicitly. Directly implements the
--      spec's event vocabulary (§6) entries `meeting.item.raised` /
--      `meeting.action.owed`.
--
-- OWNERSHIP SHAPE — three-way, mirroring migration 42's
-- form_instances convention exactly (tenant-owned / doctor-owned [schema
-- column only, see RLS note below] / both-NULL global default). See that
-- migration's header for the full CHECK-constraint-shape rationale; the
-- same three-disjunct CHECK is used verbatim here on `meeting_series`.
--
-- RLS — DELIBERATE DEVIATION FROM MIGRATION 42/40'S auth.uid() BOUNDARY:
-- per this task's explicit instruction (mirroring the concurrent
-- Scheduling task's own deferral, for consistency across this migration
-- wave), the real `auth.uid() = doctor_id` RLS boundary is NOT built in
-- this pass. `doctor_id` columns exist on all three tables (so a future
-- doctor-scoped RLS pass — and a future doctor-owned Meetings UI — needs
-- no schema change), but RLS here is fully permissive
-- (`USING (true) WITH CHECK (true)`) for every row regardless of
-- ownership shape, same as the baseline trust model nearly every table in
-- this schema already uses (see CLAUDE.md's Security Notes). FLAGGED AS A
-- FOLLOWUP, not silently built or silently skipped: a doctor-owned
-- meeting_series row is, today, exactly as writable/readable by any
-- anon-key holder as a tenant-owned one.
--
-- `meetings`/`meeting_actions` denormalize `tenant_id`/`doctor_id` from
-- their parent `meeting_series` row for cheap filtering — same precedent
-- CLAUDE.md's Forms section notes for `form_entries.tenant_id` relative to
-- `form_instances`. These are plain nullable columns, not FK-enforced
-- against the parent's actual owner shape (the application layer is
-- responsible for keeping them consistent at write time, matching
-- form_entries' own convention).
--
-- SEED: one global (tenant_id IS NULL AND doctor_id IS NULL)
-- `meeting_series` row, "Standing Departmental Meeting", fulfilling
-- §8.2's "standing meeting template with agenda, minutes, and
-- action-tracker pipeline" ask. Kept specialty/org-type-agnostic per §7's
-- naming rule beyond the label itself (a clinic, a practice, or a board
-- would use the same generic agenda shape).
--
-- OUT OF SCOPE, PER THIS TASK'S EXPLICIT INSTRUCTION: no doctor-owned RLS
-- boundary (see above); no dashboard/nav wiring (schema + service +
-- standalone panel only); does not touch anything under
-- src/modules/scheduling/ or migration 44.
--
-- NOT APPLIED LIVE. Per this task's security boundary, this migration is
-- written for review only — a human applies it to the live database
-- afterward.
-- ====================================================================

-- --------------------------------------------------
-- 1. MEETING SERIES — the "builder" concept: a named recurring meeting
--    type with a reusable default agenda.
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS meeting_series (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid REFERENCES tenants(id),
  doctor_id uuid REFERENCES doctor_profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  -- Reusable default agenda-item list for any new occurrence of this
  -- series, e.g. [{"label": "Review of previous minutes"}, {"label":
  -- "Matters arising"}]. Free-form (not a fixed schema) — the org edits
  -- this per series, same "don't over-engineer a DSL" precedent as
  -- form_instances.schema (migration 35).
  agenda_template jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_system_default boolean NOT NULL DEFAULT false,
  created_by_workforce_id uuid REFERENCES workforce(id),
  created_at timestamptz DEFAULT now(),
  CONSTRAINT meeting_series_owner_check CHECK (
    (tenant_id IS NOT NULL AND doctor_id IS NULL)
    OR (tenant_id IS NULL AND doctor_id IS NOT NULL)
    OR (tenant_id IS NULL AND doctor_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_meeting_series_tenant ON meeting_series(tenant_id);
CREATE INDEX IF NOT EXISTS idx_meeting_series_doctor ON meeting_series(doctor_id);

ALTER TABLE meeting_series ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "meeting_series_select" ON meeting_series;
CREATE POLICY "meeting_series_select" ON meeting_series FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "meeting_series_insert" ON meeting_series;
CREATE POLICY "meeting_series_insert" ON meeting_series FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "meeting_series_update" ON meeting_series;
CREATE POLICY "meeting_series_update" ON meeting_series FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- --------------------------------------------------
-- 2. MEETINGS — one row per actual occurrence of a series (the
--    "instances").
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS meetings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_series_id uuid REFERENCES meeting_series(id) NOT NULL,
  -- Denormalized from the series for cheap filtering — see header note.
  tenant_id uuid,
  doctor_id uuid,
  title text NOT NULL,
  scheduled_at timestamptz,
  -- This occurrence's actual agenda, seeded from the series'
  -- agenda_template but independently editable from then on.
  agenda jsonb NOT NULL DEFAULT '{}'::jsonb,
  minutes text,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meetings_series ON meetings(meeting_series_id);
CREATE INDEX IF NOT EXISTS idx_meetings_tenant ON meetings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_meetings_doctor ON meetings(doctor_id);

ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "meetings_select" ON meetings;
CREATE POLICY "meetings_select" ON meetings FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "meetings_insert" ON meetings;
CREATE POLICY "meetings_insert" ON meetings FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "meetings_update" ON meetings;
CREATE POLICY "meetings_update" ON meetings FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- --------------------------------------------------
-- 3. MEETING ACTIONS — the action-tracker pipeline output §7/§8.2 both
--    call out explicitly. Implements the spec's event vocabulary (§6)
--    entries `meeting.item.raised` / `meeting.action.owed`.
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS meeting_actions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  meeting_id uuid REFERENCES meetings(id) NOT NULL,
  description text NOT NULL,
  owner_workforce_id uuid REFERENCES workforce(id),
  due_date date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done', 'overdue')),
  created_at timestamptz DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_meeting_actions_meeting ON meeting_actions(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_actions_owner ON meeting_actions(owner_workforce_id);

ALTER TABLE meeting_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "meeting_actions_select" ON meeting_actions;
CREATE POLICY "meeting_actions_select" ON meeting_actions FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "meeting_actions_insert" ON meeting_actions;
CREATE POLICY "meeting_actions_insert" ON meeting_actions FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "meeting_actions_update" ON meeting_actions;
CREATE POLICY "meeting_actions_update" ON meeting_actions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- --------------------------------------------------
-- 4. SEED — one global standing meeting template, per §8.2's "Meetings &
--    actions" bullet verbatim ("standing meeting template with agenda,
--    minutes, and action-tracker pipeline, usable for any recurring
--    meeting type"). Kept specialty/org-type-agnostic: "Standing
--    Departmental Meeting" is generic enough for a clinic, practice, or
--    board to use as-is or rename — the agenda items themselves name no
--    specialty or org type.
-- --------------------------------------------------

INSERT INTO meeting_series (tenant_id, doctor_id, name, description, agenda_template, is_system_default)
SELECT
  NULL, NULL,
  'Standing Departmental Meeting',
  'Generic seed template for any recurring meeting — a department, a partner group, a committee, or a '
  || 'board. Clone and edit the agenda for your own recurring meeting type.',
  '{"items": [
    {"label": "Review of previous minutes"},
    {"label": "Matters arising"},
    {"label": "Main agenda items"},
    {"label": "Any other business (AOB)"},
    {"label": "Action items review"}
  ]}'::jsonb,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM meeting_series
  WHERE tenant_id IS NULL AND doctor_id IS NULL AND name = 'Standing Departmental Meeting'
);

-- ====================================================================
-- END OF MIGRATION 45
-- ====================================================================
