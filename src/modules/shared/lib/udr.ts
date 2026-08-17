// L3 "Spine" foundation — Unified Doctor Record (UDR) read-composition layer.
//
// docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md §5 describes a `udr.*` shape
// (identity, tenant, instances, entries, academic, billing, insights) as if
// it were backed by one generic set of tables. Building that literally would
// mean migrating every existing table (submissions, case_reports,
// research_workspaces, casebook_workspaces, user_subscriptions, ...) into a
// new generic schema — a large, high-risk rewrite of a live production
// database. That was explicitly NOT done here.
//
// Instead, `getUnifiedDoctorRecord` is a pure READ-COMPOSITION function: it
// queries the tables that already exist today (see src/types.ts and
// src/lib/databaseService.ts for their real shapes) and reassembles the
// result into §5's shape purely by reading and reshaping data that already
// lives elsewhere. It creates no new storage and performs no writes.
//
// SCOPE NOTES (what this does and doesn't cover, so gaps are visible rather
// than silently missing):
//   - `insights[]` reads the real `insights` table (migration 37) — the
//     first real agent, Submission Chaser (src/modules/shared/lib/
//     submissionChaserAgent.ts), started writing real rows there once it was
//     wired into InsightsStrip.tsx. This function does NOT run that agent
//     itself (still a pure read, no writes) — it only surfaces whatever
//     insights already exist. Scoped by `workforce_id` when a workforce row
//     is present; a genuinely unlinked doctor (migration 49 — insights.
//     doctor_id — made this possible) is scoped by `doctor_id` instead, via
//     fetchInsightsForDoctor(). Still returns `[]` for every doctor today,
//     but now because no agent WRITES a doctor-scoped insight yet, not
//     because the schema/read-path can't represent one — see migration 49's
//     own header for the distinction.
//   - `entries[]` covers `submissions` (monthly roster entries) and
//     `case_reports` (the original 15-slot Casebook Builder MVP) plus
//     `dissertation_milestones` — the three genuinely flat "one entry per
//     event" tables tied directly to a workforce member. It deliberately
//     does NOT expand into `research_chapters` / `clinical_case_reports`
//     (children of `research_workspaces`/`casebook_workspaces`) — those are
//     represented at the coarser `instances[]` granularity instead, to keep
//     this a bounded read rather than an unbounded fan-out join. A caller
//     that needs chapter/case-level detail should query those workspace
//     tables directly (see `databaseService.getResearchWorkspace` /
//     `getCasebookWorkspace` and their child-table getters).
//   - `billing` only reflects a per-resident (`workforce_id`-scoped)
//     subscription via `user_subscriptions` — there is no doctor_id column
//     on that table today, so an unlinked individual doctor's `billing`
//     is always `{ activeSubscription: null }`. Org-wide (`scope='tenant'`)
//     subscriptions are not surfaced here either, since they belong to the
//     tenant, not to an individual doctor record.
//   - EXTENDED 2026-08-17 (living-system re-audit, docs/LIVING_SYSTEM_GAP_AUDIT.md's
//     addendum §5 finding) to cover migrations 41/44/45/48 (Scored Rubric,
//     Scheduling, Meetings, Clinical Writing), which shipped after this file
//     was first written and were never wired back in. Deliberately did NOT
//     add `scheduling_instances`/`clinical_document_types` to `instances[]`
//     despite being schema-shaped like one: unlike `research_workspaces`/
//     `casebook_workspaces` (owned directly by one `workforce_id`/`doctor_id`
//     — a genuinely personal track), a scheduling instance or a clinical
//     document TYPE is a tenant-shared builder/template object (its
//     `tenant_id`/`doctor_id` mean "visible to this org/doctor's scope", not
//     "this is my personal thing") — folding every org-wide roster/document-
//     type definition into one person's UDR would misrepresent shared config
//     as personal records. The genuinely personal artifacts one level down
//     (`clinical_documents.created_by_workforce_id`, a real per-person
//     authorship column; `rubric_instances.assessor_workforce_id`/
//     `assessor_doctor_id`, a real per-person assessor column) are surfaced
//     in `entries[]` instead, matching that field's own "one entry per
//     event tied to this person" definition exactly.
//   - `meetings[]` (new): `meetings`/`meeting_series` are tenant/doctor-scoped
//     builder+instance objects with no per-attendee column at all — the one
//     genuinely personal link is `meeting_actions.owner_workforce_id` (who a
//     specific action is owed by). Scoped to meetings where the caller owns
//     at least one action, matching the spec's own §5 shape "(meeting_id,
//     items raised, actions owed)" read as "meetings THIS person has a stake
//     in", not "every meeting in the tenant". Live `meeting_actions` has 0
//     rows today (Meetings module is scaffolded, not yet used beyond its one
//     seed series) — this always returns `[]` right now, same "real path,
//     no producer yet" state `fetchInsightsForDoctor` was already in before
//     Submission Chaser started writing doctor-scoped insights.
//   - `pipelines[]` (new): backed by `form_pipelines`/`scheduling_pipelines`
//     (both migration-35/44-shaped: `instance_id`, `pipeline_type`, `config`,
//     `created_at`). Scoped through the owning instance's `tenant_id`/
//     `doctor_id` (pipelines themselves don't carry a per-person owner —
//     they're config attached to a shared instance, not a personal one).
//     `created_at` stands in for the spec's `ran_at` loosely: today's one
//     real `form_pipelines` row (`schedule_to_roster`) documents a pipeline
//     CONCEPT that's actually implemented directly in `ResidentFormView.tsx`/
//     `databaseService.ts`, not a per-run execution log — there is no real
//     per-execution `ran_at` timestamp anywhere in this schema yet. Flagged
//     here rather than faked.
//   - `audit[]` (new): **no real source exists.** `event_log` (migration 32)
//     has no per-person actor column at all — only `tenant_id`/`event_type`/
//     `payload`/`source`/`agent_ref`. Scoping it by the caller's tenant would
//     misattribute every OTHER member's tenant-wide event as this person's
//     own audit trail, which is worse than an honest gap. The field exists
//     on `UnifiedDoctorRecord` (per spec §5) and always returns `[]` — this
//     is the one field in this extension with no real backing data source
//     at all, unlike `meetings[]`/`pipelines[]` above which have a real path
//     that's simply unused so far.
//   - An individual doctor identity (`doctor_profiles`, migration 18) can
//     be *linked* to an institutional `workforce` row via
//     `workforce.doctor_id`. When looked up by `doctorId` and a linked
//     workforce row is found, this function pulls in that workforce row's
//     tenant/entries/billing too — matching how the rest of the app already
//     treats a linked doctor as gaining the resident dashboard (see
//     CLAUDE.md's migration 18 notes). An unlinked doctor gets `tenant:
//     null` and doctor_id-scoped `instances` only (personal research/
//     casebook workspaces, migration 25).

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Category,
  CaseReport,
  Dissertation,
  DissertationMilestone,
  ExamReadiness,
  Submission,
  Tenant,
  UserSubscription,
} from '../../../types';

