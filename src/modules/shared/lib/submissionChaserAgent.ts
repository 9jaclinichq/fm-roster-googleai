// L1 Agent — "Submission Chaser" (BabsBrain-2, rung 1).
//
// Per docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md §4 (intelligence ladder) this
// is a rung-1 "Reasoning" agent: it reads operational state (a tenant's
// currently-open collection, its submissions, its active workforce) and
// surfaces a finding — "shown as suggestion," never acted on autonomously.
// It is the FIRST agent in this app that actually drives data through the
// spine end to end: reads existing tables -> writes a persisted `insights`
// row (migration 37) -> emits an `insight.generated` event_log row
// (migration 32). Registered in `agent_manifests` (migration 34/37) as
// `babsbrain2_submission_chaser`.
//
// SCOPE: deliberately narrow — one signal (pending, past-deadline
// submissions in the currently open collection), one insight shape. Not a
// general-purpose rules engine.
//
// STALENESS THRESHOLD: the task motivation for this agent talks about
// members "past some staleness threshold," but doesn't operationalize a
// specific one beyond "hasn't submitted yet." Rather than invent a new
// schema field, this agent uses the open collection's own `deadline`
// (already queried, already the field ChiefDashboardView.tsx's own
// `isPastDeadline` derives from) as that threshold: insights are only
// raised once the active collection's deadline has passed. A collection
// can be past its own deadline while still `status = 'open'` (closing is a
// separate manual Chief action) — same distinction ChiefDashboardView
// already treats as independent. Flagged here as a deliberate
// interpretation, not a literal spec requirement.
//
// IDEMPOTENCY NOTE (read before changing the dedup check below): a literal
// reading of "skip if an ACTIVE (dismissed_at IS NULL AND cooldown_until <
// now()) insight already exists" would NOT be idempotent — a freshly
// inserted row has `cooldown_until` 3 days in the future, so it would fail
// its own "not in cooldown" clause and a same-day re-run would insert a
// SECOND row for the same member, defeating the stated purpose ("re-running
// doesn't re-insert daily"). `getActiveInsights` below still implements
// that literal "active" formula verbatim (it's given as an exact
// expression, and is a reasonable display predicate on its own) — but the
// dedup check inside `runSubmissionChaser` is deliberately NOT the same
// formula. It skips whenever a not-yet-superseded row already exists for
// the subject (dismissed_at IS NULL, OR dismissed but still inside its own
// cooldown window), which is what actually satisfies "idempotent, no
// duplicate spam." One consequence worth knowing: a freshly generated
// insight will not appear in `getActiveInsights` until its 3-day cooldown
// lapses (its `cooldown_until` is in the future). If the intent is for a
// brand-new insight to be visible immediately, `cooldown_until` should be
// left null at insert time and only set once dismissed — that's a one-line
// change (see the INSERT call below) left for whoever wires this into the
// dashboard to decide, since it changes user-visible behavior.

import type { SupabaseClient } from '@supabase/supabase-js';
import { emitEvent } from './eventBus';

export const SUBMISSION_CHASER_AGENT_KEY = 'babsbrain2_submission_chaser';
const SUBMISSION_CHASER_RUNG = 1;
const COOLDOWN_DAYS = 3;

function subjectRefFor(collectionId: string, workforceId: string): string {
  return `collection:${collectionId}:workforce:${workforceId}`;
}

interface OpenCollectionRow {
  id: string;
  title: string;
  deadline: string;
  status: string;
}

interface ActiveWorkforceRow {
  id: string;
  full_name: string;
}

interface SubmissionWorkforceIdRow {
  workforce_id: string;
}

interface ExistingInsightRow {
  subject_ref: string | null;
  dismissed_at: string | null;
  cooldown_until: string | null;
}

export interface InsightRow {
  id: string;
  tenant_id: string;
  agent_key: string;
  rung: number;
  text: string;
  action: Record<string, unknown>;
  workforce_id: string | null;
  subject_ref: string | null;
  cooldown_until: string | null;
  dismissed_at: string | null;
  created_at: string;
}

export interface SubmissionChaserRunResult {
  /** The tenant's currently-open collection, or null if none is open. */
  collectionId: string | null;
  /** True once the open collection's deadline has passed (the staleness
   *  gate — see header note). If false, no insights are raised this run
   *  even if members are pending, since the collection isn't "late" yet. */
  pastDeadline: boolean;
  /** Active workforce members with no submission yet in the open collection. */
  pendingCount: number;
  /** New insight rows actually inserted this run (excludes skipped dupes). */
  insightsCreated: number;
}

