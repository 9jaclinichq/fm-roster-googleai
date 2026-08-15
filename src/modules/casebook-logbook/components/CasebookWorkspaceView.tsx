import React, { useState, useEffect, useMemo } from 'react';
import { databaseService } from '../../../lib/databaseService';
import { casebookCopilot, CasebookCopilotSource } from '../lib/casebookCopilot';
import { useWorkspaceQuota } from '../../billing/lib/useWorkspaceQuota';
import { UpgradeCheckoutModal } from '../../billing/components/UpgradeCheckoutModal';
import {
  createGenogramTemplate, addGenogramNode, updateGenogramNode,
  calculateFamilyApgar, FAMILY_APGAR_INTERPRETATION_LABELS,
  createEcomap, addEcomapConnection, removeEcomapConnection,
  createFamilyCircle, addFamilyCircleMember, removeFamilyCircleMember,
  DUVALL_STAGES, getDuvallStage,
} from '../lib/familyTools';
import {
  validateReferenceFormatting, detectFigureStartingSentences, countPccmComponents, summarizeRubricScore,
} from '../lib/caseRubricEngine';
import {
  CasebookWorkspace, CasebookTemplate, CasebookFrameworkType, ClinicalCaseReport, ThematicArea,
  ClinicalLogbook, GenogramData, FamilyApgarInput, EcomapData, FamilyCircleData, DuvallStageNumber,
} from '../../../types';
import {
  GraduationCap, Plus, X, ClipboardList, Sparkles, Save, RefreshCw, CheckCircle2, AlertTriangle,
  Stethoscope, HeartPulse, Network, UploadCloud, FileText, Trash2, UserPlus, ListChecks,
} from 'lucide-react';

// Since migration 25, this view serves two kinds of owner: an institutional
// resident (workforce_id) or an unlinked individual doctor's personal
// workspace (doctor_id) — see DoctorHomeView's entry cards and
// ResearchWorkspaceView's identical WorkspaceOwner pattern.
interface WorkspaceOwner {
  id: string;
  name: string;
  kind: 'workforce' | 'doctor';
  // See ResearchWorkspaceView's identical field for the full rationale —
  // a real per-owner tenant, not a hardcoded DEFAULT_TENANT_ID, so
  // workspaces/AI subscription billing aren't misattributed to UCH for a
  // non-UCH tenant's resident.
  tenantId: string;
}

interface CasebookWorkspaceViewProps {
  owner: WorkspaceOwner;
  canManageLogbooks: boolean;
}

const FRAMEWORK_LABELS: Record<CasebookFrameworkType, string> = {
  WACP_PMR_10: 'WACP PMR 10-Case Track (Membership)',
  WACP_CASEBOOK_15: 'WACP 15-Casebook Track (Fellowship)',
  NPMCN_CASEBOOK_15: 'NPMCN 15-Casebook Track',
  GENERIC_10: 'Generic 10-Case Portfolio',
  CUSTOM_CLINICAL: 'Custom Clinical Track',
};

const THEMATIC_AREAS: ThematicArea[] = [
  'maternal_health', 'gynaecology', 'internal_medicine', 'child_health', 'surgery',
  'mental_health', 'trauma_orthopaedics', 'accident_emergency', 'ent', 'ophthalmology',
  'family_case_study', 'custom',
];

function caseCountForFramework(framework: CasebookFrameworkType): number {
  return framework === 'WACP_PMR_10' || framework === 'GENERIC_10' ? 10 : 15;
}

const CASE_TABS = [
  { id: 'history', label: 'Demographics & History' },
  { id: 'exam', label: 'Examination' },
  { id: 'pccm', label: 'PCCM' },
  { id: 'family', label: 'Family Tools' },
  { id: 'management', label: 'Management' },
  { id: 'discussion', label: 'Discussion & References' },
] as const;
type CaseTabId = typeof CASE_TABS[number]['id'];

const SourceBadge: React.FC<{ source: CasebookCopilotSource }> = ({ source }) => (
  <span className={`inline-block px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border ${
    source === 'edge_function' ? 'bg-violet-50 text-violet-700 border-violet-200' : 'bg-slate-100 text-slate-600 border-slate-200'
  }`}>
    {source === 'edge_function' ? 'AI-generated' : 'Heuristic (no AI configured)'}
  </span>
);

