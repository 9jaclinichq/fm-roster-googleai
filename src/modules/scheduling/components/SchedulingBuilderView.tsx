import React, { useEffect, useState } from 'react';
import { databaseService } from '../../../lib/databaseService';
import { WorkforceMember } from '../../../types';
import {
  SchedulingInstance,
  SchedulingEntry,
  SchedulingRowDefinition,
  SchedulingColumnDefinition,
  listSchedulingInstances,
  createSchedulingInstance,
  getSchedulingEntries,
  upsertSchedulingEntry,
  updateInstanceDefinitions,
  updateInstanceStatus,
} from '../lib/schedulingService';
import { CalendarClock, Plus, Rows3, Columns3, Grid3x3, ArrowLeft, Trash2, CheckCircle2 } from 'lucide-react';

// Scheduling module — minimal generic builder UI, per
// docs/SCHEDULING_MODULE_SCOPING.md §5.2 ("Minimal generic builder UI").
// Backed by migration 44's scheduling_instances/scheduling_entries/
// scheduling_pipelines tables via ../lib/schedulingService.ts.
//
// SCOPE — deliberately minimal, matching the scoping doc's own framing:
//   1. Create a named instance (name, schedule_kind free text, period).
//   2. Define rows: ordered free-text labels + a row_kind picker
//      (person / resource / category).
//   3. Define columns: ordered free-text labels.
//   4. Fill cells: free text OR a workforce-member picker, one cell at a
//      time (saved on blur/change via upsertSchedulingEntry).
//   5. A draft / chief_review / published status toggle, reusing the same
//      3-state convention combined_master_rosters already proved for
//      exactly this kind of HITL workflow.
//
// Explicitly NOT built here, per the scoping doc's own non-goals: no
// drag-and-drop, no AI parsing, no HITL review workflow — those stay
// unique to MultiRosterManagerView.tsx, which this component does not
// import from, read, or otherwise touch.
//
// NOT WIRED IN. Same "additive, standalone" precedent FormsBuilderPanel.tsx
// / IntegrationsPanel.tsx / CategoryManagerPanel.tsx all followed before
// being wired into ChiefDashboardView.tsx by a separate, later, reviewed
// step — this component is not imported from ChiefDashboardView.tsx,
// App.tsx, or any navigation in this pass. Deliberate followup, not an
// oversight.

interface SchedulingBuilderViewProps {
  tenantId: string;
  // A Chief has no workforce_id of their own (see CLAUDE.md's Role Model) —
  // null is the correct value for that case, same convention
  // FormsBuilderPanel.tsx's createdByWorkforceId prop already uses.
  createdByWorkforceId?: string | null;
}

const ROW_KINDS: { value: string; label: string }[] = [
  { value: 'person', label: 'Person' },
  { value: 'resource', label: 'Resource' },
  { value: 'category', label: 'Category' },
];

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'chief_review', label: 'In Review' },
  { value: 'published', label: 'Published' },
];

let rowIdCounter = 0;
function nextRowId(): string {
  rowIdCounter += 1;
  return `sched-row-${rowIdCounter}`;
}

function slugifyKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'item';
}

interface DraftRow extends SchedulingRowDefinition {
  _rowId: string;
}
interface DraftColumn extends SchedulingColumnDefinition {
  _rowId: string;
}

// Local per-cell edit state: either free text, or a workforce member id.
type CellMode = 'text' | 'workforce';
interface CellDraft {
  mode: CellMode;
  text: string;
  workforceId: string;
}

function cellKeyOf(rowKey: string, columnKey: string): string {
  return `${rowKey}::${columnKey}`;
}

function draftFromAssignment(assignment: Record<string, unknown> | undefined): CellDraft {
  if (assignment && Array.isArray((assignment as any).workforce_ids) && (assignment as any).workforce_ids.length > 0) {
    return { mode: 'workforce', text: '', workforceId: String((assignment as any).workforce_ids[0]) };
  }
  const text = assignment && typeof (assignment as any).value === 'string' ? (assignment as any).value : '';
  return { mode: 'text', text, workforceId: '' };
}

function assignmentFromDraft(draft: CellDraft): Record<string, unknown> {
  if (draft.mode === 'workforce' && draft.workforceId) {
    return { workforce_ids: [draft.workforceId] };
  }
  return { value: draft.text };
}

