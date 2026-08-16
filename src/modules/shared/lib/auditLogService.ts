import { supabase } from '../../../lib/databaseService';

// L3 "Spine" read-out — the counterpart to eventBus.ts's write-only
// `emitEvent`. Backs `event_log` (supabase/migrations/32_event_log.sql).
//
// eventBus.ts's own header notes that nothing in the app has ever read
// `event_log` back out — every real agent run (submissionChaserAgent.ts,
// meetingActionAgent.ts) has been writing into this table with zero
// visibility for the org that owns those agents. This is the first reader:
// a simple tenant-scoped "what have my agents actually done" listing, no
// filtering/pagination/aggregation beyond a reverse-chronological limit.
//
// Deliberately its own file rather than added to eventBus.ts — that file is
// scoped as "just a typed insert wrapper" per its own header, and to
// databaseService.ts's existing god-file growth pattern this repo has been
// moving away from (see formService.ts/meetingsService.ts's own headers for
// the same "new, additive slice" precedent this follows).

export interface EventLogRow {
  id: string;
  tenant_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
  source: string | null;
  agent_ref: string | null;
  created_at: string;
}

function checkSupabase() {
  if (!supabase) {
    throw new Error('Supabase is not configured yet. Please provide VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment variables.');
  }
}

/**
 * Lists the most recent `event_log` rows for a tenant, newest first.
 * Defaults to 50 rows; pass `limit` to override.
 */
export async function listRecentEvents(tenantId: string, limit: number = 50): Promise<EventLogRow[]> {
  checkSupabase();

  const { data, error } = await supabase!
    .from('event_log')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('Error fetching event_log rows:', error);
    throw error;
  }
  return data || [];
}
