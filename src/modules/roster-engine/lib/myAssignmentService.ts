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
  date_or_day: string;
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
