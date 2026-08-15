import React, { useState, useEffect, useMemo } from 'react';
import { databaseService } from '../lib/databaseService';
import { loadAvailableTemplates, forkTemplate, editTemplate, TemplateEditPayload } from '../lib/research/templateEngine';
import { validatePicoTitle, validateWordCap, validateCitationSyntax } from '../lib/research/rubricEngine';
import { researchCopilot, DraftAuditResult, LiteratureMatrixResult, TableShellsResult, ResearchCopilotSource } from '../lib/ai/researchCopilot';
import { useWorkspaceQuota } from '../lib/billing/useWorkspaceQuota';
import { UpgradeCheckoutModal } from './UpgradeCheckoutModal';
import {
  ResearchWorkspace,
  ResearchTemplate,
  ResearchChapter,
  ResearchChapterType,
  ResearchCorrectionLog,
  ResearchCorrectionSource,
  ResearchStudyDesign,
  FolderNode,
} from '../types';
import {
  FolderKanban, BookOpen, ClipboardCheck, Sparkles, Plus, X, ChevronRight, ChevronDown,
  Folder, FileText, Calculator, Table2, RefreshCw, Save, CheckCircle2, AlertTriangle,
  GitFork, Settings2, GraduationCap,
} from 'lucide-react';

// Since migration 25, this view serves two kinds of owner: an institutional
// resident (workforce_id) or an unlinked individual doctor's personal
// workspace (doctor_id) — see DoctorHomeView's entry cards. `kind` drives
// which id column workspace CRUD writes to, and gates AI Copilot (personal
// workspaces have no tenant/quota context — see migration 25's header).
interface WorkspaceOwner {
  id: string;
  name: string;
  kind: 'workforce' | 'doctor';
  // The owner's real tenant for a 'workforce' owner (resolved at login —
  // see App.tsx's ResidentSession) — using DEFAULT_TENANT_ID unconditionally
  // here would misattribute a non-UCH tenant's workspaces/AI subscription
  // billing to UCH now that self-serve orgs exist (migration 24).
  // Meaningless for a 'doctor' owner (no tenant), always DEFAULT_TENANT_ID
  // there since personal workspaces have tenant_id NULL anyway.
  tenantId: string;
}

interface ResearchWorkspaceViewProps {
  owner: WorkspaceOwner;
}

const CHAPTER_ORDER: { type: ResearchChapterType; number: number; label: string }[] = [
  { type: 'proposal', number: 0, label: 'Proposal' },
  { type: 'ch1_intro', number: 1, label: 'Ch.1 Introduction' },
  { type: 'ch2_lit_review', number: 2, label: 'Ch.2 Literature Review' },
  { type: 'ch3_methods', number: 3, label: 'Ch.3 Methodology' },
  { type: 'ch4_results', number: 4, label: 'Ch.4 Results' },
  { type: 'ch5_discussion', number: 5, label: 'Ch.5 Discussion' },
];

const STUDY_DESIGNS: ResearchStudyDesign[] = ['cross_sectional', 'cohort', 'case_control', 'clinical_trial', 'qualitative', 'systematic_review', 'case_series'];

const CORRECTION_SOURCES: { value: ResearchCorrectionSource; label: string }[] = [
  { value: 'college_assessor', label: 'College Assessor' },
  { value: 'supervisor_round_1', label: 'Supervisor (Round 1)' },
  { value: 'supervisor_round_2', label: 'Supervisor (Round 2)' },
  { value: 'peer_reviewer', label: 'Peer Reviewer' },
];

// Fisher's formula (n = Z^2 * p(1-p) / d^2) — the standard sample-size-for-
// proportion estimate taught in WACP/NPMCN research methodology courses.
// Deterministic math, not AI — appropriate to compute client-side.
function computeFisherSampleSize(prevalencePct: number, precisionPct: number, zScore: number): number | null {
  if (prevalencePct <= 0 || prevalencePct >= 100 || precisionPct <= 0 || precisionPct >= 100) return null;
  const p = prevalencePct / 100;
  const d = precisionPct / 100;
  const n = (zScore * zScore * p * (1 - p)) / (d * d);
  return Math.ceil(n);
}

const SOURCE_BADGE: Record<ResearchCopilotSource, { label: string; className: string }> = {
  edge_function: { label: 'AI-generated', className: 'bg-violet-50 text-violet-700 border-violet-200' },
  heuristic_fallback: { label: 'Heuristic (no AI configured)', className: 'bg-slate-100 text-slate-600 border-slate-200' },
};

