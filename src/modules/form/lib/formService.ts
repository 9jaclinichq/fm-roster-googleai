import { supabase } from '../../../lib/databaseService';
import { FormInstance, FormInstanceSchema, FormEntry } from '../../../types';

// Forms module generalization (migration 35) — a NEW, additive data-access
// slice for the generic form_instances/form_entries/form_pipelines tables.
// Deliberately kept separate from src/lib/databaseService.ts rather than
// added to it: the existing monthly-form flow (submissions/collections,
// ResidentFormView.tsx) is untouched by this pass, and mixing this scaffold
// into the god-file risked implying a rewire that hasn't happened. See
// migration 35's own header and CLAUDE.md's Casebook & Logbook Engine
// section for the "additive, sits alongside" precedent this follows.
//
// This imports the shared `supabase` client that databaseService.ts already
// exports, rather than creating a second client instance — there is no
// dedicated `shared/supabaseClient.ts` extraction yet (see
// docs/MODULARIZATION_ARCHITECTURE.md's Phase 4, not started), so this is
// the correct single-client import today.
//
// Not yet wired into any live UI beyond FormsBuilderPanel.tsx (first
// slice — lists instances, creates new ones). `getFormEntries` exists for
// that panel's eventual "view submissions" affordance but isn't called by
// the panel's first cut. No update/delete for instances or entries yet —
// first slice is create + list only, per the task's own "minimal, not the
// full spec's eventual richness" scope.

function checkSupabase() {
  if (!supabase) {
    throw new Error('Supabase is not configured yet. Please provide VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment variables.');
  }
}

export async function listFormInstances(tenantId: string): Promise<FormInstance[]> {
  checkSupabase();

  const { data, error } = await supabase!
    .from('form_instances')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true });

  if (error) {
    console.warn('Error fetching form instances:', error);
    throw error;
  }
  return data || [];
}

export async function createFormInstance(
  tenantId: string,
  name: string,
  schema: FormInstanceSchema,
  createdByWorkforceId: string | null
): Promise<FormInstance> {
  checkSupabase();

  const { data, error } = await supabase!
    .from('form_instances')
    .insert({
      tenant_id: tenantId,
      name,
      schema,
      created_by_workforce_id: createdByWorkforceId,
    })
    .select()
    .single();

  if (error) {
    console.warn('Error creating form instance:', error);
    throw error;
  }
  return data;
}

export async function getFormEntries(instanceId: string): Promise<FormEntry[]> {
  checkSupabase();

  const { data, error } = await supabase!
    .from('form_entries')
    .select('*')
    .eq('instance_id', instanceId)
    .order('created_at', { ascending: false });

  if (error) {
    console.warn('Error fetching form entries:', error);
    throw error;
  }
  return data || [];
}
