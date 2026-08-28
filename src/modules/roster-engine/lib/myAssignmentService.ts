import { supabase } from '../../../lib/databaseService';

// My Assignment (member-facing) — read-only client for
// resident_get_current_assignment() (migration 67, WRITTEN LOCALLY ONLY,
// NOT APPLIED — see that file's own header). Deliberately kept out of
// databaseService.ts and out of rosterReconciliation.ts: this is a new,
// narrow, read-only slice, not an extension of either existing surface.
// Imports the shared `supabase` client the same way
// src/modules/scheduling/lib/schedulingService.ts already does, rather
// than creating a second client instance.
//
// SECURITY: this file never reads combined_master_rosters directly and
// never will — every call goes through the SECURITY DEFINER RPC, which is
// the only sanctioned path for a member to see roster data (see migration
// 67's header for why a direct table read would leak every tenant's full
// roster). There is no parameter here for "whose assignment to fetch"
// other than the caller's own (workforceId, code) pair — this file cannot
// be used to request another member's assignment, because the RPC itself
// has no such parameter.

export type MyAssignmentStatus = 'not_published' | 'published_no_assignment' | 'published_with_assignment';

export interface MyAssignmentEntry {
  grid_label: string;
  // Migration 72: a Satellite/Special Coverage posting whose source
  // represents a period/range (e.g. "1-30 Sep") rather than a single date
  // has date_or_day = null in the stored roster — the RPC now returns such
  // postings (previously excluded entirely) and passes that null through
  // verbatim rather than fabricating a date. Every consumer must handle
  // date_or_day being null, not just being present.
  date_or_day: string | null;
  // Migration 71: the matched slot's own actual service point / shift /
  // facility / duty position (e.g. a GOP clinic_type, an A&E shift label,
  // a Satellite facility, or the generic "1st On Duty"/"2nd On Duty" for
  // Supervision) — opaque, organization-supplied text, rendered verbatim.
  // Optional/additive: older RPC responses (pre-migration-71, or any
  // future response that genuinely has nothing to report) omit this
  // field entirely, so every consumer must treat it as possibly absent,
  // never assume it exists.
  assignment_detail?: string;
}

export interface MyAssignmentResult {
  status: MyAssignmentStatus;
  month: number | null;
  year: number | null;
  assignments: MyAssignmentEntry[];
}

export const myAssignmentService = {
  async getCurrentAssignment(workforceId: string, code: string): Promise<MyAssignmentResult> {
    const { data, error } = await supabase!.rpc('resident_get_current_assignment', {
      p_workforce_id: workforceId,
      p_code: code,
    });

    if (error) {
      console.warn('Error fetching current assignment:', error);
      throw error;
    }

    const row = data?.[0];
    return {
      status: (row?.status as MyAssignmentStatus) ?? 'not_published',
      month: row?.month ?? null,
      year: row?.year ?? null,
      assignments: Array.isArray(row?.assignments) ? row.assignments : [],
    };
  },
};