// Mirrors WORKFORCE_PUBLIC_COLUMNS in src/lib/databaseService.ts —
// `resident_code` is locked down at the database level and never selectable
// by anon/authenticated (see migration 02), so it's excluded here too.
const WORKFORCE_PUBLIC_COLUMNS = 'id, full_name, category, active, on_floor, tenant_id, doctor_id, created_at';

export type UdrLookupRef = { workforceId: string } | { doctorId: string };

export interface UdrIdentity {
  /** Which identity path this record was resolved from — a `workforce` row
   *  (plaintext-code resident/Chief flow) and/or a `doctor_profiles` row
   *  (Supabase Auth individual-doctor flow, migration 18) can both be
   *  present when a doctor is linked to an institutional workforce row. */
  kind: 'workforce' | 'doctor' | 'workforce_linked_to_doctor';
  workforceId: string | null;
  doctorId: string | null;
  fullName: string | null;
  email: string | null;
  category: Category | null;
  active: boolean | null;
}

export interface UdrTenant {
  id: string;
  name: string;
  shortCode: string;
  planType: Tenant['plan_type'];
  status: Tenant['status'];
}

export type UdrInstanceType = 'research_workspace' | 'casebook_workspace';

export interface UdrInstance {
  id: string;
  type: UdrInstanceType;
  title: string;
  status: string;
  tenantId: string | null;
  createdAt: string;
}

