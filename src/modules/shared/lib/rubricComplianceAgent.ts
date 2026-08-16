// L1 Agent — "Rubric Compliance Chaser" (PrivyBrain-2, rung 1).
//
// Per docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md §4 (intelligence ladder) this
// is a second rung-1 "Reasoning" agent, same ladder rung as Submission
// Chaser (submissionChaserAgent.ts) — it reads operational state (scored
// `rubric_instances` rows, migration 41/46) and surfaces a finding — "shown
// as suggestion," never acted on autonomously. Registered in
// `agent_manifests` (migration 50) as
// `privybrain2_rubric_compliance_chaser`, engine `privybrain-2`.
//
// SCOPE: one signal (a scored rubric instance whose `recommendation` is
// `review_required` or `recommend_revise`), one insight shape, raised once
// per `rubric_instances.id`. Not a general-purpose rules engine — the actual
// scoring/recommendation logic lives entirely in `compute_rubric_totals()`
// (migration 41); this agent only reacts to its output.
//
// TWO SWEEP MODES, per migration 50's own header:
//   - `runRubricComplianceChaserForTenant`: an org-wide sweep. The resulting
//     insight is written with BOTH `tenant_id` (so it reaches the Chief via
//     InsightsStrip.tsx's tenant-scoped read) AND `workforce_id` set to the
//     instance's own `assessor_workforce_id` when present (so it ALSO
//     reaches the specific resident it's about via their own
//     UnifiedRecordView.tsx / udr.ts's `fetchInsights`, which is
//     workforce_id-scoped) — mirrors exactly how Submission Chaser's
//     `workforce_id` field does double duty for the same reason (see that
//     file's INSERT call).
//   - `runRubricComplianceChaserForDoctor`: a doctor-scoped sweep for an
//     individual/unlinked doctor's own `rubric_instances` rows (identified
//     by `assessor_doctor_id`, which get `tenant_id = null` on the instance
//     itself — there is no institutional tenant for an unlinked doctor's
//     work). The resulting insight is written with `tenant_id: null,
//     doctor_id: doctorId, workforce_id: null` — the shape migration 49
//     added and the FIRST real producer of a doctor-scoped insight in this
//     app (Submission Chaser remains org-only; `udr.ts`'s
//     `fetchInsightsForDoctor` already reads this shape but had nothing
//     writing it until now).
//
// SUBJECT_REF NOTE — two different `subject_ref` values are in play here,
// deliberately not the same string:
//   - `rubric_instances.subject_ref` (migration 41's own column) names WHAT
//     was assessed, e.g. `'research_workspace:<uuid>'` or
//     `'clinical_case_report:<uuid>'` — used here only to phrase the
//     insight's human-readable text (see `describeAssessedConcept` below),
//     never as this agent's own dedup key.
//   - This agent's OWN `insights.subject_ref` is `'rubric_instance:<id>'`,
//     keyed off the `rubric_instances.id` itself — the same workspace/case
//     can accumulate multiple scored instances over time (re-submitted,
//     re-scored), and each one is a distinct thing to potentially flag, so
//     the instance id (not the instance's own subject_ref) is the right
//     dedup granularity.
//
// IDEMPOTENCY: same convention as Submission Chaser — a pre-check against
// existing `insights` rows for the candidate subject_refs skips any subject
// with a not-yet-superseded row (not dismissed, or dismissed but still
// inside its cooldown window), then the actual insert goes through
// `upsert(..., { ignoreDuplicates: true })` against the partial unique dedup
// index (migration 38, widened by migration 49) as a race-safety net for two
// near-simultaneous runs. `cooldown_until` is left unset at insert time for
// the same reason as Submission Chaser: a brand-new insight must be
// immediately visible, not hidden for 3 days — the cooldown is only applied
// on dismissal (see `dismissInsight` in submissionChaserAgent.ts, reused
// as-is by this agent's own callers rather than duplicated here).

import type { SupabaseClient } from '@supabase/supabase-js';
import { emitEvent } from './eventBus';

export const RUBRIC_COMPLIANCE_AGENT_KEY = 'privybrain2_rubric_compliance_chaser';
const RUBRIC_COMPLIANCE_RUNG = 1;

// The only two `rubric_instances.recommendation` values that warrant a
// human's attention — `recommend_pass` needs no chasing, and `draft`/
// `submitted` instances haven't been scored yet (status != 'scored', so
// they're excluded by the query itself, not this list).
const RECOMMENDATIONS_NEEDING_ATTENTION = ['review_required', 'recommend_revise'] as const;

function subjectRefFor(rubricInstanceId: string): string {
  return `rubric_instance:${rubricInstanceId}`;
}

