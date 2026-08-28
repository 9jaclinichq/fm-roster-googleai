import { supabase } from '../../../lib/databaseService';
import type { RosterRevision, GopClinicGrid, EmergencyCallGrid, SupervisionGrid, SatelliteGrid } from '../../../types';

// Chief-facing, admin-code-verified client for the 4 roster_revisions RPCs
// (migration 75, WRITTEN LOCALLY ONLY, NOT APPLIED — see that file's own
// header). Imported directly by MultiRosterManagerView.tsx, matching that
// file's own existing convention of importing roster-engine/lib functions
// directly rather than through the databaseService facade (it already
// does this for the parser/reconciliation/identity-ingest functions).
//
// SECURITY: this file never reads/writes roster_revisions directly — that
// table has RLS enabled with zero policies (same posture as
// roster_section_config, migration 74), so a direct client read/write
// would fail regardless. Every call re-verifies the Chief's admin code
// server-side and derives tenant/collection only from that verified
// code — there is no parameter anywhere in this file for "which tenant"
// or "which collection," only "which revision" (for save/discard/
// publish), and every one of those lookups is itself tenant-scoped
// inside the RPC.

export const rosterRevisionService = {
  async startRevision(adminCode: string): Promise<RosterRevision> {
    const { data, error } = await supabase!.rpc('chief_start_roster_revision', {
      p_admin_code: adminCode,
    });
    if (error) {
      console.warn('Error starting roster revision:', error);
      throw error;
    }
    return data;
  },

  async saveRevision(
    adminCode: string,
    revisionId: string,
    expectedUpdatedAt: string,
    grids: { gop_clinic_grid: GopClinicGrid; emergency_call_grid: EmergencyCallGrid; supervision_grid: SupervisionGrid; satellite_grid: SatelliteGrid },
    changeReason?: string | null
  ): Promise<RosterRevision> {
    const { data, error } = await supabase!.rpc('chief_save_roster_revision', {
      p_admin_code: adminCode,
      p_revision_id: revisionId,
      p_expected_updated_at: expectedUpdatedAt,
      p_gop_clinic_grid: grids.gop_clinic_grid,
      p_emergency_call_grid: grids.emergency_call_grid,
      p_supervision_grid: grids.supervision_grid,
      p_satellite_grid: grids.satellite_grid,
      p_change_reason: changeReason ?? null,
    });
    if (error) {
      console.warn('Error saving roster revision:', error);
      throw error;
    }
    return data;
  },

  async discardRevision(adminCode: string, revisionId: string): Promise<RosterRevision> {
    const { data, error } = await supabase!.rpc('chief_discard_roster_revision', {
      p_admin_code: adminCode,
      p_revision_id: revisionId,
    });
    if (error) {
      console.warn('Error discarding roster revision:', error);
      throw error;
    }
    return data;
  },

  async publishRevision(adminCode: string, revisionId: string, expectedUpdatedAt: string): Promise<RosterRevision> {
    const { data, error } = await supabase!.rpc('chief_publish_roster_revision', {
      p_admin_code: adminCode,
      p_revision_id: revisionId,
      p_expected_updated_at: expectedUpdatedAt,
    });
    if (error) {
      console.warn('Error publishing roster revision:', error);
      throw error;
    }
    return data;
  },
};
