import { supabase } from '../../../lib/databaseService';
import type { GopClinicGrid, EmergencyCallGrid, SupervisionGrid, SatelliteGrid } from '../../../types';

// Full Roster (member-facing) — read-only client for
// resident_get_current_full_roster() (migration 73, WRITTEN LOCALLY ONLY,
// NOT APPLIED — see that file's own header). Sibling to
// myAssignmentService.ts, same file, same conventions, deliberately kept
// out of databaseService.ts and rosterReconciliation.ts for the same
// reason that file already documents.
//
// SECURITY: this file never reads combined_master_rosters directly and
// never will — every call goes through the SECURITY DEFINER RPC, the only
// sanctioned path for a member to see roster data (see migration 73's
// header for why a direct table read would leak every tenant's full
// roster, including drafts). There is no parameter here for "which
// tenant's roster" other than the caller's own (workforceId, code) pair —
// this file cannot be used to request another tenant's roster, because
// the RPC itself derives tenant only from the verified workforce row.
//
// NAME RESOLUTION: unlike the raw storage shape (where GOP/A&E/Satellite
// assignee arrays hold workforce_id strings), the RPC already resolves
// every id to that member's full_name server-side before returning — so
// the grid shapes below are structurally identical to the stored
// GopClinicGrid/EmergencyCallGrid/SupervisionGrid/SatelliteGrid types,
// but their assignee arrays contain DISPLAY NAMES, not ids. Reused as-is
// (not redeclared) since the shapes are otherwise byte-identical.

export type FullRosterStatus = 'not_published' | 'published';

export interface FullRosterResult {
  status: FullRosterStatus;
  month: number | null;
  year: number | null;
  gop_clinic_grid: GopClinicGrid;
  emergency_call_grid: EmergencyCallGrid;
  supervision_grid: SupervisionGrid;
  satellite_grid: SatelliteGrid;
}

const EMPTY_GOP: GopClinicGrid = { slots: [], unparsed_notes: [] };
const EMPTY_EMERGENCY: EmergencyCallGrid = { shifts: [], unparsed_notes: [] };
const EMPTY_SUPERVISION: SupervisionGrid = { duties: [], unparsed_notes: [] };
const EMPTY_SATELLITE: SatelliteGrid = { postings: [], unparsed_notes: [] };

export const fullRosterService = {
  // Migration 79: code is now string | null — a restored session with no
  // PIN in memory (an authenticated, previously-claimed resident) passes
  // null. The RPC's own authenticated-membership-first check runs before
  // it ever inspects p_code, so a null/absent code is only ever a problem
  // if that check also doesn't match (an unclaimed or legacy-only
  // caller), in which case the RPC raises its existing 'Invalid access
  // code' error exactly as it already does for a wrong code today.
  async getCurrentFullRoster(workforceId: string, code: string | null): Promise<FullRosterResult> {
    const { data, error } = await supabase!.rpc('resident_get_current_full_roster', {
      p_workforce_id: workforceId,
      p_code: code,
    });

    if (error) {
      console.warn('Error fetching current full roster:', error);
      throw error;
    }

    const row = data?.[0];
    return {
      status: (row?.status as FullRosterStatus) ?? 'not_published',
      month: row?.month ?? null,
      year: row?.year ?? null,
      gop_clinic_grid: row?.gop_clinic_grid ?? EMPTY_GOP,
      emergency_call_grid: row?.emergency_call_grid ?? EMPTY_EMERGENCY,
      supervision_grid: row?.supervision_grid ?? EMPTY_SUPERVISION,
      satellite_grid: row?.satellite_grid ?? EMPTY_SATELLITE,
    };
  },
};