const SourceBadge: React.FC<{ source: ResearchCopilotSource }> = ({ source }) => {
  const badge = SOURCE_BADGE[source];
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border ${badge.className}`}>{badge.label}</span>;
};

export const ResearchWorkspaceView: React.FC<ResearchWorkspaceViewProps> = ({ owner }) => {
  const [workspaces, setWorkspaces] = useState<ResearchWorkspace[]>([]);
  const [templates, setTemplates] = useState<ResearchTemplate[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);

  const [chapters, setChapters] = useState<ResearchChapter[]>([]);
  const [correctionLogs, setCorrectionLogs] = useState<ResearchCorrectionLog[]>([]);

  // New workspace form
  const [showNewWorkspaceModal, setShowNewWorkspaceModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newStudyDesign, setNewStudyDesign] = useState<ResearchStudyDesign | ''>('');
  const [newTemplateId, setNewTemplateId] = useState('');
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);

  // Template library / fork modal
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [forkSourceId, setForkSourceId] = useState<string | null>(null);
  const [forkName, setForkName] = useState('');
  const [forkScope, setForkScope] = useState<'personal' | 'tenant'>('personal');
  const [isForking, setIsForking] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [editWordCaps, setEditWordCaps] = useState('');
  const [editRules, setEditRules] = useState('');

  // Active chapter editor
  const [activeChapterType, setActiveChapterType] = useState<ResearchChapterType>('proposal');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [isSavingChapter, setIsSavingChapter] = useState(false);

  // Citation scratch pad (not persisted — a live checker, like CasebookBuilderView's DDx tool)
  const [referencesDraft, setReferencesDraft] = useState('');

  // Folder navigator expand/collapse
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // Correction log form
  const [logSource, setLogSource] = useState<ResearchCorrectionSource>('supervisor_round_1');
  const [logTopic, setLogTopic] = useState('');
  const [logComment, setLogComment] = useState('');
  const [isAddingLog, setIsAddingLog] = useState(false);

  // AI Copilot Panel
  const [sampleP, setSampleP] = useState('50');
  const [sampleD, setSampleD] = useState('5');
  const [sampleZ, setSampleZ] = useState('1.96');
  const [auditResult, setAuditResult] = useState<DraftAuditResult | null>(null);
  const [isAuditing, setIsAuditing] = useState(false);
  const [tableShellsResult, setTableShellsResult] = useState<TableShellsResult | null>(null);
  const [isGeneratingShells, setIsGeneratingShells] = useState(false);
  const [matrixResult, setMatrixResult] = useState<LiteratureMatrixResult | null>(null);
  const [isSynthesizingMatrix, setIsSynthesizingMatrix] = useState(false);

  // AI Copilot feature gating — free tier gets a rolling-window allowance,
  // exhaustion opens the Paystack/Flutterwave upgrade checkout instead of
  // running the action (see src/modules/shared/config/tiers.ts).
  const quota = useWorkspaceQuota(owner.id);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId) || null;
  const activeTemplate = templates.find(t => t.id === activeWorkspace?.template_id) || null;
  const activeChapter = chapters.find(c => c.chapter_type === activeChapterType) || null;

  useEffect(() => {
    setIsLoading(true);
    // loadAvailableTemplates' "personal fork" filter is workforce_id-keyed
    // (research_templates.created_by_workforce_id) — passing a doctor's id
    // through it is harmless (it just never matches a fork), global
    // templates still load correctly either way.
    Promise.all([
      owner.kind === 'workforce'
        ? databaseService.getResearchWorkspacesForWorkforce(owner.id)
        : databaseService.getResearchWorkspacesForDoctor(owner.id),
      loadAvailableTemplates(owner.tenantId, owner.id),
    ])
      .then(([ws, tpl]) => {
        setWorkspaces(ws);
        setTemplates(tpl);
      })
      .catch(err => console.warn('Failed to load research workspaces:', err))
      .finally(() => setIsLoading(false));
  }, [owner.id, owner.kind]);

  useEffect(() => {
    if (!activeWorkspaceId) {
      setChapters([]);
      setCorrectionLogs([]);
      return;
    }
    databaseService.getResearchChapters(activeWorkspaceId).then(setChapters).catch(err => console.warn('Failed to load research chapters:', err));
    databaseService.getResearchCorrectionLogs(activeWorkspaceId).then(setCorrectionLogs).catch(err => console.warn('Failed to load correction logs:', err));
    setAuditResult(null);
    setTableShellsResult(null);
    setMatrixResult(null);
  }, [activeWorkspaceId]);

  useEffect(() => {
    setDraftTitle(activeChapter?.title || '');
    setDraftContent(activeChapter?.content_text || '');
    setAuditResult(null);
  }, [activeChapter?.id, activeChapterType]);

  const picoTitle = (activeWorkspace?.pico_framework?.title as string) || '';

  const titleValidation = useMemo(() => validatePicoTitle(picoTitle, activeTemplate), [picoTitle, activeTemplate]);
  const wordCapValidation = useMemo(() => validateWordCap(activeChapterType, draftContent, activeTemplate), [activeChapterType, draftContent, activeTemplate]);
  const citationValidation = useMemo(() => validateCitationSyntax(referencesDraft, activeTemplate), [referencesDraft, activeTemplate]);

  const handleCreateWorkspace = async () => {
    if (!newTitle.trim()) return;
    setIsCreatingWorkspace(true);
    try {
      const workspace = await databaseService.createResearchWorkspace({
        tenant_id: owner.kind === 'workforce' ? owner.tenantId : null,
        workforce_id: owner.kind === 'workforce' ? owner.id : null,
        doctor_id: owner.kind === 'doctor' ? owner.id : null,
        title: newTitle.trim(),
        study_design: newStudyDesign || null,
        template_id: newTemplateId || null,
      });
      setWorkspaces(prev => [workspace, ...prev]);
      setActiveWorkspaceId(workspace.id);
      setShowNewWorkspaceModal(false);
      setNewTitle('');
      setNewStudyDesign('');
      setNewTemplateId('');
    } catch (err) {
      console.warn('Failed to create research workspace:', err);
    } finally {
      setIsCreatingWorkspace(false);
    }
  };

  const handleSetTemplate = async (templateId: string) => {
    if (!activeWorkspace) return;
    try {
      const updated = await databaseService.updateResearchWorkspaceTemplate(activeWorkspace.id, templateId);
      setWorkspaces(prev => prev.map(w => (w.id === updated.id ? updated : w)));
      setShowTemplateModal(false);
    } catch (err) {
      console.warn('Failed to set active template:', err);
    }
  };

  const handleSavePicoTitle = async (title: string) => {
    if (!activeWorkspace) return;
    try {
      const updated = await databaseService.updateResearchWorkspacePico(activeWorkspace.id, { ...activeWorkspace.pico_framework, title });
      setWorkspaces(prev => prev.map(w => (w.id === updated.id ? updated : w)));
    } catch (err) {
      console.warn('Failed to save PICO title:', err);
    }
  };

  const handleSaveChapter = async () => {
    if (!activeWorkspace) return;
    const meta = CHAPTER_ORDER.find(c => c.type === activeChapterType)!;
    setIsSavingChapter(true);
    try {
      const saved = await databaseService.upsertResearchChapter(activeWorkspace.id, activeChapterType, meta.number, {
        title: draftTitle.trim() || meta.label,
        content_text: draftContent,
        word_count: draftContent.trim() ? draftContent.trim().split(/\s+/).length : 0,
      });
      setChapters(prev => {
        const exists = prev.some(c => c.id === saved.id);
        return exists ? prev.map(c => (c.id === saved.id ? saved : c)) : [...prev, saved];
      });
    } catch (err) {
      console.warn('Failed to save chapter:', err);
    } finally {
      setIsSavingChapter(false);
    }
  };

  const handleFork = async () => {
    // Defensive guard mirroring the hidden Fork button below — forking
    // writes created_by_workforce_id, a real FK into workforce(id), so a
    // doctor's id would fail the constraint rather than just no-op.
    if (owner.kind !== 'workforce' || !forkSourceId || !forkName.trim()) return;
    setIsForking(true);
    try {
      const forked = await forkTemplate(forkSourceId, owner.id, {
        scope: forkScope,
        newName: forkName.trim(),
        tenantId: owner.tenantId,
      });
      setTemplates(prev => [...prev, forked]);
      setForkSourceId(null);
      setForkName('');
    } catch (err) {
      console.warn('Failed to fork template:', err);
    } finally {
      setIsForking(false);
    }
  };

  const handleSaveTemplateEdits = async (templateId: string) => {
    const edits: TemplateEditPayload = {};
    if (editWordCaps.trim()) {
      const caps: Record<string, number> = {};
      for (const line of editWordCaps.split('\n')) {
        const [key, val] = line.split('=').map(s => s.trim());
        if (key && val && !Number.isNaN(Number(val))) caps[key] = Number(val);
      }
      if (Object.keys(caps).length > 0) edits.wordCaps = caps;
    }
    if (editRules.trim()) {
      edits.customPromptRules = editRules.split('\n').map(l => l.trim()).filter(Boolean);
    }
    try {
      const updated = await editTemplate(templateId, edits);
      setTemplates(prev => prev.map(t => (t.id === updated.id ? updated : t)));
      setEditingTemplateId(null);
      setEditWordCaps('');
      setEditRules('');
    } catch (err) {
      console.warn('Failed to save template edits:', err);
    }
  };

  const handleAddCorrectionLog = async () => {
    if (!activeWorkspace || !logComment.trim()) return;
    setIsAddingLog(true);
    try {
      const created = await databaseService.createResearchCorrectionLog({
        workspace_id: activeWorkspace.id,
        comment_source: logSource,
        section_topic: logTopic.trim() || null,
        original_comment: logComment.trim(),
      });
      setCorrectionLogs(prev => [created, ...prev]);
      setLogTopic('');
      setLogComment('');
    } catch (err) {
      console.warn('Failed to add correction log:', err);
    } finally {
      setIsAddingLog(false);
    }
  };

  const handleUpdateLog = async (id: string, updates: { action_taken?: string; status?: 'pending' | 'resolved' }) => {
    try {
      const updated = await databaseService.updateResearchCorrectionLog(id, updates);
      setCorrectionLogs(prev => prev.map(l => (l.id === updated.id ? updated : l)));
    } catch (err) {
      console.warn('Failed to update correction log:', err);
    }
  };

  const toggleFolder = (path: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const renderFolderNode = (node: FolderNode, path: string, depth: number) => {
    const isExpanded = expandedFolders.has(path);
    const hasChildren = !!node.children?.length;
    return (
      <div key={path}>
        <button
          onClick={() => hasChildren && toggleFolder(path)}
          className="flex items-center space-x-1.5 py-1.5 text-xs font-semibold text-slate-700 hover:text-slate-950 cursor-pointer w-full text-left"
          style={{ paddingLeft: `${depth * 16}px` }}
        >
          {hasChildren ? (isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : <span className="w-3" />}
          <Folder size={13} className="text-slate-400" />
          <span>{node.name}</span>
        </button>
        {hasChildren && isExpanded && (
          <div>{node.children!.map((child, i) => renderFolderNode(child, `${path}/${child.name}-${i}`, depth + 1))}</div>
        )}
      </div>
    );
  };

  const sampleSize = useMemo(
    () => computeFisherSampleSize(Number(sampleP), Number(sampleD), Number(sampleZ)),
    [sampleP, sampleD, sampleZ]
  );

  const handleRunAudit = async () => {
    if (!activeWorkspace) return;
    if (quota.exhausted) {
      setShowUpgradeModal(true);
      return;
    }
    setIsAuditing(true);
    try {
      const result = await researchCopilot.auditDraft(owner.id, picoTitle, draftContent, referencesDraft, activeTemplate);
      setAuditResult(result);
      quota.refresh();
    } finally {
      setIsAuditing(false);
    }
  };

  const handleGenerateTableShells = async () => {
    if (!activeWorkspace) return;
    if (quota.exhausted) {
      setShowUpgradeModal(true);
      return;
    }
    setIsGeneratingShells(true);
    try {
      const result = await researchCopilot.generateTableShells(owner.id, activeWorkspace.title, activeWorkspace.study_design, activeTemplate);
      setTableShellsResult(result);
      quota.refresh();
    } finally {
      setIsGeneratingShells(false);
    }
  };

  const handleSynthesizeMatrix = async () => {
    if (!referencesDraft.trim()) return;
    if (quota.exhausted) {
      setShowUpgradeModal(true);
      return;
    }
    setIsSynthesizingMatrix(true);
    try {
      const result = await researchCopilot.synthesizeLiteratureMatrix(owner.id, referencesDraft, activeTemplate);
      setMatrixResult(result);
      quota.refresh();
    } finally {
      setIsSynthesizingMatrix(false);
    }
  };

  if (isLoading) {
    return (
      <div className="text-center py-16">
        <RefreshCw size={28} className="text-slate-400 animate-spin mx-auto mb-2" />
        <p className="text-sm text-slate-500">Loading Research Workspace...</p>
      </div>
    );
  }

  if (!activeWorkspace) {
    return (
      <div className="max-w-5xl mx-auto my-8 px-4 space-y-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center space-x-2">
            <GraduationCap className="text-slate-500" size={18} />
            <div>
              <h2 className="font-bold text-slate-900 text-lg tracking-tight">Universal Research Engine</h2>
              <p className="text-xs text-slate-500">Proposal & dissertation workspaces, template library, and correction tracking</p>
            </div>
          </div>
          <button
            onClick={() => setShowNewWorkspaceModal(true)}
            className="flex items-center space-x-1.5 px-3 py-2 bg-slate-950 hover:bg-slate-900 text-white rounded-xl text-xs font-bold shadow-sm transition cursor-pointer"
          >
            <Plus size={14} />
            <span>New Research Workspace</span>
          </button>
        </div>

        {workspaces.length === 0 ? (
          <div className="text-center py-12 bg-white border border-dashed border-slate-300 rounded-2xl">
            <BookOpen size={28} className="text-slate-300 mx-auto mb-2" />
            <p className="text-sm text-slate-500">No research workspaces yet — create one to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {workspaces.map(w => (
              <button
                key={w.id}
                onClick={() => setActiveWorkspaceId(w.id)}
                className="bg-white border border-slate-200 hover:border-slate-300 rounded-2xl p-4 text-left shadow-sm transition cursor-pointer space-y-1"
              >
                <span className="font-bold text-slate-900 text-sm">{w.title}</span>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">{w.status.replace(/_/g, ' ')}</p>
              </button>
            ))}
          </div>
        )}

        {showNewWorkspaceModal && (
          <div className="fixed inset-0 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl max-w-md w-full border border-slate-100 shadow-2xl">
              <div className="bg-slate-950 px-6 py-4 text-white flex justify-between items-center rounded-t-2xl">
                <h3 className="font-bold text-base">New Research Workspace</h3>
                <button onClick={() => setShowNewWorkspaceModal(false)} className="text-slate-300 hover:text-white cursor-pointer">
                  <X size={18} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 uppercase">Working Title</label>
                  <input
                    type="text"
                    value={newTitle}
                    onChange={e => setNewTitle(e.target.value)}
                    placeholder="e.g. Prevalence of Hypertension Among..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 uppercase">Study Design</label>
                  <select
                    value={newStudyDesign}
                    onChange={e => setNewStudyDesign(e.target.value as ResearchStudyDesign)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
                  >
                    <option value="">Select...</option>
                    {STUDY_DESIGNS.map(d => (
                      <option key={d} value={d}>{d.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 uppercase">Template</label>
                  <select
                    value={newTemplateId}
                    onChange={e => setNewTemplateId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
                  >
                    <option value="">None yet — choose later</option>
                    {templates.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="bg-slate-50 border-t border-slate-100 px-6 py-4 flex justify-end gap-2 rounded-b-2xl">
                <button
                  onClick={handleCreateWorkspace}
                  disabled={isCreatingWorkspace || !newTitle.trim()}
                  className="px-4 py-2 bg-slate-950 hover:bg-slate-900 text-white font-bold rounded-xl text-xs shadow-sm transition cursor-pointer disabled:opacity-50"
                >
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
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center space-x-2">
          <button onClick={() => setActiveWorkspaceId(null)} className="text-xs font-bold text-slate-400 hover:text-slate-700 mr-2 cursor-pointer">&larr; All Workspaces</button>
          <GraduationCap className="text-slate-500" size={18} />
          <div>
            <h2 className="font-bold text-slate-900 text-lg tracking-tight">{activeWorkspace.title}</h2>
            <p className="text-xs text-slate-500">{activeTemplate ? activeTemplate.name : 'No template selected'} &bull; {activeWorkspace.status.replace(/_/g, ' ')}</p>
          </div>
        </div>
        <button
          onClick={() => setShowTemplateModal(true)}
          className="flex items-center space-x-1.5 px-3 py-1.5 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md text-xs font-semibold shadow-sm transition cursor-pointer"
        >
          <Settings2 size={13} />
          <span>Template Library</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Chapter editor + rubric scorecard */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex items-center space-x-1.5 flex-wrap gap-1">
              {CHAPTER_ORDER.map(c => (
                <button
                  key={c.type}
                  onClick={() => setActiveChapterType(c.type)}
                  className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border transition cursor-pointer ${
                    activeChapterType === c.type ? 'bg-slate-950 text-white border-slate-950' : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>

            {activeChapterType === 'proposal' && (
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 uppercase">PICO Title</label>
                <input
                  type="text"
                  defaultValue={picoTitle}
                  onBlur={e => handleSavePicoTitle(e.target.value)}
                  placeholder="e.g. Prevalence and Determinants of Hypertension Among Adults in..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
                />
                <p className={`text-[10px] font-semibold ${titleValidation.valid ? 'text-emerald-600' : 'text-rose-600'}`}>{titleValidation.message}</p>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 uppercase">Content</label>
              <textarea
                rows={10}
                value={draftContent}
                onChange={e => setDraftContent(e.target.value)}
                placeholder="Write or paste this section's draft here..."
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
              />
              <p className={`text-[10px] font-semibold ${wordCapValidation.valid ? 'text-emerald-600' : 'text-rose-600'}`}>{wordCapValidation.message}</p>
            </div>

            <button
              onClick={handleSaveChapter}
              disabled={isSavingChapter}
              className="flex items-center space-x-1.5 px-4 py-2 bg-slate-950 hover:bg-slate-900 text-white font-bold rounded-xl text-xs shadow-sm transition cursor-pointer disabled:opacity-50"
            >
              <Save size={13} />
              <span>{isSavingChapter ? 'Saving...' : 'Save Section'}</span>
            </button>
          </div>

          {/* Real-Time Rubric Scorecard */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
            <div className="flex items-center space-x-1.5">
              <ClipboardCheck className="text-slate-500" size={16} />
              <h3 className="font-bold text-slate-900 text-sm">Real-Time Rubric Scorecard</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <ScoreGauge label="Title Word Count" result={titleValidation} />
              <ScoreGauge label="Active Section Word Cap" result={wordCapValidation} />
              <ScoreGauge label="Citation Syntax" result={citationValidation} />
              {citationValidation.africanLiteraturePct !== undefined && (
                <ScoreGauge
                  label="African Literature Ratio"
                  result={{ valid: citationValidation.valid, message: `${citationValidation.africanLiteraturePct}%` }}
                />
              )}
            </div>
            <div className="space-y-1 pt-2 border-t border-slate-100">
              <label className="text-xs font-bold text-slate-700 uppercase">Reference List (checker — not saved)</label>
              <textarea
                rows={4}
                value={referencesDraft}
                onChange={e => setReferencesDraft(e.target.value)}
                placeholder={'1. Author AB, Author CD. Title of paper. Journal Name. 2023;12(3):45-50.'}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono focus:outline-none focus:ring-1 focus:ring-slate-950"
              />
            </div>
          </div>

          {/* Synopsis of Corrections */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
            <div className="flex items-center space-x-1.5">
              <FileText className="text-slate-500" size={16} />
              <h3 className="font-bold text-slate-900 text-sm">Synopsis of Corrections</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <select
                value={logSource}
                onChange={e => setLogSource(e.target.value as ResearchCorrectionSource)}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
              >
                {CORRECTION_SOURCES.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
              <input
                type="text"
                value={logTopic}
                onChange={e => setLogTopic(e.target.value)}
                placeholder="Section/topic"
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
              />
              <button
                onClick={handleAddCorrectionLog}
                disabled={isAddingLog || !logComment.trim()}
                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 font-bold rounded-xl text-xs transition cursor-pointer"
              >
                {isAddingLog ? 'Adding...' : 'Add Row'}
              </button>
            </div>
            <textarea
              rows={2}
              value={logComment}
              onChange={e => setLogComment(e.target.value)}
              placeholder="Original comment from assessor/supervisor..."
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
            />

            {correctionLogs.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[9px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
                      <th className="py-1.5 pr-2">Source</th>
                      <th className="py-1.5 pr-2">Comment</th>
                      <th className="py-1.5 pr-2">Action Taken</th>
                      <th className="py-1.5">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {correctionLogs.map(log => (
                      <tr key={log.id} className="border-b border-slate-50 align-top">
                        <td className="py-2 pr-2 font-semibold text-slate-600 whitespace-nowrap">{CORRECTION_SOURCES.find(s => s.value === log.comment_source)?.label}</td>
                        <td className="py-2 pr-2 text-slate-700 max-w-[220px]">{log.original_comment}</td>
                        <td className="py-2 pr-2">
                          <input
                            type="text"
                            defaultValue={log.action_taken || ''}
                            onBlur={e => handleUpdateLog(log.id, { action_taken: e.target.value })}
                            placeholder="What was done..."
                            className="w-full px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-[11px] focus:outline-none focus:ring-1 focus:ring-slate-950"
                          />
                        </td>
                        <td className="py-2">
                          <button
                            onClick={() => handleUpdateLog(log.id, { status: log.status === 'resolved' ? 'pending' : 'resolved' })}
                            className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border cursor-pointer ${
                              log.status === 'resolved' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'
                            }`}
                          >
                            {log.status}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right: Folder navigator + AI Copilot panel */}
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-2">
            <div className="flex items-center space-x-1.5">
              <FolderKanban className="text-slate-500" size={16} />
              <h3 className="font-bold text-slate-900 text-sm">Drive Navigator</h3>
            </div>
            <div>
              {activeWorkspace.folder_tree.map((node, i) => renderFolderNode(node, `${node.name}-${i}`, 0))}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-1.5">
                <Sparkles className="text-slate-500" size={16} />
                <h3 className="font-bold text-slate-900 text-sm">AI Copilot Panel</h3>
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
            {owner.kind === 'doctor' ? (
              <p className="text-[10px] text-amber-600 leading-relaxed bg-amber-50 border border-amber-200 rounded-lg p-2">
                AI Copilot actions aren't available for personal workspaces yet — only Fisher's sample-size
                calculator below (a pure formula, not AI) works here. Everything else on this page works normally.
              </p>
            ) : (
              <p className="text-[10px] text-slate-400 leading-relaxed">
                These tools try a live AI provider first (OpenAI, then Gemini) and fall back to a
                deterministic local check if neither is configured or available — a badge on each result
                shows which path produced it. Never a substitute for supervisor review.
              </p>
            )}

            {/* Audit Draft against Active Rubric */}
            <div className="space-y-1.5 pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-slate-700 flex items-center space-x-1.5"><ClipboardCheck size={12} /><span>Audit Draft Against Active Rubric</span></p>
                <button
                  onClick={handleRunAudit}
                  disabled={owner.kind === 'doctor' || isAuditing || !draftContent.trim()}
                  className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 font-bold rounded-lg text-[10px] transition cursor-pointer shrink-0"
                >
                  {isAuditing ? 'Auditing...' : 'Run AI Audit'}
                </button>
              </div>
              <div className="space-y-1 text-[10px]">
                <p className={titleValidation.valid ? 'text-emerald-600' : 'text-rose-600'}>Title: {titleValidation.message}</p>
                <p className={wordCapValidation.valid ? 'text-emerald-600' : 'text-rose-600'}>Section: {wordCapValidation.message}</p>
                <p className={citationValidation.valid ? 'text-emerald-600' : 'text-rose-600'}>Citations: {citationValidation.message}</p>
              </div>
              {auditResult && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-2 space-y-1">
                  <SourceBadge source={auditResult.source} />
                  <ul className="list-disc list-inside space-y-0.5">
                    {auditResult.notes.map((n, i) => (
                      <li key={i} className="text-[10px] text-slate-600">{n}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Fisher's Z sample size */}
            <div className="space-y-1.5 pt-2 border-t border-slate-100">
              <p className="text-xs font-bold text-slate-700 flex items-center space-x-1.5"><Calculator size={12} /><span>Precision Sample Size (Fisher's Formula)</span></p>
              <p className="text-[9px] text-slate-400">Pure formula — computed locally, not sent to any AI provider.</p>
              <div className="grid grid-cols-3 gap-1.5">
                <input type="number" value={sampleP} onChange={e => setSampleP(e.target.value)} placeholder="p %" className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px] focus:outline-none focus:ring-1 focus:ring-slate-950" />
                <input type="number" value={sampleD} onChange={e => setSampleD(e.target.value)} placeholder="d %" className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px] focus:outline-none focus:ring-1 focus:ring-slate-950" />
                <input type="number" value={sampleZ} onChange={e => setSampleZ(e.target.value)} placeholder="Z" step="0.01" className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px] focus:outline-none focus:ring-1 focus:ring-slate-950" />
              </div>
              <p className="text-[10px] text-slate-500">n = Z&sup2;p(1-p)/d&sup2; &rarr; <span className="font-bold text-slate-800">{sampleSize !== null ? `n = ${sampleSize}` : 'enter valid p/d'}</span></p>
            </div>

            {/* Dummy table shells */}
            <div className="space-y-1.5 pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-slate-700 flex items-center space-x-1.5"><Table2 size={12} /><span>Dummy Table Shells</span></p>
                <button
                  onClick={handleGenerateTableShells}
                  disabled={owner.kind === 'doctor' || isGeneratingShells}
                  className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 font-bold rounded-lg text-[10px] transition cursor-pointer shrink-0"
                >
                  {isGeneratingShells ? 'Generating...' : 'Generate'}
                </button>
              </div>
              {!tableShellsResult ? (
                <p className="text-[10px] text-slate-400">Generate table shells tailored to this workspace's title and study design.</p>
              ) : (
                <div className="space-y-1">
                  <SourceBadge source={tableShellsResult.source} />
                  {tableShellsResult.tables.map((t, i) => (
                    <div key={i} className="bg-slate-50 border border-slate-200 rounded-lg p-2">
                      <p className="text-[10px] font-bold text-slate-700">{t.title}</p>
                      {t.columns_hint && <p className="text-[9px] text-slate-500">{t.columns_hint}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Literature matrix */}
            <div className="space-y-1.5 pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-slate-700 flex items-center space-x-1.5"><BookOpen size={12} /><span>Literature Matrix</span></p>
                <button
                  onClick={handleSynthesizeMatrix}
                  disabled={owner.kind === 'doctor' || isSynthesizingMatrix || !referencesDraft.trim()}
                  className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 font-bold rounded-lg text-[10px] transition cursor-pointer shrink-0"
                >
                  {isSynthesizingMatrix ? 'Synthesizing...' : 'Synthesize'}
                </button>
              </div>
              {!matrixResult ? (
                <p className="text-[10px] text-slate-400">Paste references in the checker above, then synthesize a matrix.</p>
              ) : matrixResult.rows.length === 0 ? (
                <p className="text-[10px] text-slate-400">No references to synthesize yet.</p>
              ) : (
                <div className="space-y-1">
                  <SourceBadge source={matrixResult.source} />
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {matrixResult.rows.map((row, i) => (
                      <div key={i} className="bg-slate-50 border border-slate-200 rounded-lg p-2 text-[10px] space-y-0.5">
                        <p><span className="font-bold text-slate-700">{row.author_year}</span> <span className="text-slate-400">({row.study_design})</span></p>
                        {row.key_focus && <p className="text-slate-600">{row.key_focus}</p>}
                        {row.gap_or_note && <p className="text-slate-500 italic">{row.gap_or_note}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Template Library & Customization Modal */}
      {showTemplateModal && (
        <div className="fixed inset-0 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-2xl w-full border border-slate-100 shadow-2xl max-h-[85vh] overflow-y-auto">
            <div className="bg-slate-950 px-6 py-4 text-white flex justify-between items-center rounded-t-2xl sticky top-0">
              <h3 className="font-bold text-base">Template Library</h3>
              <button onClick={() => setShowTemplateModal(false)} className="text-slate-300 hover:text-white cursor-pointer">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-3">
              {templates.map(t => (
                <div key={t.id} className="border border-slate-200 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <p className="text-sm font-bold text-slate-900">{t.name}</p>
                      <p className="text-[10px] text-slate-500">{t.organization_or_body} &bull; {t.referencing_style} {t.created_by_workforce_id === owner.id ? '• Your fork' : ''}</p>
                    </div>
                    <div className="flex items-center space-x-1.5">
                      <button
                        onClick={() => handleSetTemplate(t.id)}
                        className="px-2.5 py-1 bg-slate-950 hover:bg-slate-900 text-white rounded-lg text-[10px] font-bold transition cursor-pointer"
                      >
                        Use
                      </button>
                      {owner.kind === 'workforce' && (
                        <button
                          onClick={() => { setForkSourceId(t.id); setForkName(`${t.name} (Custom)`); }}
                          className="flex items-center space-x-1 px-2.5 py-1 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-[10px] font-bold transition cursor-pointer"
                        >
                          <GitFork size={11} />
                          <span>Fork</span>
                        </button>
                      )}
                      {t.created_by_workforce_id === owner.id && (
                        <button
                          onClick={() => { setEditingTemplateId(t.id); setEditWordCaps(''); setEditRules(''); }}
                          className="px-2.5 py-1 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-[10px] font-bold transition cursor-pointer"
                        >
                          Edit
                        </button>
                      )}
                    </div>
                  </div>

                  {forkSourceId === t.id && (
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                      <input
                        type="text"
                        value={forkName}
                        onChange={e => setForkName(e.target.value)}
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
                      />
                      <div className="flex items-center space-x-3">
                        <label className="flex items-center space-x-1.5 text-[10px] font-semibold text-slate-600">
                          <input type="radio" checked={forkScope === 'personal'} onChange={() => setForkScope('personal')} />
                          <span>Personal</span>
                        </label>
                        <label className="flex items-center space-x-1.5 text-[10px] font-semibold text-slate-600">
                          <input type="radio" checked={forkScope === 'tenant'} onChange={() => setForkScope('tenant')} />
                          <span>Department-wide</span>
                        </label>
                      </div>
                      <div className="flex justify-end space-x-1.5">
                        <button onClick={() => setForkSourceId(null)} className="px-2.5 py-1 text-[10px] font-bold text-slate-500 cursor-pointer">Cancel</button>
                        <button
                          onClick={handleFork}
                          disabled={isForking || !forkName.trim()}
                          className="px-2.5 py-1 bg-slate-950 hover:bg-slate-900 text-white rounded-lg text-[10px] font-bold transition cursor-pointer disabled:opacity-50"
                        >
                          {isForking ? 'Forking...' : 'Create Fork'}
                        </button>
                      </div>
                    </div>
                  )}

                  {editingTemplateId === t.id && (
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-600 uppercase">Word Caps (one per line, key=value)</label>
                        <textarea
                          rows={3}
                          value={editWordCaps}
                          onChange={e => setEditWordCaps(e.target.value)}
                          placeholder={'proposal_title=25\nch1_intro=1500'}
                          className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-slate-950"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-600 uppercase">Custom Prompt Rules (one per line)</label>
                        <textarea
                          rows={2}
                          value={editRules}
                          onChange={e => setEditRules(e.target.value)}
                          className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] focus:outline-none focus:ring-1 focus:ring-slate-950"
                        />
                      </div>
                      <div className="flex justify-end space-x-1.5">
                        <button onClick={() => setEditingTemplateId(null)} className="px-2.5 py-1 text-[10px] font-bold text-slate-500 cursor-pointer">Cancel</button>
                        <button
                          onClick={() => handleSaveTemplateEdits(t.id)}
                          className="px-2.5 py-1 bg-slate-950 hover:bg-slate-900 text-white rounded-lg text-[10px] font-bold transition cursor-pointer"
                        >
                          Save Edits
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
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

const ScoreGauge: React.FC<{ label: string; result: { valid: boolean; message: string } }> = ({ label, result }) => (
  <div className={`rounded-xl p-3 border ${result.valid ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
    <div className="flex items-center space-x-1.5">
      {result.valid ? <CheckCircle2 size={12} className="text-emerald-600" /> : <AlertTriangle size={12} className="text-rose-600" />}
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">{label}</span>
    </div>
    <p className={`text-[11px] font-semibold mt-0.5 ${result.valid ? 'text-emerald-700' : 'text-rose-700'}`}>{result.message}</p>
  </div>
);
