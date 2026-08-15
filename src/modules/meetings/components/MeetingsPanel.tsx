import React, { useEffect, useState } from 'react';
import {
  AgendaItem,
  Meeting,
  MeetingAction,
  MeetingSeries,
  createMeetingAction,
  createMeetingSeries,
  listMeetingActions,
  listMeetingSeries,
  listMeetings,
  resolveMeetingAction,
  scheduleMeeting,
  updateMeetingMinutes,
} from '../lib/meetingsService';
import { Users, Plus, Trash2, CalendarClock, ListChecks, ArrowLeft, CheckCircle2, Circle } from 'lucide-react';

// Meetings & Actions module (migration 45) — minimal, standalone UI over
// meetingsService.ts. Backs docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md §7's
// module 7 ("Meetings & actions... with an action tracker for any of
// them") and §8.2's "standing meeting template with agenda, minutes, and
// action-tracker pipeline" seed ask.
//
// SCOPE — deliberately minimal, same "first slice, not the full eventual
// richness" framing as FormsBuilderPanel.tsx/CategoryManagerPanel.tsx:
//   - List meeting series (create a new one with a name + starter agenda
//     items).
//   - List scheduled/past meetings for a selected series (schedule a new
//     occurrence with a title + optional date/time).
//   - Open a meeting to edit its minutes and add/resolve action items.
//   - No edit/delete for series or meetings, no agenda editing on an
//     existing meeting occurrence yet, no notification/reminder wiring.
//
// NOT wired into ChiefDashboardView.tsx, App.tsx, or any navigation in
// this pass — standalone, same precedent as FormsBuilderPanel.tsx/
// IntegrationsPanel.tsx/CategoryManagerPanel.tsx each had before their own
// dashboard wiring landed. Dashboard-tab wiring is a deliberate followup.
//
// Visual style follows FormsBuilderPanel.tsx (card layout, field-row
// pattern for the agenda-item list) and CategoryManagerPanel.tsx
// (two-column list + create-form layout).

interface MeetingsPanelProps {
  tenantId: string;
  // A Chief has no workforce_id of their own (see CLAUDE.md's Role
  // Model) — null is the correct value for that case, same convention as
  // FormsBuilderPanel.tsx's createdByWorkforceId prop.
  createdByWorkforceId?: string | null;
}

interface DraftAgendaItem extends AgendaItem {
  _rowId: string;
}

let rowIdCounter = 0;
function nextRowId(): string {
  rowIdCounter += 1;
  return `agenda-row-${rowIdCounter}`;
}

function emptyDraftAgendaItem(): DraftAgendaItem {
  return { _rowId: nextRowId(), label: '' };
}