export type UdrEntryType = 'submission' | 'case_report' | 'dissertation_milestone' | 'clinical_document' | 'rubric_instance';

export interface UdrEntry {
  id: string;
  type: UdrEntryType;
  status: string | null;
  summary: string;
  createdAt: string;
}

export interface UdrAcademic {
  dissertation: Dissertation | null;
  examReadiness: ExamReadiness | null;
  caseReportsCount: number;
}

export interface UdrBilling {
  activeSubscription: UserSubscription | null;
}

// Mirrors the real `insights` table (migration 37) — trimmed to the fields
// a UDR consumer actually needs (no tenant_id/subject_ref/cooldown_until,
// those are agent/dedup-internal, not part of this record's public shape).
export interface UdrInsight {
  id: string;
  agentKey: string;
  rung: number;
  text: string;
  action: Record<string, unknown>;
  createdAt: string;
}

// See this file's header (2026-08-17 extension note) for why meetings[] is
// scoped to "meetings this person owes an action on", not every tenant
// meeting.
export interface UdrMeetingAction {
  id: string;
  description: string;
  status: string;
  dueDate: string | null;
}

export interface UdrMeeting {
  id: string;
  title: string;
  scheduledAt: string | null;
  status: string;
  itemsRaised: string[];
  actionsOwed: UdrMeetingAction[];
}

// See this file's header for why `ranAt` is really "defined/created at",
// not a per-execution timestamp — no such data exists yet.
export interface UdrPipeline {
  id: string;
  instanceId: string;
  pipelineType: string;
  ranAt: string;
}

// Always `[]` today — see this file's header note on why no real per-person
// audit source exists yet. Shape kept per spec §5 so a future real source
// (should one ever exist) doesn't need an interface change.
export interface UdrAuditEntry {
  who: string;
  what: string;
  when: string;
  why: string | null;
}

export interface UnifiedDoctorRecord {
  identity: UdrIdentity;
  tenant: UdrTenant | null;
  instances: UdrInstance[];
  entries: UdrEntry[];
  academic: UdrAcademic;
  billing: UdrBilling;
  insights: UdrInsight[];
  meetings: UdrMeeting[];
  pipelines: UdrPipeline[];
  audit: UdrAuditEntry[];
}

interface WorkforceRow {
  id: string;
  full_name: string;
  category: Category;
  active: boolean;
  on_floor: boolean;
  tenant_id?: string;
  doctor_id?: string | null;
  created_at: string;
}

interface DoctorProfileRow {
  id: string;
  email: string;
  full_name: string;
  created_at: string;
}

async function fetchWorkforceById(client: SupabaseClient, id: string): Promise<WorkforceRow | null> {
  const { data, error } = await client
    .from('workforce')
    .select(WORKFORCE_PUBLIC_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as WorkforceRow | null) ?? null;
}

async function fetchWorkforceLinkedToDoctor(client: SupabaseClient, doctorId: string): Promise<WorkforceRow | null> {
  const { data, error } = await client
    .from('workforce')
    .select(WORKFORCE_PUBLIC_COLUMNS)
    .eq('doctor_id', doctorId)
    .maybeSingle();
  if (error) throw error;
  return (data as WorkforceRow | null) ?? null;
}

async function fetchDoctorProfile(client: SupabaseClient, doctorId: string): Promise<DoctorProfileRow | null> {
  const { data, error } = await client
    .from('doctor_profiles')
    .select('*')
    .eq('id', doctorId)
    .maybeSingle();
  if (error) throw error;
  return (data as DoctorProfileRow | null) ?? null;
}

async function fetchTenant(client: SupabaseClient, tenantId: string): Promise<Tenant | null> {
  const { data, error } = await client.from('tenants').select('*').eq('id', tenantId).maybeSingle();
  if (error) throw error;
  return (data as Tenant | null) ?? null;
}

