// L3 "Spine" foundation — minimal event emission helper.
//
// Backs `event_log` (supabase/migrations/32_event_log.sql). Per
// docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md's 5-layer anatomy (§3) and event
// vocabulary (§6), every layer of the app is meant to eventually emit
// structured lifecycle events into one append-only stream instead of each
// module inventing its own ad hoc audit log.
//
// SCOPE: this is deliberately just a typed insert wrapper — no pub/sub, no
// listeners, no in-process dispatch. Nothing in this app currently reads
// `event_log` back out; that's future work (an actual event bus with
// subscribers), not this pass. Call sites that want to start emitting
// events can import `emitEvent` and pass their own `supabase` client
// instance (usually the one exported from `src/lib/databaseService.ts`).
//
// `EventType` is a string-literal union covering the vocabulary named in
// §6, for editor autocomplete only — it is NOT enforced by the database.
// `event_log.event_type` is a free `text` column on purpose (see that
// migration's header): this repo already hit the exact pain of a
// CHECK-constrained action/event taxonomy needing repeated widening
// migrations (`ai_action_logs.action_type`, migrations 14 and 16). New
// event types can be added to this union at any time without a migration —
// widen the union, or pass a string outside it entirely (still accepted,
// just without autocomplete).

import type { SupabaseClient } from '@supabase/supabase-js';

export type EventType =
  // --- identity / membership lifecycle ---
  | 'member.provisioned'
  | 'member.linked'
  | 'member.deactivated'
  | 'member.role_changed'
  // --- tenant / organization lifecycle ---
  | 'tenant.provisioned'
  | 'tenant.plan_changed'
  | 'tenant.suspended'
  // --- workspace / instance lifecycle (research, casebook, dissertation, roster) ---
  | 'instance.created'
  | 'instance.updated'
  | 'instance.status_changed'
  | 'instance.archived'
  // --- entry lifecycle (a submission/chapter/case/log entry within an instance) ---
  | 'entry.submitted'
  | 'entry.updated'
  | 'entry.reviewed'
  | 'entry.approved'
  | 'entry.revisions_requested'
  // --- pipeline lifecycle (multi-stage processes: exam readiness, roster HITL, etc.) ---
  | 'pipeline.started'
  | 'pipeline.stage_advanced'
  | 'pipeline.completed'
  | 'pipeline.blocked'
  // --- academic milestones (dissertation stages, casebook/logbook sign-offs) ---
  | 'academic.milestone_submitted'
  | 'academic.milestone_reviewed'
  | 'academic.signoff_recorded'
  // --- meetings / scheduled sessions (viva, supervision) ---
  | 'meeting.scheduled'
  | 'meeting.completed'
  | 'meeting.cancelled'
  // --- billing ---
  | 'billing.checkout_started'
  | 'billing.subscription_activated'
  | 'billing.subscription_cancelled'
  | 'billing.quota_exhausted'
  // --- AI / agent actions (rungs — see agent_manifests, migration 34) ---
  | 'ai.action_invoked'
  | 'ai.action_completed'
  | 'ai.action_failed'
  // --- insights (future insight-generation engine — see udr.ts's `insights[]`) ---
  | 'insight.generated'
  | 'insight.acknowledged'
  // --- audit ---
  | 'audit.viewed'
  | 'audit.exported';

export interface EmitEventInput {
  /** Tenant the event belongs to, if any. Nullable — some events (e.g.
   *  platform-operator actions) are cross-tenant, same as `platform_operators`
   *  not being tenant-scoped (migration 11). */
  tenantId?: string | null;
  /** Free-text in the database; typed here against `EventType` for
   *  autocomplete, but any string is accepted so a caller isn't blocked on
   *  this union being updated first. */
  eventType: EventType | (string & {});
  /** Arbitrary structured detail about the event. Defaults to `{}`. */
  payload?: Record<string, unknown>;
  /** Free-text origin label, e.g. a module/component name or Edge Function slug. */
  source?: string | null;
  /** Free-text reference to the agent_manifests.agent_key that produced this
   *  event, when applicable (e.g. 'casebook_copilot_audit_case'). Not a
   *  foreign key — agent_manifests may not have a row for every source yet. */
  agentRef?: string | null;
}

/**
 * Inserts a single row into `event_log`. Intentionally dumb: no batching, no
 * retry, no in-process fan-out. Failures are surfaced to the caller (not
 * swallowed) since callers should decide for themselves whether a failed
 * event emission should block the action that triggered it — for most
 * call sites it should not, so wrap in try/catch at the call site if the
 * emission is "best effort" (matches this codebase's existing
 * `logAiAction`-failure-shouldn't-block-the-user convention, see
 * src/modules/dissertation/lib/academicCopilot.ts).
 */
export async function emitEvent(
  supabaseClient: SupabaseClient,
  input: EmitEventInput
): Promise<void> {
  const { tenantId = null, eventType, payload = {}, source = null, agentRef = null } = input;

  const { error } = await supabaseClient.from('event_log').insert({
    tenant_id: tenantId,
    event_type: eventType,
    payload,
    source,
    agent_ref: agentRef,
  });

  if (error) {
    throw error;
  }
}
