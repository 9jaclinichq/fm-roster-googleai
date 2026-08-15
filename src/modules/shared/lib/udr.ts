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
//     insights already exist for this workforce member. Scoped by
//     `workforce_id`, matching how insights are actually keyed today;
//     unlinked doctors (no workforce row) always get `insights: []`, since
//     nothing in this app raises insights against a bare doctor_id yet.
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

export type UdrEntryType = 'submission' | 'case_report' | 'dissertation_milestone';

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

export interface UnifiedDoctorRecord {
  identity: UdrIdentity;
  tenant: UdrTenant | null;
  instances: UdrInstance[];
  entries: UdrEntry[];
  academic: UdrAcademic;
  billing: UdrBilling;
  insights: UdrInsight[];
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
  };
}