async function fetchInstances(
  client: SupabaseClient,
  filter: { workforceId?: string; doctorId?: string }
): Promise<UdrInstance[]> {
  const instances: UdrInstance[] = [];

  // research_workspaces/casebook_workspaces can be owned by EITHER
  // workforce_id OR doctor_id (never both — see migration 25); when both
  // refs are known (a linked doctor), union both owner columns' rows.
  if (filter.workforceId) {
    const { data, error } = await client
      .from('research_workspaces')
      .select('id, title, status, tenant_id, created_at')
      .eq('workforce_id', filter.workforceId);
    if (error) throw error;
    for (const row of data ?? []) {
      instances.push({ id: row.id, type: 'research_workspace', title: row.title, status: row.status, tenantId: row.tenant_id, createdAt: row.created_at });
    }

    const { data: cbData, error: cbError } = await client
      .from('casebook_workspaces')
      .select('id, title, status, tenant_id, created_at')
      .eq('workforce_id', filter.workforceId);
    if (cbError) throw cbError;
    for (const row of cbData ?? []) {
      instances.push({ id: row.id, type: 'casebook_workspace', title: row.title, status: row.status, tenantId: row.tenant_id, createdAt: row.created_at });
    }
  }

  if (filter.doctorId) {
    const { data, error } = await client
      .from('research_workspaces')
      .select('id, title, status, tenant_id, created_at')
      .eq('doctor_id', filter.doctorId);
    if (error) throw error;
    for (const row of data ?? []) {
      instances.push({ id: row.id, type: 'research_workspace', title: row.title, status: row.status, tenantId: row.tenant_id, createdAt: row.created_at });
    }

    const { data: cbData, error: cbError } = await client
      .from('casebook_workspaces')
      .select('id, title, status, tenant_id, created_at')
      .eq('doctor_id', filter.doctorId);
    if (cbError) throw cbError;
    for (const row of cbData ?? []) {
      instances.push({ id: row.id, type: 'casebook_workspace', title: row.title, status: row.status, tenantId: row.tenant_id, createdAt: row.created_at });
    }
  }

  return instances;
}

async function fetchSubmissions(client: SupabaseClient, workforceId: string): Promise<Submission[]> {
  const { data, error } = await client
    .from('submissions')
    .select('*')
    .eq('workforce_id', workforceId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as Submission[] | null) ?? [];
}

async function fetchCaseReports(client: SupabaseClient, workforceId: string): Promise<CaseReport[]> {
  const { data, error } = await client
    .from('case_reports')
    .select('*')
    .eq('workforce_id', workforceId)
    .order('case_number', { ascending: true });
  if (error) throw error;
  return (data as CaseReport[] | null) ?? [];
}

async function fetchDissertation(client: SupabaseClient, workforceId: string): Promise<Dissertation | null> {
  const { data, error } = await client.from('dissertations').select('*').eq('workforce_id', workforceId).maybeSingle();
  if (error) throw error;
  return (data as Dissertation | null) ?? null;
}

async function fetchDissertationMilestones(client: SupabaseClient, dissertationId: string): Promise<DissertationMilestone[]> {
  const { data, error } = await client
    .from('dissertation_milestones')
    .select('*')
    .eq('dissertation_id', dissertationId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as DissertationMilestone[] | null) ?? [];
}

async function fetchExamReadiness(client: SupabaseClient, workforceId: string): Promise<ExamReadiness | null> {
  // Deliberately a plain read, NOT databaseService.getOrCreateExamReadiness
  // — this layer is read-only and must not create rows as a side effect of
  // being read.
  const { data, error } = await client.from('exam_readiness').select('*').eq('workforce_id', workforceId).maybeSingle();
  if (error) throw error;
  return (data as ExamReadiness | null) ?? null;
}

interface InsightRow {
  id: string;
  agent_key: string;
  rung: number;
  text: string;
  action: Record<string, unknown> | null;
  created_at: string;
}

