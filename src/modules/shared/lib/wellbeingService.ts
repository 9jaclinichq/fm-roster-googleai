import { supabase } from '../../../lib/databaseService';

// Wellbeing module (migration 51) — a NEW, additive data-access slice for
// the generic wellbeing_entries table (mood check-in + sleep tracking), per
// this session's "Workspc" reference study (see migration 51's own header
// for the full 4-module selection rationale). Kept as its own module slice
// rather than added to src/lib/databaseService.ts, same "additive, sits
// alongside" precedent as formService.ts/meetingsService.ts since the
// Living-System initiative (migrations 32-40) — see CLAUDE.md.
//
// OWNERSHIP: workforce_id/doctor_id, exactly one set — see migration 51's
// header for why this differs from the tenant_id/doctor_id shape used by
// research_workspaces/form_instances (a mood check-in always belongs to one
// PERSON, never "the org").
//
// ONE ENTRY PER PERSON PER DAY: entry_date is the natural key for a given
// owner. upsertTodaysEntry below checks for today's existing row first and
// updates it if found, matching migration 51's "meant to be updatable, not
// a new row every time someone re-opens the app" intent — this is done as
// an explicit select-then-update/insert rather than a DB-level upsert()
// since there's no unique constraint on (owner, entry_date) to target with
// onConflict.

function checkSupabase() {
  if (!supabase) {
    throw new Error('Supabase is not configured yet. Please provide VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment variables.');
  }
}

export interface WellbeingOwnerRef {
  workforceId?: string;
  doctorId?: string;
  tenantId?: string; // only meaningful for workforce owner
}

export type MoodValue = 'great' | 'good' | 'okay' | 'low' | 'bad';

export interface WellbeingEntryRow {
  id: string;
  entry_date: string;
  mood: MoodValue | null;
  sleep_hours: number | null;
  journal_note: string | null;
  created_at: string;
}

function todayIso(): string {
  return new Date().toISOString().split('T')[0];
}

function applyOwnerFilter(query: any, owner: WellbeingOwnerRef) {
  if (owner.workforceId) return query.eq('workforce_id', owner.workforceId);
  if (owner.doctorId) return query.eq('doctor_id', owner.doctorId);
  throw new Error('WellbeingOwnerRef requires either workforceId or doctorId.');
}

// Finds or creates today's entry for the given owner and applies `updates`
// to it, returning the resulting row either way.
export async function upsertTodaysEntry(
  owner: WellbeingOwnerRef,
  updates: { mood?: MoodValue; sleep_hours?: number | null; journal_note?: string | null }
): Promise<WellbeingEntryRow> {
  checkSupabase();
  const today = todayIso();

  let existingQuery = supabase!
    .from('wellbeing_entries')
    .select('id')
    .eq('entry_date', today);
  existingQuery = applyOwnerFilter(existingQuery, owner);

  const { data: existing, error: findError } = await existingQuery.maybeSingle();

  if (findError) {
    console.warn('Error checking for existing wellbeing entry:', findError);
    throw findError;
  }

  if (existing) {
    const { data, error } = await supabase!
      .from('wellbeing_entries')
      .update(updates)
      .eq('id', existing.id)
      .select()
      .single();

    if (error) {
      console.warn('Error updating wellbeing entry:', error);
      throw error;
    }
    return data;
  }

  const { data, error } = await supabase!
    .from('wellbeing_entries')
    .insert({
      workforce_id: owner.workforceId ?? null,
      doctor_id: owner.doctorId ?? null,
      tenant_id: owner.workforceId ? (owner.tenantId ?? null) : null,
      entry_date: today,
      ...updates,
    })
    .select()
    .single();

  if (error) {
    console.warn('Error creating wellbeing entry:', error);
    throw error;
  }
  return data;
}

// Reads this owner's entries, most recent first, defaulting to the last 14
// calendar days.
export async function getRecentEntries(owner: WellbeingOwnerRef, days: number = 14): Promise<WellbeingEntryRow[]> {
  checkSupabase();

  const since = new Date();
  since.setDate(since.getDate() - (days - 1));
  const sinceIso = since.toISOString().split('T')[0];

  let query = supabase!
    .from('wellbeing_entries')
    .select('*')
    .gte('entry_date', sinceIso)
    .order('entry_date', { ascending: false });
  query = applyOwnerFilter(query, owner);

  const { data, error } = await query;

  if (error) {
    console.warn('Error fetching recent wellbeing entries:', error);
    throw error;
  }
  return data || [];
}
