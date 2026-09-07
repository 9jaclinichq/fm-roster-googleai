import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BookOpen,
  Camera,
  ChevronRight,
  FileSearch,
  GraduationCap,
  IdCard,
  Library,
  Mic,
  RefreshCw,
  ShieldCheck,
  Stethoscope,
} from 'lucide-react';
import { supabase } from '../../../lib/databaseService';
import { getUnifiedDoctorRecord, UnifiedDoctorRecord } from '../lib/udr';
import {
  buildRecentWorkCandidates,
  RecentWorkCandidate,
  selectNewestRecentWork,
} from '../lib/recentWork';

interface ContinuityOwner {
  id: string;
  name: string;
  kind: 'workforce' | 'doctor';
}

interface ProfessionalWorkContinuityPanelProps {
  owner: ContinuityOwner;
  canOpenCaseCapture: boolean;
  canUseInstitutionalReview: boolean;
  canUseLearningTools: boolean;
}

interface LaneLink {
  label: string;
  path: string;
  disabled?: boolean;
  disabledReason?: string;
}

interface Lane {
  key: string;
  title: string;
  description: string;
  summary: string;
  primary: LaneLink;
  secondary: LaneLink[];
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

function workspaceCount(record: UnifiedDoctorRecord | null, type: 'research_workspace' | 'casebook_workspace'): number {
  return record?.instances.filter((instance) => instance.type === type).length ?? 0;
}

function formatRecentWorkDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'date unavailable';
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatRecentWorkSummary(item: RecentWorkCandidate): string {
  return `${item.title} - ${item.timestampLabel} ${formatRecentWorkDate(item.lastUpdatedAt)}; status: ${item.status}.`;
}

export const ProfessionalWorkContinuityPanel: React.FC<ProfessionalWorkContinuityPanelProps> = ({
  owner,
  canOpenCaseCapture,
  canUseInstitutionalReview,
  canUseLearningTools,
}) => {
  const navigate = useNavigate();
  const [record, setRecord] = useState<UnifiedDoctorRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    getUnifiedDoctorRecord(
      supabase,
      owner.kind === 'workforce' ? { workforceId: owner.id } : { doctorId: owner.id }
    )
      .then((result) => {
        if (!cancelled) setRecord(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load continuity summary.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [owner.id, owner.kind]);

  const routePrefix = owner.kind === 'workforce' ? '/workspace' : '/doctor';
  const casebookCount = workspaceCount(record, 'casebook_workspace');
  const researchCount = workspaceCount(record, 'research_workspace');
  const caseReportsCount = record?.academic.caseReportsCount ?? 0;
  const dissertation = record?.academic.dissertation ?? null;
  const examReadiness = record?.academic.examReadiness ?? null;
  const recentWorkScope = useMemo(() => ({
    ownerId: owner.id,
    ownerKind: owner.kind,
    tenantId: record?.tenant?.id ?? null,
  }), [owner.id, owner.kind, record?.tenant?.id]);
  const recentWorkCandidates = useMemo(() => buildRecentWorkCandidates({
    scope: recentWorkScope,
    instances: record?.instances ?? [],
    dissertation,
  }), [dissertation, recentWorkScope, record?.instances]);
  const recentCaseWork = useMemo(
    () => selectNewestRecentWork(recentWorkCandidates, recentWorkScope, { domain: 'cases' }),
    [recentWorkCandidates, recentWorkScope]
  );
  const recentResearchWork = useMemo(
    () => selectNewestRecentWork(recentWorkCandidates, recentWorkScope, { domain: 'research' }),
    [recentWorkCandidates, recentWorkScope]
  );
  const directResearchResume = useMemo(
    () => selectNewestRecentWork(recentWorkCandidates, recentWorkScope, { domain: 'research', requireDirectRoute: true }),
    [recentWorkCandidates, recentWorkScope]
  );

  const lanes = useMemo<Lane[]>(() => [
    {
      key: 'cases',
      title: 'Cases and follow-up',
      description: 'Capture raw case material privately, then continue structured casebook and logbook work.',
      summary: isLoading
        ? 'Loading case summary...'
        : error
          ? 'Case summary is unavailable right now.'
          : recentCaseWork
            ? `${formatRecentWorkSummary(recentCaseWork)} Continue in Casebook & Logbook.`
          : casebookCount > 0 || caseReportsCount > 0
            ? `${casebookCount} casebook workspace${casebookCount === 1 ? '' : 's'}; ${caseReportsCount} submitted case report${caseReportsCount === 1 ? '' : 's'}.`
            : 'No casebook workspaces or submitted case reports are visible yet.',
      primary: canOpenCaseCapture
        ? { label: 'Open Case Capture', path: '/doctor/cases' }
        : { label: 'Open Casebook', path: `${routePrefix}/casebook-logbook` },
      secondary: [
        { label: 'Casebook & Logbook', path: `${routePrefix}/casebook-logbook` },
        canOpenCaseCapture
          ? { label: 'Private capture', path: '/doctor/cases' }
          : { label: 'Private capture', path: '', disabled: true, disabledReason: 'Sign in with a doctor account to use private capture.' },
      ],
      icon: Stethoscope,
    },
    {
      key: 'research',
      title: 'Dissertation and research',
      description: 'Keep the long-running dissertation separate from structured research work, source materials, and review.',
      summary: isLoading
        ? 'Loading research summary...'
        : error
          ? 'Research summary is unavailable right now.'
          : directResearchResume
            ? formatRecentWorkSummary(directResearchResume)
            : recentResearchWork
              ? `${formatRecentWorkSummary(recentResearchWork)} Continue in Research Engine.`
            : researchCount > 0
              ? `${researchCount} research workspace${researchCount === 1 ? '' : 's'} visible. No direct dissertation record is visible yet.`
              : 'No dissertation record or research workspace is visible yet.',
      primary: directResearchResume
        ? { label: 'Resume recent work', path: directResearchResume.route }
        : { label: owner.kind === 'workforce' ? 'Open Dissertation' : 'Open Research', path: owner.kind === 'workforce' ? '/workspace/dissertation' : '/doctor/research' },
      secondary: [
        { label: 'Research Engine', path: `${routePrefix}/research` },
        owner.kind === 'workforce'
          ? { label: 'Knowledge Library', path: '/workspace/library' }
          : { label: 'Knowledge Library', path: '', disabled: true, disabledReason: 'Library access is available after organization linkage.' },
        canUseInstitutionalReview
          ? { label: 'Review Workspace', path: '/workspace/consultant-review' }
          : { label: 'Review Workspace', path: '', disabled: true, disabledReason: 'Available in an institutional workspace.' },
      ],
      icon: GraduationCap,
    },
    {
      key: 'record',
      title: 'Professional record / learning',
      description: 'Return to the unified record, exam readiness, viva practice, and learning evidence already in this workspace.',
      summary: isLoading
        ? 'Loading record summary...'
        : error
          ? 'Record summary is unavailable right now.'
          : examReadiness
            ? `Exam readiness exists: Evidemy ${examReadiness.evidemy_completed_count}/${examReadiness.evidemy_total_required}.`
            : 'No exam-readiness record is visible yet.',
      primary: { label: 'Open My Record', path: `${routePrefix}/my-record` },
      secondary: [
        canUseLearningTools
          ? { label: 'Exam Readiness', path: '/workspace/exam-readiness' }
          : { label: 'Exam Readiness', path: '', disabled: true, disabledReason: 'Available in an institutional workspace.' },
        canUseLearningTools
          ? { label: 'Viva Simulator', path: '/workspace/viva-simulator' }
          : { label: 'Viva Simulator', path: '', disabled: true, disabledReason: 'Available in an institutional workspace.' },
      ],
      icon: IdCard,
    },
  ], [
    canOpenCaseCapture,
    canUseInstitutionalReview,
    canUseLearningTools,
    caseReportsCount,
    casebookCount,
    dissertation,
    error,
    examReadiness,
    isLoading,
    owner.kind,
    researchCount,
    routePrefix,
  ]);

  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div>
          <p className="text-[10px] text-blue-600 font-bold uppercase tracking-wider">Professional Work Continuity</p>
          <h2 className="text-lg sm:text-xl font-extrabold text-slate-900 tracking-tight mt-0.5">Pick up where you left off</h2>
        </div>
        {isLoading && <RefreshCw size={16} className="text-slate-400 animate-spin" />}
      </div>

      {error && (
        <p className="mb-3 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
          Summary unavailable. Continuation links below still use the existing app routes.
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {lanes.map((lane) => {
          const Icon = lane.icon;
          return (
            <div key={lane.key} className="border border-slate-200 rounded-xl p-4 bg-slate-50 flex flex-col">
              <div className="flex items-start gap-3">
                <div className="h-9 w-9 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-blue-600 shrink-0">
                  <Icon size={17} />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-slate-900">{lane.title}</h3>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{lane.description}</p>
                </div>
              </div>

              <p className="text-xs text-slate-700 mt-3 leading-relaxed min-h-[42px]">{lane.summary}</p>

              <button
                type="button"
                onClick={() => navigate(lane.primary.path)}
                className="mt-3 w-full inline-flex items-center justify-between gap-2 px-3 py-2 bg-slate-950 hover:bg-slate-900 text-white rounded-lg text-xs font-bold shadow-sm transition cursor-pointer"
              >
                <span>{lane.primary.label}</span>
                <ChevronRight size={13} />
              </button>

              <div className="mt-3 flex flex-wrap gap-2">
                {lane.secondary.map((link) => (
                  <button
                    key={link.label}
                    type="button"
                    onClick={() => !link.disabled && navigate(link.path)}
                    disabled={link.disabled}
                    title={link.disabledReason}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed hover:border-slate-300 text-slate-700 rounded-lg text-[10px] font-bold transition cursor-pointer"
                  >
                    {link.label === 'Private capture' && <Camera size={11} />}
                    {link.label === 'Research Engine' && <FileSearch size={11} />}
                    {link.label === 'Knowledge Library' && <Library size={11} />}
                    {link.label === 'Review Workspace' && <ShieldCheck size={11} />}
                    {link.label === 'Exam Readiness' && <BookOpen size={11} />}
                    {link.label === 'Viva Simulator' && <Mic size={11} />}
                    <span>{link.label}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
