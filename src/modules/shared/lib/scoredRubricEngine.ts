// L4 "Forms & pipelines" — generic Scored Rubric primitive.
//
// Per docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md §8.1 ("A reusable primitive:
// the scored rubric"): a sectioned form where each item is graded on a fixed
// scale, sections total to a threshold, and a final score maps to a
// recommendation. Fellowship dissertation/proposal assessments, OSCE mark
// sheets, credentialing checklists, competency sign-offs, audit scorecards,
// and peer-review forms are all the same shape — built ONCE here, not as a
// one-off "dissertation form."
//
// NAMED `scoredRubricEngine.ts`, NOT `rubricEngine.ts` — this repo already
// has `src/modules/research/lib/rubricEngine.ts` (the Universal Research
// Engine's client-side PICO/word-count/citation validator, unrelated to this
// primitive). Disambiguated per this task's own instruction rather than
// colliding names or renaming the pre-existing file.
//
// Backs supabase/migrations/41_scored_rubric_primitive.sql
// (rubric_templates / rubric_sections / rubric_items / rubric_instances +
// the compute_rubric_totals() SQL function). Per living-system spec §3
// ("modules never import modules, wire through the spine"), this lives
// under src/modules/shared — it is a cross-cutting primitive, not owned by
// any one domain module, exactly like eventBus.ts/udr.ts/
// submissionChaserAgent.ts already do.
//
// SCOPE: 100% generic. No template-specific logic, no hardcoded section or
// item names anywhere in this file — every rubric_templates row is just
// data. Seeding real rubric content (WACP, OSCE, etc.) is explicitly out of
// scope for this pass (see this migration's own header and CLAUDE.md's
// "Sourcing module content" section).
//
// Callers pass their own SupabaseClient instance (usually the one exported
// from src/lib/databaseService.ts), same convention as every other
// shared/lib module in this app (eventBus.ts, submissionChaserAgent.ts) —
// this file never imports databaseService itself.

import type { SupabaseClient } from '@supabase/supabase-js';

// --------------------------------------------------------------------
// Types — mirror supabase/migrations/41_scored_rubric_primitive.sql
// column-for-column. Keep both in sync by hand if the schema changes
// (same convention as src/types.ts's own header).
// --------------------------------------------------------------------

export interface RubricItem {
  id: string;
  rubric_section_id: string;
  label: string;
  guidance_text: string | null;
  scale_min: number;
  scale_max: number;
  weight: number;
  sort_order: number;
}

export interface RubricSection {
  id: string;
  rubric_template_id: string;
  name: string;
  max_points: number | null;
  pass_threshold: number | null;
  all_items_required: boolean;
  sort_order: number;
}

export interface RubricTemplate {
  id: string;
  tenant_id: string | null;
  doctor_id: string | null;
  created_by_workforce_id: string | null;
  name: string;
  description: string | null;
  scale_definition: Record<string, unknown>;
  pass_logic: Record<string, unknown>;
  is_system_default: boolean;
  created_at: string;
}

/** A template with its sections and each section's items attached, fully
 *  nested — what a rendering UI (RubricInstanceForm) actually needs to draw
 *  the form without further round-trips. */
export interface RubricTemplateWithStructure extends RubricTemplate {
  sections: (RubricSection & { items: RubricItem[] })[];
}

export type RubricInstanceStatus = 'draft' | 'submitted' | 'scored' | 'confirmed';

export interface RubricSectionTotal {
  section_name: string;
  score: number;
  max_points: number | null;
  pass_threshold: number | null;
  passed: boolean;
  flagged_zero_required_item: boolean;
}

export interface RubricInstance {
  id: string;
  rubric_template_id: string;
  tenant_id: string | null;
  subject_ref: string | null;
  assessor_workforce_id: string | null;
  assessor_doctor_id: string | null;
  /** Keyed by rubric_items.id -> raw numeric score entered by the assessor. */
  scores: Record<string, number>;
  /** Keyed by rubric_sections.id -> RubricSectionTotal, written server-side
   *  by compute_rubric_totals(). Empty until the instance has been scored. */
  section_totals: Record<string, RubricSectionTotal>;
  final_score: number | null;
  recommendation: string | null;
  status: RubricInstanceStatus;
  created_at: string;
  updated_at: string;
}

