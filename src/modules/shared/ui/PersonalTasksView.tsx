import React, { useEffect, useState } from 'react';
import {
  listTasksForOwner,
  createTask,
  toggleTaskStatus,
  deleteTask,
  TaskOwnerRef,
  TaskPriority,
  PersonalTaskRow,
} from '../lib/personalTasksService';
import { CheckCircle2, Circle, Trash2, Plus, ChevronDown, ChevronRight, ListTodo } from 'lucide-react';

// Personal Tasks module (migration 51) — a NEW, standalone screen for the
// personal_tasks table. One of 4 modules selected from the "Workspc"
// Flutter reference study this session; carries over the reference
// mockups' structure/functionality (quick-add row + High/Medium/Low
// grouped sections + collapsed Completed section), not their dark theme —
// this app deliberately does not reskin the reference's visuals. Matches
// FormsBuilderPanel.tsx's compact bg-slate-50 row / text-xs scale
// conventions and UnifiedRecordView.tsx's owner prop pattern.
//
// Distinct from meeting_actions (MeetingsPanel.tsx) — a personal task is
// free-standing, not tied to any meeting.

interface PersonalTasksViewOwner {
  id: string;
  name: string;
  kind: 'workforce' | 'doctor';
  tenantId: string;
}

interface PersonalTasksViewProps {
  owner: PersonalTasksViewOwner;
}

function toOwnerRef(owner: PersonalTasksViewOwner): TaskOwnerRef {
  return owner.kind === 'workforce'
    ? { workforceId: owner.id, tenantId: owner.tenantId }
    : { doctorId: owner.id };
}

const PRIORITY_SECTIONS: { key: TaskPriority; label: string; emptyLabel: string }[] = [
  { key: 'high', label: 'High Priority', emptyLabel: 'No high priority tasks.' },
  { key: 'medium', label: 'Medium Priority', emptyLabel: 'No medium priority tasks.' },
  { key: 'low', label: 'Low Priority', emptyLabel: 'No low priority tasks.' },
];

function isOverdue(task: PersonalTaskRow): boolean {
  if (!task.due_date || task.status !== 'open') return false;
  const today = new Date().toISOString().slice(0, 10);
  return task.due_date < today;
}