// Turns rubric_instances.subject_ref's '<concept>:<id>' convention
// (migration 41's own header) into a natural-language phrase for the
// insight's text, without ever dumping the raw subject_ref string in front
// of a user. Unknown/future concepts fall back to a generic phrase rather
// than throwing — this agent must not break because a new subject type
// shows up before this map is updated.
function describeAssessedConcept(instanceSubjectRef: string | null): string {
  const concept = instanceSubjectRef?.split(':')[0] ?? null;
  switch (concept) {
    case 'research_workspace':
      return 'proposal self-assessment';
    case 'clinical_case_report':
      return 'case self-assessment';
    default:
      return 'self-assessment';
  }
}

function describeRecommendation(recommendation: string): string {
  switch (recommendation) {
    case 'review_required':
      return 'needs review';
    case 'recommend_revise':
      return 'needs revisions';
    default:
      return 'needs attention';
  }
}

function buildInsightText(row: ScoredRubricInstanceRow): string {
  const concept = describeAssessedConcept(row.subject_ref);
  const recommendation = describeRecommendation(row.recommendation);
  const scoreSuffix = row.final_score != null ? ` (score: ${row.final_score})` : '';
  return `Your ${concept} ${recommendation}${scoreSuffix}.`;
}

interface ScoredRubricInstanceRow {
  id: string;
  subject_ref: string | null;
  assessor_workforce_id: string | null;
  assessor_doctor_id: string | null;
  final_score: number | null;
  recommendation: string;
}

interface ExistingInsightRow {
  subject_ref: string | null;
  dismissed_at: string | null;
  cooldown_until: string | null;
}

export interface RubricComplianceChaserRunResult {
  /** Scored rubric_instances rows matching the attention filter this run. */
  flaggedCount: number;
  /** New insight rows actually inserted this run (excludes skipped dupes). */
  insightsCreated: number;
}

/**
 * Computes which candidate subject_refs already have a not-yet-superseded
 * insight for this agent (not dismissed, or dismissed but still inside its
 * cooldown window) — same "blocked" formula as submissionChaserAgent.ts's
 * runSubmissionChaser, extracted here since both sweep modes need it against
 * different insights queries (tenant-scoped vs. doctor-scoped).
 */
function blockedSubjectRefs(existingRows: ExistingInsightRow[]): Set<string | null> {
  const nowMs = Date.now();
  return new Set(
    existingRows
      .filter((row) => {
        const stillOpen = row.dismissed_at === null;
        const stillCoolingDown = row.cooldown_until !== null && new Date(row.cooldown_until).getTime() > nowMs;
        return stillOpen || stillCoolingDown;
      })
      .map((row) => row.subject_ref)
  );
}

/**
 * Org-wide sweep: reads a tenant's scored `rubric_instances` needing
 * attention and raises a persisted, dismissible `insights` row per instance.
 * `workforce_id` is stamped from the instance's own `assessor_workforce_id`
 * when present, so the SAME insight reaches both the Chief (via
 * InsightsStrip.tsx's tenant_id-scoped read) and the resident it's actually
 * about (via their own UnifiedRecordView.tsx / udr.ts's workforce_id-scoped
 * `fetchInsights`) — mirrors Submission Chaser's own `workforce_id`
 * double-duty exactly.
 */
export async function runRubricComplianceChaserForTenant(
  supabaseClient: SupabaseClient,
  tenantId: string
): Promise<RubricComplianceChaserRunResult> {
  const { data: instanceRows, error: instancesErr } = await supabaseClient
    .from('rubric_instances')
    .select('id, subject_ref, assessor_workforce_id, assessor_doctor_id, final_score, recommendation')
    .eq('tenant_id', tenantId)
    .eq('status', 'scored')
    .in('recommendation', RECOMMENDATIONS_NEEDING_ATTENTION);
  if (instancesErr) throw instancesErr;

  const flagged = (instanceRows ?? []) as ScoredRubricInstanceRow[];
  if (flagged.length === 0) {
    return { flaggedCount: 0, insightsCreated: 0 };
  }

  const candidateRefs = flagged.map((row) => subjectRefFor(row.id));
  const { data: existingRows, error: existingErr } = await supabaseClient
    .from('insights')
    .select('subject_ref, dismissed_at, cooldown_until')
    .eq('tenant_id', tenantId)
    .eq('agent_key', RUBRIC_COMPLIANCE_AGENT_KEY)
    .in('subject_ref', candidateRefs);
  if (existingErr) throw existingErr;

  const blockedRefs = blockedSubjectRefs((existingRows ?? []) as ExistingInsightRow[]);
  const toInsert = flagged.filter((row) => !blockedRefs.has(subjectRefFor(row.id)));
  if (toInsert.length === 0) {
    return { flaggedCount: flagged.length, insightsCreated: 0 };
  }

  const rowsToInsert = toInsert.map((row) => ({
    tenant_id: tenantId,
    agent_key: RUBRIC_COMPLIANCE_AGENT_KEY,
    rung: RUBRIC_COMPLIANCE_RUNG,
    text: buildInsightText(row),
    action: { type: 'review_self_assessment', rubric_instance_id: row.id },
    workforce_id: row.assessor_workforce_id ?? null,
    subject_ref: subjectRefFor(row.id),
  }));

  const { error: insertErr } = await supabaseClient
    .from('insights')
    .upsert(rowsToInsert, { onConflict: 'tenant_id,doctor_id,agent_key,subject_ref', ignoreDuplicates: true });
  if (insertErr) throw insertErr;

  // One batched event for the whole run, same convention as
  // submissionChaserAgent.ts's runSubmissionChaser — event_log records "this
  // agent ran and produced N findings," not a second insights table.
  try {
    await emitEvent(supabaseClient, {
      tenantId,
      eventType: 'insight.generated',
      source: RUBRIC_COMPLIANCE_AGENT_KEY,
      agentRef: RUBRIC_COMPLIANCE_AGENT_KEY,
      payload: {
        count: toInsert.length,
        rubricInstanceIds: toInsert.map((row) => row.id),
      },
    });
  } catch (eventErr) {
    console.warn('rubricComplianceAgent: failed to emit insight.generated event (tenant sweep)', eventErr);
  }

  return { flaggedCount: flagged.length, insightsCreated: toInsert.length };
}