async function fetchInsights(client: SupabaseClient, workforceId: string): Promise<UdrInsight[]> {
  const { data, error } = await client
    .from('insights')
    .select('id, agent_key, rung, text, action, created_at')
    .eq('workforce_id', workforceId)
    .is('dismissed_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data as InsightRow[] | null) ?? []).map((row) => ({
    id: row.id,
    agentKey: row.agent_key,
    rung: row.rung,
    text: row.text,
    action: row.action ?? {},
    createdAt: row.created_at,
  }));
}

// Doctor-scoped counterpart, added by migration 49 once `insights` stopped
// requiring a tenant_id and gained a nullable doctor_id column. No agent in
// this app writes a doctor-scoped insight yet (Submission Chaser remains
// org-only) — this function exists so that gap is a "nothing produces one
// yet" state, not a "the read path can't even surface one if it existed"
// state, matching migration 49's own header note on why both were fixed
// together.
async function fetchInsightsForDoctor(client: SupabaseClient, doctorId: string): Promise<UdrInsight[]> {
  const { data, error } = await client
    .from('insights')
    .select('id, agent_key, rung, text, action, created_at')
    .eq('doctor_id', doctorId)
    .is('dismissed_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data as InsightRow[] | null) ?? []).map((row) => ({
    id: row.id,
    agentKey: row.agent_key,
    rung: row.rung,
    text: row.text,
    action: row.action ?? {},
    createdAt: row.created_at,
  }));
}

interface ClinicalDocumentRow {
  id: string;
  title: string;
  status: string;
  created_at: string;
}

async function fetchClinicalDocuments(client: SupabaseClient, workforceId: string): Promise<UdrEntry[]> {
  const { data, error } = await client
    .from('clinical_documents')
    .select('id, title, status, created_at')
    .eq('created_by_workforce_id', workforceId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data as ClinicalDocumentRow[] | null) ?? []).map((row) => ({
    id: row.id,
    type: 'clinical_document',
    status: row.status,
    summary: row.title,
    createdAt: row.created_at,
  }));
}

interface RubricInstanceRow {
  id: string;
  subject_ref: string | null;
  created_at: string;
}

async function fetchRubricInstances(
  client: SupabaseClient,
  filter: { workforceId?: string; doctorId?: string }
): Promise<UdrEntry[]> {
  let query = client.from('rubric_instances').select('id, subject_ref, created_at');
  if (filter.workforceId) {
    query = query.eq('assessor_workforce_id', filter.workforceId);
  } else if (filter.doctorId) {
    query = query.eq('assessor_doctor_id', filter.doctorId);
  } else {
    return [];
  }
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  return ((data as RubricInstanceRow[] | null) ?? []).map((row) => ({
    id: row.id,
    type: 'rubric_instance',
    status: null,
    summary: row.subject_ref ? `Rubric assessment: ${row.subject_ref}` : 'Rubric assessment',
    createdAt: row.created_at,
  }));
}

interface MeetingActionRow {
  id: string;
  meeting_id: string;
  description: string;
  status: string;
  due_date: string | null;
}

interface MeetingRow {
  id: string;
  title: string;
  scheduled_at: string | null;
  status: string;
  agenda: { items?: { label?: string }[] } | null;
}

async function fetchMeetings(client: SupabaseClient, workforceId: string): Promise<UdrMeeting[]> {
  const { data: actions, error: actionsError } = await client
    .from('meeting_actions')
    .select('id, meeting_id, description, status, due_date')
    .eq('owner_workforce_id', workforceId);
  if (actionsError) throw actionsError;
  const actionRows = (actions as MeetingActionRow[] | null) ?? [];
  if (actionRows.length === 0) return [];

  const meetingIds = [...new Set(actionRows.map((a) => a.meeting_id))];
  const { data: meetings, error: meetingsError } = await client
    .from('meetings')
    .select('id, title, scheduled_at, status, agenda')
    .in('id', meetingIds);
  if (meetingsError) throw meetingsError;

  return ((meetings as MeetingRow[] | null) ?? []).map((m) => ({
    id: m.id,
    title: m.title,
    scheduledAt: m.scheduled_at,
    status: m.status,
    itemsRaised: (m.agenda?.items ?? []).map((item) => item.label ?? '').filter(Boolean),
    actionsOwed: actionRows
      .filter((a) => a.meeting_id === m.id)
      .map((a) => ({ id: a.id, description: a.description, status: a.status, dueDate: a.due_date })),
  }));
}

