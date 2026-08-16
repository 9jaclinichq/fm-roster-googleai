// L1 Agent — "Meeting Action Chaser" (BabsBrain-2, rung 1).
//
// Per docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md §4 (intelligence ladder) this
// is a rung-1 "Reasoning" agent: it reads operational state (a tenant's
// meetings and their action items) and surfaces a finding — "shown as
// suggestion," never acted on autonomously. This is the SECOND agent driving
// data through the spine end to end (the first is submissionChaserAgent.ts,
// read that file first — this one mirrors its structure and conventions
// file-for-file): reads meeting_actions/meetings -> writes a persisted
// `insights` row (migration 37) -> emits an `insight.generated` event_log
// row (migration 32). Registered in `agent_manifests` (migration 50) as
// `babsbrain2_meeting_action_chaser`.
//
// SCOPE: deliberately narrow — one signal (open/in_progress meeting actions
// past their own due_date), one insight shape. Not a general-purpose rules
// engine. Mirrors submissionChaserAgent.ts's own scope note.
//
// STALENESS THRESHOLD: unlike Submission Chaser (which gates on a
// collection-level deadline), each `meeting_actions` row already carries its
// own `due_date` (migration 45) — that's the per-item staleness threshold
// here, no collection-level gate to check first.
//
// WHY THIS EXISTS: `src/modules/meetings/lib/meetingsService.ts`'s
// `createMeetingAction` used to carry a dead, commented-out `emitEvent(...,
// 'meeting.action.owed', ...)` call, flagged in its own comment as a
// deliberate followup ("wiring it in here would be a one-line addition...
// felt like scope beyond what this pass asked for"). This agent activates
// that real behavior properly — through the insights spine (so an overdue
// action surfaces as a dismissible, Chief-and-owner-visible finding, same as
// every other agent-raised insight), not as a bare event_log write at
// creation time. See the note left in meetingsService.ts pointing here.
//
// IDEMPOTENCY NOTE — mirrors submissionChaserAgent.ts's own dedup approach
// verbatim (read that file's header for the full reasoning): the dedup
// check below skips whenever a not-yet-superseded insight already exists for
// the subject (dismissed_at IS NULL, OR dismissed but still inside its own
// cooldown window). `cooldown_until` is left unset at insert time so a
// brand-new insight is immediately visible in InsightsStrip — the cooldown
// is only applied on dismissal (see dismissInsight, reused as-is from
// submissionChaserAgent.ts — see this file's own note below on why no
// duplicate read functions are defined here).

import type { SupabaseClient } from '@supabase/supabase-js';
import { emitEvent } from './eventBus';

export const MEETING_ACTION_CHASER_AGENT_KEY = 'babsbrain2_meeting_action_chaser';
const MEETING_ACTION_CHASER_RUNG = 1;

function subjectRefFor(meetingActionId: string): string {
  return `meeting_action:${meetingActionId}`;
}

interface OverdueMeetingActionRow {
  id: string;
  meeting_id: string;
  description: string;
  owner_workforce_id: string | null;
  due_date: string;
  status: string;
  meetings: { tenant_id: string | null; title: string } | { tenant_id: string | null; title: string }[] | null;
}

interface ExistingInsightRow {
  subject_ref: string | null;
  dismissed_at: string | null;
  cooldown_until: string | null;
}

export interface MeetingActionChaserRunResult {
  /** Open/in_progress meeting_actions rows past their own due_date, for
   *  this tenant, at the time this run started. */
  overdueCount: number;
  /** New insight rows actually inserted this run (excludes skipped dupes). */
  insightsCreated: number;
}

/**
 * Reads a tenant's meeting_actions (joined to their parent meetings for
 * tenant scoping — meeting_id -> meetings.id, meetings.tenant_id is already
 * denormalized per migration 45, no need to go all the way to
 * meeting_series) and raises a persisted, dismissible `insights` row for
 * each open/in_progress action whose due_date has passed. Idempotent: see
 * header note above for exactly how, mirroring submissionChaserAgent.ts.
 *
 * Mirrors the query shape of meetingsService.ts's listMeetingActions (read
 * for reference, not imported — modules never import modules, wire through
 * the spine per living-system spec §3/§8).
 */
