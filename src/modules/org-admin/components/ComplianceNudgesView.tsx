import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { databaseService } from '../../../lib/databaseService';
import { ComplianceNudge, DerivedNudge, NudgeSeverity } from '../../../types';
import { AlertTriangle, CheckCircle2, X, ArrowRight, RefreshCw } from 'lucide-react';

interface ComplianceNudgesViewProps {
  resident: { id: string; name: string; category: string };
  // Compact mode renders a short summary (top 3, no page chrome) for
  // embedding on the Resident Home Workspace. Full mode shows everything.
  compact?: boolean;
}

const SEVERITY_ORDER: Record<NudgeSeverity, number> = { high: 0, medium: 1, info: 2 };

const SEVERITY_STYLES: Record<NudgeSeverity, string> = {
  high: 'bg-rose-50 text-rose-800 border-rose-200',
  medium: 'bg-amber-50 text-amber-800 border-amber-200',
  info: 'bg-blue-50 text-blue-800 border-blue-200',
};

const ACTION_LABELS: Record<string, string> = {
  '/workspace/dissertation': 'Go to Dissertation',
  '/workspace/casebook': 'Go to Casebook',
  '/workspace/exam-readiness': 'Update Exam Readiness',
  '/workspace/form': 'Go to Roster Form',
  // Legacy pre-rebrand paths — chief-authored nudge rows persisted in the
  // DB may still carry these; navigation is handled by App.tsx's redirects.
  '/resident/dissertation': 'Go to Dissertation',
  '/resident/casebook': 'Go to Casebook',
  '/resident/exam-readiness': 'Update Exam Readiness',
  '/resident-form': 'Go to Roster Form',
};

async function deriveNudges(workforceId: string): Promise<DerivedNudge[]> {
  const [dissertation, caseReports, readiness, settings, collections] = await Promise.all([
    databaseService.getDissertationForWorkforce(workforceId),
    databaseService.getCaseReports(workforceId),
    databaseService.getOrCreateExamReadiness(workforceId),
    databaseService.getSettings(),
    databaseService.getCollections(),
  ]);

  const nudges: DerivedNudge[] = [];

  if (!dissertation) {
    nudges.push({
      nudge_type: 'dissertation_not_started',
      severity: 'medium',
      title: 'Dissertation not yet started — register a working title to begin the WACP pipeline.',
      action_link: '/workspace/dissertation',
    });
  } else {
    const milestones = await databaseService.getDissertationMilestones(dissertation.id);
    const ethics = milestones.find(m => m.stage === 'Ethical Clearance');
    if (ethics?.status !== 'approved') {
      nudges.push({
        nudge_type: 'ethics_pending',
        severity: 'high',
        title: 'Proposal pending ethics approval — required for Part 2 exam eligibility.',
        action_link: '/workspace/dissertation',
      });
    }
  }

  const completedCases = caseReports.filter(r => r.status === 'pending_supervisor' || r.status === 'approved').length;
  if (completedCases < 15) {
    const missing = 15 - completedCases;
    nudges.push({
      nudge_type: 'missing_case_reports',
      severity: missing >= 5 ? 'high' : 'medium',
      title: `Missing ${missing} Case Report${missing === 1 ? '' : 's'} for Part 2 Exam Eligibility.`,
      action_link: '/workspace/casebook',
    });
  }

  if (readiness.evidemy_total_required > 0 && readiness.evidemy_completed_count < readiness.evidemy_total_required) {
    nudges.push({
      nudge_type: 'evidemy_incomplete',
      severity: 'medium',
      title: 'CME/Evidemy modules unverified — update your completion count.',
      action_link: '/workspace/exam-readiness',
    });
  }

  if (!readiness.physical_logbook_verified) {
    nudges.push({
      nudge_type: 'logbook_unverified',
      severity: 'medium',
      title: 'Physical logbook has not been verified.',
      action_link: '/workspace/exam-readiness',
    });
  }

  if (!readiness.exam_fees_paid) {
    nudges.push({
      nudge_type: 'fees_unpaid',
      severity: 'high',
      title: 'Exam fees are not yet marked as paid.',
      action_link: '/workspace/exam-readiness',
    });
  }

  if (!readiness.college_forms_submitted) {
    nudges.push({
      nudge_type: 'forms_unsubmitted',
      severity: 'high',
      title: 'College forms have not been submitted.',
      action_link: '/workspace/exam-readiness',
    });
  }

  const activeColl = collections.find(c => c.id === settings.current_collection_id) || null;
  if (activeColl) {
    const submission = await databaseService.getSubmissionForWorkforceAndCollection(workforceId, activeColl.id);
    if (!submission) {
      nudges.push({
        nudge_type: 'roster_pending',
        severity: 'medium',
        title: `Roster submission pending for "${activeColl.title}".`,
        action_link: '/workspace/form',
      });
    }
  }

  return nudges;
}

