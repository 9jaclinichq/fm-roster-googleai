// Exam-readiness domain service (Modularization Phase 4C) — extracted
// verbatim from src/lib/databaseService.ts's EXAM READINESS section. Spread
// into the databaseService object facade (see databaseService.ts) so every
// existing `databaseService.X(...)` call site keeps working unchanged —
// this file is not imported directly by any application call site in this
// slice.
//
// getOrCreateExamReadiness()'s retry self-call (`this.getOrCreateExamReadiness(...)`)
// is preserved exactly as-is. Empirically verified before this extraction
// landed: under the spread-composition pattern, `this` resolves to whichever
// facade object the caller invoked through (databaseService.X() binds
// `this` to databaseService for the entire recursive chain, identical to
// the pre-extraction single-object-literal shape) — not rewritten to a
// direct object-property reference, since the existing behavior is already
// correct and this task's own instruction is to preserve it exactly.
import { checkSupabase, supabase } from '../databaseService';
import { ExamReadiness } from '../../types';

export const examReadinessService = {
  async getOrCreateExamReadiness(workforceId: string): Promise<ExamReadiness> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('exam_readiness')
      .select('*')
      .eq('workforce_id', workforceId)
      .maybeSingle();

    if (error) {
      console.warn('Error fetching exam readiness:', error);
      throw error;
    }
    if (data) return data;

    // Upsert rather than a plain insert: two near-simultaneous callers (two
    // tabs opening the Exam Readiness view) can both see no existing row
    // above before either write lands. A plain insert would throw a raw
    // 23505 on the loser (exam_readiness.workforce_id is UNIQUE — see
    // upsertExamReadiness's onConflict target below); upserting on the same
    // conflict target makes the loser just return the winner's row instead.
    const { data: created, error: createErr } = await supabase!
      .from('exam_readiness')
      .upsert([{ workforce_id: workforceId }], { onConflict: 'workforce_id', ignoreDuplicates: true })
      .select()
      .maybeSingle();

    if (createErr) {
      console.warn('Error creating exam readiness record:', createErr);
      throw createErr;
    }
    if (created) return created;

    // ignoreDuplicates:true returns no row when another request already won
    // the race — fetch what that request created.
    const existing = await this.getOrCreateExamReadiness(workforceId);
    return existing;
  },

  async upsertExamReadiness(
    workforceId: string,
    updates: Partial<Pick<ExamReadiness, 'evidemy_completed_count' | 'evidemy_total_required' | 'physical_logbook_verified' | 'exam_fees_paid' | 'college_forms_submitted'>>
  ): Promise<ExamReadiness> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('exam_readiness')
      .upsert([{ workforce_id: workforceId, ...updates }], { onConflict: 'workforce_id' })
      .select()
      .single();

    if (error) {
      console.warn('Error updating exam readiness:', error);
      throw error;
    }
    return data;
  },
};