/**
 * Reads a tenant's currently-open collection + its submissions + its active
 * workforce, and raises a persisted, dismissible `insights` row for each
 * active member who hasn't submitted yet, once the collection is past its
 * deadline. Idempotent: re-running the same day (or within the 3-day
 * cooldown window) does not create duplicate rows for a member already
 * flagged for this collection — see the header note above for exactly how.
 *
 * Mirrors the query shape of ChiefDashboardView.tsx's `loadDashboardData` /
 * `pendingResidents` (read for reference, not imported — modules never
 * import modules, wire through the spine per living-system spec §3/§8).
 */
export async function runSubmissionChaser(
  supabaseClient: SupabaseClient,
  tenantId: string
): Promise<SubmissionChaserRunResult> {
  // 1. The tenant's currently-open collection. Mirrors
  //    databaseService.getCollections() + ChiefDashboardView's
  //    `collections.find(c => c.status === 'open')` fallback shape, scoped
  //    directly to status='open' here since this agent only ever cares
  //    about the live collection, not history.
  const { data: openCollections, error: collErr } = await supabaseClient
    .from('collections')
    .select('id, title, deadline, status')
    .eq('tenant_id', tenantId)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(1);
  if (collErr) throw collErr;

  const collection = (openCollections?.[0] as OpenCollectionRow | undefined) ?? null;
  if (!collection) {
    return { collectionId: null, pastDeadline: false, pendingCount: 0, insightsCreated: 0 };
  }

  const pastDeadline = new Date(collection.deadline).getTime() < Date.now();
  if (!pastDeadline) {
    return { collectionId: collection.id, pastDeadline: false, pendingCount: 0, insightsCreated: 0 };
  }

  // 2. Active workforce for this tenant.
  const { data: workforceRows, error: wfErr } = await supabaseClient
    .from('workforce')
    .select('id, full_name')
    .eq('tenant_id', tenantId)
    .eq('active', true);
  if (wfErr) throw wfErr;
  const activeWorkforce = (workforceRows ?? []) as ActiveWorkforceRow[];
  if (activeWorkforce.length === 0) {
    return { collectionId: collection.id, pastDeadline: true, pendingCount: 0, insightsCreated: 0 };
  }

  // 3. Submissions already in for this collection, tenant-scoped through the
  //    workforce join — same pattern as databaseService.getSubmissions().
  const { data: submissionRows, error: subErr } = await supabaseClient
    .from('submissions')
    .select('workforce_id, workforce!inner(tenant_id)')
    .eq('collection_id', collection.id)
    .eq('workforce.tenant_id', tenantId);
  if (subErr) throw subErr;
  const submittedIds = new Set(
    ((submissionRows ?? []) as SubmissionWorkforceIdRow[]).map((s) => s.workforce_id)
  );

  const pending = activeWorkforce.filter((w) => !submittedIds.has(w.id));
  if (pending.length === 0) {
    return { collectionId: collection.id, pastDeadline: true, pendingCount: 0, insightsCreated: 0 };
  }

  // 4. Dedup: find subject_refs that already have a not-yet-superseded
  //    insight (see header note for exactly what "not-yet-superseded" means
  //    and why it's not a literal read of the "active" formula).
  const candidateRefs = pending.map((w) => subjectRefFor(collection.id, w.id));
  const { data: existingRows, error: existingErr } = await supabaseClient
    .from('insights')
    .select('subject_ref, dismissed_at, cooldown_until')
    .eq('tenant_id', tenantId)
    .eq('agent_key', SUBMISSION_CHASER_AGENT_KEY)
    .in('subject_ref', candidateRefs);
  if (existingErr) throw existingErr;

  const nowMs = Date.now();
  const blockedRefs = new Set(
    ((existingRows ?? []) as ExistingInsightRow[])
      .filter((row) => {
        const stillOpen = row.dismissed_at === null;
        const stillCoolingDown = row.cooldown_until !== null && new Date(row.cooldown_until).getTime() > nowMs;
        return stillOpen || stillCoolingDown;
      })
      .map((row) => row.subject_ref)
  );

  const toInsert = pending.filter((w) => !blockedRefs.has(subjectRefFor(collection.id, w.id)));
  if (toInsert.length === 0) {
    return { collectionId: collection.id, pastDeadline: true, pendingCount: pending.length, insightsCreated: 0 };
  }

  // cooldown_until is intentionally left unset here (wiring-in decision,
  // per this file's header note): it gates re-INSERTION of a duplicate
  // after dismissal, not initial visibility — a brand-new insight must be
  // immediately visible in InsightsStrip, not hidden for 3 days. See
  // dismissInsight() below for where the cooldown is actually applied.
  const rowsToInsert = toInsert.map((w) => ({
    tenant_id: tenantId,
    agent_key: SUBMISSION_CHASER_AGENT_KEY,
    rung: SUBMISSION_CHASER_RUNG,
    text: `${w.full_name} hasn't submitted for ${collection.title} yet.`,
    action: { type: 'reset_code_or_remind', workforce_id: w.id },
    workforce_id: w.id,
    subject_ref: subjectRefFor(collection.id, w.id),
  }));

  // Upsert against the partial unique index (migration 38, widened by
  // migration 49 to include doctor_id once insights became multi-scope)
  // instead of a plain insert: two near-simultaneous runs (e.g. a fast page
  // reload remounting InsightsStrip before the first run's insert is
  // visible to the second run's dedup SELECT) previously raced past the
  // in-app dedup check and created duplicate rows for the same member/
  // collection. ignoreDuplicates makes the second racer's redundant row a
  // silent no-op at the database level instead of a duplicate insight.
  // This agent only ever inserts org-scoped rows (doctor_id always null
  // here, per the rowsToInsert shape above) -- doctor_id is included in the
  // conflict target only because it's part of the table's unique index now.
  const { error: insertErr } = await supabaseClient
    .from('insights')
    .upsert(rowsToInsert, { onConflict: 'tenant_id,doctor_id,agent_key,subject_ref', ignoreDuplicates: true });
  if (insertErr) throw insertErr;

  // One batched event for the whole run rather than one per insight — this
  // agent can raise many insights in a single pass (one per pending member),
  // and event_log is meant to record "this agent ran and produced N
  // findings," not stand in as a second insights table. Documented choice
  // per this task's own "your call, document which" instruction.
  try {
    await emitEvent(supabaseClient, {
      tenantId,
      eventType: 'insight.generated',
      source: SUBMISSION_CHASER_AGENT_KEY,
      agentRef: SUBMISSION_CHASER_AGENT_KEY,
      payload: {
        count: toInsert.length,
        collectionId: collection.id,
        workforceIds: toInsert.map((w) => w.id),
      },
    });
  } catch (eventErr) {
    // Best-effort, same convention as this repo's existing AI-action
    // logging (see eventBus.ts's own doc comment) — a failed event emission
    // must never roll back or block the insights that were already inserted.
    console.warn('submissionChaserAgent: failed to emit insight.generated event', eventErr);
  }

  return {
    collectionId: collection.id,
    pastDeadline: true,
    pendingCount: pending.length,
    insightsCreated: toInsert.length,
  };
}