/** Scope for listing templates — mirrors the 3-way ownership shape in the
 *  migration's own header: pass neither for global-only, tenantId for an
 *  org's own templates (plus global), doctorId for an individual's own
 *  templates (plus global). Both can be passed at once by a caller that
 *  wants "everything visible to this session," left to the caller to decide
 *  since this primitive has no opinion on session/auth state. */
export interface RubricTemplateScope {
  tenantId?: string;
  doctorId?: string;
}

// --------------------------------------------------------------------
// listRubricTemplates
// --------------------------------------------------------------------

/**
 * Lists rubric templates visible to the given scope: always includes global
 * templates (tenant_id IS NULL AND doctor_id IS NULL), plus the tenant's own
 * templates (if tenantId given) and/or the doctor's own templates (if
 * doctorId given). Does not fetch sections/items — use getRubricTemplate()
 * for the fully-nested structure needed to render a form.
 */
export async function listRubricTemplates(
  supabaseClient: SupabaseClient,
  scope: RubricTemplateScope = {}
): Promise<RubricTemplate[]> {
  const { tenantId, doctorId } = scope;

  // PostgREST or() filter: global OR tenant-owned OR doctor-owned, whichever
  // of the latter two the caller actually asked for.
  const clauses = ['and(tenant_id.is.null,doctor_id.is.null)'];
  if (tenantId) clauses.push(`tenant_id.eq.${tenantId}`);
  if (doctorId) clauses.push(`doctor_id.eq.${doctorId}`);

  const { data, error } = await supabaseClient
    .from('rubric_templates')
    .select('*')
    .or(clauses.join(','))
    .order('name', { ascending: true });

  if (error) throw error;
  return (data ?? []) as RubricTemplate[];
}

// --------------------------------------------------------------------
// getRubricTemplate — fully nested, for rendering
// --------------------------------------------------------------------

/**
 * Fetches one rubric template plus its sections and each section's items,
 * nested and sorted by sort_order — the shape RubricInstanceForm renders
 * directly. Returns null if the template doesn't exist.
 */
export async function getRubricTemplate(
  supabaseClient: SupabaseClient,
  templateId: string
): Promise<RubricTemplateWithStructure | null> {
  const { data: template, error: templateErr } = await supabaseClient
    .from('rubric_templates')
    .select('*')
    .eq('id', templateId)
    .maybeSingle();
  if (templateErr) throw templateErr;
  if (!template) return null;

  const { data: sections, error: sectionsErr } = await supabaseClient
    .from('rubric_sections')
    .select('*')
    .eq('rubric_template_id', templateId)
    .order('sort_order', { ascending: true });
  if (sectionsErr) throw sectionsErr;

  const sectionRows = (sections ?? []) as RubricSection[];
  if (sectionRows.length === 0) {
    return { ...(template as RubricTemplate), sections: [] };
  }

  const { data: items, error: itemsErr } = await supabaseClient
    .from('rubric_items')
    .select('*')
    .in('rubric_section_id', sectionRows.map((s) => s.id))
    .order('sort_order', { ascending: true });
  if (itemsErr) throw itemsErr;

  const itemsBySection = new Map<string, RubricItem[]>();
  for (const item of (items ?? []) as RubricItem[]) {
    const list = itemsBySection.get(item.rubric_section_id) ?? [];
    list.push(item);
    itemsBySection.set(item.rubric_section_id, list);
  }

  return {
    ...(template as RubricTemplate),
    sections: sectionRows.map((section) => ({
      ...section,
      items: itemsBySection.get(section.id) ?? [],
    })),
  };
}

// --------------------------------------------------------------------
// createRubricInstance
// --------------------------------------------------------------------

export interface CreateRubricInstanceInput {
  rubricTemplateId: string;
  tenantId?: string | null;
  subjectRef?: string | null;
  assessorWorkforceId?: string | null;
  assessorDoctorId?: string | null;
}

