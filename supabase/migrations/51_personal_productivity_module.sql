-- ====================================================================
-- FM Roster - Migration 51: Personal Productivity module
-- (personal_tasks, wellbeing_entries, focus_sessions)
-- ====================================================================
-- PREREQUISITE: migrations 01-50 already applied.
--
-- CONTEXT: per user-supplied reference mockups (a Flutter product concept
-- called "Workspc") studied this session, 4 genuinely-missing modules were
-- selected to build as new, additive slices complementing (not replacing)
-- this app's existing features: Focus Mode (a Pomodoro-style deep-work
-- timer), Wellbeing (mood check-in + sleep tracking), a personal Tasks
-- list, and a People/Team directory. The last of these needs NO schema —
-- it's a read-only view over the existing `workforce` table. This
-- migration adds the 3 tables the other three modules need.
--
-- OWNERSHIP SHAPE — deliberately NOT the same as migration 25/31/40's
-- pattern, because the thing being owned here is different in kind. Those
-- tables (research_workspaces, form_instances, ...) can be owned by an
-- ORGANIZATION broadly (tenant_id set, no single person) or by one
-- individual doctor — a 2-way split where one side is institutional-but-
-- impersonal. A personal task, a mood check-in, or a focus session belongs
-- to exactly one PERSON, always — there is no "the org owns this" state.
-- So the owner column pair here is workforce_id/doctor_id (not
-- tenant_id/doctor_id), with the same "exactly one of the two" CHECK
-- shape. `tenant_id` is still present but purely a denormalized
-- convenience column (same precedent as meetings.tenant_id, migration 45's
-- own header) — set from the workforce row's own tenant at insert time by
-- the client, not itself an ownership signal, and left NULL for
-- doctor-owned rows (an unlinked doctor has no tenant).
--
-- RLS — workforce-owned rows stay fully permissive (USING(true)), matching
-- every other workforce_id-keyed table in this app (submissions,
-- viva_simulations, meeting_actions, ...) per this schema's established
-- posture (see CLAUDE.md's Security Notes). Doctor-owned rows get the
-- SAME real auth.uid()-scoped boundary as every other doctor-owned table
-- in this app (migration 25 -> 31 -> 40 -> here, now used a 4th time) —
-- policy syntax below is copied from migration 40's form_instances
-- policies verbatim, adjusted only for the workforce_id/doctor_id branch
-- condition instead of tenant_id/doctor_id, per CLAUDE.md's own note to
-- copy this pattern's actual syntax rather than write new RLS from
-- scratch. Unlike form_instances (select/insert/update only), these 3
-- tables also get a DELETE policy — a personal task/mood entry/focus
-- session is the person's own private data, not an append-only
-- institutional record, so allowing them to delete their own rows (never
-- someone else's) is the correct default here.
--
-- NOT APPLIED LIVE by this file alone -- applied via .tmp-run-migration.cjs
-- immediately after being written, same as every other migration this
-- session; not left pending for a separate review step.
-- ====================================================================

-- --------------------------------------------------
-- 1. PERSONAL_TASKS
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS personal_tasks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid REFERENCES tenants(id),
  workforce_id uuid REFERENCES workforce(id) ON DELETE CASCADE,
  doctor_id uuid REFERENCES doctor_profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  due_date date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  completed_at timestamptz,
  CONSTRAINT personal_tasks_owner_check CHECK (
    (workforce_id IS NOT NULL AND doctor_id IS NULL) OR (workforce_id IS NULL AND doctor_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_personal_tasks_workforce ON personal_tasks(workforce_id);
CREATE INDEX IF NOT EXISTS idx_personal_tasks_doctor ON personal_tasks(doctor_id);

ALTER TABLE personal_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "personal_tasks_select" ON personal_tasks;
CREATE POLICY "personal_tasks_select" ON personal_tasks FOR SELECT TO anon, authenticated
  USING (workforce_id IS NOT NULL OR (doctor_id IS NOT NULL AND auth.uid() = doctor_id));
DROP POLICY IF EXISTS "personal_tasks_insert" ON personal_tasks;
CREATE POLICY "personal_tasks_insert" ON personal_tasks FOR INSERT TO anon, authenticated
  WITH CHECK (workforce_id IS NOT NULL OR (doctor_id IS NOT NULL AND auth.uid() = doctor_id));
DROP POLICY IF EXISTS "personal_tasks_update" ON personal_tasks;
CREATE POLICY "personal_tasks_update" ON personal_tasks FOR UPDATE TO anon, authenticated
  USING (workforce_id IS NOT NULL OR (doctor_id IS NOT NULL AND auth.uid() = doctor_id))
  WITH CHECK (workforce_id IS NOT NULL OR (doctor_id IS NOT NULL AND auth.uid() = doctor_id));
DROP POLICY IF EXISTS "personal_tasks_delete" ON personal_tasks;
CREATE POLICY "personal_tasks_delete" ON personal_tasks FOR DELETE TO anon, authenticated
  USING (workforce_id IS NOT NULL OR (doctor_id IS NOT NULL AND auth.uid() = doctor_id));

-- --------------------------------------------------
-- 2. WELLBEING_ENTRIES
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS wellbeing_entries (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid REFERENCES tenants(id),
  workforce_id uuid REFERENCES workforce(id) ON DELETE CASCADE,
  doctor_id uuid REFERENCES doctor_profiles(id) ON DELETE CASCADE,
  entry_date date NOT NULL DEFAULT current_date,
  mood text CHECK (mood IN ('great', 'good', 'okay', 'low', 'bad')),
  sleep_hours numeric(4,1) CHECK (sleep_hours IS NULL OR (sleep_hours >= 0 AND sleep_hours <= 24)),
  journal_note text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT wellbeing_entries_owner_check CHECK (
    (workforce_id IS NOT NULL AND doctor_id IS NULL) OR (workforce_id IS NULL AND doctor_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_wellbeing_entries_workforce ON wellbeing_entries(workforce_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_wellbeing_entries_doctor ON wellbeing_entries(doctor_id, entry_date);

ALTER TABLE wellbeing_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wellbeing_entries_select" ON wellbeing_entries;
CREATE POLICY "wellbeing_entries_select" ON wellbeing_entries FOR SELECT TO anon, authenticated
  USING (workforce_id IS NOT NULL OR (doctor_id IS NOT NULL AND auth.uid() = doctor_id));
DROP POLICY IF EXISTS "wellbeing_entries_insert" ON wellbeing_entries;
CREATE POLICY "wellbeing_entries_insert" ON wellbeing_entries FOR INSERT TO anon, authenticated
  WITH CHECK (workforce_id IS NOT NULL OR (doctor_id IS NOT NULL AND auth.uid() = doctor_id));
DROP POLICY IF EXISTS "wellbeing_entries_update" ON wellbeing_entries;
CREATE POLICY "wellbeing_entries_update" ON wellbeing_entries FOR UPDATE TO anon, authenticated
  USING (workforce_id IS NOT NULL OR (doctor_id IS NOT NULL AND auth.uid() = doctor_id))
  WITH CHECK (workforce_id IS NOT NULL OR (doctor_id IS NOT NULL AND auth.uid() = doctor_id));
DROP POLICY IF EXISTS "wellbeing_entries_delete" ON wellbeing_entries;
CREATE POLICY "wellbeing_entries_delete" ON wellbeing_entries FOR DELETE TO anon, authenticated
  USING (workforce_id IS NOT NULL OR (doctor_id IS NOT NULL AND auth.uid() = doctor_id));

-- --------------------------------------------------
-- 3. FOCUS_SESSIONS
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS focus_sessions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid REFERENCES tenants(id),
  workforce_id uuid REFERENCES workforce(id) ON DELETE CASCADE,
  doctor_id uuid REFERENCES doctor_profiles(id) ON DELETE CASCADE,
  duration_minutes integer NOT NULL CHECK (duration_minutes > 0),
  goal_label text,
  completed_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT focus_sessions_owner_check CHECK (
    (workforce_id IS NOT NULL AND doctor_id IS NULL) OR (workforce_id IS NULL AND doctor_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_focus_sessions_workforce ON focus_sessions(workforce_id, completed_at);
CREATE INDEX IF NOT EXISTS idx_focus_sessions_doctor ON focus_sessions(doctor_id, completed_at);

ALTER TABLE focus_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "focus_sessions_select" ON focus_sessions;
CREATE POLICY "focus_sessions_select" ON focus_sessions FOR SELECT TO anon, authenticated
  USING (workforce_id IS NOT NULL OR (doctor_id IS NOT NULL AND auth.uid() = doctor_id));
DROP POLICY IF EXISTS "focus_sessions_insert" ON focus_sessions;
CREATE POLICY "focus_sessions_insert" ON focus_sessions FOR INSERT TO anon, authenticated
  WITH CHECK (workforce_id IS NOT NULL OR (doctor_id IS NOT NULL AND auth.uid() = doctor_id));
DROP POLICY IF EXISTS "focus_sessions_delete" ON focus_sessions;
CREATE POLICY "focus_sessions_delete" ON focus_sessions FOR DELETE TO anon, authenticated
  USING (workforce_id IS NOT NULL OR (doctor_id IS NOT NULL AND auth.uid() = doctor_id));
-- No UPDATE policy: a completed focus session is an append-only log entry,
-- same "no editing history" posture as viva_simulations (migration 05) —
-- there's nothing about a finished session that should ever change.

-- ====================================================================
-- END OF MIGRATION 51
-- ====================================================================
