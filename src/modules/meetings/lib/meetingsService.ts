import { supabase } from '../../../lib/databaseService';

// Meetings & Actions module (migration 45) — a NEW, additive data-access
// slice for the generic meeting_series/meetings/meeting_actions tables,
// per docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md §7 (module 7, "Meetings &
// actions") and §8.2's "standing meeting template with agenda, minutes,
// and action-tracker pipeline" seed ask. There is no prior Meetings
// feature anywhere in this codebase — this is a genuine blank slate, not
// a rewire of something existing (unlike the Forms module's
// formService.ts, which this file's structure otherwise mirrors closely).
//
// Kept as its own module slice rather than added to
// src/lib/databaseService.ts, same "additive, sits alongside" precedent
// as formService.ts and every module under src/modules/ since the
// Living-System initiative (migrations 32-40) — see CLAUDE.md.
//
// SCOPE: schema + service + a standalone panel only (see
// MeetingsPanel.tsx). NOT wired into ChiefDashboardView.tsx, App.tsx, or
// any navigation in this pass — that wiring is a deliberate followup,
// flagged rather than silently done, same precedent as
// FormsBuilderPanel.tsx/IntegrationsPanel.tsx/CategoryManagerPanel.tsx
// each had before their own dashboard wiring landed.
//
// OWNERSHIP: meeting_series follows the same three-way ownership shape as
// form_instances (migration 42) — tenant-owned / doctor-owned (schema
// column only) / global default (tenant_id IS NULL AND doctor_id IS
// NULL). Migration 45 deliberately does NOT build a real
// `auth.uid() = doctor_id` RLS boundary in this pass (flagged in that
// migration's own header) — every row is equally readable/writable by
// any anon-key holder today, same as nearly every other table in this
// schema. `listMeetingSeries` below mirrors `listRubricTemplates`'s
// (src/modules/shared/lib/scoredRubricEngine.ts) global-OR-tenant-OR-doctor
// filter shape for consistency with that existing multi-owner-shape
// precedent.

function checkSupabase() {
  if (!supabase) {
    throw new Error('Supabase is not configured yet. Please provide VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment variables.');
  }
}

export interface AgendaItem {
  label: string;
  notes?: string;
}

export interface AgendaTemplate {
  items: AgendaItem[];
}

// Mirrors meeting_series (migration 45). tenant_id/doctor_id: at most one
// is set — a both-NULL row is a global seed default (e.g. "Standing
// Departmental Meeting"), same three-way shape as form_instances
// (migration 42's header has the full rationale).
export interface MeetingSeries {
  id: string;
  tenant_id: string | null;
  doctor_id: string | null;
  name: string;
  description: string | null;
  agenda_template: AgendaTemplate;
  is_system_default: boolean;
  created_by_workforce_id: string | null;
  created_at: string;
}

export type MeetingStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

// Mirrors meetings (migration 45). tenant_id/doctor_id are denormalized
// from the parent meeting_series row for cheap filtering — same
// precedent as form_entries.tenant_id relative to form_instances.
export interface Meeting {
  id: string;
  meeting_series_id: string;
  tenant_id: string | null;
  doctor_id: string | null;
  title: string;
  scheduled_at: string | null;
  agenda: AgendaTemplate;
  minutes: string | null;
  status: MeetingStatus;
  created_at: string;
}

export type MeetingActionStatus = 'open' | 'in_progress' | 'done' | 'overdue';

// Mirrors meeting_actions (migration 45) — the action-tracker pipeline
// output §7/§8.2 both call out explicitly.
export interface MeetingAction {
  id: string;
  meeting_id: string;
  description: string;
  owner_workforce_id: string | null;
  due_date: string | null;
  status: MeetingActionStatus;
  created_at: string;
  resolved_at: string | null;
}

export interface MeetingSeriesScope {
  tenantId?: string | null;
  doctorId?: string | null;
}

// Lists meeting series visible to the given scope: always includes global
// seed series (tenant_id IS NULL AND doctor_id IS NULL — e.g. "Standing
// Departmental Meeting"), plus the tenant's own series (if tenantId given)
// and/or the doctor's own series (if doctorId given). Same shape as
// listRubricTemplates (src/modules/shared/lib/scoredRubricEngine.ts).
export async function listMeetingSeries(scope: MeetingSeriesScope = {}): Promise<MeetingSeries[]> {
  checkSupabase();
  const { tenantId, doctorId } = scope;

  const clauses = ['and(tenant_id.is.null,doctor_id.is.null)'];
  if (tenantId) clauses.push(`tenant_id.eq.${tenantId}`);
  if (doctorId) clauses.push(`doctor_id.eq.${doctorId}`);

  const { data, error } = await supabase!
    .from('meeting_series')
    .select('*')
    .or(clauses.join(','))
    .order('created_at', { ascending: true });

  if (error) {
    console.warn('Error fetching meeting series:', error);
    throw error;
  }
  return data || [];
}