export const ComplianceNudgesView: React.FC<ComplianceNudgesViewProps> = ({ resident, compact = false }) => {
  const navigate = useNavigate();
  const [nudges, setNudges] = useState<ComplianceNudge[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      try {
        const derived = await deriveNudges(resident.id);
        const synced = await databaseService.syncComplianceNudges(resident.id, derived);
        if (!cancelled) setNudges(synced);
      } catch (err) {
        console.warn('Failed to load compliance nudges:', err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [resident.id]);

  const handleDismiss = async (nudge: ComplianceNudge) => {
    setNudges(prev => prev.filter(n => n.id !== nudge.id));
    try {
      await databaseService.resolveComplianceNudge(nudge.id);
    } catch (err) {
      console.warn('Failed to dismiss nudge:', err);
    }
  };

  const unresolved = nudges
    .filter(n => !n.resolved)
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const visible = compact ? unresolved.slice(0, 3) : unresolved;

  if (isLoading) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 text-center">
        <RefreshCw size={18} className="text-slate-400 animate-spin mx-auto" />
      </div>
    );
  }

  if (visible.length === 0) {
    return (
      <div className="flex items-center space-x-2 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl p-3">
        <CheckCircle2 size={15} />
        <span>You're all caught up — no outstanding compliance items.</span>
      </div>
    );
  }

  return (
    <div className={compact ? 'space-y-2' : 'bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-3'}>
      {!compact && (
        <div className="flex items-center space-x-2 mb-1">
          <AlertTriangle className="text-amber-500" size={16} />
          <h3 className="font-bold text-slate-800 text-sm">Compliance Nudges</h3>
        </div>
      )}
      {visible.map(nudge => (
        <div key={nudge.id} className={`rounded-xl border p-3 flex items-start justify-between gap-3 ${SEVERITY_STYLES[nudge.severity]}`}>
          <div className="flex items-start space-x-2 min-w-0">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
            <span className="text-xs font-medium leading-relaxed">{nudge.title}</span>
          </div>
          <div className="flex items-center space-x-1.5 shrink-0">
            {nudge.action_link && (
              <button
                onClick={() => navigate(nudge.action_link!)}
                className="inline-flex items-center space-x-1 px-2.5 py-1 bg-white/70 hover:bg-white border border-current/20 rounded-lg text-[10px] font-bold cursor-pointer transition"
              >
                <span>{ACTION_LABELS[nudge.action_link] || 'View'}</span>
                <ArrowRight size={10} />
              </button>
            )}
            <button
              onClick={() => handleDismiss(nudge)}
              title="Dismiss"
              className="p-1 hover:bg-white/70 rounded-lg cursor-pointer transition"
            >
              <X size={12} />
            </button>
          </div>
        </div>
      ))}
      {compact && unresolved.length > visible.length && (
        <p className="text-[10px] text-slate-400 text-center">+{unresolved.length - visible.length} more</p>
      )}
    </div>
  );
};
