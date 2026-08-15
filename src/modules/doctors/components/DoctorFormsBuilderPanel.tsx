import React, { useState, useEffect } from 'react';
import { listFormInstancesForDoctor, createFormInstanceForDoctor } from '../../form/lib/formService';
import { FormInstance, FormFieldDefinition } from '../../../types';
import { ClipboardList, Plus, Trash2, FileText } from 'lucide-react';

// Doctor-scoped sibling of
// src/modules/org-admin/components/dashboard/FormsBuilderPanel.tsx —
// same minimal builder UI (list instances, create-new with a basic
// field-row builder), backed by migration 40's doctor_id ownership path
// on form_instances instead of tenant_id. See that migration's header for
// the schema/RLS rationale, and PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md §7's
// "Individual customisation ... personal forms" line for why this exists
// as its own entry point rather than reusing FormsBuilderPanel directly
// (a doctor has no tenantId to pass it).
//
// SCOPE — same as the org-side panel: create + list only, no edit/delete/
// entries-viewer, no pipeline configuration UI. No AI Copilot integration
// (out of scope per this task, same limitation CLAUDE.md documents for
// doctor-owned research/casebook workspaces — no quota model exists for
// bare doctors yet).
//
// Wired into DoctorHomeView.tsx as a third personal-instance entry point,
// alongside the Research/Casebook workspace cards and the
// DoctorIntegrationsPanel.

interface DoctorFormsBuilderPanelProps {
  doctorId: string;
}

interface DraftField extends FormFieldDefinition {
  _rowId: string;
}

const FIELD_TYPES: { value: FormFieldDefinition['type']; label: string }[] = [
  { value: 'text', label: 'Short Text' },
  { value: 'textarea', label: 'Long Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'boolean', label: 'Yes / No' },
  { value: 'select', label: 'Dropdown' },
  { value: 'file', label: 'File Upload' },
];

let rowIdCounter = 0;
function nextRowId(): string {
  rowIdCounter += 1;
  return `doctor-form-row-${rowIdCounter}`;
}

function emptyDraftField(): DraftField {
  return { _rowId: nextRowId(), key: '', label: '', type: 'text', required: false };
}

// Mirrors FormsBuilderPanel.tsx's slugifyKey exactly — same
// label-to-jsonb-key convention used everywhere else in this app (see
// CLAUDE.md's genogram-input note).
function slugifyKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'field';
}

