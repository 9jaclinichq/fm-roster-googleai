import { supabase } from '../databaseService';
import { SubmissionReviewStatus } from '../../types';

// Submission review_status (migration 68, locked 2026-08-22) — administrative
// metadata only for the Chief/admin submissions workflow. Kept separate from
// databaseService.ts's existing submissions functions (getSubmissions/
// submitRoster/updateSubmissionDirectly) per this slice's explicit scope
// boundary: a narrow, additive concern, matching the newer-module
// service-extraction precedent (tenantService.ts, myAssignmentService.ts)
// rather than growing that already-large shared file further.
//
// There is deliberately no "mark submitted" / un-review action here — the
// only supported transition is submitted -> reviewed by an authorized
// Chief/admin; the reverse only ever happens automatically, as a side
// effect of a resident's own resubmission (see submitRoster()'s own
// comment), never as a direct admin action.
//
// No new RLS/RPC/admin-code gate: submissions already has fully permissive
// RLS (see migration 68's header), and the existing "edit submission on
// behalf of resident" feature (ChiefDashboardView.tsx) has no separate
// per-action gate either — authorization here is the same as that
// precedent: reachable only from the Chief-authenticated dashboard.

export const submissionReviewService = {
  async markReviewed(submissionId: string): Promise<{ id: string; review_status: SubmissionReviewStatus }> {
    const { data, error } = await supabase!
      .from('submissions')
      .update({ review_status: 'reviewed' })
      .eq('id', submissionId)
      .select('id, review_status')
      .single();

    if (error) {
      console.warn('Error marking submission reviewed:', error);
      throw error;
    }
    return data;
  },
};