/** Creates a new, empty (status='draft') rubric instance against a template.
 *  `subjectRef` is free text — see the migration header for the convention
 *  ('<concept>:<id>', e.g. 'research_workspace:<uuid>'). */
export async function createRubricInstance(
  supabaseClient: SupabaseClient,
  input: CreateRubricInstanceInput
): Promise<RubricInstance> {
  const { data, error } = await supabaseClient
    .from('rubric_instances')
    .insert({
      rubric_template_id: input.rubricTemplateId,
      tenant_id: input.tenantId ?? null,
      subject_ref: input.subjectRef ?? null,
      assessor_workforce_id: input.assessorWorkforceId ?? null,
      assessor_doctor_id: input.assessorDoctorId ?? null,
    })
    .select('*')
    .single();

  if (error) throw error;
  return data as RubricInstance;
}

// --------------------------------------------------------------------
// getRubricInstance
// --------------------------------------------------------------------

export async function getRubricInstance(
  supabaseClient: SupabaseClient,
  instanceId: string
): Promise<RubricInstance | null> {
  const { data, error } = await supabaseClient
    .from('rubric_instances')
    .select('*')
    .eq('id', instanceId)
    .maybeSingle();

  if (error) throw error;
  return (data as RubricInstance) ?? null;
}

// --------------------------------------------------------------------
// submitRubricScores
// --------------------------------------------------------------------

/**
 * Writes the assessor's per-item scores, marks the instance 'submitted',
 * then invokes the compute_rubric_totals() SQL function (migration 41) to
 * derive section_totals/final_score/recommendation and move status to
 * 'scored'. Mirrors the spec's own pipeline description: "rubric.instance
 * submitted -> BabsBrain-2 computes section totals... -> org admin or
 * assessor confirms." Confirming (status -> 'confirmed') is a separate,
 * deliberately un-computed step — call updateRubricInstanceStatus() for
 * that once a human has reviewed the proposed recommendation.
 */
export async function submitRubricScores(
  supabaseClient: SupabaseClient,
  instanceId: string,
  scores: Record<string, number>
): Promise<RubricInstance> {
  const { error: updateErr } = await supabaseClient
    .from('rubric_instances')
    .update({ scores, status: 'submitted' })
    .eq('id', instanceId);
  if (updateErr) throw updateErr;

  const { data, error: computeErr } = await supabaseClient.rpc('compute_rubric_totals', {
    p_instance_id: instanceId,
  });
  if (computeErr) throw computeErr;

  return data as RubricInstance;
}

// --------------------------------------------------------------------
// listRubricInstancesForSubject
// --------------------------------------------------------------------

/**
 * Lists rubric instances for a given subject_ref (see the migration header's
 * '<concept>:<id>' convention, e.g. 'research_workspace:<uuid>'), optionally
 * narrowed to one rubric_template_id, newest first. Lets a caller find an
 * existing instance to resume (pass its id as RubricInstanceForm's
 * instanceId prop) instead of creating a new blank instance every time a
 * rubric section is opened.
 */
export async function listRubricInstancesForSubject(
  supabaseClient: SupabaseClient,
  subjectRef: string,
  rubricTemplateId?: string
): Promise<RubricInstance[]> {
  let query = supabaseClient
    .from('rubric_instances')
    .select('*')
    .eq('subject_ref', subjectRef)
    .order('created_at', { ascending: false });

  if (rubricTemplateId) {
    query = query.eq('rubric_template_id', rubricTemplateId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as RubricInstance[];
}

// --------------------------------------------------------------------
// updateRubricInstanceStatus — the human "confirms" step
// --------------------------------------------------------------------

/** Moves a scored instance to 'confirmed' (org admin or assessor accepting
 *  the computed recommendation) — the human gate the pipeline description
 *  ends on. Deliberately just a status write; no revalidation of scores. */
export async function confirmRubricInstance(
  supabaseClient: SupabaseClient,
  instanceId: string
): Promise<RubricInstance> {
  const { data, error } = await supabaseClient
    .from('rubric_instances')
    .update({ status: 'confirmed' })
    .eq('id', instanceId)
    .select('*')
    .single();

  if (error) throw error;
  return data as RubricInstance;
}