const Gauge: React.FC<{ label: string; result: { valid: boolean; message: string } }> = ({ label, result }) => (
  <div className={`rounded-xl p-3 border ${result.valid ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
    <div className="flex items-center space-x-1.5">
      {result.valid ? <CheckCircle2 size={12} className="text-emerald-600" /> : <AlertTriangle size={12} className="text-rose-600" />}
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">{label}</span>
    </div>
    <p className={`text-[11px] font-semibold mt-0.5 ${result.valid ? 'text-emerald-700' : 'text-rose-700'}`}>{result.message}</p>
  </div>
);

export const CasebookWorkspaceView: React.FC<CasebookWorkspaceViewProps> = ({ owner, canManageLogbooks }) => {
  const [workspaces, setWorkspaces] = useState<CasebookWorkspace[]>([]);
  const [templates, setTemplates] = useState<CasebookTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [cases, setCases] = useState<ClinicalCaseReport[]>([]);
  const [myLogbooks, setMyLogbooks] = useState<ClinicalLogbook[]>([]);

  // New workspace modal
  const [showNewModal, setShowNewModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newFramework, setNewFramework] = useState<CasebookFrameworkType>('WACP_PMR_10');
  const [newCandidateName, setNewCandidateName] = useState('');
  const [newExamDate, setNewExamDate] = useState('');
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);

  // Active case editor
  const [activeCaseNumber, setActiveCaseNumber] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<CaseTabId>('history');
  const [draft, setDraft] = useState<Partial<ClinicalCaseReport>>({});
  const [isSavingCase, setIsSavingCase] = useState(false);

  // AI Copilot
  const [auditNotes, setAuditNotes] = useState<string[] | null>(null);
  const [auditSource, setAuditSource] = useState<CasebookCopilotSource | null>(null);
  const [isAuditing, setIsAuditing] = useState(false);
  const [isGeneratingQuestions, setIsGeneratingQuestions] = useState(false);
  const [questionsSource, setQuestionsSource] = useState<CasebookCopilotSource | null>(null);

  // Admin logbook parsing panel
  const [logbookRawText, setLogbookRawText] = useState('');
  const [logbookFile, setLogbookFile] = useState<File | null>(null);
  const [isParsingLogbook, setIsParsingLogbook] = useState(false);
  const [parsedStations, setParsedStations] = useState<{ station_name: string; procedures: { procedure_or_competency: string; required_count: number }[] }[] | null>(null);
  const [parsedSource, setParsedSource] = useState<CasebookCopilotSource | null>(null);

  // AI Copilot feature gating — same free-tier rolling-window allowance and
  // upgrade checkout as the Research Engine (see src/modules/shared/config/tiers.ts).
  const quota = useWorkspaceQuota(owner.id);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId) || null;
  const activeTemplate = templates.find(t => t.id === activeWorkspace?.template_id) || null;
  const activeCase = cases.find(c => c.case_number === activeCaseNumber) || null;
  const caseCount = activeWorkspace ? caseCountForFramework(activeWorkspace.framework_type) : 0;

  useEffect(() => {
    setIsLoading(true);
    // Logbooks are workforce_id-keyed only (no doctor_id path — see
    // migration 25's header) — fetching by a doctor's id just returns an
    // empty list, which is the correct state for a personal workspace.
    Promise.all([
      owner.kind === 'workforce'
        ? databaseService.getCasebookWorkspacesForWorkforce(owner.id)
        : databaseService.getCasebookWorkspacesForDoctor(owner.id),
      databaseService.getCasebookTemplates(),
      databaseService.getClinicalLogbooks(owner.id),
    ])
      .then(([ws, tpl, lb]) => { setWorkspaces(ws); setTemplates(tpl); setMyLogbooks(lb); })
      .catch(err => console.warn('Failed to load casebook workspaces:', err))
      .finally(() => setIsLoading(false));
  }, [owner.id, owner.kind]);

  useEffect(() => {
    if (!activeWorkspaceId) { setCases([]); return; }
    databaseService.getClinicalCaseReports(activeWorkspaceId).then(setCases).catch(err => console.warn('Failed to load case reports:', err));
  }, [activeWorkspaceId]);

  useEffect(() => {
    setDraft(activeCase || { thematic_area: 'custom', history_notes: {}, examination_notes: {}, pccm_framework: {}, genogram_data: { nodes: [], relationships: [], disease_keys: [] }, family_tools_data: {}, management_plan: {} });
    setAuditNotes(null);
    setAuditSource(null);
  }, [activeCase?.id, activeCaseNumber]);

  const handleCreateWorkspace = async () => {
    if (!newTitle.trim()) return;
    setIsCreatingWorkspace(true);
    try {
      const matchingTemplate = templates.find(t => t.framework_type === newFramework);
      const workspace = await databaseService.createCasebookWorkspace({
        tenant_id: owner.kind === 'workforce' ? owner.tenantId : null,
        workforce_id: owner.kind === 'workforce' ? owner.id : null,
        doctor_id: owner.kind === 'doctor' ? owner.id : null,
        title: newTitle.trim(),
        framework_type: newFramework,
        template_id: matchingTemplate?.id || null,
        candidate_name: newCandidateName.trim() || owner.name,
        exam_date: newExamDate || null,
      });
      setWorkspaces(prev => [workspace, ...prev]);
      setActiveWorkspaceId(workspace.id);
      setShowNewModal(false);
      setNewTitle(''); setNewCandidateName(''); setNewExamDate('');
    } catch (err) {
      console.warn('Failed to create casebook workspace:', err);
    } finally {
      setIsCreatingWorkspace(false);
    }
  };

  const openCase = (num: number) => {
    setActiveCaseNumber(num);
    setActiveTab('history');
  };

  const handleSaveCase = async () => {
    if (!activeWorkspace || !activeCaseNumber) return;
    setIsSavingCase(true);
    try {
      const saved = await databaseService.upsertClinicalCaseReport(activeWorkspace.id, activeCaseNumber, {
        thematic_area: draft.thematic_area || 'custom',
        title: draft.title || null,
        patient_initials: draft.patient_initials || null,
        hospital_number: draft.hospital_number || null,
        age: draft.age ?? null,
        gender: draft.gender || null,
        point_of_care: draft.point_of_care || null,
        presenting_complaints: draft.presenting_complaints || null,
        hpi_text: draft.hpi_text || null,
        history_notes: draft.history_notes || {},
        examination_notes: draft.examination_notes || {},
        pccm_framework: draft.pccm_framework || {},
        genogram_data: draft.genogram_data || { nodes: [], relationships: [], disease_keys: [] },
        family_tools_data: draft.family_tools_data || {},
        management_plan: draft.management_plan || {},
        discussion_text: draft.discussion_text || null,
        references_text: draft.references_text || null,
      });
      setCases(prev => {
        const exists = prev.some(c => c.id === saved.id);
        return exists ? prev.map(c => (c.id === saved.id ? saved : c)) : [...prev, saved];
      });
    } catch (err) {
      console.warn('Failed to save case:', err);
    } finally {
      setIsSavingCase(false);
    }
  };

  const handleRunAudit = async () => {
    if (owner.kind !== 'workforce' || !activeWorkspace || !activeCaseNumber) return;
    if (quota.exhausted) {
      setShowUpgradeModal(true);
      return;
    }
    setIsAuditing(true);
    try {
      const result = await casebookCopilot.auditCase(owner.id, draft.title || '', draft.discussion_text || draft.hpi_text || '', draft.references_text || '', activeTemplate);
      setAuditNotes(result.notes);
      setAuditSource(result.source);
      const saved = await databaseService.upsertClinicalCaseReport(activeWorkspace.id, activeCaseNumber, { rubric_scores: result.scores });
      setCases(prev => prev.map(c => (c.case_number === activeCaseNumber ? saved : c)));
      setDraft(prev => ({ ...prev, rubric_scores: result.scores }));
      quota.refresh();
    } finally {
      setIsAuditing(false);
    }
  };

  const handleGenerateQuestions = async () => {
    if (owner.kind !== 'workforce' || !activeWorkspace || !activeCaseNumber) return;
    if (quota.exhausted) {
      setShowUpgradeModal(true);
      return;
    }
    setIsGeneratingQuestions(true);
    try {
      const result = await casebookCopilot.generateDefenseQuestions(owner.id, draft.title || '', draft.discussion_text || draft.hpi_text || '', draft.thematic_area || 'custom', activeTemplate);
      setQuestionsSource(result.source);
      const saved = await databaseService.upsertClinicalCaseReport(activeWorkspace.id, activeCaseNumber, { defense_questions: result.questions });
      setCases(prev => prev.map(c => (c.case_number === activeCaseNumber ? saved : c)));
      setDraft(prev => ({ ...prev, defense_questions: result.questions }));
      quota.refresh();
    } finally {
      setIsGeneratingQuestions(false);
    }
  };

  const handleParseLogbook = async () => {
    // Admin Logbook Parsing writes uploaded_by_workforce_id, a real FK into
    // workforce(id) — clinical_logbooks/admin_logbook_parsing_queue have no
    // doctor_id path (migration 25's header flags this as out of scope),
    // so this stays workforce-only. canManageLogbooks should already gate
    // this panel out of a doctor's UI, but this is a defense-in-depth
    // guard against a broken FK write, not just a redundant check.
    if (owner.kind !== 'workforce') return;
    if (quota.exhausted) {
      setShowUpgradeModal(true);
      return;
    }
    setIsParsingLogbook(true);
    try {
      let fileUrl: string | null = null;
      if (logbookFile) fileUrl = await databaseService.uploadLogbookDocument(logbookFile);

      const result = await casebookCopilot.parseLogbookCurriculum(owner.id, logbookRawText);
      setParsedStations(result.stations);
      setParsedSource(result.source);

      await databaseService.createAdminLogbookParsingQueueEntry({
        tenant_id: owner.tenantId,
        uploaded_by_workforce_id: owner.id,
        file_url: fileUrl,
        raw_text_content: logbookRawText || null,
      });
    } catch (err) {
      console.warn('Failed to parse logbook curriculum:', err);
    } finally {
      setIsParsingLogbook(false);
    }
  };

  const applyStationToMyLogbook = async (stationName: string, procedure: string, requiredCount: number) => {
    // Same FK constraint as handleParseLogbook above — clinical_logbooks
    // is workforce_id-keyed only.
    if (owner.kind !== 'workforce') return;
    try {
      const saved = await databaseService.upsertClinicalLogbookEntry({
        tenant_id: owner.tenantId,
        workforce_id: owner.id,
        station_name: stationName,
        procedure_or_competency: procedure,
        required_count: requiredCount,
      });
      setMyLogbooks(prev => {
        const exists = prev.some(l => l.id === saved.id);
        return exists ? prev.map(l => (l.id === saved.id ? saved : l)) : [...prev, saved];
      });
    } catch (err) {
      console.warn('Failed to apply station to logbook:', err);
    }
  };

  // --- Real-time gauges ---
  const referenceCheck = useMemo(() => validateReferenceFormatting(draft.references_text || '', activeTemplate), [draft.references_text, activeTemplate]);
  const figureCheck = useMemo(() => detectFigureStartingSentences(draft.discussion_text || ''), [draft.discussion_text]);
  const pccmCheck = useMemo(() => countPccmComponents(draft.pccm_framework || {}), [draft.pccm_framework]);
  const scoreSummary = useMemo(() => summarizeRubricScore(draft.rubric_scores || {}, activeTemplate), [draft.rubric_scores, activeTemplate]);

  // --- Family tools helpers bound to draft.family_tools_data / genogram_data ---
  const genogram: GenogramData = draft.genogram_data || { nodes: [], relationships: [], disease_keys: [] };
  const familyTools = draft.family_tools_data || {};

  const updateFamilyTools = (updates: Partial<typeof familyTools>) => {
    setDraft(prev => ({ ...prev, family_tools_data: { ...prev.family_tools_data, ...updates } }));
  };

  if (isLoading) {
    return (
      <div className="text-center py-16">
        <RefreshCw size={28} className="text-slate-400 animate-spin mx-auto mb-2" />
        <p className="text-sm text-slate-500">Loading Casebook & Logbook Engine...</p>
      </div>
    );
  }

  if (!activeWorkspace) {
    return (
      <div className="max-w-5xl mx-auto my-8 px-4 space-y-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center space-x-2">
            <Stethoscope className="text-slate-500" size={18} />
            <div>
              <h2 className="font-bold text-slate-900 text-lg tracking-tight">Casebook & Clinical Logbook Engine</h2>
              <p className="text-xs text-slate-500">WACP/NPMCN PMR & 15-Casebook portfolios, family medicine tools, and logbook tracking</p>
            </div>
          </div>
          <button onClick={() => setShowNewModal(true)} className="flex items-center space-x-1.5 px-3 py-2 bg-slate-950 hover:bg-slate-900 text-white rounded-xl text-xs font-bold shadow-sm transition cursor-pointer">
            <Plus size={14} /><span>New Casebook Workspace</span>
          </button>
        </div>

        {workspaces.length === 0 ? (
          <div className="text-center py-12 bg-white border border-dashed border-slate-300 rounded-2xl">
            <ClipboardList size={28} className="text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-500">No casebook workspaces yet — create one to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {workspaces.map(w => (
              <button key={w.id} onClick={() => setActiveWorkspaceId(w.id)} className="bg-white border border-slate-200 hover:border-slate-300 rounded-2xl p-4 text-left shadow-sm transition cursor-pointer space-y-1">
                <span className="font-bold text-slate-900 text-sm">{w.title}</span>
                <p className="text-[10px] text-slate-500">{FRAMEWORK_LABELS[w.framework_type]}</p>
                <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">{w.status.replace(/_/g, ' ')}</p>
              </button>
            ))}
          </div>
        )}

        {myLogbooks.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-2">
            <div className="flex items-center space-x-1.5">
              <ListChecks className="text-slate-500" size={16} />
              <h3 className="font-bold text-slate-900 text-sm">My Clinical Logbook</h3>
            </div>
            <div className="space-y-2">
              {myLogbooks.map(lb => (
                <div key={lb.id} className="flex items-center justify-between text-xs bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                  <div>
                    <p className="font-bold text-slate-700">{lb.station_name}</p>
                    <p className="text-slate-500">{lb.procedure_or_competency}</p>
                  </div>
                  <span className="font-bold text-slate-600">{lb.completed_count}/{lb.required_count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {showNewModal && (
          <div className="fixed inset-0 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl max-w-md w-full border border-slate-100 shadow-2xl">
              <div className="bg-slate-950 px-6 py-4 text-white flex justify-between items-center rounded-t-2xl">
                <h3 className="font-bold text-base">New Casebook Workspace</h3>
                <button onClick={() => setShowNewModal(false)} className="text-slate-300 hover:text-white cursor-pointer"><X size={18} /></button>
              </div>
              <div className="p-6 space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 uppercase">Working Title</label>
                  <input type="text" value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="e.g. 2026 Fellowship Casebook" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 uppercase">Track (Mode Switcher)</label>
                  <div className="grid grid-cols-1 gap-1.5">
                    {(Object.keys(FRAMEWORK_LABELS) as CasebookFrameworkType[]).map(fw => (
                      <button
                        key={fw}
                        onClick={() => setNewFramework(fw)}
                        className={`px-3 py-2 rounded-xl text-xs font-bold text-left border transition cursor-pointer ${
                          newFramework === fw ? 'bg-slate-950 text-white border-slate-950' : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        {FRAMEWORK_LABELS[fw]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 uppercase">Candidate Name</label>
                  <input type="text" value={newCandidateName} onChange={e => setNewCandidateName(e.target.value)} placeholder={owner.name} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 uppercase">Exam Date</label>
                  <input type="date" value={newExamDate} onChange={e => setNewExamDate(e.target.value)} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950" />
                </div>
              </div>
              <div className="bg-slate-50 border-t border-slate-100 px-6 py-4 flex justify-end gap-2 rounded-b-2xl">
                <button onClick={handleCreateWorkspace} disabled={isCreatingWorkspace || !newTitle.trim()} className="px-4 py-2 bg-slate-950 hover:bg-slate-900 text-white font-bold rounded-xl text-xs shadow-sm transition cursor-pointer disabled:opacity-50">
                  {isCreatingWorkspace ? 'Creating...' : 'Create Workspace'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto my-8 px-4 space-y-6">
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center space-x-2">
          <button onClick={() => { setActiveWorkspaceId(null); setActiveCaseNumber(null); }} className="text-xs font-bold text-slate-400 hover:text-slate-700 mr-2 cursor-pointer">&larr; All Workspaces</button>
          <Stethoscope className="text-slate-500" size={18} />
          <div>
            <h2 className="font-bold text-slate-900 text-lg tracking-tight">{activeWorkspace.title}</h2>
            <p className="text-xs text-slate-500">{FRAMEWORK_LABELS[activeWorkspace.framework_type]} &bull; {activeWorkspace.page_count_target.min_pages ? `${activeWorkspace.page_count_target.min_pages}-${activeWorkspace.page_count_target.max_pages}p target` : 'no page target'}</p>
          </div>
        </div>
      </div>

      {/* Case Matrix */}
      {!activeCaseNumber && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {Array.from({ length: caseCount }, (_, i) => i + 1).map(num => {
            const c = cases.find(cc => cc.case_number === num);
            return (
              <button key={num} onClick={() => openCase(num)} className="bg-white border border-slate-200 hover:border-slate-300 rounded-2xl p-4 text-left shadow-sm transition cursor-pointer space-y-2">
                <span className="font-extrabold text-slate-900 text-sm">Case {num}</span>
                <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{(c?.thematic_area || 'unassigned').replace(/_/g, ' ')}</p>
                <span className={`inline-block px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border ${
                  c?.status === 'approved' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                  c?.status === 'supervisor_review' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-slate-100 text-slate-600 border-slate-200'
                }`}>{c?.status || 'draft'}</span>
                {c?.title && <p className="text-[10px] text-slate-500 truncate">{c.title}</p>}
              </button>
            );
          })}
        </div>
      )}

      {/* Case Editor */}
      {activeCaseNumber && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <button onClick={() => setActiveCaseNumber(null)} className="text-xs font-bold text-slate-400 hover:text-slate-700 cursor-pointer">&larr; Case Matrix</button>
                <h3 className="font-bold text-slate-900 text-sm">Case {activeCaseNumber}</h3>
              </div>

              <div className="flex items-center space-x-1.5 flex-wrap gap-1">
                {CASE_TABS.map(t => (
                  <button key={t.id} onClick={() => setActiveTab(t.id)} className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border transition cursor-pointer ${
                    activeTab === t.id ? 'bg-slate-950 text-white border-slate-950' : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-slate-300'
                  }`}>{t.label}</button>
                ))}
              </div>

              {/* Tab 1: Demographics & History */}
              {activeTab === 'history' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <input type="text" value={draft.title || ''} onChange={e => setDraft(p => ({ ...p, title: e.target.value }))} placeholder="Case title" className="col-span-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950" />
                    <select value={draft.thematic_area || 'custom'} onChange={e => setDraft(p => ({ ...p, thematic_area: e.target.value as ThematicArea }))} className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium">
                      {THEMATIC_AREAS.map(a => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
                    </select>
                    <input type="text" value={draft.point_of_care || ''} onChange={e => setDraft(p => ({ ...p, point_of_care: e.target.value }))} placeholder="Point of care" className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-1 focus:ring-slate-950" />
                    <input type="text" value={draft.patient_initials || ''} onChange={e => setDraft(p => ({ ...p, patient_initials: e.target.value }))} placeholder="Patient initials" maxLength={10} className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-1 focus:ring-slate-950" />
                    <input type="text" value={draft.hospital_number || ''} onChange={e => setDraft(p => ({ ...p, hospital_number: e.target.value }))} placeholder="Hospital number" className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-1 focus:ring-slate-950" />
                    <input type="number" value={draft.age ?? ''} onChange={e => setDraft(p => ({ ...p, age: e.target.value ? Number(e.target.value) : null }))} placeholder="Age" className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-1 focus:ring-slate-950" />
                    <input type="text" value={draft.gender || ''} onChange={e => setDraft(p => ({ ...p, gender: e.target.value }))} placeholder="Gender" className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-1 focus:ring-slate-950" />
                  </div>
                  <textarea rows={2} value={draft.presenting_complaints || ''} onChange={e => setDraft(p => ({ ...p, presenting_complaints: e.target.value }))} placeholder="Presenting complaints" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium" />
                  <textarea rows={3} value={draft.hpi_text || ''} onChange={e => setDraft(p => ({ ...p, hpi_text: e.target.value }))} placeholder="History of Presenting Illness" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium" />
                  {([['ros', 'Review of Systems'], ['past_med_surg', 'Past Medical/Surgical History'], ['gynae_obs', 'Gynae/Obstetric History'], ['drug_allergy', 'Drug/Allergy History'], ['personal', 'Personal History'], ['family_social', 'Family/Social History']] as const).map(([key, label]) => (
                    <div key={key} className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-600 uppercase">{label}</label>
                      <textarea rows={2} value={draft.history_notes?.[key] || ''} onChange={e => setDraft(p => ({ ...p, history_notes: { ...p.history_notes, [key]: e.target.value } }))} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium" />
                    </div>
                  ))}
                </div>
              )}

              {/* Tab 2: Examination */}
              {activeTab === 'exam' && (
                <div className="space-y-3">
                  {([['general', 'General Examination'], ['systems', 'Systemic Examination'], ['local_specialized', 'Local / Specialized Examination']] as const).map(([key, label]) => (
                    <div key={key} className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-600 uppercase">{label}</label>
                      <textarea rows={3} value={draft.examination_notes?.[key] || ''} onChange={e => setDraft(p => ({ ...p, examination_notes: { ...p.examination_notes, [key]: e.target.value } }))} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium" />
                    </div>
                  ))}
                </div>
              )}

              {/* Tab 3: PCCM */}
              {activeTab === 'pccm' && (
                <div className="space-y-3">
                  {([['fife', 'FIFE (Feelings, Ideas, Function, Expectations)'], ['common_ground', 'Finding Common Ground'], ['whole_person', 'Understanding the Whole Person'], ['health_promotion', 'Health Promotion & Prevention']] as const).map(([key, label]) => (
                    <div key={key} className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-600 uppercase">{label}</label>
                      <textarea rows={2} value={draft.pccm_framework?.[key] || ''} onChange={e => setDraft(p => ({ ...p, pccm_framework: { ...p.pccm_framework, [key]: e.target.value } }))} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium" />
                    </div>
                  ))}
                  <Gauge label="PCCM Components" result={pccmCheck} />
                </div>
              )}

              {/* Tab 4: Family Tools Canvas */}
              {activeTab === 'family' && (
                <div className="space-y-5">
                  {/* Genogram */}
                  <div className="space-y-2 pb-3 border-b border-slate-100">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold text-slate-700 flex items-center space-x-1.5"><Network size={12} /><span>3-Generation Genogram</span></p>
                      {genogram.nodes.length === 0 && (
                        <button onClick={() => setDraft(p => ({ ...p, genogram_data: createGenogramTemplate(p.patient_initials || 'Index Patient') }))} className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-[10px] transition cursor-pointer">Generate Template</button>
                      )}
                    </div>
                    {genogram.nodes.map(node => (
                      <div key={node.id} className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg p-1.5">
                        <input type="text" value={node.label} onChange={e => setDraft(p => ({ ...p, genogram_data: updateGenogramNode(p.genogram_data!, node.id, { label: e.target.value }) }))} className="flex-1 px-2 py-1 bg-white border border-slate-200 rounded text-[11px]" />
                        <select value={node.sex} onChange={e => setDraft(p => ({ ...p, genogram_data: updateGenogramNode(p.genogram_data!, node.id, { sex: e.target.value as 'M' | 'F' | 'unknown' }) }))} className="px-1.5 py-1 bg-white border border-slate-200 rounded text-[11px]">
                          <option value="M">M</option><option value="F">F</option><option value="unknown">?</option>
                        </select>
                        <GenogramDiseasesInput
                          diseases={node.diseases}
                          onCommit={diseases => setDraft(p => ({ ...p, genogram_data: updateGenogramNode(p.genogram_data!, node.id, { diseases }) }))}
                        />
                      </div>
                    ))}
                    {genogram.disease_keys.length > 0 && (
                      <p className="text-[10px] text-slate-500">Disease legend: {genogram.disease_keys.join(', ')}</p>
                    )}
                    {genogram.nodes.length > 0 && (
                      <button onClick={() => setDraft(p => ({ ...p, genogram_data: addGenogramNode(p.genogram_data!, { label: 'New Member', generation: 3, sex: 'unknown', diseases: [] }) }))} className="flex items-center space-x-1 px-2 py-1 text-[10px] font-bold text-slate-500 hover:text-slate-800 cursor-pointer"><UserPlus size={11} /><span>Add Member</span></button>
                    )}
                  </div>

                  {/* Family APGAR */}
                  <div className="space-y-2 pb-3 border-b border-slate-100">
                    <p className="text-xs font-bold text-slate-700 flex items-center space-x-1.5"><HeartPulse size={12} /><span>Family APGAR</span></p>
                    <div className="grid grid-cols-5 gap-1.5">
                      {(['adaptability', 'partnership', 'growth', 'affection', 'resolve'] as const).map(key => (
                        <div key={key} className="space-y-0.5">
                          <label className="text-[9px] font-bold text-slate-500 uppercase">{key.slice(0, 4)}</label>
                          <select
                            value={(familyTools.family_apgar as FamilyApgarInput | undefined)?.[key] ?? 0}
                            onChange={e => {
                              const base: FamilyApgarInput = { adaptability: 0, partnership: 0, growth: 0, affection: 0, resolve: 0, ...(familyTools.family_apgar || {}) };
                              const updated = { ...base, [key]: Number(e.target.value) };
                              updateFamilyTools({ family_apgar: calculateFamilyApgar(updated) });
                            }}
                            className="w-full px-1.5 py-1 bg-slate-50 border border-slate-200 rounded text-[11px]"
                          >
                            <option value={0}>0</option><option value={1}>1</option><option value={2}>2</option>
                          </select>
                        </div>
                      ))}
                    </div>
                    {familyTools.family_apgar && (
                      <p className="text-[11px] font-semibold text-slate-700">Total: {familyTools.family_apgar.total}/10 — {FAMILY_APGAR_INTERPRETATION_LABELS[familyTools.family_apgar.interpretation]}</p>
                    )}
                  </div>

                  {/* Ecomap */}
                  <div className="space-y-2 pb-3 border-b border-slate-100">
                    <p className="text-xs font-bold text-slate-700">Ecomap</p>
                    <input type="text" value={(familyTools.ecomap as EcomapData | undefined)?.center || ''} onChange={e => updateFamilyTools({ ecomap: createEcomap(e.target.value) })} placeholder="Household/family label" className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium" />
                    {(familyTools.ecomap?.connections || []).map((c, i) => (
                      <div key={i} className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg p-1.5 text-[11px]">
                        <span>{c.label} <span className="text-slate-400">({c.strength}, {c.category})</span></span>
                        <button onClick={() => updateFamilyTools({ ecomap: removeEcomapConnection(familyTools.ecomap!, i) })} className="text-slate-400 hover:text-rose-600 cursor-pointer"><Trash2 size={11} /></button>
                      </div>
                    ))}
                    {familyTools.ecomap && <EcomapConnectionForm ecomap={familyTools.ecomap} onAdd={c => updateFamilyTools({ ecomap: addEcomapConnection(familyTools.ecomap!, c) })} />}
                  </div>

                  {/* Family Circle */}
                  <div className="space-y-2 pb-3 border-b border-slate-100">
                    <p className="text-xs font-bold text-slate-700">Family Circle</p>
                    {!familyTools.family_circle && <button onClick={() => updateFamilyTools({ family_circle: createFamilyCircle() })} className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-[10px] transition cursor-pointer">Start Family Circle</button>}
                    {(familyTools.family_circle?.members || []).map((m, i) => (
                      <div key={i} className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg p-1.5 text-[11px]">
                        <span>{m.label} <span className="text-slate-400">({m.closeness})</span></span>
                        <button onClick={() => updateFamilyTools({ family_circle: removeFamilyCircleMember(familyTools.family_circle!, i) })} className="text-slate-400 hover:text-rose-600 cursor-pointer"><Trash2 size={11} /></button>
                      </div>
                    ))}
                    {familyTools.family_circle && <FamilyCircleForm circle={familyTools.family_circle} onAdd={m => updateFamilyTools({ family_circle: addFamilyCircleMember(familyTools.family_circle!, m) })} />}
                  </div>

                  {/* Duvall Stage */}
                  <div className="space-y-2">
                    <p className="text-xs font-bold text-slate-700">Duvall's / Stevenson's Family Life Cycle Stage</p>
                    <select value={familyTools.duvall_stage || ''} onChange={e => updateFamilyTools({ duvall_stage: Number(e.target.value) as DuvallStageNumber })} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium">
                      <option value="">Select stage...</option>
                      {DUVALL_STAGES.map(s => <option key={s.stage} value={s.stage}>{s.stage}. {s.label}</option>)}
                    </select>
                    {familyTools.duvall_stage && <p className="text-[10px] text-slate-500">{getDuvallStage(familyTools.duvall_stage).description}</p>}
                  </div>
                </div>
              )}

              {/* Tab 5: Management */}
              {activeTab === 'management' && (
                <div className="space-y-3">
                  {([['resuscitation', 'Resuscitation'], ['definitive', 'Definitive Management'], ['post_op_follow_up', 'Post-Op / Follow-up'], ['cost_considerations', 'Cost Considerations']] as const).map(([key, label]) => (
                    <div key={key} className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-600 uppercase">{label}</label>
                      <textarea rows={2} value={draft.management_plan?.[key] || ''} onChange={e => setDraft(p => ({ ...p, management_plan: { ...p.management_plan, [key]: e.target.value } }))} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium" />
                    </div>
                  ))}
                </div>
              )}

              {/* Tab 6: Discussion & References */}
              {activeTab === 'discussion' && (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-600 uppercase">Discussion & Lessons Learnt</label>
                    <textarea rows={5} value={draft.discussion_text || ''} onChange={e => setDraft(p => ({ ...p, discussion_text: e.target.value }))} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium" />
                    <Gauge label="Sentence Formatting" result={figureCheck} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-600 uppercase">Vancouver References</label>
                    <textarea rows={4} value={draft.references_text || ''} onChange={e => setDraft(p => ({ ...p, references_text: e.target.value }))} placeholder={'1. Author AB. Title. Journal. 2023;12(3):45-50.'} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono" />
                    <Gauge label="Reference Formatting" result={referenceCheck} />
                  </div>
                </div>
              )}

              <button onClick={handleSaveCase} disabled={isSavingCase} className="flex items-center space-x-1.5 px-4 py-2 bg-slate-950 hover:bg-slate-900 text-white font-bold rounded-xl text-xs shadow-sm transition cursor-pointer disabled:opacity-50">
                <Save size={13} /><span>{isSavingCase ? 'Saving...' : 'Save Case'}</span>
              </button>
            </div>
          </div>

          {/* Right: Scorecard + AI Copilot */}
          <div className="space-y-6">
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
              <div className="flex items-center space-x-1.5">
                <ClipboardList className="text-slate-500" size={16} />
                <h3 className="font-bold text-slate-900 text-sm">Real-Time WACP Scorecard</h3>
              </div>
              <Gauge label="Overall Score" result={scoreSummary} />
              <Gauge label="PCCM Components" result={pccmCheck} />
              <Gauge label="Reference Formatting" result={referenceCheck} />
              <Gauge label="Sentence Formatting" result={figureCheck} />
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-1.5">
                  <Sparkles className="text-slate-500" size={16} />
                  <h3 className="font-bold text-slate-900 text-sm">AI Copilot</h3>
                </div>
                {owner.kind === 'workforce' && !quota.loading && (
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                      quota.limit == null
                        ? 'bg-indigo-50 text-indigo-700 border-indigo-100'
                        : quota.exhausted
                          ? 'bg-rose-50 text-rose-700 border-rose-100'
                          : 'bg-slate-50 text-slate-500 border-slate-200'
                    }`}
                    title={quota.limit == null ? 'Pro / Unlimited plan' : `${quota.used} of ${quota.limit} free AI actions used in the current rolling window`}
                  >
                    {quota.limit == null ? 'PRO — UNLIMITED' : `${quota.used}/${quota.limit} USED`}
                  </span>
                )}
              </div>

              {owner.kind === 'doctor' && (
                <p className="text-[10px] text-amber-600 leading-relaxed bg-amber-50 border border-amber-200 rounded-lg p-2">
                  AI Copilot actions aren't available for personal workspaces yet. The scorecard above still
                  works normally.
                </p>
              )}

              <div className="space-y-1.5">
                <button onClick={handleRunAudit} disabled={owner.kind === 'doctor' || isAuditing} className="w-full px-3 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 font-bold rounded-xl text-[11px] transition cursor-pointer">
                  {isAuditing ? 'Auditing...' : 'Audit Against WACP Rubric'}
                </button>
                {auditNotes && (
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 space-y-1">
                    {auditSource && <SourceBadge source={auditSource} />}
                    <ul className="list-disc list-inside space-y-0.5">
                      {auditNotes.map((n, i) => <li key={i} className="text-[10px] text-slate-600">{n}</li>)}
                    </ul>
                  </div>
                )}
              </div>

              <div className="space-y-1.5 pt-2 border-t border-slate-100">
                <button onClick={handleGenerateQuestions} disabled={owner.kind === 'doctor' || isGeneratingQuestions} className="w-full px-3 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 font-bold rounded-xl text-[11px] transition cursor-pointer">
                  {isGeneratingQuestions ? 'Generating...' : 'Generate Defense Questions'}
                </button>
                {draft.defense_questions && draft.defense_questions.length > 0 && (
                  <div className="space-y-1">
                    {questionsSource && <SourceBadge source={questionsSource} />}
                    {draft.defense_questions.map((q, i) => (
                      <div key={i} className="bg-slate-50 border border-slate-200 rounded-lg p-2">
                        <p className="text-[10px] font-bold text-slate-700">Q: {q.question}</p>
                        <p className="text-[10px] text-slate-500">A: {q.recommended_answer}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Admin / Chief Resident Logbook Panel — workforce-only, see
          handleParseLogbook's comment on why (clinical_logbooks has no
          doctor_id path). canManageLogbooks should already exclude a bare
          doctor session, this is a defense-in-depth gate. */}
      {owner.kind === 'workforce' && canManageLogbooks && !activeCaseNumber && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
          <div className="flex items-center space-x-1.5">
            <UploadCloud className="text-slate-500" size={16} />
            <h3 className="font-bold text-slate-900 text-sm">Admin: Logbook Curriculum Parser</h3>
          </div>
          <p className="text-[10px] text-slate-400">Paste (or upload for reference) a raw logbook document's text — the file itself isn't parsed server-side, only the pasted text is sent for extraction, same convention as the Multi-Roster Manager.</p>
          <textarea rows={4} value={logbookRawText} onChange={e => setLogbookRawText(e.target.value)} placeholder={'Station: Family Planning Clinic\n- IUCD Insertion (target: 5)\n- Implant Insertion (target: 5)'} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono" />
          <div className="flex items-center gap-2">
            <label className="inline-flex items-center space-x-1.5 px-3 py-2 bg-slate-50 hover:bg-slate-100 border border-dashed border-slate-300 rounded-xl text-xs font-semibold text-slate-700 cursor-pointer transition">
              <FileText size={14} className="text-slate-400" />
              <span>{logbookFile ? logbookFile.name : 'Attach file (reference only)'}</span>
              <input type="file" className="hidden" onChange={e => setLogbookFile(e.target.files?.[0] || null)} />
            </label>
            <button onClick={handleParseLogbook} disabled={isParsingLogbook || !logbookRawText.trim()} className="px-3 py-2 bg-slate-950 hover:bg-slate-900 disabled:opacity-50 text-white font-bold rounded-xl text-xs transition cursor-pointer">
              {isParsingLogbook ? 'Parsing...' : 'Parse Curriculum'}
            </button>
          </div>
          {parsedStations && (
            <div className="space-y-2">
              {parsedSource && <SourceBadge source={parsedSource} />}
              {parsedStations.map((s, i) => (
                <div key={i} className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 space-y-1">
                  <p className="text-xs font-bold text-slate-800">{s.station_name}</p>
                  {s.procedures.map((p, j) => (
                    <div key={j} className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-600">{p.procedure_or_competency} (target: {p.required_count})</span>
                      <button onClick={() => applyStationToMyLogbook(s.station_name, p.procedure_or_competency, p.required_count)} className="px-2 py-0.5 border border-slate-200 hover:bg-white rounded-full text-[9px] font-bold text-slate-600 cursor-pointer">Apply to My Logbook</button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <UpgradeCheckoutModal
        open={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
        workforceId={owner.id}
        tenantId={owner.tenantId}
        used={quota.used}
        limit={quota.limit}
        onPaymentCompleted={async () => {
          await quota.refresh();
          setShowUpgradeModal(false);
        }}
      />
    </div>
  );
};

// Uncontrolled-from-the-parent's-perspective text buffer: the parent only
// stores the parsed diseases array, but re-deriving this input's displayed
// value from that array on every keystroke (via .join(', ')) fights
// against typing a comma-separated list — a trailing "Foo, " gets its
// comma silently stripped mid-type since the empty segment after the
// comma is filtered out before the next disease name is typed. Local
// state + onBlur commit (same pattern as PICO Title elsewhere in this
// app) avoids that.
const GenogramDiseasesInput: React.FC<{ diseases: string[]; onCommit: (diseases: string[]) => void }> = ({ diseases, onCommit }) => {
  const [text, setText] = useState(diseases.join(', '));
  useEffect(() => setText(diseases.join(', ')), [diseases]);

  return (
    <input
      type="text"
      value={text}
      onChange={e => setText(e.target.value)}
      onBlur={() => onCommit(text.split(',').map(s => s.trim()).filter(Boolean))}
      placeholder="Diseases (comma-sep)"
      className="flex-1 px-2 py-1 bg-white border border-slate-200 rounded text-[11px]"
    />
  );
};

const EcomapConnectionForm: React.FC<{ ecomap: EcomapData; onAdd: (c: { label: string; strength: 'strong' | 'stressful' | 'tenuous'; category: string }) => void }> = ({ onAdd }) => {
  const [label, setLabel] = useState('');
  const [strength, setStrength] = useState<'strong' | 'stressful' | 'tenuous'>('strong');
  const [category, setCategory] = useState('');
  return (
    <div className="flex items-center gap-1.5">
      <input type="text" value={label} onChange={e => setLabel(e.target.value)} placeholder="Connection (e.g. Church)" className="flex-1 px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px]" />
      <select value={strength} onChange={e => setStrength(e.target.value as 'strong' | 'stressful' | 'tenuous')} className="px-1.5 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px]">
        <option value="strong">strong</option><option value="stressful">stressful</option><option value="tenuous">tenuous</option>
      </select>
      <input type="text" value={category} onChange={e => setCategory(e.target.value)} placeholder="Category" className="flex-1 px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px]" />
      <button onClick={() => { if (label.trim()) { onAdd({ label: label.trim(), strength, category: category.trim() || 'Other' }); setLabel(''); setCategory(''); } }} className="px-2 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-[10px] font-bold text-slate-700 cursor-pointer">Add</button>
    </div>
  );
};

const FamilyCircleForm: React.FC<{ circle: FamilyCircleData; onAdd: (m: { label: string; closeness: 'close' | 'moderate' | 'distant' }) => void }> = ({ onAdd }) => {
  const [label, setLabel] = useState('');
  const [closeness, setCloseness] = useState<'close' | 'moderate' | 'distant'>('close');
  return (
    <div className="flex items-center gap-1.5">
      <input type="text" value={label} onChange={e => setLabel(e.target.value)} placeholder="Member (e.g. Elder Sibling)" className="flex-1 px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px]" />
      <select value={closeness} onChange={e => setCloseness(e.target.value as 'close' | 'moderate' | 'distant')} className="px-1.5 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px]">
        <option value="close">close</option><option value="moderate">moderate</option><option value="distant">distant</option>
      </select>
      <button onClick={() => { if (label.trim()) { onAdd({ label: label.trim(), closeness }); setLabel(''); } }} className="px-2 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-[10px] font-bold text-slate-700 cursor-pointer">Add</button>
    </div>
  );
};
