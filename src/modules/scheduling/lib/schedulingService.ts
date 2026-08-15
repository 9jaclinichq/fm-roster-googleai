import { supabase } from '../../../lib/databaseService';

// Scheduling module (migration 44) — a NEW, additive data-access slice for
// the generic scheduling_instances/scheduling_entries/scheduling_pipelines
// tables, per docs/SCHEDULING_MODULE_SCOPING.md's §5 ("Minimum first slice
// for (b)"). Deliberately kept separate from src/lib/databaseService.ts,
// same precedent src/modules/form/lib/formService.ts already set for the
// Forms module generalization — this is a brand-new module folder
// (src/modules/scheduling/), NOT src/modules/roster-engine/, which is
// already taken by the UCH-specific AI-parsing lib
// (uchRosterParser.ts) per the scoping doc's §5.3.
//
// SCOPE — this is purely additive alongside the existing, untouched,
// UCH-specific roster-parsing pipeline (raw_roster_uploads/
// combined_master_rosters, MultiRosterManagerView.tsx, roster-parser Edge
// Function). Nothing in this file reads or writes any of those tables, and
// nothing outside src/modules/scheduling/ imports from this file yet — see
// SchedulingBuilderView.tsx's own header for the "not wired into
// navigation yet" note.
//
// This imports the shared `supabase` client that databaseService.ts
// already exports, rather than creating a second client instance — same
// reasoning formService.ts's own header gives (no dedicated
// shared/supabaseClient.ts extraction yet).
//
// Types are defined and exported here rather than in src/types.ts —
// deliberate scope boundary for this task (this module's first slice is
// authorized to touch only src/modules/scheduling/ and its one migration
// file, not the shared types file). A future pass that wires this module
// into the rest of the app should consider moving these into types.ts
// alongside FormInstance/FormEntry/FormPipeline, which this shape mirrors.

// One entry in scheduling_instances.row_definitions[].
// row_kind is a free-text string interpreted by the builder UI ('person' /
// 'resource' / 'category' in this first slice) — not a foreign key, per
// migration 44's header / scoping doc §5.1.
export interface SchedulingRowDefinition {
  key: string;
  label: string;
  row_kind: string;
}

// One entry in scheduling_instances.column_definitions[].
export interface SchedulingColumnDefinition {
  key: string;
  label: string;
}

// Mirrors scheduling_instances (migration 44). tenant_id/doctor_id: exactly
// one set (institutional / doctor-owned), or both null (global template) —
// same 3-shape convention as FormInstance post-migration-42. The
// doctor-owned shape has no real RLS boundary or UI yet — schema-only, see
// migration 44's own header.
export interface SchedulingInstance {
  id: string;
  tenant_id: string | null;
  doctor_id: string | null;
  name: string;
  schedule_kind: string;
  period_start: string | null;
  period_end: string | null;
  row_definitions: SchedulingRowDefinition[];
  column_definitions: SchedulingColumnDefinition[];
  config: Record<string, unknown>;
  status: string; // 'draft' | 'chief_review' | 'published', free text
  published_at: string | null;
  created_by_workforce_id: string | null;
  created_at: string;
}

// Mirrors scheduling_entries (migration 44) — one row per assignment/cell,
// the crux design decision the scoping doc's §2.2 reasons through
// explicitly (queryable per-cell data, not one big jsonb blob per
// instance). tenant_id/doctor_id are denormalized copies of the owning
// instance's owner columns, same precedent as FormEntry.tenant_id.
export interface SchedulingEntry {
  id: string;
  instance_id: string;
  tenant_id: string | null;
  doctor_id: string | null;
  row_key: string;
  column_key: string;
  row_kind: string | null;
  assignment: Record<string, unknown>;
  source: string; // 'manual' | 'ai_parsed' | 'imported', free text
  unparsed_note: string | null;
  created_at: string;
  updated_at: string;
}

// Mirrors scheduling_pipelines (migration 44). pipeline_type is free text
// (e.g. 'roster_to_priority_list', the scoping doc §2.3's own worked
// example) — not a fixed union, same reasoning as FormPipeline.pipeline_type.
export interface SchedulingPipeline {
  id: string;
  instance_id: string;
  pipeline_type: string;
  config: Record<string, unknown>;
  created_at: string;
}

function checkSupabase() {
  if (!supabase) {
    throw new Error('Supabase is not configured yet. Please provide VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment variables.');
  }
}