/**
 * Active insights for a tenant, literally per this table's "active" formula:
 * not dismissed, and either no cooldown or the cooldown has already lapsed.
 * Filtered client-side after a single `dismissed_at IS NULL` query rather
 * than pushed into a Postgrest `.or()` filter — simpler to read and avoids
 * timestamp-comparison edge cases across client/server clocks.
 */
export async function getActiveInsights(
  supabaseClient: SupabaseClient,
  tenantId: string
): Promise<InsightRow[]> {
  const { data, error } = await supabaseClient
    .from('insights')
    .select('*')
    .eq('tenant_id', tenantId)
    .is('dismissed_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;

  const nowMs = Date.now();
  return ((data ?? []) as InsightRow[]).filter(
    (row) => row.cooldown_until === null || new Date(row.cooldown_until).getTime() < nowMs
  );
}

/**
 * Dismisses one insight — sets `dismissed_at = now()` and a `cooldown_until`
 * COOLDOWN_DAYS out. The cooldown is applied HERE, not at creation (see the
 * insert path in runSubmissionChaser above): it suppresses the agent from
 * immediately re-raising the same finding again on its very next run right
 * after a Chief dismisses it, without delaying a brand-new insight's first
 * appearance in InsightsStrip.
 */
export async function dismissInsight(supabaseClient: SupabaseClient, insightId: string): Promise<void> {
  const cooldownUntil = new Date(Date.now() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabaseClient
    .from('insights')
    .update({ dismissed_at: new Date().toISOString(), cooldown_until: cooldownUntil })
    .eq('id', insightId);
  if (error) throw error;
}