export const DoctorFormsBuilderPanel: React.FC<DoctorFormsBuilderPanelProps> = ({ doctorId }) => {
  const [instances, setInstances] = useState<FormInstance[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState('');
  const [loadError, setLoadError] = useState('');

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftFields, setDraftFields] = useState<DraftField[]>([emptyDraftField()]);
  const [isSaving, setIsSaving] = useState(false);

  const load = async () => {
    setIsLoading(true);
    setLoadError('');
    try {
      const rows = await listFormInstancesForDoctor(doctorId);
      setInstances(rows);
    } catch (err) {
      console.warn(err);
      // Fails closed to an empty list with a visible message rather than
      // crashing the panel — expected today until migration 40 is applied.
      setInstances([]);
      setLoadError('Could not load your forms. This is expected if migration 40 has not been applied to this database yet.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, [doctorId]);

  const openCreate = () => {
    setDraftName('');
    setDraftFields([emptyDraftField()]);
    setStatusMessage('');
    setShowCreateForm(true);
  };

  const updateDraftField = (rowId: string, patch: Partial<DraftField>) => {
    setDraftFields(prev => prev.map(f => (f._rowId === rowId ? { ...f, ...patch } : f)));
  };

  const addDraftField = () => setDraftFields(prev => [...prev, emptyDraftField()]);

  const removeDraftField = (rowId: string) => {
    setDraftFields(prev => (prev.length <= 1 ? prev : prev.filter(f => f._rowId !== rowId)));
  };

  const handleCreate = async () => {
    if (!draftName.trim()) {
      setStatusMessage('Form name is required.');
      return;
    }
    const cleanFields: FormFieldDefinition[] = draftFields
      .filter(f => f.label.trim())
      .map(f => ({
        key: f.key.trim() || slugifyKey(f.label),
        label: f.label.trim(),
        type: f.type,
        required: !!f.required,
        ...(f.type === 'select' && f.options ? { options: f.options } : {}),
      }));

    if (cleanFields.length === 0) {
      setStatusMessage('Add at least one field with a label.');
      return;
    }

    setIsSaving(true);
    try {
      await createFormInstanceForDoctor(doctorId, draftName.trim(), { fields: cleanFields });
      setStatusMessage(`"${draftName.trim()}" created.`);
      setShowCreateForm(false);
      await load();
    } catch (err) {
      console.warn(err);
      setStatusMessage('Failed to create form.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2"><ClipboardList size={18} className="text-indigo-600" /> Personal Forms</h2>
        <p className="text-sm text-slate-500 mt-1">
          Build your own data-collection forms — separate from any organization's forms. Useful for
          personal tracking before (or independent of) linking to an organization.
        </p>
      </div>

      {statusMessage && <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-xl p-3 text-sm">{statusMessage}</div>}
      {loadError && <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3 text-sm">{loadError}</div>}

      <div className="border border-slate-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-slate-800 flex items-center gap-2 text-sm"><FileText size={14} /> Your Forms</h3>
          <button
            onClick={openCreate}
            className="flex items-center gap-1 text-xs font-bold bg-slate-900 text-white px-3 py-1.5 rounded-lg hover:bg-slate-800 cursor-pointer"
          >
            <Plus size={14} /> New Form
          </button>
        </div>

        {isLoading && <p className="text-xs text-slate-400">Loading...</p>}
        {!isLoading && instances.length === 0 && !loadError && (
          <p className="text-xs text-slate-400">No personal forms yet — create one to get started.</p>
        )}
        <div className="space-y-2">
          {instances.map(inst => (
            <div key={inst.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">{inst.name}</p>
                <p className="text-[10px] text-slate-500">
                  {inst.schema?.fields?.length ?? 0} field{inst.schema?.fields?.length === 1 ? '' : 's'}
                  {inst.is_active ? '' : ' • inactive'}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {showCreateForm && (
        <div className="border border-slate-200 rounded-xl p-4 space-y-4">
          <h3 className="font-bold text-slate-800 text-sm">New Personal Form</h3>

          <div>
            <label className="text-xs font-bold text-slate-500">Form Name</label>
            <input
              type="text"
              value={draftName}
              onChange={e => setDraftName(e.target.value)}
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              placeholder="e.g. Weekly Reflection Log"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500">Fields</label>
            {draftFields.map(field => (
              <div key={field._rowId} className="flex items-center gap-2">
                <input
                  type="text"
                  value={field.label}
                  onChange={e => updateDraftField(field._rowId, { label: e.target.value })}
                  className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm"
                  placeholder="Field label"
                />
                <select
                  value={field.type}
                  onChange={e => updateDraftField(field._rowId, { type: e.target.value as FormFieldDefinition['type'] })}
                  className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
                >
                  {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <label className="flex items-center gap-1 text-[10px] text-slate-500 shrink-0">
                  <input
                    type="checkbox"
                    checked={!!field.required}
                    onChange={e => updateDraftField(field._rowId, { required: e.target.checked })}
                  />
                  Required
                </label>
                <button
                  onClick={() => removeDraftField(field._rowId)}
                  disabled={draftFields.length <= 1}
                  className="shrink-0 text-rose-600 hover:text-rose-700 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer p-1"
                  title="Remove field"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <button
              onClick={addDraftField}
              className="flex items-center gap-1 text-xs font-bold text-slate-700 border border-slate-200 hover:bg-slate-50 px-2 py-1 rounded-lg cursor-pointer"
            >
              <Plus size={12} /> Add Field
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCreate}
              disabled={isSaving}
              className="text-xs font-bold bg-slate-900 text-white px-3 py-1.5 rounded-lg hover:bg-slate-800 cursor-pointer disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : 'Create Form'}
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