export async function runMeetingActionChaser(
  supabaseClient: SupabaseClient,
  tenantId: string
): Promise<MeetingActionChaserRunResult> {
  const todayIso = new Date().toISOString().slice(0, 10);

  // 1. Overdue, still-open action items for this tenant, tenant-scoped
  //    through the meetings join — same pattern as submissionChaserAgent.ts's
  //    submissions!inner(workforce_id) join against `workforce.tenant_id`.
  const { data: overdueRows, error: actionsErr } = await supabaseClient
    .from('meeting_actions')
    .select('id, meeting_id, description, owner_workforce_id, due_date, status, meetings!inner(tenant_id, title)')
    .eq('meetings.tenant_id', tenantId)
    .in('status', ['open', 'in_progress'])
    .lt('due_date', todayIso);
  if (actionsErr) throw actionsErr;

  const overdue = (overdueRows ?? []) as OverdueMeetingActionRow[];
  if (overdue.length === 0) {
    return { overdueCount: 0, insightsCreated: 0 };
  }

  // 2. Dedup: find subject_refs that already have a not-yet-superseded
  //    insight (see header note for exactly what "not-yet-superseded" means
  //    and why it's not a literal read of the "active" formula).
  const candidateRefs = overdue.map((a) => subjectRefFor(a.id));
  const { data: existingRows, error: existingErr } = await supabaseClient
    .from('insights')
    .select('subject_ref, dismissed_at, cooldown_until')
    .eq('tenant_id', tenantId)
    .eq('agent_key', MEETING_ACTION_CHASER_AGENT_KEY)
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

  const toInsert = overdue.filter((a) => !blockedRefs.has(subjectRefFor(a.id)));
  if (toInsert.length === 0) {
    return { overdueCount: overdue.length, insightsCreated: 0 };
  }

  // cooldown_until is intentionally left unset here — see header note and
  // submissionChaserAgent.ts's own identical comment on this exact line.
  const rowsToInsert = toInsert.map((a) => {
    const meetingRow = Array.isArray(a.meetings) ? a.meetings[0] : a.meetings;
    const daysOverdue = Math.max(1, Math.floor((nowMs - new Date(a.due_date).getTime()) / (24 * 60 * 60 * 1000)));
    const meetingTitle = meetingRow?.title ? ` (from ${meetingRow.title})` : '';
    return {
      tenant_id: tenantId,
      agent_key: MEETING_ACTION_CHASER_AGENT_KEY,
      rung: MEETING_ACTION_CHASER_RUNG,
      text: `"${a.description}"${meetingTitle} is ${daysOverdue} day${daysOverdue === 1 ? '' : 's'} overdue (was due ${a.due_date}).`,
      action: { type: 'follow_up_on_action', meeting_action_id: a.id },
      workforce_id: a.owner_workforce_id,
      subject_ref: subjectRefFor(a.id),
    };
  });

  // Upsert against the partial unique index (migration 38, widened by
  // migration 49 to include doctor_id) instead of a plain insert — same
  // race-avoidance reasoning as submissionChaserAgent.ts's own upsert call.
  // This agent only ever inserts org-scoped rows (doctor_id always null
  // here, per the rowsToInsert shape above) -- doctor_id is included in the
  // conflict target only because it's part of the table's unique index now.
  const { error: insertErr } = await supabaseClient
    .from('insights')
    .upsert(rowsToInsert, { onConflict: 'tenant_id,doctor_id,agent_key,subject_ref', ignoreDuplicates: true });
  if (insertErr) throw insertErr;

  // One batched event for the whole run rather than one per insight — same
  // reasoning as submissionChaserAgent.ts's own batched event. Reuses
  // 'meeting.action.owed' (added to eventBus.ts's EventType union by this
  // change) for continuity with the event vocabulary migration 45's own
  // header already named for this exact write, rather than the more generic
  // 'insight.generated' — this run's whole purpose IS "these actions are
  // owed," so the domain-specific type carries more signal here than it
  // would for Submission Chaser's own run event.
  try {
    await emitEvent(supabaseClient, {
      tenantId,
      eventType: 'meeting.action.owed',
      source: MEETING_ACTION_CHASER_AGENT_KEY,
      agentRef: MEETING_ACTION_CHASER_AGENT_KEY,
      payload: {
        count: toInsert.length,
        meetingActionIds: toInsert.map((a) => a.id),
      },
    });
  } catch (eventErr) {
    // Best-effort, same convention as submissionChaserAgent.ts's own run
    // event — a failed event emission must never roll back or block the
    // insights that were already inserted.
    console.warn('meetingActionAgent: failed to emit meeting.action.owed event', eventErr);
  }

  return {
    overdueCount: overdue.length,
    insightsCreated: toInsert.length,
  };
}

// NOTE: no getActiveInsights/dismissInsight pair is defined in this file.
// submissionChaserAgent.ts's own versions of both are already fully generic
// — filtered only by `tenant_id` (getActiveInsights) or by `id`
// (dismissInsight), never by `agent_key` — so they already cover this
// agent's own rows with zero changes needed. Confirmed by reading both
// functions before writing this file; duplicating them here would just be
// dead code. Import them from submissionChaserAgent.ts at call sites that
// need to read/dismiss insights generically (as InsightsStrip.tsx already
// does).
