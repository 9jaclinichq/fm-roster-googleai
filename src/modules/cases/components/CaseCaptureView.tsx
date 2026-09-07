import React, { useCallback, useEffect, useState } from 'react';
import {
  caseCaptureService,
  CaseCaptureRecord,
  CaseCaptureArtifact,
  CaseLifecycleStatus,
  CaseArtifactKind,
  CaseArtifactProvenance,
} from '../lib/caseCaptureService';
import {
  caseContinuityService,
  CaseContinuityAction,
  CaseContinuityActionType,
  CaseContinuityResultStatus,
} from '../lib/caseContinuityService';
import {
  dueGroupForAction,
  orderOpenContinuityActions,
} from '../lib/caseContinuityDomain';

// Cases slice 1 — minimal authenticated-doctor capture surface.
//
// SCOPE is exactly the four capabilities relay TURN 0027 authorised: create a
// capture, add ordered artifacts, move lifecycle status, and retrieve securely.
// Deliberately absent, because they are outside that boundary rather than
// forgotten:
//   * no delete — the service supports it, the UI does not expose it;
//   * no portfolio assignment — portfolio_ref is shown read-only, and a capture
//     occupying no Fellowship slot is the point of the slice;
//   * no AI or provider call of any kind;
//   * no de-identified derivative generation;
//   * no Family/Household;
//   * no institutional/plaintext-code path.
//
// AUTHENTICATED DOCTOR ONLY, and that is load-bearing rather than a
// convenience. `case_capture_records.doctor_id` is NOT NULL and its RLS is
// `doctor_id = auth.uid()`, so this surface only functions for the one persona
// that holds a real Supabase session. Every other persona in this app operates
// on the anon key, and for them these queries return nothing rather than
// failing loudly — so the component refuses to render its form without a
// doctor rather than showing an empty list that looks like "no captures yet".

export interface CaseCaptureViewProps {
  doctor: { id: string; fullName: string } | null;
}

const LIFECYCLE_OPTIONS: { value: CaseLifecycleStatus; label: string }[] = [
  { value: 'quick_capture', label: 'Quick capture' },
  { value: 'candidate', label: 'Candidate' },
  { value: 'active_follow_up', label: 'Active follow-up' },
  { value: 'write_up_ready', label: 'Write-up ready' },
  { value: 'completed', label: 'Completed' },
  { value: 'archived', label: 'Archived' },
  { value: 'dropped', label: 'Dropped' },
];

const ARTIFACT_KINDS: { value: CaseArtifactKind; label: string }[] = [
  { value: 'note_page', label: 'Note page' },
  { value: 'clinical_photo', label: 'Clinical photo' },
  { value: 'document', label: 'Document' },
];

const PROVENANCE: { value: CaseArtifactProvenance; label: string }[] = [
  { value: 'source_observed', label: 'Source-observed' },
  { value: 'patient_reported', label: 'Patient-reported' },
  { value: 'clinician_stated', label: 'Clinician-stated' },
];

const ACTION_TYPES: { value: CaseContinuityActionType; label: string }[] = [
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'procedure', label: 'Procedure' },
  { value: 'investigation', label: 'Investigation' },
  { value: 'result_review', label: 'Result review' },
  { value: 'other', label: 'Other' },
];

const RESULT_STATUSES: { value: CaseContinuityResultStatus; label: string }[] = [
  { value: 'not_expected', label: 'Not expected' },
  { value: 'awaiting', label: 'Awaiting' },
  { value: 'available', label: 'Available' },
  { value: 'reviewed', label: 'Reviewed' },
];

