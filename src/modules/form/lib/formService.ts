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

  // Also include global seed templates (tenant_id IS NULL AND doctor_id IS
  // NULL, migration 42) alongside this tenant's own rows — an .eq() alone
  // makes every seeded template invisible to every tenant, defeating the
  // point of seeding them. Found via the living-system re-audit
  // (2026-08-17) after the identical bug was confirmed and fixed for
  // scheduling_instances (migration 55) — same root cause here.
  const { data, error } = await supabase!
    .from('form_instances')
    .select('*')
    .or(`tenant_id.eq.${tenantId},and(tenant_id.is.null,doctor_id.is.null)`)
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

// Added for the ResidentFormView.tsx dual-write (submissions -> form_entries,
// additive/mirroring only — see that file's own comment for the full
// rationale). Looks up a form_instances row by its exact name rather than by
// id, since the legacy submissions flow has no stored form_instances.id to
// reference — it only knows the seeded instance's name
// ("Monthly Rotation & Leave Schedule Form", migration 35's seed row).
export async function getFormInstanceByName(tenantId: string, name: string): Promise<FormInstance | null> {
  checkSupabase();

  const { data, error } = await supabase!
    .from('form_instances')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('name', name)
    .maybeSingle();

  if (error) {
    console.warn('Error fetching form instance by name:', error);
    throw error;
  }
  return data;
}

// Doctor-owned personal Forms instances (migration 40) — extends the
// established doctor-ownership pattern (migration 25's
// research_workspaces/casebook_workspaces, migration 31's child-table join
// policies) to the Forms module, per
// PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md §7's "tenant scope: individual"
// customisation line. Mirrors listFormInstances/createFormInstance above
// but keyed by doctor_id instead of tenant_id — see migration 40's header
// for the schema/RLS rationale. No doctor-scoped equivalent of
// getFormEntries/createFormEntry is added here: this task's scope is
// create + list only (same first-slice scope FormsBuilderPanel.tsx shipped
// with for the org side), not an entry-submission flow.
export async function listFormInstancesForDoctor(doctorId: string): Promise<FormInstance[]> {
  checkSupabase();

  // Same global-template visibility fix as listFormInstances above.
  const { data, error } = await supabase!
    .from('form_instances')
    .select('*')
    .or(`doctor_id.eq.${doctorId},and(tenant_id.is.null,doctor_id.is.null)`)
    .order('created_at', { ascending: true });

  if (error) {
    console.warn('Error fetching doctor form instances:', error);
    throw error;
  }
  return data || [];
}

export async function createFormInstanceForDoctor(
  doctorId: string,
  name: string,
  schema: FormInstanceSchema
): Promise<FormInstance> {
  checkSupabase();

  const { data, error } = await supabase!
    .from('form_instances')
    .insert({
      doctor_id: doctorId,
      tenant_id: null,
      name,
      schema,
      created_by_workforce_id: null,
    })
    .select()
    .single();

  if (error) {
    console.warn('Error creating doctor form instance:', error);
    throw error;
  }
  return data;
}

// Doctor-owned equivalent of createFormEntry below, for a personal
// (tenant_id-NULL, doctor_id-set) form_instances row (migration 40). No
// tenantId/submittedByWorkforceId params — a bare doctor has neither; RLS
// on form_entries derives ownership by joining instance_id back to
// form_instances.doctor_id (see migration 40's header), so the row itself
// needs no owner column. Powers DoctorFormsBuilderPanel.tsx's fill-in-and-
// submit flow. Deliberately a separate function rather than an optional-arg
// overload of createFormEntry, so the org-side call sites (currently none
// yet, but the dual-write path is analogous) keep their existing required
// signature unchanged.
export async function createFormEntryForDoctor(
  instanceId: string,
  payload: Record<string, unknown>
): Promise<FormEntry> {
  checkSupabase();

  const { data, error } = await supabase!
    .from('form_entries')
    .insert({
      instance_id: instanceId,
      tenant_id: null,
      submitted_by_workforce_id: null,
      payload,
    })
    .select()
    .single();

  if (error) {
    console.warn('Error creating doctor form entry:', error);
    throw error;
  }
  return data;
}

// Inserts one form_entries row. Used by the ResidentFormView.tsx dual-write
// to mirror a real submissions write into the generic Forms scaffold —
// callers are expected to wrap this in their own try/catch and treat any
// failure as non-fatal (log + continue), since form_entries is not the
// source of truth for the live monthly submission flow.
export async function createFormEntry(
  instanceId: string,
  tenantId: string,
  submittedByWorkforceId: string | null,
  payload: Record<string, unknown>
): Promise<FormEntry> {
  checkSupabase();

  const { data, error } = await supabase!
    .from('form_entries')
    .insert({
      instance_id: instanceId,
      tenant_id: tenantId,
      submitted_by_workforce_id: submittedByWorkforceId,
      payload,
    })
    .select()
    .single();

  if (error) {
    console.warn('Error creating form entry:', error);
    throw error;
  }
  return data;
}