/**
 * Doctor-scoped sweep: reads an individual/unlinked doctor's own scored
 * `rubric_instances` needing attention (via `assessor_doctor_id`; these rows
 * carry `tenant_id = null` themselves, same as every other doctor-owned row
 * in this app) and raises a persisted, dismissible `insights` row per
 * instance with `tenant_id: null, doctor_id: doctorId, workforce_id: null`
 * — migration 49's doctor-scoped shape. This is the FIRST agent in the app
 * to actually write one; `udr.ts`'s `fetchInsightsForDoctor` already reads
 * it, it just had nothing populating it until now.
 */
export async function runRubricComplianceChaserForDoctor(
  supabaseClient: SupabaseClient,
  doctorId: string
): Promise<RubricComplianceChaserRunResult> {
  const { data: instanceRows, error: instancesErr } = await supabaseClient
    .from('rubric_instances')
    .select('id, subject_ref, assessor_workforce_id, assessor_doctor_id, final_score, recommendation')
    .eq('assessor_doctor_id', doctorId)
    .eq('status', 'scored')
    .in('recommendation', RECOMMENDATIONS_NEEDING_ATTENTION);
  if (instancesErr) throw instancesErr;

  const flagged = (instanceRows ?? []) as ScoredRubricInstanceRow[];
  if (flagged.length === 0) {
    return { flaggedCount: 0, insightsCreated: 0 };
  }

  const candidateRefs = flagged.map((row) => subjectRefFor(row.id));
  const { data: existingRows, error: existingErr } = await supabaseClient
    .from('insights')
    .select('subject_ref, dismissed_at, cooldown_until')
    .eq('doctor_id', doctorId)
    .eq('agent_key', RUBRIC_COMPLIANCE_AGENT_KEY)
    .in('subject_ref', candidateRefs);
  if (existingErr) throw existingErr;

  const blockedRefs = blockedSubjectRefs((existingRows ?? []) as ExistingInsightRow[]);
  const toInsert = flagged.filter((row) => !blockedRefs.has(subjectRefFor(row.id)));
  if (toInsert.length === 0) {
    return { flaggedCount: flagged.length, insightsCreated: 0 };
  }

  const rowsToInsert = toInsert.map((row) => ({
    tenant_id: null,
    doctor_id: doctorId,
    agent_key: RUBRIC_COMPLIANCE_AGENT_KEY,
    rung: RUBRIC_COMPLIANCE_RUNG,
    text: buildInsightText(row),
    action: { type: 'review_self_assessment', rubric_instance_id: row.id },
    workforce_id: null,
    subject_ref: subjectRefFor(row.id),
  }));

  const { error: insertErr } = await supabaseClient
    .from('insights')
    .upsert(rowsToInsert, { onConflict: 'tenant_id,doctor_id,agent_key,subject_ref', ignoreDuplicates: true });
  if (insertErr) throw insertErr;

  try {
    await emitEvent(supabaseClient, {
      tenantId: null,
      eventType: 'insight.generated',
      source: RUBRIC_COMPLIANCE_AGENT_KEY,
      agentRef: RUBRIC_COMPLIANCE_AGENT_KEY,
      payload: {
        count: toInsert.length,
        doctorId,
        rubricInstanceIds: toInsert.map((row) => row.id),
      },
    });
  } catch (eventErr) {
    console.warn('rubricComplianceAgent: failed to emit insight.generated event (doctor sweep)', eventErr);
  }

  return { flaggedCount: flagged.length, insightsCreated: toInsert.length };
}