export const PersonalTasksView: React.FC<PersonalTasksViewProps> = ({ owner }) => {
  const [tasks, setTasks] = useState<PersonalTaskRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [draftTitle, setDraftTitle] = useState('');
  const [draftPriority, setDraftPriority] = useState<TaskPriority>('medium');
  const [draftDueDate, setDraftDueDate] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  const [showCompleted, setShowCompleted] = useState(false);
  const [busyTaskIds, setBusyTaskIds] = useState<Record<string, boolean>>({});

  const load = async () => {
    setIsLoading(true);
    setLoadError('');
    try {
      const rows = await listTasksForOwner(toOwnerRef(owner));
      setTasks(rows);
    } catch (err) {
      console.warn(err);
      setTasks([]);
      setLoadError('Could not load your tasks.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner.id, owner.kind]);

  const handleAdd = async () => {
    if (!draftTitle.trim()) {
      setStatusMessage('Task title is required.');
      return;
    }
    setIsSaving(true);
    setStatusMessage('');
    try {
      await createTask(toOwnerRef(owner), draftTitle.trim(), draftPriority, draftDueDate || null);
      setDraftTitle('');
      setDraftPriority('medium');
      setDraftDueDate('');
      await load();
    } catch (err) {
      console.warn(err);
      setStatusMessage('Failed to add task.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggle = async (task: PersonalTaskRow) => {
    setBusyTaskIds(prev => ({ ...prev, [task.id]: true }));
    try {
      await toggleTaskStatus(task.id, task.status);
      await load();
    } catch (err) {
      console.warn(err);
      setStatusMessage('Failed to update task.');
    } finally {
      setBusyTaskIds(prev => ({ ...prev, [task.id]: false }));
    }
  };

  const handleDelete = async (task: PersonalTaskRow) => {
    setBusyTaskIds(prev => ({ ...prev, [task.id]: true }));
    try {
      await deleteTask(task.id);
      await load();
    } catch (err) {
      console.warn(err);
      setStatusMessage('Failed to delete task.');
      setBusyTaskIds(prev => ({ ...prev, [task.id]: false }));
    }
  };

  const openTasks = tasks.filter(t => t.status === 'open');
  const completedTasks = tasks.filter(t => t.status === 'done');

  const renderTaskRow = (task: PersonalTaskRow) => {
    const busy = !!busyTaskIds[task.id];
    const overdue = isOverdue(task);
    return (
      <div key={task.id} className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2">
        <button
          onClick={() => handleToggle(task)}
          disabled={busy}
          className="shrink-0 text-slate-400 hover:text-emerald-600 cursor-pointer disabled:opacity-40"
          title={task.status === 'open' ? 'Mark done' : 'Reopen'}
        >
          {task.status === 'done' ? (
            <CheckCircle2 size={16} className="text-emerald-600" />
          ) : (
            <Circle size={16} />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <p className={`text-xs font-semibold truncate ${task.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
            {task.title}
          </p>
          {task.due_date && (
            <p className={`text-[10px] mt-0.5 ${overdue ? 'text-rose-600 font-bold' : 'text-slate-400'}`}>
              Due {new Date(task.due_date).toLocaleDateString()}{overdue ? ' • overdue' : ''}
            </p>
          )}
        </div>
        <button
          onClick={() => handleDelete(task)}
          disabled={busy}
          className="shrink-0 text-rose-600 hover:text-rose-700 disabled:opacity-40 cursor-pointer p-1"
          title="Delete task"
        >
          <Trash2 size={14} />
        </button>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2"><ListTodo size={20} /> Tasks</h2>
        <p className="text-sm text-slate-500 mt-1">
          A personal to-do list, free-standing from any meeting or module — organize your own work by priority.
        </p>
      </div>

      {statusMessage && <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-xl p-3 text-sm">{statusMessage}</div>}
      {loadError && <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3 text-sm">{loadError}</div>}

      {/* Always-visible quick-add row */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <input
            type="text"
            value={draftTitle}
            onChange={e => setDraftTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
            placeholder="Add a task..."
            className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm"
          />
          <select
            value={draftPriority}
            onChange={e => setDraftPriority(e.target.value as TaskPriority)}
            className="border border-slate-200 rounded-lg px-2 py-2 text-sm"
          >
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <input
            type="date"
            value={draftDueDate}
            onChange={e => setDraftDueDate(e.target.value)}
            className="border border-slate-200 rounded-lg px-2 py-2 text-sm"
          />
          <button
            onClick={handleAdd}
            disabled={isSaving}
            className="flex items-center justify-center gap-1 text-xs font-bold bg-slate-900 text-white px-3 py-2 rounded-lg hover:bg-slate-800 cursor-pointer disabled:opacity-50 shrink-0"
          >
            <Plus size={14} /> Add
          </button>
        </div>
      </div>

      {isLoading && <p className="text-xs text-slate-400">Loading...</p>}

      {!isLoading && (
        <div className="space-y-4">
          {PRIORITY_SECTIONS.map(section => {
            const sectionTasks = openTasks.filter(t => t.priority === section.key);
            return (
              <div key={section.key} className="bg-white rounded-2xl border border-slate-200 p-4">
                <h3 className="font-bold text-slate-800 text-sm mb-2">{section.label}</h3>
                {sectionTasks.length === 0 ? (
                  <p className="text-xs text-slate-400">{section.emptyLabel}</p>
                ) : (
                  <div className="space-y-2">
                    {sectionTasks.map(renderTaskRow)}
                  </div>
                )}
              </div>
            );
          })}

          {/* Collapsed-by-default Completed section, matching
              FormsBuilderPanel.tsx's entries-viewer expand pattern. */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <button
              onClick={() => setShowCompleted(prev => !prev)}
              className="w-full flex items-center justify-between px-4 py-3 text-left cursor-pointer hover:bg-slate-50"
            >
              <div className="flex items-center gap-2">
                {showCompleted ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                <h3 className="font-bold text-slate-800 text-sm">Completed ({completedTasks.length})</h3>
              </div>
            </button>
            {showCompleted && (
              <div className="px-4 pb-4 border-t border-slate-200 pt-2 space-y-2">
                {completedTasks.length === 0 ? (
                  <p className="text-xs text-slate-400">No completed tasks yet.</p>
                ) : (
                  completedTasks.map(renderTaskRow)
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