function defaultDraftAgendaItems(): DraftAgendaItem[] {
  return [
    { _rowId: nextRowId(), label: 'Review of previous minutes' },
    { _rowId: nextRowId(), label: 'Matters arising' },
    { _rowId: nextRowId(), label: 'Action items review' },
  ];
}

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Scheduled',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const MeetingsPanel: React.FC<MeetingsPanelProps> = ({ tenantId, createdByWorkforceId = null }) => {
  // --- Series list state ---
  const [seriesList, setSeriesList] = useState<MeetingSeries[]>([]);
  const [isLoadingSeries, setIsLoadingSeries] = useState(true);
  const [seriesLoadError, setSeriesLoadError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');

  const [showCreateSeries, setShowCreateSeries] = useState(false);
  const [draftSeriesName, setDraftSeriesName] = useState('');
  const [draftSeriesDescription, setDraftSeriesDescription] = useState('');
  const [draftAgendaItems, setDraftAgendaItems] = useState<DraftAgendaItem[]>(defaultDraftAgendaItems());
  const [isSavingSeries, setIsSavingSeries] = useState(false);

  // --- Selected series / meetings list state ---
  const [selectedSeries, setSelectedSeries] = useState<MeetingSeries | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [isLoadingMeetings, setIsLoadingMeetings] = useState(false);
  const [meetingsLoadError, setMeetingsLoadError] = useState('');

  const [showScheduleMeeting, setShowScheduleMeeting] = useState(false);
  const [draftMeetingTitle, setDraftMeetingTitle] = useState('');
  const [draftMeetingDate, setDraftMeetingDate] = useState('');
  const [isScheduling, setIsScheduling] = useState(false);

  // --- Selected meeting detail state ---
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [minutesDraft, setMinutesDraft] = useState('');
  const [isSavingMinutes, setIsSavingMinutes] = useState(false);
  const [actions, setActions] = useState<MeetingAction[]>([]);
  const [isLoadingActions, setIsLoadingActions] = useState(false);
  const [newActionDescription, setNewActionDescription] = useState('');
  const [newActionDueDate, setNewActionDueDate] = useState('');
  const [isAddingAction, setIsAddingAction] = useState(false);
  const [resolvingActionId, setResolvingActionId] = useState<string | null>(null);

  const loadSeries = async () => {
    setIsLoadingSeries(true);
    setSeriesLoadError('');
    try {
      const rows = await listMeetingSeries({ tenantId });
      setSeriesList(rows);
    } catch (err) {
      console.warn(err);
      setSeriesList([]);
      setSeriesLoadError('Could not load meeting series. This is expected if migration 45 has not been applied to this database yet.');
    } finally {
      setIsLoadingSeries(false);
    }
  };

  useEffect(() => { loadSeries(); }, [tenantId]);

  const openCreateSeries = () => {
    setDraftSeriesName('');
    setDraftSeriesDescription('');
    setDraftAgendaItems(defaultDraftAgendaItems());
    setStatusMessage('');
    setShowCreateSeries(true);
  };

  const updateDraftAgendaItem = (rowId: string, patch: Partial<DraftAgendaItem>) => {
    setDraftAgendaItems(prev => prev.map(item => (item._rowId === rowId ? { ...item, ...patch } : item)));
  };

  const addDraftAgendaItem = () => setDraftAgendaItems(prev => [...prev, emptyDraftAgendaItem()]);

  const removeDraftAgendaItem = (rowId: string) => {
    setDraftAgendaItems(prev => (prev.length <= 1 ? prev : prev.filter(item => item._rowId !== rowId)));
  };

  const handleCreateSeries = async () => {
    if (!draftSeriesName.trim()) {
      setStatusMessage('Meeting series name is required.');
      return;
    }
    const cleanItems: AgendaItem[] = draftAgendaItems
      .filter(item => item.label.trim())
      .map(item => ({ label: item.label.trim() }));

    if (cleanItems.length === 0) {
      setStatusMessage('Add at least one agenda item.');
      return;
    }

    setIsSavingSeries(true);
    try {
      await createMeetingSeries(
        tenantId,
        null,
        draftSeriesName.trim(),
        { items: cleanItems },
        draftSeriesDescription.trim() || null,
        createdByWorkforceId
      );
      setStatusMessage(`"${draftSeriesName.trim()}" created.`);
      setShowCreateSeries(false);
      await loadSeries();
    } catch (err) {
      console.warn(err);
      setStatusMessage('Failed to create meeting series.');
    } finally {
      setIsSavingSeries(false);
    }
  };

  const openSeries = async (series: MeetingSeries) => {
    setSelectedSeries(series);
    setSelectedMeeting(null);
    setShowScheduleMeeting(false);
    setMeetingsLoadError('');
    setIsLoadingMeetings(true);
    try {
      const rows = await listMeetings(series.id);
      setMeetings(rows);
    } catch (err) {
      console.warn(err);
      setMeetings([]);
      setMeetingsLoadError('Could not load meetings for this series.');
    } finally {
      setIsLoadingMeetings(false);
    }
  };

  const backToSeriesList = () => {
    setSelectedSeries(null);
    setMeetings([]);
    setSelectedMeeting(null);
  };

  const openScheduleMeeting = () => {
    setDraftMeetingTitle(selectedSeries?.name ?? '');
    setDraftMeetingDate('');
    setShowScheduleMeeting(true);
  };

  const handleScheduleMeeting = async () => {
    if (!selectedSeries) return;
    if (!draftMeetingTitle.trim()) {
      setStatusMessage('Meeting title is required.');
      return;
    }
    setIsScheduling(true);
    try {
      const scheduledAtIso = draftMeetingDate ? new Date(draftMeetingDate).toISOString() : null;
      await scheduleMeeting(selectedSeries.id, draftMeetingTitle.trim(), scheduledAtIso);
      setShowScheduleMeeting(false);
      await openSeries(selectedSeries);
    } catch (err) {
      console.warn(err);
      setStatusMessage('Failed to schedule meeting.');
    } finally {
      setIsScheduling(false);
    }
  };

  const openMeeting = async (meeting: Meeting) => {
    setSelectedMeeting(meeting);
    setMinutesDraft(meeting.minutes ?? '');
    setNewActionDescription('');
    setNewActionDueDate('');
    setIsLoadingActions(true);
    try {
      const rows = await listMeetingActions(meeting.id);
      setActions(rows);
    } catch (err) {
      console.warn(err);
      setActions([]);
    } finally {
      setIsLoadingActions(false);
    }
  };

  const backToMeetingsList = () => {
    setSelectedMeeting(null);
    setActions([]);
  };

  const handleSaveMinutes = async () => {
    if (!selectedMeeting) return;
    setIsSavingMinutes(true);
    try {
      const updated = await updateMeetingMinutes(selectedMeeting.id, minutesDraft);
      setSelectedMeeting(updated);
      setMeetings(prev => prev.map(m => (m.id === updated.id ? updated : m)));
      setStatusMessage('Minutes saved.');
    } catch (err) {
      console.warn(err);
      setStatusMessage('Failed to save minutes.');
    } finally {
      setIsSavingMinutes(false);
    }
  };

  const handleAddAction = async () => {
    if (!selectedMeeting) return;
    if (!newActionDescription.trim()) {
      setStatusMessage('Action description is required.');
      return;
    }
    setIsAddingAction(true);
    try {
      const created = await createMeetingAction(
        selectedMeeting.id,
        newActionDescription.trim(),
        null,
        newActionDueDate || null
      );
      setActions(prev => [...prev, created]);
      setNewActionDescription('');
      setNewActionDueDate('');
    } catch (err) {
      console.warn(err);
      setStatusMessage('Failed to add action item.');
    } finally {
      setIsAddingAction(false);
    }
  };

  const handleResolveAction = async (action: MeetingAction) => {
    if (action.status === 'done') return;
    setResolvingActionId(action.id);
    try {
      const updated = await resolveMeetingAction(action.id);
      setActions(prev => prev.map(a => (a.id === updated.id ? updated : a)));
    } catch (err) {
      console.warn(err);
      setStatusMessage('Failed to resolve action item.');
    } finally {
      setResolvingActionId(null);
    }
  };

  // --- Meeting detail view (minutes + actions) ---
  if (selectedSeries && selectedMeeting) {
    return (
      <div className="space-y-6">
        <button
          onClick={backToMeetingsList}
          className="flex items-center gap-1 text-xs font-bold text-slate-600 hover:text-slate-900 cursor-pointer"
        >
          <ArrowLeft size={14} /> Back to {selectedSeries.name}
        </button>

        <div>
          <h2 className="text-xl font-bold text-slate-900">{selectedMeeting.title}</h2>
          <p className="text-sm text-slate-500 mt-1">
            {selectedMeeting.scheduled_at ? new Date(selectedMeeting.scheduled_at).toLocaleString() : 'No date set'}
            {' • '}{STATUS_LABELS[selectedMeeting.status] ?? selectedMeeting.status}
          </p>
        </div>

        {statusMessage && <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-xl p-3 text-sm">{statusMessage}</div>}

        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
          <h3 className="font-bold text-slate-800 flex items-center gap-2"><ListChecks size={16} /> Agenda</h3>
          <div className="space-y-1">
            {(selectedMeeting.agenda?.items ?? []).map((item, idx) => (
              <div key={idx} className="text-sm text-slate-700 bg-slate-50 rounded-lg px-3 py-2">{item.label}</div>
            ))}
            {(selectedMeeting.agenda?.items ?? []).length === 0 && (
              <p className="text-xs text-slate-400">No agenda items.</p>
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
          <h3 className="font-bold text-slate-800">Minutes</h3>
          <textarea
            value={minutesDraft}
            onChange={e => setMinutesDraft(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
            rows={6}
            placeholder="Record what was discussed and decided..."
          />
          <button
            onClick={handleSaveMinutes}
            disabled={isSavingMinutes}
            className="text-xs font-bold bg-slate-900 text-white px-3 py-1.5 rounded-lg hover:bg-slate-800 cursor-pointer disabled:opacity-50"
          >
            {isSavingMinutes ? 'Saving...' : 'Save Minutes'}
          </button>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
          <h3 className="font-bold text-slate-800 flex items-center gap-2"><CheckCircle2 size={16} /> Action Items</h3>

          {isLoadingActions && <p className="text-xs text-slate-400">Loading...</p>}
          {!isLoadingActions && actions.length === 0 && (
            <p className="text-xs text-slate-400">No action items yet.</p>
          )}
          <div className="space-y-2">
            {actions.map(action => (
              <div key={action.id} className="flex items-center justify-between gap-3 bg-slate-50 rounded-lg px-3 py-2">
                <button
                  onClick={() => handleResolveAction(action)}
                  disabled={action.status === 'done' || resolvingActionId === action.id}
                  className="shrink-0 text-slate-400 hover:text-emerald-600 disabled:hover:text-slate-400 cursor-pointer disabled:cursor-default"
                  title={action.status === 'done' ? 'Resolved' : 'Mark resolved'}
                >
                  {action.status === 'done' ? <CheckCircle2 size={16} className="text-emerald-600" /> : <Circle size={16} />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium ${action.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                    {action.description}
                  </p>
                  {action.due_date && (
                    <p className="text-[10px] text-slate-500">Due {new Date(action.due_date).toLocaleDateString()}</p>
                  )}
                </div>
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-600">
                  {action.status}
                </span>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
            <input
              type="text"
              value={newActionDescription}
              onChange={e => setNewActionDescription(e.target.value)}
              placeholder="New action item..."
              className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm"
            />
            <input
              type="date"
              value={newActionDueDate}
              onChange={e => setNewActionDueDate(e.target.value)}
              className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
            />
            <button
              onClick={handleAddAction}
              disabled={isAddingAction}
              className="shrink-0 flex items-center gap-1 text-xs font-bold bg-slate-900 text-white px-3 py-1.5 rounded-lg hover:bg-slate-800 cursor-pointer disabled:opacity-50"
            >
              <Plus size={14} /> Add
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- Meetings-for-series view ---
  if (selectedSeries) {
    return (
      <div className="space-y-6">
        <button
          onClick={backToSeriesList}
          className="flex items-center gap-1 text-xs font-bold text-slate-600 hover:text-slate-900 cursor-pointer"
        >
          <ArrowLeft size={14} /> Back to Meeting Series
        </button>

        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2"><CalendarClock size={20} /> {selectedSeries.name}</h2>
          {selectedSeries.description && <p className="text-sm text-slate-500 mt-1">{selectedSeries.description}</p>}
        </div>

        {statusMessage && <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-xl p-3 text-sm">{statusMessage}</div>}
        {meetingsLoadError && <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3 text-sm">{meetingsLoadError}</div>}

        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-slate-800">Meetings</h3>
            <button
              onClick={openScheduleMeeting}
              className="flex items-center gap-1 text-xs font-bold bg-slate-900 text-white px-3 py-1.5 rounded-lg hover:bg-slate-800 cursor-pointer"
            >
              <Plus size={14} /> Schedule Meeting
            </button>
          </div>

          {isLoadingMeetings && <p className="text-xs text-slate-400">Loading...</p>}
          {!isLoadingMeetings && meetings.length === 0 && !meetingsLoadError && (
            <p className="text-xs text-slate-400">No meetings scheduled yet for this series.</p>
          )}
          <div className="space-y-2">
            {meetings.map(meeting => (
              <button
                key={meeting.id}
                onClick={() => openMeeting(meeting)}
                className="w-full text-left flex items-center justify-between bg-slate-50 hover:bg-slate-100 rounded-lg px-3 py-2 cursor-pointer transition"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{meeting.title}</p>
                  <p className="text-[10px] text-slate-500">
                    {meeting.scheduled_at ? new Date(meeting.scheduled_at).toLocaleString() : 'No date set'}
                  </p>
                </div>
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-600">
                  {STATUS_LABELS[meeting.status] ?? meeting.status}
                </span>
              </button>
            ))}
          </div>
        </div>

        {showScheduleMeeting && (
          <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4">
            <h3 className="font-bold text-slate-800">Schedule Meeting</h3>
            <div>
              <label className="text-xs font-bold text-slate-500">Title</label>
              <input
                type="text"
                value={draftMeetingTitle}
                onChange={e => setDraftMeetingTitle(e.target.value)}
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500">Date &amp; Time (optional)</label>
              <input
                type="datetime-local"
                value={draftMeetingDate}
                onChange={e => setDraftMeetingDate(e.target.value)}
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleScheduleMeeting}
                disabled={isScheduling}
                className="text-xs font-bold bg-slate-900 text-white px-3 py-1.5 rounded-lg hover:bg-slate-800 cursor-pointer disabled:opacity-50"
              >
                {isScheduling ? 'Scheduling...' : 'Schedule'}
              </button>
              <button
                onClick={() => setShowScheduleMeeting(false)}
                className="text-xs font-bold text-slate-600 border border-slate-200 px-3 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // --- Meeting series list view (default) ---
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2"><Users size={20} /> Meetings &amp; Actions</h2>
        <p className="text-sm text-slate-500 mt-1">
          Set up recurring meeting types with a reusable agenda, schedule occurrences, record minutes, and
          track action items — usable for a departmental meeting, a partner meeting, a committee, or a board.
        </p>
      </div>

      {statusMessage && <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-xl p-3 text-sm">{statusMessage}</div>}
      {seriesLoadError && <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3 text-sm">{seriesLoadError}</div>}

      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-slate-800">Meeting Series</h3>
          <button
            onClick={openCreateSeries}
            className="flex items-center gap-1 text-xs font-bold bg-slate-900 text-white px-3 py-1.5 rounded-lg hover:bg-slate-800 cursor-pointer"
          >
            <Plus size={14} /> New Meeting Series
          </button>
        </div>

        {isLoadingSeries && <p className="text-xs text-slate-400">Loading...</p>}
        {!isLoadingSeries && seriesList.length === 0 && !seriesLoadError && (
          <p className="text-xs text-slate-400">No meeting series yet — create one to get started.</p>
        )}
        <div className="space-y-2">
          {seriesList.map(series => (
            <button
              key={series.id}
              onClick={() => openSeries(series)}
              className="w-full text-left flex items-center justify-between bg-slate-50 hover:bg-slate-100 rounded-lg px-3 py-2 cursor-pointer transition"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">{series.name}</p>
                <p className="text-[10px] text-slate-500">
                  {series.agenda_template?.items?.length ?? 0} agenda item{series.agenda_template?.items?.length === 1 ? '' : 's'}
                  {series.is_system_default ? ' • Built-in' : ''}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {showCreateSeries && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4">
          <h3 className="font-bold text-slate-800">New Meeting Series</h3>

          <div>
            <label className="text-xs font-bold text-slate-500">Name</label>
            <input
              type="text"
              value={draftSeriesName}
              onChange={e => setDraftSeriesName(e.target.value)}
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              placeholder="e.g. Weekly Departmental Meeting"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-500">Description (optional)</label>
            <textarea
              value={draftSeriesDescription}
              onChange={e => setDraftSeriesDescription(e.target.value)}
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500">Default Agenda</label>
            {draftAgendaItems.map(item => (
              <div key={item._rowId} className="flex items-center gap-2">
                <input
                  type="text"
                  value={item.label}
                  onChange={e => updateDraftAgendaItem(item._rowId, { label: e.target.value })}
                  className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm"
                  placeholder="Agenda item"
                />
                <button
                  onClick={() => removeDraftAgendaItem(item._rowId)}
                  disabled={draftAgendaItems.length <= 1}
                  className="shrink-0 text-rose-600 hover:text-rose-700 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer p-1"
                  title="Remove item"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <button
              onClick={addDraftAgendaItem}
              className="flex items-center gap-1 text-xs font-bold text-slate-700 border border-slate-200 hover:bg-slate-50 px-2 py-1 rounded-lg cursor-pointer"
            >
              <Plus size={12} /> Add Agenda Item
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCreateSeries}
              disabled={isSavingSeries}
              className="text-xs font-bold bg-slate-900 text-white px-3 py-1.5 rounded-lg hover:bg-slate-800 cursor-pointer disabled:opacity-50"
            >
              {isSavingSeries ? 'Saving...' : 'Create Series'}
            </button>
            <button
              onClick={() => setShowCreateSeries(false)}
              className="text-xs font-bold text-slate-600 border border-slate-200 px-3 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