export const SchedulingBuilderView: React.FC<SchedulingBuilderViewProps> = ({ tenantId, createdByWorkforceId = null }) => {
  const [instances, setInstances] = useState<SchedulingInstance[]>([]);
  const [workforce, setWorkforce] = useState<WorkforceMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');

  const [selected, setSelected] = useState<SchedulingInstance | null>(null);
  const [entries, setEntries] = useState<SchedulingEntry[]>([]);
  const [isLoadingEntries, setIsLoadingEntries] = useState(false);

  // Step 1: create instance
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftScheduleKind, setDraftScheduleKind] = useState('');
  const [draftPeriodStart, setDraftPeriodStart] = useState('');
  const [draftPeriodEnd, setDraftPeriodEnd] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Steps 2-3: rows/columns definitions (edited locally, saved together)
  const [draftRows, setDraftRows] = useState<DraftRow[]>([]);
  const [draftColumns, setDraftColumns] = useState<DraftColumn[]>([]);
  const [isSavingDefinitions, setIsSavingDefinitions] = useState(false);

  // Step 4: cell grid local edit buffer, keyed by "rowKey::columnKey"
  const [cellDrafts, setCellDrafts] = useState<Record<string, CellDraft>>({});
  const [savingCellKey, setSavingCellKey] = useState<string | null>(null);

  // Step 5: status toggle
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  const loadInstances = async () => {
    setIsLoading(true);
    setLoadError('');
    try {
      const [rows, wf] = await Promise.all([
        listSchedulingInstances({ tenantId }),
        databaseService.getWorkforce(tenantId).catch(() => [] as WorkforceMember[]),
      ]);
      setInstances(rows);
      setWorkforce(wf);
    } catch (err) {
      console.warn(err);
      setInstances([]);
      setLoadError('Could not load scheduling instances. This is expected if migration 44 has not been applied to this database yet.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { loadInstances(); }, [tenantId]);

  const openCreate = () => {
    setDraftName('');
    setDraftScheduleKind('');
    setDraftPeriodStart('');
    setDraftPeriodEnd('');
    setStatusMessage('');
    setShowCreateForm(true);
  };

  const handleCreate = async () => {
    if (!draftName.trim() || !draftScheduleKind.trim()) {
      setStatusMessage('Name and schedule type are required.');
      return;
    }
    setIsSaving(true);
    try {
      const created = await createSchedulingInstance(
        { tenantId },
        draftName.trim(),
        draftScheduleKind.trim(),
        draftPeriodStart || null,
        draftPeriodEnd || null,
        createdByWorkforceId
      );
      setStatusMessage(`"${created.name}" created.`);
      setShowCreateForm(false);
      await loadInstances();
      openInstance(created);
    } catch (err) {
      console.warn(err);
      setStatusMessage('Failed to create scheduling instance.');
    } finally {
      setIsSaving(false);
    }
  };

  const openInstance = async (instance: SchedulingInstance) => {
    setSelected(instance);
    setStatusMessage('');
    setDraftRows((instance.row_definitions || []).map(r => ({ ...r, _rowId: nextRowId() })));
    setDraftColumns((instance.column_definitions || []).map(c => ({ ...c, _rowId: nextRowId() })));
    setIsLoadingEntries(true);
    try {
      const rows = await getSchedulingEntries(instance.id);
      setEntries(rows);
      const drafts: Record<string, CellDraft> = {};
      rows.forEach(e => {
        drafts[cellKeyOf(e.row_key, e.column_key)] = draftFromAssignment(e.assignment);
      });
      setCellDrafts(drafts);
    } catch (err) {
      console.warn(err);
      setEntries([]);
      setCellDrafts({});
    } finally {
      setIsLoadingEntries(false);
    }
  };

  const backToList = () => {
    setSelected(null);
    setEntries([]);
    setCellDrafts({});
  };

  // --- Rows/columns editing (steps 2-3) ---

  const addDraftRow = () => setDraftRows(prev => [...prev, { _rowId: nextRowId(), key: '', label: '', row_kind: 'person' }]);
  const updateDraftRow = (rowId: string, patch: Partial<DraftRow>) =>
    setDraftRows(prev => prev.map(r => (r._rowId === rowId ? { ...r, ...patch } : r)));
  const removeDraftRow = (rowId: string) => setDraftRows(prev => prev.filter(r => r._rowId !== rowId));

  const addDraftColumn = () => setDraftColumns(prev => [...prev, { _rowId: nextRowId(), key: '', label: '' }]);
  const updateDraftColumn = (rowId: string, patch: Partial<DraftColumn>) =>
    setDraftColumns(prev => prev.map(c => (c._rowId === rowId ? { ...c, ...patch } : c)));
  const removeDraftColumn = (rowId: string) => setDraftColumns(prev => prev.filter(c => c._rowId !== rowId));

  const handleSaveDefinitions = async () => {
    if (!selected) return;
    const cleanRows: SchedulingRowDefinition[] = draftRows
      .filter(r => r.label.trim())
      .map(r => ({ key: r.key.trim() || slugifyKey(r.label), label: r.label.trim(), row_kind: r.row_kind || 'person' }));
    const cleanColumns: SchedulingColumnDefinition[] = draftColumns
      .filter(c => c.label.trim())
      .map(c => ({ key: c.key.trim() || slugifyKey(c.label), label: c.label.trim() }));

    setIsSavingDefinitions(true);
    try {
      const updated = await updateInstanceDefinitions(selected.id, cleanRows, cleanColumns);
      setSelected(updated);
      setInstances(prev => prev.map(i => (i.id === updated.id ? updated : i)));
      setStatusMessage('Rows and columns saved.');
    } catch (err) {
      console.warn(err);
      setStatusMessage('Failed to save rows/columns.');
    } finally {
      setIsSavingDefinitions(false);
    }
  };

  // --- Cell editing (step 4) ---

  const getCellDraft = (rowKey: string, columnKey: string): CellDraft =>
    cellDrafts[cellKeyOf(rowKey, columnKey)] || { mode: 'text', text: '', workforceId: '' };

  const setCellDraft = (rowKey: string, columnKey: string, patch: Partial<CellDraft>) => {
    const key = cellKeyOf(rowKey, columnKey);
    setCellDrafts(prev => ({ ...prev, [key]: { ...getCellDraft(rowKey, columnKey), ...patch } }));
  };

  const saveCell = async (rowKey: string, columnKey: string) => {
    if (!selected) return;
    const key = cellKeyOf(rowKey, columnKey);
    const draft = getCellDraft(rowKey, columnKey);
    setSavingCellKey(key);
    try {
      const rowDef = selected.row_definitions.find(r => r.key === rowKey);
      await upsertSchedulingEntry(
        selected.id,
        rowKey,
        columnKey,
        assignmentFromDraft(draft),
        'manual',
        { tenantId: selected.tenant_id || undefined, doctorId: selected.doctor_id || undefined }
      );
      void rowDef; // row_kind is denormalized server-side by a future pass; not required for this first slice's save call.
    } catch (err) {
      console.warn(err);
      setStatusMessage('Failed to save that cell — please try again.');
    } finally {
      setSavingCellKey(null);
    }
  };

  // --- Status toggle (step 5) ---

  const handleStatusChange = async (status: string) => {
    if (!selected) return;
    setIsUpdatingStatus(true);
    try {
      const updated = await updateInstanceStatus(selected.id, status);
      setSelected(updated);
      setInstances(prev => prev.map(i => (i.id === updated.id ? updated : i)));
    } catch (err) {
      console.warn(err);
      setStatusMessage('Failed to update status.');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  // ------------------------------------------------------------------

  if (selected) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <button
              onClick={backToList}
              className="flex items-center gap-1 text-xs font-bold text-slate-600 hover:text-slate-900 cursor-pointer mb-2"
            >
              <ArrowLeft size={14} /> Back to Scheduling Instances
            </button>
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <CalendarClock size={20} /> {selected.name}
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              {selected.schedule_kind}
              {selected.period_start ? ` • ${selected.period_start}${selected.period_end ? ` – ${selected.period_end}` : ''}` : ''}
            </p>
          </div>

          <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl p-1">
            {STATUS_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => handleStatusChange(opt.value)}
                disabled={isUpdatingStatus}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer disabled:opacity-50 ${
                  selected.status === opt.value
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {statusMessage && <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-xl p-3 text-sm">{statusMessage}</div>}

        {/* Step 2-3: rows and columns */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-slate-800 flex items-center gap-2 text-sm"><Rows3 size={16} /> Rows</h3>
              <button onClick={addDraftRow} className="flex items-center gap-1 text-xs font-bold text-slate-700 border border-slate-200 hover:bg-slate-50 px-2 py-1 rounded-lg cursor-pointer">
                <Plus size={12} /> Add Row
              </button>
            </div>
            <div className="space-y-2">
              {draftRows.length === 0 && <p className="text-xs text-slate-400">No rows yet — add a person, resource, or category.</p>}
              {draftRows.map(row => (
                <div key={row._rowId} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={row.label}
                    onChange={e => updateDraftRow(row._rowId, { label: e.target.value })}
                    placeholder="e.g. Dr. Adeyemi"
                    className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm"
                  />
                  <select
                    value={row.row_kind}
                    onChange={e => updateDraftRow(row._rowId, { row_kind: e.target.value })}
                    className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm cursor-pointer"
                  >
                    {ROW_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                  </select>
                  <button onClick={() => removeDraftRow(row._rowId)} className="shrink-0 text-rose-600 hover:text-rose-700 cursor-pointer p-1" title="Remove row">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-slate-800 flex items-center gap-2 text-sm"><Columns3 size={16} /> Columns</h3>
              <button onClick={addDraftColumn} className="flex items-center gap-1 text-xs font-bold text-slate-700 border border-slate-200 hover:bg-slate-50 px-2 py-1 rounded-lg cursor-pointer">
                <Plus size={12} /> Add Column
              </button>
            </div>
            <div className="space-y-2">
              {draftColumns.length === 0 && <p className="text-xs text-slate-400">No columns yet — add a date, shift, or session slot.</p>}
              {draftColumns.map(col => (
                <div key={col._rowId} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={col.label}
                    onChange={e => updateDraftColumn(col._rowId, { label: e.target.value })}
                    placeholder="e.g. Monday"
                    className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm"
                  />
                  <button onClick={() => removeDraftColumn(col._rowId)} className="shrink-0 text-rose-600 hover:text-rose-700 cursor-pointer p-1" title="Remove column">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div>
          <button
            onClick={handleSaveDefinitions}
            disabled={isSavingDefinitions}
            className="text-xs font-bold bg-slate-900 text-white px-4 py-2 rounded-lg hover:bg-slate-800 cursor-pointer disabled:opacity-50"
          >
            {isSavingDefinitions ? 'Saving...' : 'Save Rows & Columns'}
          </button>
        </div>

        {/* Step 4: fill cells */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <h3 className="font-bold text-slate-800 flex items-center gap-2 text-sm mb-3"><Grid3x3 size={16} /> Grid</h3>
          {selected.row_definitions.length === 0 || selected.column_definitions.length === 0 ? (
            <p className="text-xs text-slate-400">Save at least one row and one column above to start filling in the grid.</p>
          ) : isLoadingEntries ? (
            <p className="text-xs text-slate-400">Loading grid...</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs border-separate border-spacing-1">
                <thead>
                  <tr>
                    <th className="text-left text-slate-500 font-bold px-2 py-1"> </th>
                    {selected.column_definitions.map(col => (
                      <th key={col.key} className="text-left text-slate-500 font-bold px-2 py-1 whitespace-nowrap">{col.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {selected.row_definitions.map(row => (
                    <tr key={row.key}>
                      <td className="px-2 py-1 font-bold text-slate-800 whitespace-nowrap align-top">
                        {row.label}
                        <div className="text-[9px] font-normal text-slate-400">{row.row_kind}</div>
                      </td>
                      {selected.column_definitions.map(col => {
                        const draft = getCellDraft(row.key, col.key);
                        const cellKey = cellKeyOf(row.key, col.key);
                        const isSavingThisCell = savingCellKey === cellKey;
                        return (
                          <td key={col.key} className="px-2 py-1 align-top">
                            <div className="bg-slate-50 border border-slate-200 rounded-lg p-1.5 min-w-[160px] space-y-1">
                              <select
                                value={draft.mode}
                                onChange={e => setCellDraft(row.key, col.key, { mode: e.target.value as CellMode })}
                                className="w-full border border-slate-200 rounded px-1.5 py-1 text-[10px] cursor-pointer bg-white"
                              >
                                <option value="text">Free text</option>
                                <option value="workforce">Workforce member</option>
                              </select>
                              {draft.mode === 'workforce' ? (
                                <select
                                  value={draft.workforceId}
                                  onChange={e => setCellDraft(row.key, col.key, { workforceId: e.target.value })}
                                  onBlur={() => saveCell(row.key, col.key)}
                                  className="w-full border border-slate-200 rounded px-1.5 py-1 text-xs cursor-pointer bg-white"
                                >
                                  <option value="">Select...</option>
                                  {workforce.map(w => (
                                    <option key={w.id} value={w.id}>{w.full_name}</option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  type="text"
                                  value={draft.text}
                                  onChange={e => setCellDraft(row.key, col.key, { text: e.target.value })}
                                  onBlur={() => saveCell(row.key, col.key)}
                                  placeholder="Assign..."
                                  className="w-full border border-slate-200 rounded px-1.5 py-1 text-xs bg-white"
                                />
                              )}
                              {isSavingThisCell && <div className="text-[9px] text-slate-400">Saving...</div>}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2"><CalendarClock size={20} /> Scheduling</h2>
        <p className="text-sm text-slate-500 mt-1">
          Build a generic schedule, duty roster, or booking grid for your organization — name it, define rows and
          columns, then fill in assignments. UCH's existing AI-assisted roster tool is untouched and keeps
          running separately; this is a simpler, manual builder for any other scheduling need.
        </p>
      </div>

      {statusMessage && <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-xl p-3 text-sm">{statusMessage}</div>}
      {loadError && <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3 text-sm">{loadError}</div>}

      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-slate-800 flex items-center gap-2"><CalendarClock size={16} /> Scheduling Instances</h3>
          <button
            onClick={openCreate}
            className="flex items-center gap-1 text-xs font-bold bg-slate-900 text-white px-3 py-1.5 rounded-lg hover:bg-slate-800 cursor-pointer"
          >
            <Plus size={14} /> New Schedule
          </button>
        </div>

        {isLoading && <p className="text-xs text-slate-400">Loading...</p>}
        {!isLoading && instances.length === 0 && !loadError && (
          <p className="text-xs text-slate-400">No scheduling instances yet — create one to get started.</p>
        )}
        <div className="space-y-2">
          {instances.map(inst => (
            <button
              key={inst.id}
              onClick={() => openInstance(inst)}
              className="w-full flex items-center justify-between bg-slate-50 hover:bg-slate-100 rounded-lg px-3 py-2 cursor-pointer text-left"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">{inst.name}</p>
                <p className="text-[10px] text-slate-500">
                  {inst.schedule_kind} • {inst.row_definitions?.length ?? 0} row{(inst.row_definitions?.length ?? 0) === 1 ? '' : 's'} •
                  {' '}{inst.column_definitions?.length ?? 0} column{(inst.column_definitions?.length ?? 0) === 1 ? '' : 's'}
                </p>
              </div>
              <span className={`shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                inst.status === 'published'
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : inst.status === 'chief_review'
                  ? 'bg-amber-50 text-amber-700 border border-amber-200'
                  : 'bg-slate-100 text-slate-600 border border-slate-200'
              }`}>
                {inst.status === 'published' && <CheckCircle2 size={10} />}
                {inst.status.replace('_', ' ')}
              </span>
            </button>
          ))}
        </div>
      </div>

      {showCreateForm && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4">
          <h3 className="font-bold text-slate-800">New Scheduling Instance</h3>

          <div>
            <label className="text-xs font-bold text-slate-500">Name</label>
            <input
              type="text"
              value={draftName}
              onChange={e => setDraftName(e.target.value)}
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              placeholder="e.g. August 2026 Duty Roster"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-500">Schedule Type</label>
            <input
              type="text"
              value={draftScheduleKind}
              onChange={e => setDraftScheduleKind(e.target.value)}
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              placeholder="e.g. duty_roster, on_call, clinic_session, room_booking"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-500">Period Start</label>
              <input
                type="date"
                value={draftPeriodStart}
                onChange={e => setDraftPeriodStart(e.target.value)}
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500">Period End</label>
              <input
                type="date"
                value={draftPeriodEnd}
                onChange={e => setDraftPeriodEnd(e.target.value)}
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCreate}
              disabled={isSaving}
              className="text-xs font-bold bg-slate-900 text-white px-3 py-1.5 rounded-lg hover:bg-slate-800 cursor-pointer disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : 'Create Schedule'}
            </button>
            <button
              onClick={() => setShowCreateForm(false)}
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
