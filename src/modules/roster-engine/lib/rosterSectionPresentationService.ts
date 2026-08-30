import { supabase } from '../../../lib/databaseService';
import { RosterSectionPresentation } from './rosterSectionPresentation';

// Resident-facing, read-only client for
// resident_get_roster_section_presentation() (migration 74, WRITTEN
// LOCALLY ONLY, NOT APPLIED — see that file's own header). Sibling to
// myAssignmentService.ts/fullRosterService.ts, same conventions.
//
// SECURITY: this file never reads roster_section_config directly — that
// table has RLS enabled with zero policies, so a direct client read/write
// would fail regardless. Every call goes through the SECURITY DEFINER
// RPC, which re-verifies (workforceId, code) exactly like every other
// resident RPC in this app and derives tenant only from the verified
// workforce row.

export const rosterSectionPresentationService = {
  // Migration 79: code is now string | null — same authenticated-
  // membership-first coexistence as myAssignmentService.getCurrentAssignment
  // and fullRosterService.getCurrentFullRoster. A null code only fails if
  // the caller also has no matching active membership for this workforce.
  async getResidentPresentation(workforceId: string, code: string | null): Promise<RosterSectionPresentation[]> {
    const { data, error } = await supabase!.rpc('resident_get_roster_section_presentation', {
      p_workforce_id: workforceId,
      p_code: code,
    });

    if (error) {
      console.warn('Error fetching roster section presentation:', error);
      throw error;
    }

    return Array.isArray(data) ? data : [];
  },
};
