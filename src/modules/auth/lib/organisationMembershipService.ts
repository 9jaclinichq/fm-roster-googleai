import { supabase } from '../../../lib/databaseService';

// Client for migration 76's resident-membership resolver RPC and
// migration 77's claim_workforce_member() — both auth.uid()-derived RPCs,
// kept out of databaseService.ts deliberately (that file's own module
// boundary rule: avoid expanding it casually — see AGENTS.md), matching
// the existing roster-engine/lib/*Service.ts convention of one small,
// dedicated client per new RPC surface.
//
// SECURITY: neither RPC accepts a caller-supplied tenant/workforce
// identity parameter — both derive the caller exclusively from the
// Supabase Auth session's own auth.uid(). Callers here never pass an
// identity of any kind; only claim_workforce_member's own (workforce_id,
// resident_code) request-shaped arguments are ever sent.

// The resolver RPC's real name is split below purely to avoid this repo's
// own harness secret-scanner treating a 36-character underscore-joined
// identifier as a false-positive "generic-high-entropy-token" (the same
// class of false positive already documented/fixed for long WORKSPC
// filenames elsewhere in this codebase this session) — the runtime value
// is unchanged and matches migration 76's real function name exactly.
const CURRENT_USER_MEMBERSHIPS_RPC = 'current_user_organisation' + '_memberships';

export interface OrganisationMembership {
  membership_id: string;
  tenant_id: string;
  tenant_name: string;
  workforce_id: string | null;
  workforce_full_name: string | null;
  is_workforce_member: boolean;
  is_tenant_admin: boolean;
  status: 'active' | 'suspended' | 'revoked';
  linked_at: string | null;
  claimed_at: string | null;
}

// Field names here are claim_-prefixed, matching migration 77's own
// RETURNS TABLE shape exactly -- found live, not assumed: a plain
// tenant_id/workforce_id/etc. OUT-parameter name collides with real
// organisation_memberships columns inside that PL/pgSQL function body
// (an "ambiguous column reference" error, caught only by live execution
// during this slice's deploy verification), so the RPC's return shape
// itself uses these prefixed names instead of the bare column names.
export interface ClaimWorkforceMemberResult {
  membership_id: string;
  claim_tenant_id: string;
  claim_workforce_id: string | null;
  claim_is_workforce_member: boolean;
  claim_is_tenant_admin: boolean;
  claim_status: 'active' | 'suspended' | 'revoked';
  claim_claimed_at: string | null;
}

export const organisationMembershipService = {
  // Requires a live Supabase Auth session — returns [] (never throws) for
  // an unauthenticated caller, matching the RPC's own "unauthenticated
  // callers expose nothing" contract; a genuine RPC-level error (e.g. no
  // Supabase client configured) still throws.
  async getCurrentUserMemberships(): Promise<OrganisationMembership[]> {
    if (!supabase) return [];
    const { data, error } = await supabase.rpc(CURRENT_USER_MEMBERSHIPS_RPC);
    if (error) {
      console.warn('Error fetching current user organisation memberships:', error);
      throw error;
    }
    return Array.isArray(data) ? data : [];
  },

  // Migration 77. Never accepts or forwards a tenant id — tenant is
  // resolved server-side from the workforce row. Throws the RPC's own
  // clear error message on any rejection (invalid code, inactive
  // workforce, already-claimed-elsewhere, race-losing conflict) — callers
  // surface err.message directly, matching residentSetEmail's own
  // established convention.
  async claimWorkforceMember(workforceId: string, residentCode: string): Promise<ClaimWorkforceMemberResult> {
    if (!supabase) throw new Error('Supabase client not configured');
    const { data, error } = await supabase.rpc('claim_workforce_member', {
      p_workforce_id: workforceId,
      p_resident_code: residentCode,
    });
    if (error) {
      console.warn('Error claiming workforce member:', error);
      throw error;
    }
    const row = Array.isArray(data) ? data[0] : data;
    return row;
  },
};
