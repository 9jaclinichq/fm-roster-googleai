import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, BookOpen, Camera, ExternalLink, FileText, RefreshCw, Stethoscope } from 'lucide-react';
import {
  CaseArtifactKind,
  CaseArtifactProvenance,
  CaseCaptureArtifact,
  CaseCaptureRecord,
  CaseLifecycleStatus,
  caseCaptureService,
} from '../lib/caseCaptureService';
import {
  CaseContinuityAction,
  CaseContinuityActionType,
  CaseContinuityResultStatus,
  caseContinuityService,
} from '../lib/caseContinuityService';
import { CASES_V1_ROUTES, projectCasesOverview, type CasesOverviewItem } from '../lib/casesOverview';

interface CasesLandingViewProps {
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

function formatDate(value: string | null): string {
  if (!value) return 'Unscheduled';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Invalid date';
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function labelize(value: string): string {
  return value.replace(/_/g, ' ');
}

function actionLabel(action: CaseContinuityAction): string {
  const type = ACTION_TYPES.find((option) => option.value === action.action_type)?.label ?? action.action_type;
  const result = action.result_status === 'not_expected'
    ? ''
    : ` · result ${RESULT_STATUSES.find((option) => option.value === action.result_status)?.label.toLowerCase() ?? action.result_status}`;
  return `${type} · ${formatDate(action.planned_for)} · ${action.status}${result}`;
}

export const CasesLandingView: React.FC<CasesLandingViewProps> = ({ doctor }) => {
  const navigate = useNavigate();
  const [records, setRecords] = useState<CaseCaptureRecord[]>([]);
  const [artifactCounts, setArtifactCounts] = useState<Record<string, number>>({});
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [selectedArtifacts, setSelectedArtifacts] = useState<CaseCaptureArtifact[]>([]);
  const [continuityActions, setContinuityActions] = useState<CaseContinuityAction[]>([]);
  const [continuityUnavailable, setContinuityUnavailable] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [subjectLabel, setSubjectLabel] = useState('');
  const [artifactKind, setArtifactKind] = useState<CaseArtifactKind>('note_page');
  const [provenance, setProvenance] = useState<CaseArtifactProvenance>('source_observed');
  const [actionLabelInput, setActionLabelInput] = useState('');
  const [actionType, setActionType] = useState<CaseContinuityActionType>('follow_up');
  const [plannedFor, setPlannedFor] = useState('');
  const [resultStatus, setResultStatus] = useState<CaseContinuityResultStatus>('not_expected');

  const selectedRecord = records.find((record) => record.id === selectedRecordId) ?? null;
  const selectedActions = continuityActions
    .filter((action) => action.case_capture_record_id === selectedRecordId)
    .sort((a, b) => (a.planned_for || a.updated_at).localeCompare(b.planned_for || b.updated_at));
  const overview = useMemo<CasesOverviewItem[]>(() => (
    projectCasesOverview({ records, artifactCountsByRecordId: artifactCounts, continuityActions })
  ), [records, artifactCounts, continuityActions]);

  const load = useCallback(async () => {
    if (!doctor) return;
    setIsLoading(true);
    setError(null);
    try {
      const nextRecords = await caseCaptureService.listCaptureRecords(doctor.id);
      setRecords(nextRecords);
      setSelectedRecordId((current) => current ?? nextRecords[0]?.id ?? null);
      const counts: Record<string, number> = {};
      await Promise.all(nextRecords.map(async (record) => {
        counts[record.id] = (await caseCaptureService.listArtifacts(record.id)).length;
      }));
      setArtifactCounts(counts);
      try {
        setContinuityActions(await caseContinuityService.listActionsForDoctor(doctor.id));
        setContinuityUnavailable(false);
      } catch {
        setContinuityActions([]);
        setContinuityUnavailable(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load cases.');
    } finally {
      setIsLoading(false);
    }
  }, [doctor]);

  const loadSelectedArtifacts = useCallback(async () => {
    if (!selectedRecordId) {
      setSelectedArtifacts([]);
      return;
    }
    try {
      setSelectedArtifacts(await caseCaptureService.listArtifacts(selectedRecordId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load case artifacts.');
    }
  }, [selectedRecordId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadSelectedArtifacts(); }, [loadSelectedArtifacts]);

  const handleCreate = async () => {
    if (!doctor) return;
    if (!title.trim()) {
      setError('Give the case a de-identified working title first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await caseCaptureService.createCaptureRecord({
        doctorId: doctor.id,
        title: title.trim(),
        subjectLabel: subjectLabel.trim() || null,
      });
      setTitle('');
      setSubjectLabel('');
      await load();
      setSelectedRecordId(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not capture case.');
    } finally {
      setBusy(false);
    }
  };

  const handleLifecycle = async (status: CaseLifecycleStatus) => {
    if (!selectedRecord) return;
    setBusy(true);
    setError(null);
    try {
      await caseCaptureService.setLifecycleStatus(selectedRecord.id, status);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update case status.');
    } finally {
      setBusy(false);
    }
  };

  const handleAddArtifact = async (file: File) => {
    if (!doctor || !selectedRecord) return;
    setBusy(true);
    setError(null);
    try {
      await caseCaptureService.captureArtifact(doctor.id, selectedRecord.id, file, {
        artifactKind,
        sourceProvenance: provenance,
      });
      await load();
      await loadSelectedArtifacts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add artifact.');
    } finally {
      setBusy(false);
    }
  };

  const handleOpenArtifact = async (artifact: CaseCaptureArtifact) => {
    setBusy(true);
    setError(null);
    try {
      const url = await caseCaptureService.createArtifactSignedUrl(artifact.storage_path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open artifact.');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateAction = async () => {
    if (!doctor || !selectedRecord) return;
    if (!actionLabelInput.trim()) {
      setError('Add a short de-identified action label first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await caseContinuityService.createAction({
        caseCaptureRecordId: selectedRecord.id,
        doctorId: doctor.id,
        actionType,
        plannedFor: plannedFor ? new Date(`${plannedFor}T00:00:00.000Z`).toISOString() : null,
        resultStatus,
        safeActionLabel: actionLabelInput,
      });
      setActionLabelInput('');
      setPlannedFor('');
      setResultStatus('not_expected');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save structured action.');
    } finally {
      setBusy(false);
    }
  };

  const handleCompleteAction = async (action: CaseContinuityAction) => {
    setBusy(true);
    setError(null);
    try {
      await caseContinuityService.markCompleted(action.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not mark action completed.');
    } finally {
      setBusy(false);
    }
  };

  const handleResultReviewed = async (action: CaseContinuityAction) => {
    setBusy(true);
    setError(null);
    try {
      await caseContinuityService.markResultReviewed(action.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not mark result reviewed.');
    } finally {
      setBusy(false);
    }
  };

  if (!doctor) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-bold text-slate-900">Cases</h2>
          <p className="mt-2 text-xs leading-relaxed text-slate-600">
            Cases are available only to a signed-in doctor account. Raw source material is owned by that doctor identity.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-950">Cases</h2>
          <p className="mt-1 text-xs text-slate-500">
            Doctor-owned capture, continuity, artifacts and portfolio links in one place.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => navigate(CASES_V1_ROUTES.doctorWorkspace)} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">
            <ArrowLeft size={14} /> Workspace
          </button>
          <button type="button" onClick={() => navigate(CASES_V1_ROUTES.casebookLogbook)} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">
            <BookOpen size={14} /> Casebook/Logbook
          </button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
      {continuityUnavailable && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Structured follow-up actions are not enabled in this environment yet. Case capture and artifact review remain available.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <aside className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Capture New Case</h3>
              <Camera size={15} className="text-slate-400" />
            </div>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="De-identified working title" className="mt-3 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs" />
            <input value={subjectLabel} onChange={(e) => setSubjectLabel(e.target.value)} placeholder="Optional safe reference" className="mt-2 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs" />
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              Keep names, hospital numbers, photographs and clinical narratives out of overview labels.
            </p>
            <button type="button" onClick={() => void handleCreate()} disabled={busy} className="mt-3 w-full rounded-md bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
              Capture case
            </button>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Cases Overview</h3>
              {isLoading && <RefreshCw size={14} className="animate-spin text-slate-400" />}
            </div>
            {overview.length === 0 ? (
              <div className="px-4 py-6 text-xs leading-relaxed text-slate-500">
                No captured cases yet. Use Capture case to create your first doctor-owned record.
              </div>
            ) : (
              <div className="max-h-[620px] overflow-y-auto p-2">
                {overview.map((item) => (
                  <button key={item.id} type="button" onClick={() => setSelectedRecordId(item.id)} className={`mb-1 w-full rounded-md px-3 py-2 text-left hover:bg-slate-50 ${item.id === selectedRecordId ? 'bg-slate-100' : ''}`}>
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-bold text-slate-900">{item.displayTitle}</span>
                        <span className="mt-0.5 block text-[10px] uppercase tracking-wider text-slate-500">{labelize(item.lifecycleStatus)} · {labelize(item.ownershipStatus)}</span>
                      </span>
                      <span className="shrink-0 rounded bg-white px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-500">{labelize(item.priority)}</span>
                    </span>
                    <span className="mt-1 block text-[11px] text-slate-600">{item.nextAction}</span>
                    <span className="mt-1 block text-[10px] text-slate-400">
                      Captured {formatDate(item.capturedAt)} · Updated {formatDate(item.updatedAt)} · {item.artifactCount} artifact{item.artifactCount === 1 ? '' : 's'}{item.hasWriteUpRef ? ' · write-up linked' : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        <main className="rounded-lg border border-slate-200 bg-white p-4">
          {!selectedRecord ? (
            <div className="flex min-h-[320px] items-center justify-center text-center text-xs text-slate-500">
              Select a case to continue, review artifacts, or open portfolio work.
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold text-slate-900">{overview.find((item) => item.id === selectedRecord.id)?.displayTitle ?? 'Case'}</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Captured {formatDate(selectedRecord.captured_at)} · Last updated {formatDate(selectedRecord.updated_at)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <select value={selectedRecord.lifecycle_status} onChange={(e) => void handleLifecycle(e.target.value as CaseLifecycleStatus)} disabled={busy} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-2 text-xs">
                    {LIFECYCLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <button type="button" onClick={() => navigate(CASES_V1_ROUTES.casebookLogbook)} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">
                    <Stethoscope size={14} /> Open Casebook/Logbook
                  </button>
                </div>
              </div>

              <section className="grid gap-3 md:grid-cols-3">
                <div className="rounded-md border border-slate-100 bg-slate-50 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Artifact availability</p>
                  <p className="mt-1 text-sm font-bold text-slate-800">{selectedArtifacts.length} available</p>
                </div>
                <div className="rounded-md border border-slate-100 bg-slate-50 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Write-up</p>
                  <p className="mt-1 text-sm font-bold text-slate-800">{selectedRecord.portfolio_ref ? 'Linked' : 'Not linked'}</p>
                </div>
                <div className="rounded-md border border-slate-100 bg-slate-50 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Open actions</p>
                  <p className="mt-1 text-sm font-bold text-slate-800">{selectedActions.filter((action) => action.status === 'planned').length}</p>
                </div>
              </section>

              <section className="rounded-lg border border-slate-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">Artifacts</h4>
                  <div className="flex flex-wrap items-center gap-2">
                    <select value={artifactKind} onChange={(e) => setArtifactKind(e.target.value as CaseArtifactKind)} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px]">
                      {ARTIFACT_KINDS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                    <select value={provenance} onChange={(e) => setProvenance(e.target.value as CaseArtifactProvenance)} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px]">
                      {PROVENANCE.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-[11px] font-bold text-white">
                      <FileText size={13} />
                      Add artifact
                      <input type="file" className="hidden" disabled={busy} onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void handleAddArtifact(file);
                        e.target.value = '';
                      }} />
                    </label>
                  </div>
                </div>
                <div className="mt-3 space-y-2">
                  {selectedArtifacts.length === 0 ? (
                    <p className="text-xs text-slate-500">No artifacts are attached to this case yet.</p>
                  ) : selectedArtifacts.map((artifact) => (
                    <div key={artifact.id} className="flex items-center justify-between gap-3 rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
                      <div>
                        <p className="text-xs font-bold text-slate-800">{artifact.sequence}. {labelize(artifact.artifact_kind)}</p>
                        <p className="text-[10px] uppercase tracking-wider text-slate-500">{labelize(artifact.source_provenance)} · {formatDate(artifact.captured_at)}</p>
                      </div>
                      <button type="button" onClick={() => void handleOpenArtifact(artifact)} disabled={busy} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-700 disabled:opacity-50">
                        <ExternalLink size={12} /> Open
                      </button>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-lg border border-slate-200 p-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">Continuity</h4>
                {continuityUnavailable ? (
                  <p className="mt-2 text-xs text-slate-500">Structured follow-up actions are not yet enabled here.</p>
                ) : (
                  <>
                    <div className="mt-3 grid gap-2 md:grid-cols-[1fr_140px_140px_130px_auto]">
                      <input value={actionLabelInput} onChange={(e) => setActionLabelInput(e.target.value)} placeholder="Safe action label" className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs" />
                      <select value={actionType} onChange={(e) => setActionType(e.target.value as CaseContinuityActionType)} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-2 text-xs">
                        {ACTION_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                      <input type="date" value={plannedFor} onChange={(e) => setPlannedFor(e.target.value)} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-2 text-xs" />
                      <select value={resultStatus} onChange={(e) => setResultStatus(e.target.value as CaseContinuityResultStatus)} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-2 text-xs">
                        {RESULT_STATUSES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                      <button type="button" onClick={() => void handleCreateAction()} disabled={busy} className="rounded-md bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Add</button>
                    </div>
                    <div className="mt-3 space-y-2">
                      {selectedActions.length === 0 ? (
                        <p className="text-xs text-slate-500">No structured actions recorded for this case.</p>
                      ) : selectedActions.map((action) => (
                        <div key={action.id} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="text-xs font-bold text-slate-800">{action.safe_action_label}</p>
                              <p className="mt-0.5 text-[10px] text-slate-500">{actionLabel(action)}</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {action.status === 'planned' && (
                                <button type="button" onClick={() => void handleCompleteAction(action)} disabled={busy} className="rounded-md border border-emerald-200 bg-white px-2 py-1 text-[11px] font-bold text-emerald-700 disabled:opacity-50">Complete action</button>
                              )}
                              {action.result_status !== 'not_expected' && action.result_status !== 'reviewed' && (
                                <button type="button" onClick={() => void handleResultReviewed(action)} disabled={busy} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-700 disabled:opacity-50">Result reviewed</button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </section>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
