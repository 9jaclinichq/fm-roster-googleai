// Viva-simulator domain service (Modularization Phase 4D) — extracted
// verbatim from src/lib/databaseService.ts's MOCK VIVA ORAL EXAM SIMULATOR
// and VIVA VIGNETTE BANK sections. Spread into the databaseService object
// facade (see databaseService.ts) so every existing `databaseService.X(...)`
// call site keeps working unchanged — this file is not imported directly by
// any application call site in this slice.
import { checkSupabase, supabase } from '../databaseService';
import { VivaSimulation, ScoringBreakdown, VivaVignette } from '../../types';

export const vivaSimulatorService = {
  async createVivaSimulation(entry: {
    workforce_id: string;
    case_title: string;
    category?: string | null;
    duration_seconds?: number | null;
    scoring_breakdown: ScoringBreakdown;
    feedback_summary?: string | null;
  }): Promise<VivaSimulation> {
    checkSupabase();

    // The sync_oral_practice_score trigger recomputes exam_readiness's
    // running average as soon as this insert commits.
    const { data, error } = await supabase!
      .from('viva_simulations')
      .insert([entry])
      .select()
      .single();

    if (error) {
      console.warn('Error recording viva simulation:', error);
      throw error;
    }
    return data;
  },

  async getVivaSimulations(workforceId: string): Promise<VivaSimulation[]> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('viva_simulations')
      .select('*')
      .eq('workforce_id', workforceId)
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('Error fetching viva simulations:', error);
      throw error;
    }
    return data || [];
  },

  // --- VIVA VIGNETTE BANK (migration 28) ---
  // Reads are permissive (global + every tenant's vignettes, filtered
  // client-side by the caller — same pattern as getResearchTemplates());
  // writes go through SECURITY DEFINER RPCs since this table has no
  // INSERT/UPDATE/DELETE RLS policy at all (see migration 28's header).
  async getVivaVignettes(): Promise<VivaVignette[]> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('viva_vignettes')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      console.warn('Error fetching viva vignettes:', error);
      throw error;
    }
    return data || [];
  },

  async chiefCreateVivaVignette(
    adminCode: string,
    entry: { title: string; category: string; scenario: string; prompts: string[] }
  ): Promise<VivaVignette> {
    checkSupabase();

    const { data, error } = await supabase!.rpc('chief_create_viva_vignette', {
      p_admin_code: adminCode,
      p_title: entry.title,
      p_category: entry.category,
      p_scenario: entry.scenario,
      p_prompts: entry.prompts,
    });

    if (error) {
      console.warn('Error creating viva vignette:', error);
      throw error;
    }
    return data;
  },

  async chiefUpdateVivaVignette(
    adminCode: string,
    vignetteId: string,
    entry: { title: string; category: string; scenario: string; prompts: string[] }
  ): Promise<VivaVignette> {
    checkSupabase();

    const { data, error } = await supabase!.rpc('chief_update_viva_vignette', {
      p_admin_code: adminCode,
      p_vignette_id: vignetteId,
      p_title: entry.title,
      p_category: entry.category,
      p_scenario: entry.scenario,
      p_prompts: entry.prompts,
    });

    if (error) {
      console.warn('Error updating viva vignette:', error);
      throw error;
    }
    return data;
  },

  async chiefDeleteVivaVignette(adminCode: string, vignetteId: string): Promise<void> {
    checkSupabase();

    const { error } = await supabase!.rpc('chief_delete_viva_vignette', {
      p_admin_code: adminCode,
      p_vignette_id: vignetteId,
    });

    if (error) {
      console.warn('Error deleting viva vignette:', error);
      throw error;
    }
  },
};