interface PipelineRow {
  id: string;
  instance_id: string;
  pipeline_type: string;
  created_at: string;
}

async function fetchPipelines(client: SupabaseClient, tenantId: string): Promise<UdrPipeline[]> {
  // See this file's header for why these are scoped through the owning
  // instance's tenant, not a per-person owner column (pipelines don't have
  // one — they're shared config attached to a shared instance).
  const pipelines: UdrPipeline[] = [];

  const { data: formInstanceIds, error: fiError } = await client
    .from('form_instances')
    .select('id')
    .eq('tenant_id', tenantId);
  if (fiError) throw fiError;
  const formIds = (formInstanceIds ?? []).map((r: { id: string }) => r.id);
  if (formIds.length > 0) {
    const { data, error } = await client
      .from('form_pipelines')
      .select('id, instance_id, pipeline_type, created_at')
      .in('instance_id', formIds);
    if (error) throw error;
    for (const row of (data as PipelineRow[] | null) ?? []) {
      pipelines.push({ id: row.id, instanceId: row.instance_id, pipelineType: row.pipeline_type, ranAt: row.created_at });
    }
  }

  const { data: schedInstanceIds, error: siError } = await client
    .from('scheduling_instances')
    .select('id')
    .eq('tenant_id', tenantId);
  if (siError) throw siError;
  const schedIds = (schedInstanceIds ?? []).map((r: { id: string }) => r.id);
  if (schedIds.length > 0) {
    const { data, error } = await client
      .from('scheduling_pipelines')
      .select('id, instance_id, pipeline_type, created_at')
      .in('instance_id', schedIds);
    if (error) throw error;
    for (const row of (data as PipelineRow[] | null) ?? []) {
      pipelines.push({ id: row.id, instanceId: row.instance_id, pipelineType: row.pipeline_type, ranAt: row.created_at });
    }
  }

  return pipelines;
}

async function fetchActiveSubscription(client: SupabaseClient, workforceId: string): Promise<UserSubscription | null> {
  const { data, error } = await client
    .from('user_subscriptions')
    .select('*')
    .eq('workforce_id', workforceId)
    .eq('status', 'active')
    .gt('current_period_end', new Date().toISOString())
    .order('current_period_end', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as UserSubscription | null) ?? null;
}

/**
 * Assembles a Unified Doctor Record (§5) by reading and reshaping data that
 * already lives in existing tables — no new storage, no writes. Accepts
 * either a `workforceId` (plaintext-code resident/Chief identity) or a
 * `doctorId` (Supabase Auth individual-doctor identity, migration 18); the
 * caller supplies whichever one it already has from the current session.
 */