function formatDate(value: string | null): string {
  if (!value) return 'Unscheduled';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Invalid date';
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function actionTypeLabel(value: CaseContinuityActionType): string {
  return ACTION_TYPES.find((option) => option.value === value)?.label ?? value;
}

function resultStatusLabel(value: CaseContinuityResultStatus): string {
  return RESULT_STATUSES.find((option) => option.value === value)?.label ?? value;
}

function dueLabel(action: CaseContinuityAction): string {
  const group = dueGroupForAction(action);
  if (group === 'overdue') return 'Overdue';
  if (group === 'due_soon') return 'Due soon';
  if (group === 'later') return 'Later';
  return 'Unscheduled';
}

export const CaseCaptureView: React.FC<CaseCaptureViewProps> = ({ doctor }) => {
  const [records, setRecords] = useState<CaseCaptureRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<CaseCaptureArtifact[]>([]);
  const [continuityActions, setContinuityActions] = useState<CaseContinuityAction[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [subjectLabel, setSubjectLabel] = useState('');
  const [artifactKind, setArtifactKind] = useState<CaseArtifactKind>('note_page');
  const [provenance, setProvenance] = useState<CaseArtifactProvenance>('source_observed');
  const [actionLabel, setActionLabel] = useState('');
  const [actionType, setActionType] = useState<CaseContinuityActionType>('follow_up');
  const [plannedFor, setPlannedFor] = useState('');
  const [resultStatus, setResultStatus] = useState<CaseContinuityResultStatus>('not_expected');

  const activeRecord = records.find((r) => r.id === activeId) || null;
  const openContinuityActions = orderOpenContinuityActions(continuityActions);
  const closedContinuityActions = continuityActions
    .filter((action) => action.status !== 'planned')
    .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  const activeRecordActions = continuityActions
    .filter((action) => action.case_capture_record_id === activeRecord?.id)
    .sort((a, b) => (a.planned_for || a.updated_at || '').localeCompare(b.planned_for || b.updated_at || ''));

  const loadRecords = useCallback(async () => {
    if (!doctor) return;
    setError(null);
    try {
      setRecords(await caseCaptureService.listCaptureRecords(doctor.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load captures.');
    }
  }, [doctor]);

  const loadContinuityActions = useCallback(async () => {
    if (!doctor) return;
    setError(null);
    try {
      setContinuityActions(await caseContinuityService.listActionsForDoctor(doctor.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load ongoing case actions. The local migration may not be applied in this environment.');
    }
  }, [doctor]);

  const loadArtifacts = useCallback(async (recordId: string) => {
    setError(null);
    try {
      setArtifacts(await caseCaptureService.listArtifacts(recordId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load artifacts.');
    }
  }, []);

  useEffect(() => { void loadRecords(); }, [loadRecords]);
  useEffect(() => { void loadContinuityActions(); }, [loadContinuityActions]);
  useEffect(() => {
    if (activeId) void loadArtifacts(activeId);
    else setArtifacts([]);
  }, [activeId, loadArtifacts]);

  if (!doctor) {
    return (
      <div className="p-6">
        <div className="max-w-xl rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-bold text-slate-800">Case capture</h2>
          <p className="mt-2 text-xs leading-relaxed text-slate-600">
            Case capture is available to a signed-in doctor account only. Raw clinical source
            material is owned by the capturing doctor and protected by that identity, so there is
            no shared or code-based access path to it.
          </p>
        </div>
      </div>
    );
  }

  const handleCreate = async () => {
    if (!title.trim()) { setError('Give the capture a working title first.'); return; }
    setBusy(true); setError(null);
    try {
      const created = await caseCaptureService.createCaptureRecord({
        doctorId: doctor.id,
        title: title.trim(),
        subjectLabel: subjectLabel.trim() || null,
      });
      setTitle(''); setSubjectLabel('');
      await loadRecords();
      setActiveId(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the capture.');
    } finally { setBusy(false); }
  };

  const handleLifecycle = async (status: CaseLifecycleStatus) => {
    if (!activeRecord) return;
    setBusy(true); setError(null);
    try {
      await caseCaptureService.setLifecycleStatus(activeRecord.id, status);
      await loadRecords();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the status.');
    } finally { setBusy(false); }
  };

  const handleCreateContinuityAction = async () => {
    if (!activeRecord || !doctor) return;
    if (!actionLabel.trim()) { setError('Add a short de-identified action label first.'); return; }
    setBusy(true); setError(null);
    try {
      await caseContinuityService.createAction({
        caseCaptureRecordId: activeRecord.id,
        doctorId: doctor.id,
        actionType,
        plannedFor: plannedFor ? new Date(`${plannedFor}T00:00:00.000Z`).toISOString() : null,
        resultStatus,
        safeActionLabel: actionLabel,
      });
      setActionLabel('');
      setPlannedFor('');
      setResultStatus('not_expected');
      await loadContinuityActions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the continuity action.');
    } finally { setBusy(false); }
  };

  const handleCompleteAction = async (action: CaseContinuityAction) => {
    if (!window.confirm(`Mark "${action.safe_action_label}" completed? This records explicit completion evidence.`)) return;
    setBusy(true); setError(null);
    try {
      await caseContinuityService.markCompleted(action.id);
      await loadContinuityActions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not mark the action completed.');
    } finally { setBusy(false); }
  };

  const handleCancelAction = async (action: CaseContinuityAction) => {
    if (!window.confirm(`Cancel "${action.safe_action_label}"? This does not mark it completed.`)) return;
    setBusy(true); setError(null);
    try {
      await caseContinuityService.markCancelled(action.id);
      await loadContinuityActions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel the action.');
    } finally { setBusy(false); }
  };

  const handleResultStatus = async (action: CaseContinuityAction, status: 'available' | 'reviewed') => {
    setBusy(true); setError(null);
    try {
      if (status === 'available') await caseContinuityService.markResultAvailable(action.id);
      else await caseContinuityService.markResultReviewed(action.id);
      await loadContinuityActions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update result status.');
    } finally { setBusy(false); }
  };

  // Upload and row insert go through captureArtifact, which rolls the upload
  // back if the insert fails — otherwise a failure here would leave raw source
  // in the private bucket with no row referencing it.
  const handleAddArtifact = async (file: File) => {
    if (!activeRecord) return;
    setBusy(true); setError(null);
    try {
      await caseCaptureService.captureArtifact(doctor.id, activeRecord.id, file, {
        artifactKind,
        sourceProvenance: provenance,
      });
      await loadArtifacts(activeRecord.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the artifact.');
    } finally { setBusy(false); }
  };

  // Secure retrieval: a short-lived signed URL, never a public one. The bucket
  // is private, so there is no public URL to fall back to.
  const handleView = async (artifact: CaseCaptureArtifact) => {
    setBusy(true); setError(null);
    try {
      const url = await caseCaptureService.createArtifactSignedUrl(artifact.storage_path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the artifact.');
    } finally { setBusy(false); }
  };

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4">
        <h2 className="text-sm font-bold text-slate-800">Case capture</h2>
        <p className="mt-1 text-[11px] text-slate-500">
          Signed in as {doctor.fullName}. Captures are private to this account.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* --- captures --- */}
        <div className="space-y-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Ongoing cases</h3>
              <span className="rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600">
                {openContinuityActions.length} open
              </span>
            </div>
            {openContinuityActions.length === 0 ? (
              <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
                No structured follow-up, procedure, investigation, or result-review actions are open.
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {openContinuityActions.map((action) => {
                  const record = records.find((r) => r.id === action.case_capture_record_id);
                  return (
                    <button
                      key={action.id}
                      type="button"
                      onClick={() => setActiveId(action.case_capture_record_id)}
                      className="w-full rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-left hover:border-slate-200"
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-bold text-slate-800">{record?.subject_label || record?.title || action.case_capture_record_id.slice(0, 8)}</span>
                          <span className="block truncate text-[11px] text-slate-600">{action.safe_action_label}</span>
                        </span>
                        <span className="shrink-0 rounded-md bg-white px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-500">{dueLabel(action)}</span>
                      </span>
                      <span className="mt-1.5 block text-[10px] text-slate-500">
                        {actionTypeLabel(action.action_type)} · {formatDate(action.planned_for)} · {action.status}
                        {action.result_status !== 'not_expected' ? ` · result ${resultStatusLabel(action.result_status).toLowerCase()}` : ''}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {closedContinuityActions.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-wider text-slate-500">Completed/cancelled history</summary>
                <div className="mt-2 space-y-1">
                  {closedContinuityActions.slice(0, 6).map((action) => (
                    <p key={action.id} className="truncate rounded-lg bg-slate-50 px-2 py-1.5 text-[10px] text-slate-500">
                      {action.safe_action_label} · {action.status} · {formatDate(action.completed_at || action.updated_at)}
                    </p>
                  ))}
                </div>
              </details>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">New capture</h3>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Working title"
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
            />
            <input
              value={subjectLabel}
              onChange={(e) => setSubjectLabel(e.target.value)}
              placeholder="Subject label (de-identified)"
              className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
            />
            <p className="mt-1.5 text-[10px] leading-relaxed text-slate-500">
              Use a de-identified label. No patient name and no hospital number — those belong in
              the clinical record, not here.
            </p>
            <button
              onClick={() => void handleCreate()}
              disabled={busy}
              className="mt-3 w-full rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              Create capture
            </button>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-2">
            {records.length === 0 ? (
              <p className="px-2 py-3 text-[11px] text-slate-500">No captures yet.</p>
            ) : (
              records.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setActiveId(r.id)}
                  className={`mb-1 w-full rounded-xl px-3 py-2 text-left ${r.id === activeId ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                >
                  <span className="block truncate text-xs font-semibold text-slate-800">
                    {r.title || 'Untitled capture'}
                  </span>
                  <span className="mt-0.5 block text-[10px] uppercase tracking-wider text-slate-500">
                    {r.lifecycle_status.replace(/_/g, ' ')}
                    {r.portfolio_ref ? ' · in portfolio' : ' · unassigned'}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* --- artifacts --- */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          {!activeRecord ? (
            <p className="text-[11px] text-slate-500">Select a capture to see its source artifacts.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-bold text-slate-800">{activeRecord.title || 'Untitled capture'}</h3>
                <select
                  value={activeRecord.lifecycle_status}
                  onChange={(e) => void handleLifecycle(e.target.value as CaseLifecycleStatus)}
                  disabled={busy}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px]"
                >
                  {LIFECYCLE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <p className="mt-1 text-[10px] text-slate-500">
                {activeRecord.portfolio_ref
                  ? 'Linked to a portfolio case.'
                  : 'Not assigned to any Fellowship slot. Capture does not require one.'}
              </p>

              <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3">
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Continuity action</h4>
                <div className="mt-2 grid gap-2 md:grid-cols-[1fr_150px_150px_150px]">
                  <input
                    value={actionLabel}
                    onChange={(e) => setActionLabel(e.target.value)}
                    placeholder="Safe action label"
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                  />
                  <select
                    value={actionType}
                    onChange={(e) => setActionType(e.target.value as CaseContinuityActionType)}
                    className="rounded-xl border border-slate-200 bg-white px-2 py-2 text-xs"
                  >
                    {ACTION_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <input
                    type="date"
                    value={plannedFor}
                    onChange={(e) => setPlannedFor(e.target.value)}
                    className="rounded-xl border border-slate-200 bg-white px-2 py-2 text-xs"
                  />
                  <select
                    value={resultStatus}
                    onChange={(e) => setResultStatus(e.target.value as CaseContinuityResultStatus)}
                    className="rounded-xl border border-slate-200 bg-white px-2 py-2 text-xs"
                  >
                    {RESULT_STATUSES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[10px] leading-relaxed text-slate-500">
                    Labels must stay de-identified. Booked or planned work remains planned until you explicitly mark it completed.
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleCreateContinuityAction()}
                    disabled={busy}
                    className="rounded-lg bg-slate-900 px-3 py-2 text-[11px] font-bold text-white disabled:opacity-50"
                  >
                    Add action
                  </button>
                </div>
              </div>

              {activeRecordActions.length > 0 && (
                <div className="mt-4 space-y-2">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Actions for this case</h4>
                  {activeRecordActions.map((action) => (
                    <div key={action.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-xs font-bold text-slate-800">{action.safe_action_label}</p>
                          <p className="mt-0.5 text-[10px] text-slate-500">
                            {actionTypeLabel(action.action_type)} · {formatDate(action.planned_for)} · {action.status}
                            {action.result_status !== 'not_expected' ? ` · result ${resultStatusLabel(action.result_status).toLowerCase()}` : ''}
                          </p>
                        </div>
                        <span className="rounded-md bg-white px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-500">{dueLabel(action)}</span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {action.status === 'planned' && (
                          <>
                            <button type="button" onClick={() => void handleCompleteAction(action)} disabled={busy} className="rounded-lg border border-emerald-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-700 disabled:opacity-50">Mark completed</button>
                            <button type="button" onClick={() => void handleCancelAction(action)} disabled={busy} className="rounded-lg border border-rose-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-rose-700 disabled:opacity-50">Mark cancelled</button>
                          </>
                        )}
                        {(action.action_type === 'investigation' || action.action_type === 'result_review' || action.result_status !== 'not_expected') && action.result_status !== 'available' && action.result_status !== 'reviewed' && (
                          <button type="button" onClick={() => void handleResultStatus(action, 'available')} disabled={busy} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-50">Result available</button>
                        )}
                        {(action.action_type === 'investigation' || action.action_type === 'result_review' || action.result_status !== 'not_expected') && action.result_status !== 'reviewed' && (
                          <button type="button" onClick={() => void handleResultStatus(action, 'reviewed')} disabled={busy} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-50">Result reviewed</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Kind
                  <select
                    value={artifactKind}
                    onChange={(e) => setArtifactKind(e.target.value as CaseArtifactKind)}
                    className="mt-1 block rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] font-normal normal-case tracking-normal"
                  >
                    {ARTIFACT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                  </select>
                </label>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Provenance
                  <select
                    value={provenance}
                    onChange={(e) => setProvenance(e.target.value as CaseArtifactProvenance)}
                    className="mt-1 block rounded-xl border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] font-normal normal-case tracking-normal"
                  >
                    {PROVENANCE.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </label>
                <label className="text-[11px] font-semibold text-slate-700">
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500">Add</span>
                  <input
                    type="file"
                    disabled={busy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleAddArtifact(f);
                      e.target.value = '';
                    }}
                    className="block w-full text-[11px] file:mr-2 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-[11px] file:font-semibold file:text-white"
                  />
                </label>
              </div>

              <ol className="mt-4 space-y-2">
                {artifacts.length === 0 && (
                  <li className="text-[11px] text-slate-500">
                    No artifacts yet. Note pages and photographs stay in capture order.
                  </li>
                )}
                {artifacts.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 px-3 py-2">
                    <div className="min-w-0">
                      <span className="block text-xs font-semibold text-slate-800">
                        {a.sequence}. {a.artifact_kind.replace(/_/g, ' ')}
                      </span>
                      <span className="block text-[10px] uppercase tracking-wider text-slate-500">
                        {a.source_provenance.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <button
                      onClick={() => void handleView(a)}
                      disabled={busy}
                      className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-50"
                    >
                      View
                    </button>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
