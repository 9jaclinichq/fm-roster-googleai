import React, { useState, useEffect } from 'react';
import { databaseService } from '../lib/databaseService';
import { academicCopilot, AcademicCopilotSource } from '../lib/ai/academicCopilot';
import { Dissertation, DissertationMilestone, DissertationStage, WACP_DISSERTATION_STAGES } from '../types';
import {
  GraduationCap,
  CheckCircle2,
  Clock,
  UploadCloud,
  FileText,
  RefreshCw,
  AlertTriangle,
  Sparkles,
  BookCheck,
  Quote,
  X,
  Link2,
  Copy,
  Check,
} from 'lucide-react';

interface DissertationAssistantViewProps {
  resident: { id: string; name: string; category: string };
}

const STATUS_STYLES: Record<string, string> = {
  approved: 'bg-emerald-500 text-white border-emerald-500',
  in_review: 'bg-amber-500 text-white border-amber-500',
  draft: 'bg-white text-slate-400 border-slate-300',
};

export const DissertationAssistantView: React.FC<DissertationAssistantViewProps> = ({ resident }) => {
  const [dissertation, setDissertation] = useState<Dissertation | null>(null);
  const [milestones, setMilestones] = useState<DissertationMilestone[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [selectedStage, setSelectedStage] = useState<DissertationStage | null>(null);

  // Start-dissertation form
  const [titleInput, setTitleInput] = useState<string>('');
  const [supervisorInput, setSupervisorInput] = useState<string>('');
  const [startError, setStartError] = useState<string>('');
  const [isStarting, setIsStarting] = useState<boolean>(false);

  // Upload state
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string>('');

  // Guest review link (external, no-login reviewer sharing)
  const [guestLink, setGuestLink] = useState<string | null>(null);
  const [isCreatingGuestLink, setIsCreatingGuestLink] = useState<boolean>(false);
  const [guestLinkCopied, setGuestLinkCopied] = useState<boolean>(false);

  // AI panel
  const [aiPanelOpen, setAiPanelOpen] = useState<'guidelines' | 'citations' | null>(null);
  const [aiInputText, setAiInputText] = useState<string>('');
  const [aiResultNotes, setAiResultNotes] = useState<string[] | null>(null);
  const [aiFormatted, setAiFormatted] = useState<string | null>(null);
  const [aiSource, setAiSource] = useState<AcademicCopilotSource | null>(null);
  const [isAiRunning, setIsAiRunning] = useState<boolean>(false);

  const load = async () => {
    setIsLoading(true);
    try {
      const diss = await databaseService.getDissertationForWorkforce(resident.id);
      setDissertation(diss);
      if (diss) {
        const ms = await databaseService.getDissertationMilestones(diss.id);
        setMilestones(ms);
        setSelectedStage(prev => prev || diss.stage);
      }
    } catch (err) {
      console.warn('Failed to load dissertation:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resident.id]);

  useEffect(() => {
    setGuestLink(null);
  }, [selectedStage]);

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    setStartError('');
    if (!titleInput.trim()) {
      setStartError('Please enter a working dissertation title.');
      return;
    }
    setIsStarting(true);
    try {
      const created = await databaseService.createDissertation(resident.id, titleInput.trim(), supervisorInput.trim() || undefined);
      setDissertation(created);
      const ms = await databaseService.getDissertationMilestones(created.id);
      setMilestones(ms);
      setSelectedStage(created.stage);
    } catch (err) {
      console.warn(err);
      setStartError('Failed to start your dissertation record. Please try again.');
    } finally {
      setIsStarting(false);
    }
  };

  const currentMilestone = milestones.find(m => m.stage === selectedStage) || null;

  const handleCreateGuestLink = async () => {
    if (!currentMilestone) return;
    setIsCreatingGuestLink(true);
    setGuestLinkCopied(false);
    try {
      // Always created as 'peer_reviewer' from here — grants feedback/
      // revisions-requested only, never final approval. A supervisor with
      // an authorized role (hod/rtc/cme_coord/consultant/super_admin) can
      // grant a full-approval-authority link some other way; this resident-
      // facing view deliberately doesn't expose that escalation.
      const invite = await databaseService.createGuestReviewInvite(
        resident.id,
        'dissertation_milestone',
        currentMilestone.id,
        'peer_reviewer'
      );
      setGuestLink(`${window.location.origin}${window.location.pathname}#/guest-review/${invite.token}`);
    } catch (err) {
      console.warn('Failed to create guest review link:', err);
    } finally {
      setIsCreatingGuestLink(false);
    }
  };

  const copyGuestLink = async () => {
    if (!guestLink) return;
    try {
      await navigator.clipboard.writeText(guestLink);
      setGuestLinkCopied(true);
      setTimeout(() => setGuestLinkCopied(false), 2000);
    } catch {
      // Clipboard API can be blocked in some contexts — the link is still
      // visible and selectable, so this isn't fatal.
    }
  };

  const handleSetCurrentStage = async (stage: DissertationStage) => {
    if (!dissertation) return;
    try {
      const updated = await databaseService.updateDissertationStage(dissertation.id, stage);
      setDissertation(updated);
    } catch (err) {
      console.warn(err);
    }
  };

  const handleUploadMilestoneDoc = async (file: File) => {
    if (!currentMilestone) return;
    setUploadError('');
    setIsUploading(true);
    try {
      const url = await databaseService.uploadDissertationDocument(resident.id, currentMilestone.id, file);
      const updated = await databaseService.updateMilestone(currentMilestone.id, { document_url: url, status: 'in_review' });
      setMilestones(prev => prev.map(m => m.id === updated.id ? updated : m));
    } catch (err) {
      console.warn(err);
      setUploadError('Failed to upload document.');
    } finally {
      setIsUploading(false);
    }
  };

  const runGuidelineCheck = async () => {
    setIsAiRunning(true);
    setAiResultNotes(null);
    try {
      const result = await academicCopilot.checkGuidelineCompliance(resident.id, aiInputText);
      setAiResultNotes(result.notes);
      setAiSource(result.source);
    } finally {
      setIsAiRunning(false);
    }
  };

  const runCitationFormat = async () => {
    setIsAiRunning(true);
    setAiFormatted(null);
    try {
      const result = await academicCopilot.formatVancouverCitations(resident.id, aiInputText);
      setAiFormatted(result.formatted || 'Nothing to format — paste one reference per line.');
      setAiSource(result.source);
    } finally {
      setIsAiRunning(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto my-12 p-8 text-center bg-white border border-slate-200 rounded-2xl shadow-sm">
        <RefreshCw size={32} className="text-slate-500 animate-spin mx-auto mb-3" />
        <p className="text-sm font-medium text-slate-600">Loading your dissertation record...</p>
      </div>
    );
  }

  if (!dissertation) {
    return (
      <div className="max-w-lg mx-auto my-12 px-4">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-4">
          <div className="flex items-center space-x-2">
            <GraduationCap className="text-slate-500" size={20} />
            <h2 className="font-bold text-slate-900 text-lg">Start Your WACP Dissertation</h2>
          </div>
          <p className="text-xs text-slate-500">
            This creates your dissertation record and sets up the full 9-stage WACP pipeline for you to track.
          </p>
          {startError && (
            <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-3 text-xs flex items-center space-x-1.5">
              <AlertTriangle size={13} />
              <span>{startError}</span>
            </div>
          )}
          <form onSubmit={handleStart} className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 uppercase">Working Title</label>
              <input
                type="text"
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                placeholder="e.g. Prevalence of Hypertension Among..."
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 uppercase">Supervisor Name (optional)</label>
              <input
                type="text"
                value={supervisorInput}
                onChange={(e) => setSupervisorInput(e.target.value)}
                placeholder="e.g. Dr. Adebayo"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
              />
            </div>
            <button
              type="submit"
              disabled={isStarting}
              className="w-full py-2.5 bg-slate-950 hover:bg-slate-900 disabled:bg-slate-400 text-white font-bold rounded-xl text-sm shadow-sm transition cursor-pointer"
            >
              {isStarting ? 'Starting...' : 'Start Dissertation'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto my-8 px-4 space-y-6">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-1">
        <div className="flex items-center space-x-2">
          <GraduationCap className="text-slate-500" size={18} />
          <h2 className="font-bold text-slate-900 text-lg tracking-tight truncate">{dissertation.title}</h2>
        </div>
        <p className="text-xs text-slate-500">
          Supervisor: {dissertation.supervisor_name || 'Not assigned'} &bull; Current stage:{' '}
          <span className="font-bold text-slate-700">{dissertation.stage}</span>
        </p>
      </div>

      {/* Stage-gate timeline */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
        <div className="flex overflow-x-auto gap-1 pb-2">
          {WACP_DISSERTATION_STAGES.map((stage, idx) => {
            const milestone = milestones.find(m => m.stage === stage);
            const status = milestone?.status || 'draft';
            const isSelected = selectedStage === stage;
            const isCurrent = dissertation.stage === stage;
            return (
              <button
                key={stage}
                onClick={() => setSelectedStage(stage)}
                className="flex flex-col items-center shrink-0 w-24 cursor-pointer group"
              >
                <div
                  className={`h-8 w-8 rounded-full border-2 flex items-center justify-center text-xs font-bold transition ${STATUS_STYLES[status]} ${
                    isSelected ? 'ring-2 ring-offset-2 ring-blue-400' : ''
                  }`}
                >
                  {status === 'approved' ? <CheckCircle2 size={16} /> : status === 'in_review' ? <Clock size={14} /> : idx + 1}
                </div>
                <span className={`mt-1.5 text-[9px] font-bold text-center leading-tight ${isCurrent ? 'text-blue-600' : 'text-slate-500'} group-hover:text-slate-800`}>
                  {stage}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected stage detail */}
      {currentMilestone && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="font-bold text-slate-800 text-sm sm:text-base">{currentMilestone.stage}</h3>
            <div className="flex items-center gap-2">
              <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${STATUS_STYLES[currentMilestone.status]}`}>
                {currentMilestone.status.replace('_', ' ')}
              </span>
              {dissertation.stage !== currentMilestone.stage && (
                <button
                  onClick={() => handleSetCurrentStage(currentMilestone.stage)}
                  className="px-2.5 py-1 rounded-md text-[10px] font-bold border border-slate-200 hover:bg-slate-50 cursor-pointer"
                >
                  Set as Current Stage
                </button>
              )}
            </div>
          </div>

          {/* Document upload */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-700 uppercase">Milestone Document</label>
            {currentMilestone.document_url ? (
              <a
                href={currentMilestone.document_url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center space-x-2 text-xs font-semibold text-slate-800 hover:underline bg-slate-50 p-2.5 rounded-lg border border-slate-200 w-max"
              >
                <FileText size={14} className="text-slate-400" />
                <span>View uploaded document</span>
              </a>
            ) : (
              <p className="text-xs text-slate-400">No document uploaded for this stage yet.</p>
            )}

            <label className="inline-flex items-center space-x-1.5 px-3 py-2 bg-slate-50 hover:bg-slate-100 border border-dashed border-slate-300 rounded-xl text-xs font-semibold text-slate-700 cursor-pointer transition">
              <UploadCloud size={14} className="text-slate-400" />
              <span>{isUploading ? 'Uploading...' : 'Upload / Replace Document'}</span>
              <input
                type="file"
                accept=".pdf,.doc,.docx,image/jpeg,image/png"
                className="hidden"
                disabled={isUploading}
                onChange={(e) => e.target.files?.[0] && handleUploadMilestoneDoc(e.target.files[0])}
              />
            </label>
            {uploadError && <p className="text-[10px] text-rose-600 font-medium">{uploadError}</p>}
          </div>

          {/* Supervisor feedback (HITL, read-only here) */}
          <div className="space-y-1.5 pt-2 border-t border-slate-100">
            <label className="text-xs font-bold text-slate-700 uppercase">Supervisor Feedback</label>
            {currentMilestone.supervisor_feedback ? (
              <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl p-3 leading-relaxed">
                {currentMilestone.supervisor_feedback}
              </p>
            ) : (
              <p className="text-xs text-slate-400 italic">No feedback recorded yet for this stage.</p>
            )}
          </div>

          {/* Guest review link — no-login sharing for a reviewer not on the platform */}
          <div className="space-y-2 pt-2 border-t border-slate-100">
            <label className="text-xs font-bold text-slate-700 uppercase">Share for External Review</label>
            <p className="text-[10px] text-slate-400 leading-relaxed">
              If your reviewer isn't a platform user, generate a link they can open as a guest — no account needed.
              They can leave feedback and a photo signature, but this link can only request revisions, not grant
              final approval.
            </p>
            {guestLink ? (
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl p-2.5">
                <input readOnly value={guestLink} className="flex-1 bg-transparent text-xs font-mono text-slate-600 outline-none" onFocus={e => e.target.select()} />
                <button onClick={copyGuestLink} className="shrink-0 p-1.5 rounded-lg hover:bg-slate-200 cursor-pointer" title="Copy link">
                  {guestLinkCopied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} className="text-slate-500" />}
                </button>
              </div>
            ) : (
              <button
                onClick={handleCreateGuestLink}
                disabled={isCreatingGuestLink}
                className="inline-flex items-center space-x-1.5 px-3 py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 cursor-pointer transition disabled:opacity-50"
              >
                <Link2 size={14} />
                <span>{isCreatingGuestLink ? 'Generating...' : 'Generate Guest Review Link'}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* AI action buttons */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-3">
        <div className="flex items-center space-x-2">
          <Sparkles className="text-slate-500" size={16} />
          <h3 className="font-bold text-slate-800 text-sm">AI-Assisted Tools</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => { setAiPanelOpen('guidelines'); setAiResultNotes(null); setAiSource(null); }}
            className="inline-flex items-center space-x-1.5 px-3 py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 cursor-pointer transition"
          >
            <BookCheck size={14} />
            <span>Check Departmental Guidelines</span>
          </button>
          <button
            onClick={() => { setAiPanelOpen('citations'); setAiFormatted(null); setAiSource(null); }}
            className="inline-flex items-center space-x-1.5 px-3 py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 cursor-pointer transition"
          >
            <Quote size={14} />
            <span>Format Vancouver Citations</span>
          </button>
        </div>

        {aiPanelOpen && (
          <div className="mt-2 border-t border-slate-100 pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 uppercase">
                {aiPanelOpen === 'guidelines' ? 'Paste text to check against departmental guidelines' : 'Paste references to format'}
              </span>
              <button onClick={() => setAiPanelOpen(null)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
                <X size={14} />
              </button>
            </div>
            <textarea
              rows={4}
              value={aiInputText}
              onChange={(e) => setAiInputText(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
              placeholder={aiPanelOpen === 'guidelines' ? 'Paste your draft section here...' : 'Paste a reference list here...'}
            />
            <button
              onClick={aiPanelOpen === 'guidelines' ? runGuidelineCheck : runCitationFormat}
              disabled={isAiRunning}
              className="px-4 py-2 bg-slate-950 hover:bg-slate-900 disabled:bg-slate-400 text-white font-bold rounded-xl text-xs shadow-sm transition cursor-pointer"
            >
              {isAiRunning ? 'Running...' : 'Run'}
            </button>

            {aiSource && (
              <span className={`inline-block px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border ${
                aiSource === 'edge_function'
                  ? 'bg-violet-50 text-violet-700 border-violet-200'
                  : 'bg-slate-100 text-slate-600 border-slate-200'
              }`}>
                {aiSource === 'edge_function' ? 'AI-generated' : 'Heuristic (no AI configured)'}
              </span>
            )}
            {aiResultNotes && (
              <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-3 text-xs space-y-1">
                {aiResultNotes.map((n, i) => <p key={i}>{n}</p>)}
              </div>
            )}
            {aiFormatted && (
              <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-3 text-xs whitespace-pre-wrap">
                {aiFormatted}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