// Lists scheduling_instances visible to a given scope. Exactly one of
// tenantId/doctorId is expected in normal use (mirroring the owner-shape
// convention), but both are accepted independently since a caller may only
// know one of them; passing neither returns an empty list rather than every
// row in the table (deliberately not exposing a global "list everything"
// call from this first slice).
export async function listSchedulingInstances(scope: { tenantId?: string; doctorId?: string }): Promise<SchedulingInstance[]> {
  checkSupabase();

  if (!scope.tenantId && !scope.doctorId) {
    return [];
  }

  let query = supabase!.from('scheduling_instances').select('*');
  if (scope.tenantId) {
    query = query.eq('tenant_id', scope.tenantId);
  } else if (scope.doctorId) {
    query = query.eq('doctor_id', scope.doctorId);
  }

  const { data, error } = await query.order('created_at', { ascending: false });

  if (error) {
    console.warn('Error fetching scheduling instances:', error);
    throw error;
  }
  return data || [];
}

export async function createSchedulingInstance(
  scope: { tenantId?: string; doctorId?: string },
  name: string,
  scheduleKind: string,
  periodStart: string | null,
  periodEnd: string | null,
  createdByWorkforceId: string | null = null
): Promise<SchedulingInstance> {
  checkSupabase();

  const { data, error } = await supabase!
    .from('scheduling_instances')
    .insert({
      tenant_id: scope.tenantId ?? null,
      doctor_id: scope.doctorId ?? null,
      name,
      schedule_kind: scheduleKind,
      period_start: periodStart,
      period_end: periodEnd,
      row_definitions: [],
      column_definitions: [],
      config: {},
      status: 'draft',
      created_by_workforce_id: createdByWorkforceId,
    })
    .select()
    .single();

  if (error) {
    console.warn('Error creating scheduling instance:', error);
    throw error;
  }
  return data;
}

export async function getSchedulingEntries(instanceId: string): Promise<SchedulingEntry[]> {
  checkSupabase();

  const { data, error } = await supabase!
    .from('scheduling_entries')
    .select('*')
    .eq('instance_id', instanceId)
    .order('created_at', { ascending: true });

  if (error) {
    console.warn('Error fetching scheduling entries:', error);
    throw error;
  }
  return data || [];
}

// Creates or replaces the entry for a given (instanceId, rowKey, columnKey)
// cell. There is no unique constraint backing this at the database level in
// this first slice (migration 44 does not add one — see its header), so
// this looks up any existing row for the same cell client-side first and
// updates it if found, otherwise inserts a new one. Good enough for this
// manual-entry builder's scale (one Chief/doctor editing their own grid);
// a future pass wiring in concurrent/AI-assisted writers should add a real
// unique index and use a proper upsert instead.
export async function upsertSchedulingEntry(
  instanceId: string,
  rowKey: string,
  columnKey: string,
  assignment: Record<string, unknown>,
  source: string = 'manual',
  scope: { tenantId?: string; doctorId?: string } = {}
): Promise<SchedulingEntry> {
  checkSupabase();

  const { data: existing, error: findError } = await supabase!
    .from('scheduling_entries')
    .select('id')
    .eq('instance_id', instanceId)
    .eq('row_key', rowKey)
    .eq('column_key', columnKey)
    .maybeSingle();

  if (findError) {
    console.warn('Error looking up existing scheduling entry:', findError);
    throw findError;
  }

  if (existing) {
    const { data, error } = await supabase!
      .from('scheduling_entries')
      .update({ assignment, source, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select()
      .single();

    if (error) {
      console.warn('Error updating scheduling entry:', error);
      throw error;
    }
    return data;
  }

  const { data, error } = await supabase!
    .from('scheduling_entries')
    .insert({
      instance_id: instanceId,
      tenant_id: scope.tenantId ?? null,
      doctor_id: scope.doctorId ?? null,
      row_key: rowKey,
      column_key: columnKey,
      assignment,
      source,
    })
    .select()
    .single();

  if (error) {
    console.warn('Error creating scheduling entry:', error);
    throw error;
  }
  return data;
}

// Persists the instance's row/column definitions in one call — the builder
// UI's "define rows"/"define columns" steps operate on local draft state
// and save the full ordered list at once, rather than one field at a time.
export async function updateInstanceDefinitions(
  instanceId: string,
  rowDefinitions: SchedulingRowDefinition[],
  columnDefinitions: SchedulingColumnDefinition[]
): Promise<SchedulingInstance> {
  checkSupabase();

  const { data, error } = await supabase!
    .from('scheduling_instances')
    .update({ row_definitions: rowDefinitions, column_definitions: columnDefinitions })
    .eq('id', instanceId)
    .select()
    .single();

  if (error) {
    console.warn('Error updating scheduling instance definitions:', error);
    throw error;
  }
  return data;
}

export async function updateInstanceStatus(instanceId: string, status: string): Promise<SchedulingInstance> {
  checkSupabase();

  const patch: Record<string, unknown> = { status };
  if (status === 'published') {
    patch.published_at = new Date().toISOString();
  }

  const { data, error } = await supabase!
    .from('scheduling_instances')
    .update(patch)
    .eq('id', instanceId)
    .select()
    .single();

  if (error) {
    console.warn('Error updating scheduling instance status:', error);
    throw error;
  }
  return data;
}