export async function getUnifiedDoctorRecord(
  supabaseClient: SupabaseClient,
  ref: UdrLookupRef
): Promise<UnifiedDoctorRecord> {
  let workforceRow: WorkforceRow | null = null;
  let doctorRow: DoctorProfileRow | null = null;

  if ('workforceId' in ref) {
    workforceRow = await fetchWorkforceById(supabaseClient, ref.workforceId);
    if (workforceRow?.doctor_id) {
      doctorRow = await fetchDoctorProfile(supabaseClient, workforceRow.doctor_id);
    }
  } else {
    doctorRow = await fetchDoctorProfile(supabaseClient, ref.doctorId);
    workforceRow = await fetchWorkforceLinkedToDoctor(supabaseClient, ref.doctorId);
  }

  const identity: UdrIdentity = {
    kind: workforceRow && doctorRow ? 'workforce_linked_to_doctor' : workforceRow ? 'workforce' : 'doctor',
    workforceId: workforceRow?.id ?? null,
    doctorId: doctorRow?.id ?? null,
    fullName: workforceRow?.full_name ?? doctorRow?.full_name ?? null,
    email: doctorRow?.email ?? null,
    category: workforceRow?.category ?? null,
    active: workforceRow?.active ?? null,
  };

  let tenant: UdrTenant | null = null;
  if (workforceRow?.tenant_id) {
    const tenantRow = await fetchTenant(supabaseClient, workforceRow.tenant_id);
    if (tenantRow) {
      tenant = {
        id: tenantRow.id,
        name: tenantRow.name,
        shortCode: tenantRow.short_code,
        planType: tenantRow.plan_type,
        status: tenantRow.status,
      };
    }
  }

  const instances = await fetchInstances(supabaseClient, {
    workforceId: workforceRow?.id,
    doctorId: doctorRow?.id,
  });

  const entries: UdrEntry[] = [];
  let dissertation: Dissertation | null = null;
  let examReadiness: ExamReadiness | null = null;
  let caseReportsCount = 0;
  let activeSubscription: UserSubscription | null = null;
  let insights: UdrInsight[] = [];
  let meetings: UdrMeeting[] = [];
  let pipelines: UdrPipeline[] = [];

  if (workforceRow) {
    const [submissions, caseReports] = await Promise.all([
      fetchSubmissions(supabaseClient, workforceRow.id),
      fetchCaseReports(supabaseClient, workforceRow.id),
    ]);

    for (const s of submissions) {
      entries.push({
        id: s.id,
        type: 'submission',
        status: s.taking_leave ? 'leave_declared' : 'rotation_only',
        summary: `${s.current_rotation} -> ${s.next_rotation}`,
        createdAt: s.created_at,
      });
    }

    for (const c of caseReports) {
      entries.push({
        id: c.id,
        type: 'case_report',
        status: c.status,
        summary: `Case ${c.case_number}${c.diagnosis ? `: ${c.diagnosis}` : ''}`,
        createdAt: c.created_at,
      });
    }
    caseReportsCount = caseReports.length;

    dissertation = await fetchDissertation(supabaseClient, workforceRow.id);
    if (dissertation) {
      const milestones = await fetchDissertationMilestones(supabaseClient, dissertation.id);
      for (const m of milestones) {
        entries.push({
          id: m.id,
          type: 'dissertation_milestone',
          status: m.status,
          summary: m.stage,
          createdAt: m.created_at,
        });
      }
    }

    examReadiness = await fetchExamReadiness(supabaseClient, workforceRow.id);
    activeSubscription = await fetchActiveSubscription(supabaseClient, workforceRow.id);
    insights = await fetchInsights(supabaseClient, workforceRow.id);

    const [clinicalDocs, rubricInstances, workforceMeetings] = await Promise.all([
      fetchClinicalDocuments(supabaseClient, workforceRow.id),
      fetchRubricInstances(supabaseClient, { workforceId: workforceRow.id }),
      fetchMeetings(supabaseClient, workforceRow.id),
    ]);
    entries.push(...clinicalDocs, ...rubricInstances);
    meetings = workforceMeetings;

    if (workforceRow.tenant_id) {
      pipelines = await fetchPipelines(supabaseClient, workforceRow.tenant_id);
    }
  } else if (doctorRow) {
    // Genuinely unlinked doctor (no workforce row at all) — entries/
    // academic/billing stay empty (those tables have no doctor_id path,
    // per this file's own header note), but insights now can be non-empty
    // since migration 49 added insights.doctor_id. Will still return []
    // today since no agent writes one yet — see fetchInsightsForDoctor's
    // own comment. rubric_instances DOES have a real assessor_doctor_id
    // path (migration 41), so that one entry type can be non-empty for an
    // unlinked doctor even though clinical_documents/meetings/pipelines
    // cannot (no doctor_id-scoped path exists for those yet).
    insights = await fetchInsightsForDoctor(supabaseClient, doctorRow.id);
    entries.push(...(await fetchRubricInstances(supabaseClient, { doctorId: doctorRow.id })));
  }

  entries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return {
    identity,
    tenant,
    instances,
    entries,
    academic: {
      dissertation,
      examReadiness,
      caseReportsCount,
    },
    billing: {
      activeSubscription,
    },
    insights,
    meetings,
    pipelines,
    // Always [] — see this file's header note on why no real per-person
    // audit source exists yet.
    audit: [],
  };
}