// Creates a new meeting series (the "builder" action). Exactly one of
// tenantId/doctorId should be passed for an org-owned or doctor-owned
// series; pass both null only to author a new global default (not
// expected from ordinary UI callers — MeetingsPanel.tsx never does this).
export async function createMeetingSeries(
  tenantId: string | null,
  doctorId: string | null,
  name: string,
  agendaTemplate: AgendaTemplate,
  description: string | null = null,
  createdByWorkforceId: string | null = null
): Promise<MeetingSeries> {
  checkSupabase();

  const { data, error } = await supabase!
    .from('meeting_series')
    .insert({
      tenant_id: tenantId,
      doctor_id: doctorId,
      name,
      description,
      agenda_template: agendaTemplate,
      created_by_workforce_id: createdByWorkforceId,
    })
    .select()
    .single();

  if (error) {
    console.warn('Error creating meeting series:', error);
    throw error;
  }
  return data;
}

// Lists occurrences of a given series, most recent first.
export async function listMeetings(meetingSeriesId: string): Promise<Meeting[]> {
  checkSupabase();

  const { data, error } = await supabase!
    .from('meetings')
    .select('*')
    .eq('meeting_series_id', meetingSeriesId)
    .order('scheduled_at', { ascending: false, nullsFirst: false });

  if (error) {
    console.warn('Error fetching meetings:', error);
    throw error;
  }
  return data || [];
}

// Schedules a new occurrence of a series, seeding its agenda from the
// series' agenda_template (independently editable from then on).
export async function scheduleMeeting(
  seriesId: string,
  title: string,
  scheduledAt: string | null
): Promise<Meeting> {
  checkSupabase();

  const { data: series, error: seriesError } = await supabase!
    .from('meeting_series')
    .select('tenant_id, doctor_id, agenda_template')
    .eq('id', seriesId)
    .single();

  if (seriesError) {
    console.warn('Error fetching meeting series for scheduling:', seriesError);
    throw seriesError;
  }

  const { data, error } = await supabase!
    .from('meetings')
    .insert({
      meeting_series_id: seriesId,
      tenant_id: series?.tenant_id ?? null,
      doctor_id: series?.doctor_id ?? null,
      title,
      scheduled_at: scheduledAt,
      agenda: series?.agenda_template ?? { items: [] },
    })
    .select()
    .single();

  if (error) {
    console.warn('Error scheduling meeting:', error);
    throw error;
  }
  return data;
}

// Updates a meeting's minutes (free text) — does not touch status/agenda.
export async function updateMeetingMinutes(meetingId: string, minutes: string): Promise<Meeting> {
  checkSupabase();

  const { data, error } = await supabase!
    .from('meetings')
    .update({ minutes })
    .eq('id', meetingId)
    .select()
    .single();

  if (error) {
    console.warn('Error updating meeting minutes:', error);
    throw error;
  }
  return data;
}

// Lists action items raised against a meeting, oldest first.
export async function listMeetingActions(meetingId: string): Promise<MeetingAction[]> {
  checkSupabase();

  const { data, error } = await supabase!
    .from('meeting_actions')
    .select('*')
    .eq('meeting_id', meetingId)
    .order('created_at', { ascending: true });

  if (error) {
    console.warn('Error fetching meeting actions:', error);
    throw error;
  }
  return data || [];
}

// Creates a new action item against a meeting (the action-tracker
// pipeline's write path, §7/§8.2).
//
// EVENT EMISSION — deliberate followup, not silently done: the spec's §6
// vocabulary names `meeting.action.owed` for exactly this write. This
// function does NOT call emitEvent(...) (src/modules/shared/lib/
// eventBus.ts) — wiring it in here would be a one-line addition, but
// eventBus.ts's own header documents that "nothing in this app currently
// reads event_log back out" and every existing call site treats emission
// as the caller's/a higher layer's decision (see submissionChaserAgent.ts
// for the one real producer so far). Adding a spine-level side effect to
// a first-slice, not-yet-wired-into-any-UI service felt like scope beyond
// what this pass asked for. If/when this module is wired into the
// dashboard, add here:
//   if (dueDate) {
//     await emitEvent(supabase!, {
//       tenantId, eventType: 'meeting.action.owed',
//       payload: { meeting_id: meetingId, description, due_date: dueDate },
//       source: 'meetings_module',
//     });
//   }
export async function createMeetingAction(
  meetingId: string,
  description: string,
  ownerWorkforceId: string | null,
  dueDate: string | null
): Promise<MeetingAction> {
  checkSupabase();

  const { data, error } = await supabase!
    .from('meeting_actions')
    .insert({
      meeting_id: meetingId,
      description,
      owner_workforce_id: ownerWorkforceId,
      due_date: dueDate,
    })
    .select()
    .single();

  if (error) {
    console.warn('Error creating meeting action:', error);
    throw error;
  }
  return data;
}

// Marks an action item resolved ('done', resolved_at stamped now).
export async function resolveMeetingAction(actionId: string): Promise<MeetingAction> {
  checkSupabase();

  const { data, error } = await supabase!
    .from('meeting_actions')
    .update({ status: 'done', resolved_at: new Date().toISOString() })
    .eq('id', actionId)
    .select()
    .single();

  if (error) {
    console.warn('Error resolving meeting action:', error);
    throw error;
  }
  return data;
}
