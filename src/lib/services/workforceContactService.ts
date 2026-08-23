import { supabase } from '../databaseService';

// Chief-facing member email directory (migration 69, WRITTEN LOCALLY ONLY,
// NOT APPLIED — see that file's own header). This is the only sanctioned
// path for a Chief to read a member's actual email: workforce.email has no
// client SELECT grant, and this file never attempts a direct table read of
// it. Kept separate from databaseService.ts (and from
// submissionReviewService.ts, which is an unrelated concern) per the
// newer-module service-extraction precedent already established
// (tenantService.ts, myAssignmentService.ts, submissionReviewService.ts).
//
// Returns contacts for every ACTIVE member of the Chief's own tenant, not
// only the currently-pending subset — see migration 69's own header for
// why: this repo currently has two different "current collection"
// resolution rules (submissionStatus.ts's canonical one vs.
// ChiefDashboardView's own looser activeColl fallback), so re-deriving
// "pending" a second time in SQL risked disagreeing with whichever set is
// already rendered on screen. The caller (ChiefDashboardView) joins this
// result against its own existing, already-displayed pending-member list
// by workforce_id — never renders it standalone.

export interface WorkforceContact {
  workforce_id: string;
  email: string | null;
}

export const workforceContactService = {
  async getActiveMemberContacts(adminCode: string): Promise<WorkforceContact[]> {
    const { data, error } = await supabase!.rpc('chief_get_active_member_contacts', {
      p_admin_code: adminCode,
    });

    if (error) {
      console.warn('Error fetching active member contacts:', error);
      throw error;
    }
    return (data || []) as WorkforceContact[];
  },
};
