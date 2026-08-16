import { supabase } from '../../../lib/databaseService';

// Focus Mode module (migration 51, focus_sessions table) — a NEW, additive
// data-access slice for a Pomodoro-style deep-work timer, one of 4 modules
// selected from the "Workspc" Flutter reference study (see migration 51's
// own header for the full selection rationale). Structure mirrors
// meetingsService.ts / formService.ts (checkSupabase() guard, typed
// exported functions, doc comments per function) — kept as its own module
// slice under src/modules/shared/lib rather than added to
// src/lib/databaseService.ts, same "additive, sits alongside" precedent
// every module under src/modules/ has followed since the Living-System
// initiative (migrations 32-40) — see CLAUDE.md.
//
// OWNERSHIP: focus_sessions is workforce_id/doctor_id-owned (exactly one
// set, DB-enforced CHECK) — NOT tenant_id/doctor_id like the research/
// casebook/form-instance ownership pattern, because a focus session always
// belongs to exactly one PERSON, never an organization broadly. See
// migration 51's header for the full rationale. `tenant_id` is a purely
// denormalized convenience column, only meaningful (and only ever set) for
// workforce-owned rows — left null for doctor-owned rows.
//
// APPEND-ONLY: focus_sessions has no UPDATE policy at the DB layer (a
// completed session is a log entry, never edited after the fact) — this
// file deliberately exposes no updateFocusSession function to match.

function checkSupabase() {
  if (!supabase) {
    throw new Error('Supabase is not configured yet. Please provide VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment variables.');
  }
}

export interface FocusSessionOwnerRef {
  workforceId?: string;
  doctorId?: string;
  tenantId?: string; // only meaningful for workforce owner, denormalized convenience column
}

export interface FocusSessionRow {
  id: string;
  duration_minutes: number;
  goal_label: string | null;
  completed_at: string;
}

const DEFAULT_SINCE_DAYS = 30;

// Logs one completed (or manually-ended, per the caller's own
// minimum-elapsed-time rule — see FocusModeView.tsx) focus session. Exactly
// one of owner.workforceId / owner.doctorId is expected to be set, matching
// the DB CHECK constraint; owner.tenantId is only carried through for a
// workforce owner.
export async function logFocusSession(
  owner: FocusSessionOwnerRef,
  durationMinutes: number,
  goalLabel?: string | null
): Promise<FocusSessionRow> {
  checkSupabase();

  const { data, error } = await supabase!
    .from('focus_sessions')
    .insert({
      tenant_id: owner.tenantId ?? null,
      workforce_id: owner.workforceId ?? null,
      doctor_id: owner.doctorId ?? null,
      duration_minutes: durationMinutes,
      goal_label: goalLabel ?? null,
    })
    .select('id, duration_minutes, goal_label, completed_at')
    .single();

  if (error) {
    console.warn('Error logging focus session:', error);
    throw error;
  }
  return data;
}

// Reads focus sessions for this owner (workforce or doctor, whichever is
// set on the ref), most recent first, optionally windowed to the last
// sinceDays days (default 30). Used both to render session history and to
// derive today's count/total minutes client-side.
export async function getFocusSessionsForOwner(
  owner: FocusSessionOwnerRef,
  sinceDays: number = DEFAULT_SINCE_DAYS
): Promise<FocusSessionRow[]> {
  checkSupabase();

  let query = supabase!
    .from('focus_sessions')
    .select('id, duration_minutes, goal_label, completed_at');

  if (owner.workforceId) {
    query = query.eq('workforce_id', owner.workforceId);
  } else if (owner.doctorId) {
    query = query.eq('doctor_id', owner.doctorId);
  } else {
    throw new Error('getFocusSessionsForOwner requires either workforceId or doctorId to be set.');
  }

  if (sinceDays > 0) {
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
    query = query.gte('completed_at', since);
  }

  const { data, error } = await query.order('completed_at', { ascending: false });

  if (error) {
    console.warn('Error fetching focus sessions:', error);
    throw error;
  }
  return data || [];
}
