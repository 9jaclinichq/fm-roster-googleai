import React, { useState, useEffect } from 'react';
import { databaseService } from '../lib/databaseService';
import { academicCopilot } from '../lib/ai/academicCopilot';
import { CaseReport, CaseReportStatus } from '../types';
import { ClipboardList, RefreshCw, FileText, UploadCloud, X, AlertTriangle, CheckCircle2, Clock, Sparkles } from 'lucide-react';

interface CasebookBuilderViewProps {
  resident: { id: string; name: string; category: string };
}

const STATUS_BADGE: Record<CaseReportStatus, { label: string; className: string; icon: React.ReactNode }> = {
  draft: { label: 'Draft', className: 'bg-slate-100 text-slate-600 border-slate-200', icon: <FileText size={11} /> },
  pending_supervisor: { label: 'Submitted', className: 'bg-amber-50 text-amber-700 border-amber-200', icon: <Clock size={11} /> },
  approved: { label: 'Approved', className: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: <CheckCircle2 size={11} /> },
};

const CASE_NUMBERS = Array.from({ length: 15 }, (_, i) => i + 1);

export const CasebookBuilderView: React.FC<CasebookBuilderViewProps> = ({ resident }) => {
  const [reports, setReports] = useState<CaseReport[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [activeCaseNumber, setActiveCaseNumber] = useState<number | null>(null);

  // Edit form
  const [patientInitials, setPatientInitials] = useState<string>('');
  const [diagnosis, setDiagnosis] = useState<string>('');
  const [category, setCategory] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string>('');
  const [isUploading, setIsUploading] = useState<boolean>(false);

  // Differential-extraction helper (not persisted — a scratch tool)
  const [caseNotes, setCaseNotes] = useState<string>('');
  const [ddxCandidates, setDdxCandidates] = useState<string[] | null>(null);
  const [ddxReasoning, setDdxReasoning] = useState<string | null>(null);
  const [isExtractingDdx, setIsExtractingDdx] = useState<boolean>(false);

  const load = () => {
    setIsLoading(true);
    databaseService.getCaseReports(resident.id)
      .then(setReports)
      .catch(err => console.warn('Failed to load case reports:', err))
      .finally(() => setIsLoading(false));
  };

  useEffect(load, [resident.id]);

  const activeReport = reports.find(r => r.case_number === activeCaseNumber) || null;
  const isReadOnly = activeReport ? activeReport.status !== 'draft' : false;

  const openCase = (caseNumber: number) => {
    const existing = reports.find(r => r.case_number === caseNumber);
    setActiveCaseNumber(caseNumber);
    setPatientInitials(existing?.patient_initials || '');
    setDiagnosis(existing?.diagnosis || '');
    setCategory(existing?.category || '');
    setSaveError('');
    setCaseNotes('');
    setDdxCandidates(null);
    setDdxReasoning(null);
  };

  const handleExtractDdx = async () => {
    if (!caseNotes.trim()) return;
    setIsExtractingDdx(true);
    try {
      const result = await academicCopilot.extractDifferentialDiagnosis(resident.id, caseNotes);
      setDdxCandidates(result.candidates);
      setDdxReasoning(result.reasoning);
    } finally {
      setIsExtractingDdx(false);
    }
  };

  const closeModal = () => setActiveCaseNumber(null);

  const handleSave = async (submit: boolean) => {
    if (!activeCaseNumber) return;
    setSaveError('');

    if (submit && (!patientInitials.trim() || !diagnosis.trim())) {
      setSaveError('Patient initials and diagnosis are required before submitting.');
      return;
    }

    setIsSaving(true);
    try {
      const updated = await databaseService.upsertCaseReport(resident.id, activeCaseNumber, {
        patient_initials: patientInitials.trim() || null,
        diagnosis: diagnosis.trim() || null,
        category: category.trim() || null,
        status: submit ? 'pending_supervisor' : 'draft',
      });
      setReports(prev => {
        const exists = prev.some(r => r.id === updated.id);
        return exists ? prev.map(r => r.id === updated.id ? updated : r) : [...prev, updated];
      });
      if (submit) closeModal();
    } catch (err) {
      console.warn(err);
      setSaveError('Failed to save case report.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleUploadDoc = async (file: File) => {
    if (!activeCaseNumber) return;
    setIsUploading(true);
    try {
      const url = await databaseService.uploadCaseDocument(resident.id, activeCaseNumber, file);
      const updated = await databaseService.upsertCaseReport(resident.id, activeCaseNumber, { document_url: url });
      setReports(prev => {
        const exists = prev.some(r => r.id === updated.id);
        return exists ? prev.map(r => r.id === updated.id ? updated : r) : [...prev, updated];
      });
    } catch (err) {
      console.warn(err);
      setSaveError('Failed to upload document.');
    } finally {
      setIsUploading(false);
    }
  };

  const completedCount = reports.filter(r => r.status !== 'draft' || r.patient_initials).length;

  return (
    <div className="max-w-5xl mx-auto my-8 px-4 space-y-6">
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center space-x-2">
          <ClipboardList className="text-slate-500" size={18} />
          <div>
            <h2 className="font-bold text-slate-900 text-lg tracking-tight">Casebook Builder</h2>
            <p className="text-xs text-slate-500">15 compulsory case management reports</p>
          </div>
        </div>
        <span className="text-xs font-bold text-slate-600 bg-slate-100 px-3 py-1.5 rounded-full">
          {completedCount} / 15 started
        </span>
      </div>

      {isLoading ? (
        <div className="text-center py-12 bg-white border border-slate-200 rounded-2xl">
          <RefreshCw size={28} className="text-slate-400 animate-spin mx-auto mb-2" />
          <p className="text-sm text-slate-500">Loading casebook...</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {CASE_NUMBERS.map(num => {
            const report = reports.find(r => r.case_number === num);
            const status = report?.status || 'draft';
            const badge = STATUS_BADGE[status];
            return (
              <button
                key={num}
                onClick={() => openCase(num)}
                className="bg-white border border-slate-200 hover:border-slate-300 rounded-2xl p-4 text-left shadow-sm transition cursor-pointer space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-slate-900 text-sm">Case {num}</span>
                </div>
                <span className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border ${badge.className}`}>
                  {badge.icon}
                  <span>{badge.label}</span>
                </span>
                {report?.diagnosis && (
                  <p className="text-[10px] text-slate-500 truncate">{report.diagnosis}</p>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Edit modal */}
      {activeCaseNumber && (
        <div className="fixed inset-0 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-lg w-full border border-slate-100 shadow-2xl">
            <div className="bg-slate-950 px-6 py-4 text-white flex justify-between items-center rounded-t-2xl">
              <h3 className="font-bold text-base">Case {activeCaseNumber}</h3>
              <button onClick={closeModal} className="text-slate-300 hover:text-white cursor-pointer">
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {isReadOnly && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3 text-xs flex items-center space-x-1.5">
                  <AlertTriangle size={13} />
                  <span>This case has been submitted and is read-only pending supervisor review.</span>
                </div>
              )}
              {saveError && (
                <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-3 text-xs">{saveError}</div>
              )}

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 uppercase">Patient Initials</label>
                <input
                  type="text"
                  disabled={isReadOnly}
                  value={patientInitials}
                  onChange={(e) => setPatientInitials(e.target.value)}
                  placeholder="e.g. A.B."
                  maxLength={10}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950 disabled:opacity-60"
                />
                <p className="text-[10px] text-slate-400">De-identified initials only — never the full patient name.</p>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 uppercase">Diagnosis</label>
                <input
                  type="text"
                  disabled={isReadOnly}
                  value={diagnosis}
                  onChange={(e) => setDiagnosis(e.target.value)}
                  placeholder="e.g. Type 2 Diabetes Mellitus"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950 disabled:opacity-60"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 uppercase">Category</label>
                <input
                  type="text"
                  disabled={isReadOnly}
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="e.g. Chronic Disease Management"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950 disabled:opacity-60"
                />
              </div>

              {!isReadOnly && (
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <label className="text-xs font-bold text-slate-700 uppercase flex items-center space-x-1.5">
                    <Sparkles size={12} className="text-slate-400" />
                    <span>Extract Differential Diagnoses</span>
                  </label>
                  <p className="text-[10px] text-slate-400">
                    Paste your raw case notes below — this organizes what you've already written into a structured
                    list (e.g. a "Differentials:" section becomes separate points). It doesn't invent new diagnoses.
                  </p>
                  <textarea
                    rows={3}
                    value={caseNotes}
                    onChange={(e) => setCaseNotes(e.target.value)}
                    placeholder="e.g. 45F with chest pain. Differentials: unstable angina, GERD, musculoskeletal pain, anxiety."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
                  />
                  <button
                    type="button"
                    onClick={handleExtractDdx}
                    disabled={isExtractingDdx || !caseNotes.trim()}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 font-bold rounded-lg text-[10px] transition cursor-pointer"
                  >
                    {isExtractingDdx ? 'Extracting...' : 'Extract'}
                  </button>

                  {ddxCandidates && (
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-1.5">
                      {ddxReasoning && <p className="text-[10px] text-slate-500 italic">{ddxReasoning}</p>}
                      {ddxCandidates.length > 0 && (
                        <ul className="list-disc list-inside space-y-0.5">
                          {ddxCandidates.map((c, i) => (
                            <li key={i} className="text-xs text-slate-700">{c}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700 uppercase">Attachment</label>
                {activeReport?.document_url && (
                  <a
                    href={activeReport.document_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center space-x-2 text-xs font-semibold text-slate-800 hover:underline bg-slate-50 p-2.5 rounded-lg border border-slate-200 w-max"
                  >
                    <FileText size={14} className="text-slate-400" />
                    <span>View uploaded document</span>
                  </a>
                )}
                {!isReadOnly && (
                  <label className="inline-flex items-center space-x-1.5 px-3 py-2 bg-slate-50 hover:bg-slate-100 border border-dashed border-slate-300 rounded-xl text-xs font-semibold text-slate-700 cursor-pointer transition">
                    <UploadCloud size={14} className="text-slate-400" />
                    <span>{isUploading ? 'Uploading...' : 'Upload Document'}</span>
                    <input
                      type="file"
                      accept=".pdf,.doc,.docx,image/jpeg,image/png"
                      className="hidden"
                      disabled={isUploading}
                      onChange={(e) => e.target.files?.[0] && handleUploadDoc(e.target.files[0])}
                    />
                  </label>
                )}
              </div>
            </div>

            {!isReadOnly && (
              <div className="bg-slate-50 border-t border-slate-100 px-6 py-4 flex justify-end gap-2 rounded-b-2xl">
                <button
                  onClick={() => handleSave(false)}
                  disabled={isSaving}
                  className="px-4 py-2 border border-slate-200 hover:bg-white font-bold rounded-xl text-xs transition cursor-pointer"
                >
                  Save Draft
                </button>
                <button
                  onClick={() => handleSave(true)}
                  disabled={isSaving}
                  className="px-4 py-2 bg-slate-950 hover:bg-slate-900 text-white font-bold rounded-xl text-xs shadow-sm transition cursor-pointer"
                >
                  {isSaving ? 'Submitting...' : 'Submit for Review'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
