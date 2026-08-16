import { supabase } from '../../../lib/databaseService';

// Personal Tasks module (migration 51) — a NEW, additive data-access slice
// for the personal_tasks table. One of 4 modules selected from the
// "Workspc" Flutter reference study this session (see migration 51's own
// header) as genuinely-missing capability. Distinct from
// meeting_actions/meetingsService.ts: a personal task is free-standing, not
// tied to any meeting.
//
// Kept as its own module slice rather than added to
// src/lib/databaseService.ts, same "additive, sits alongside" precedent as
// formService.ts/meetingsService.ts — see CLAUDE.md.
//
// OWNERSHIP: personal_tasks.workforce_id/doctor_id is an exactly-one-set
// pair (migration 51's CHECK constraint), NOT the tenant_id/doctor_id shape
// form_instances/research_workspaces use — see that migration's header for
// why (a task always belongs to exactly one PERSON, never "the org").
// tenant_id is a denormalized convenience column only, set for
// workforce-owned rows and left null for doctor-owned ones.

function checkSupabase() {
  if (!supabase) {
    throw new Error('Supabase is not configured yet. Please provide VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment variables.');
  }
}

export interface TaskOwnerRef {
  workforceId?: string;
  doctorId?: string;
  tenantId?: string; // only meaningful for workforce owner
}

export type TaskPriority = 'high' | 'medium' | 'low';
export type TaskStatus = 'open' | 'done';

export interface PersonalTaskRow {
  id: string;
  title: string;
  priority: TaskPriority;
  due_date: string | null;
  status: TaskStatus;
  created_at: string;
  completed_at: string | null;
}

const PRIORITY_ORDER: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };

// Fetches all tasks for the given owner (workforce or doctor, whichever of
// TaskOwnerRef's two id fields is set) and sorts them client-side: open
// before done, then by priority (high first), then by due date ascending
// (nulls last) — simplest correct approach, since Postgrest has no native
// way to express a custom 'high'/'medium'/'low' ordering.
export async function listTasksForOwner(owner: TaskOwnerRef): Promise<PersonalTaskRow[]> {
  checkSupabase();

  let query = supabase!.from('personal_tasks').select('*');
  if (owner.workforceId) {
    query = query.eq('workforce_id', owner.workforceId);
  } else if (owner.doctorId) {
    query = query.eq('doctor_id', owner.doctorId);
  } else {
    throw new Error('listTasksForOwner requires either workforceId or doctorId.');
  }

  const { data, error } = await query;

  if (error) {
    console.warn('Error fetching personal tasks:', error);
    throw error;
  }

  const rows = data || [];
  return [...rows].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
    const priorityDiff = PRIORITY_ORDER[a.priority as TaskPriority] - PRIORITY_ORDER[b.priority as TaskPriority];
    if (priorityDiff !== 0) return priorityDiff;
    if (a.due_date === b.due_date) return 0;
    if (a.due_date === null) return 1;
    if (b.due_date === null) return -1;
    return a.due_date < b.due_date ? -1 : 1;
  });
}

export async function createTask(
  owner: TaskOwnerRef,
  title: string,
  priority: TaskPriority,
  dueDate: string | null = null
): Promise<PersonalTaskRow> {
  checkSupabase();

  const { data, error } = await supabase!
    .from('personal_tasks')
    .insert({
      tenant_id: owner.tenantId ?? null,
      workforce_id: owner.workforceId ?? null,
      doctor_id: owner.doctorId ?? null,
      title,
      priority,
      due_date: dueDate ?? null,
      status: 'open',
    })
    .select()
    .single();

  if (error) {
    console.warn('Error creating personal task:', error);
    throw error;
  }
  return data;
}

// Flips a task between open/done. Sets completed_at to now() when marking
// done, and clears it back to null when reopening.
export async function toggleTaskStatus(taskId: string, currentStatus: TaskStatus): Promise<PersonalTaskRow> {
  checkSupabase();

  const nextStatus: TaskStatus = currentStatus === 'open' ? 'done' : 'open';
  const { data, error } = await supabase!
    .from('personal_tasks')
    .update({
      status: nextStatus,
      completed_at: nextStatus === 'done' ? new Date().toISOString() : null,
    })
    .eq('id', taskId)
    .select()
    .single();

  if (error) {
    console.warn('Error toggling personal task status:', error);
    throw error;
  }
  return data;
}

export async function deleteTask(taskId: string): Promise<void> {
  checkSupabase();

  const { error } = await supabase!
    .from('personal_tasks')
    .delete()
    .eq('id', taskId);

  if (error) {
    console.warn('Error deleting personal task:', error);
    throw error;
  }
}
