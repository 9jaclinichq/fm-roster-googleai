import React, { useState, useEffect } from 'react';
import { databaseService } from '../lib/databaseService';
import { Dissertation, DissertationMilestone, CaseReport, ExamReadiness, Collection, Submission } from '../types';
import {
  Gauge,
  AlertTriangle,
  CheckCircle2,
  GraduationCap,
  ClipboardList,
  CalendarCheck,
  BookOpenCheck,
  RefreshCw,
  Save,
} from 'lucide-react';

interface ExamReadinessViewProps {
  resident: { id: string; name: string; category: string };
}

interface Pillar {
  key: string;
  label: string;
  score: number;
  icon: React.ReactNode;
  detail: string;
}

const scoreColor = (score: number) => {
  if (score >= 80) return 'text-emerald-600';
  if (score >= 50) return 'text-amber-600';
  return 'text-rose-600';
};

const scoreRing = (score: number) => {
  if (score >= 80) return 'stroke-emerald-500';
  if (score >= 50) return 'stroke-amber-500';
  return 'stroke-rose-500';
};

export const ExamReadinessView: React.FC<ExamReadinessViewProps> = ({ resident }) => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [dissertation, setDissertation] = useState<Dissertation | null>(null);
  const [milestones, setMilestones] = useState<DissertationMilestone[]>([]);
  const [caseReports, setCaseReports] = useState<CaseReport[]>([]);
  const [readiness, setReadiness] = useState<ExamReadiness | null>(null);
  const [currentCollection, setCurrentCollection] = useState<Collection | null>(null);
  const [currentSubmission, setCurrentSubmission] = useState<Submission | null>(null);

  // Editable fields
  const [evidemyCompleted, setEvidemyCompleted] = useState<number>(0);
  const [evidemyRequired, setEvidemyRequired] = useState<number>(0);
  const [logbookVerified, setLogbookVerified] = useState<boolean>(false);
  const [feesPaid, setFeesPaid] = useState<boolean>(false);
  const [formsSubmitted, setFormsSubmitted] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveMessage, setSaveMessage] = useState<string>('');

  const load = async () => {
    setIsLoading(true);
    try {
      const [diss, reports, ready, settings, collections] = await Promise.all([
        databaseService.getDissertationForWorkforce(resident.id),
        databaseService.getCaseReports(resident.id),
        databaseService.getOrCreateExamReadiness(resident.id),
        databaseService.getSettings(),
        databaseService.getCollections(),
      ]);

      setDissertation(diss);
      if (diss) {
        setMilestones(await databaseService.getDissertationMilestones(diss.id));
      }
      setCaseReports(reports);
      setReadiness(ready);
      setEvidemyCompleted(ready.evidemy_completed_count);
      setEvidemyRequired(ready.evidemy_total_required);
      setLogbookVerified(ready.physical_logbook_verified);
      setFeesPaid(ready.exam_fees_paid);
      setFormsSubmitted(ready.college_forms_submitted);

      const activeColl = collections.find(c => c.id === settings.current_collection_id) || null;
      setCurrentCollection(activeColl);
      if (activeColl) {
        setCurrentSubmission(await databaseService.getSubmissionForWorkforceAndCollection(resident.id, activeColl.id));
      }
    } catch (err) {
      console.warn('Failed to load exam readiness data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resident.id]);

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage('');
    try {
      const updated = await databaseService.upsertExamReadiness(resident.id, {
        evidemy_completed_count: evidemyCompleted,
        evidemy_total_required: evidemyRequired,
        physical_logbook_verified: logbookVerified,
        exam_fees_paid: feesPaid,
        college_forms_submitted: formsSubmitted,
      });
      setReadiness(updated);
      setSaveMessage('Saved.');
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (err) {
      console.warn(err);
      setSaveMessage('Failed to save.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto my-12 p-8 text-center bg-white border border-slate-200 rounded-2xl shadow-sm">
        <RefreshCw size={32} className="text-slate-500 animate-spin mx-auto mb-3" />
        <p className="text-sm font-medium text-slate-600">Calculating exam readiness...</p>
      </div>
    );
  }

  // --- Pillar 1: Proposal & Ethics ---
  const proposalMilestone = milestones.find(m => m.stage === 'Proposal Development');
  const ethicsMilestone = milestones.find(m => m.stage === 'Ethical Clearance');
  const milestoneScore = (status?: string) => (status === 'approved' ? 100 : status === 'in_review' ? 50 : 0);
  const dissertationScore = dissertation
    ? Math.round((milestoneScore(proposalMilestone?.status) + milestoneScore(ethicsMilestone?.status)) / 2)
    : 0;

  // --- Pillar 2: Casebook ---
  const casebookCompleted = caseReports.filter(r => r.status === 'pending_supervisor' || r.status === 'approved').length;
  const casebookScore = Math.round((casebookCompleted / 15) * 100);

  // --- Pillar 3: Roster compliance ---
  const rosterScore = !currentCollection ? 100 : currentSubmission ? 100 : 0;

  // --- Pillar 4: Evidemy / logistics ---
  const evidemyScore = evidemyRequired > 0 ? Math.round((evidemyCompleted / evidemyRequired) * 100) : 100;
  const logisticsScore = Math.round(
    (evidemyScore + (logbookVerified ? 100 : 0) + (feesPaid ? 100 : 0) + (formsSubmitted ? 100 : 0)) / 4
  );

  const overallScore = Math.round((dissertationScore + casebookScore + rosterScore + logisticsScore) / 4);

  const pillars: Pillar[] = [
    {
      key: 'dissertation',
      label: 'Proposal & Ethics',
      score: dissertationScore,
      icon: <GraduationCap size={16} />,
      detail: dissertation ? `${dissertation.stage}` : 'Not started',
    },
    {
      key: 'casebook',
      label: '15-Casebook Completion',
      score: casebookScore,
      icon: <ClipboardList size={16} />,
      detail: `${casebookCompleted} / 15 submitted`,
    },
    {
      key: 'roster',
      label: 'Roster Compliance',
      score: rosterScore,
      icon: <CalendarCheck size={16} />,
      detail: currentCollection ? (currentSubmission ? 'Current month submitted' : 'Current month pending') : 'No active collection',
    },
    {
      key: 'logistics',
      label: 'Evidemy & Logistics',
      score: logisticsScore,
      icon: <BookOpenCheck size={16} />,
      detail: `${evidemyCompleted}/${evidemyRequired || '—'} modules`,
    },
  ];

  // Dynamic alerts
  const alerts: string[] = [];
  if (!dissertation) {
    alerts.push('Dissertation not yet started — no proposal or ethics milestone on record.');
  } else {
    if (proposalMilestone?.status !== 'approved') alerts.push('Proposal Development milestone is not yet approved.');
    if (ethicsMilestone?.status !== 'approved') alerts.push('Ethical Clearance milestone is not yet approved.');
  }
  if (casebookCompleted < 15) {
    alerts.push(`Missing ${15 - casebookCompleted} Case Report${15 - casebookCompleted === 1 ? '' : 's'} for Part 2 Exam Eligibility.`);
  }
  if (currentCollection && !currentSubmission) {
    alerts.push(`Roster submission pending for "${currentCollection.title}".`);
  }
  if (evidemyRequired > 0 && evidemyCompleted < evidemyRequired) {
    alerts.push(`${evidemyRequired - evidemyCompleted} Evidemy module${evidemyRequired - evidemyCompleted === 1 ? '' : 's'} remaining.`);
  }
  if (!logbookVerified) alerts.push('Physical logbook has not been verified.');
  if (!feesPaid) alerts.push('Exam fees are not yet marked as paid.');
  if (!formsSubmitted) alerts.push('College forms have not been submitted.');

  const circumference = 2 * Math.PI * 54;

  return (
    <div className="max-w-4xl mx-auto my-8 px-4 space-y-6">
      {/* Score header */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 flex flex-col sm:flex-row items-center gap-6">
        <div className="relative h-32 w-32 shrink-0">
          <svg className="h-32 w-32 -rotate-90" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="54" fill="none" stroke="#e2e8f0" strokeWidth="10" />
            <circle
              cx="60" cy="60" r="54" fill="none" strokeWidth="10" strokeLinecap="round"
              className={scoreRing(overallScore)}
              strokeDasharray={circumference}
              strokeDashoffset={circumference - (overallScore / 100) * circumference}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`text-2xl font-extrabold ${scoreColor(overallScore)}`}>{overallScore}%</span>
            <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Ready</span>
          </div>
        </div>
        <div>
          <div className="flex items-center space-x-2 mb-1">
            <Gauge className="text-slate-500" size={18} />
            <h2 className="font-bold text-slate-900 text-lg tracking-tight">Exam Readiness Scorecard</h2>
          </div>
          <p className="text-xs text-slate-500 max-w-md">
            Consolidated score across dissertation progress, casebook completion, roster compliance, and Evidemy/logistics sign-off.
          </p>
        </div>
      </div>

      {/* Pillar cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {pillars.map(p => (
          <div key={p.key} className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 flex items-start justify-between">
            <div className="flex items-start space-x-3">
              <div className="bg-slate-100 text-slate-600 p-2 rounded-lg">{p.icon}</div>
              <div>
                <div className="text-xs font-bold text-slate-700">{p.label}</div>
                <div className="text-[10px] text-slate-400 mt-0.5">{p.detail}</div>
              </div>
            </div>
            <span className={`font-extrabold text-lg ${scoreColor(p.score)}`}>{p.score}%</span>
          </div>
        ))}
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-2">
          <div className="flex items-center space-x-2 mb-1">
            <AlertTriangle className="text-amber-500" size={16} />
            <h3 className="font-bold text-slate-800 text-sm">Outstanding Requirements</h3>
          </div>
          {alerts.map((a, i) => (
            <div key={i} className="flex items-start space-x-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              <span>{a}</span>
            </div>
          ))}
        </div>
      )}
      {alerts.length === 0 && (
        <div className="flex items-center space-x-2 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl p-3">
          <CheckCircle2 size={15} />
          <span>All tracked requirements are complete.</span>
        </div>
      )}

      {/* Editable self-report fields */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-4">
        <h3 className="font-bold text-slate-800 text-sm">Update Evidemy & Logistics</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 uppercase">Evidemy Modules Completed</label>
            <input
              type="number"
              min={0}
              value={evidemyCompleted}
              onChange={(e) => setEvidemyCompleted(Math.max(0, parseInt(e.target.value) || 0))}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 uppercase">Evidemy Modules Required</label>
            <input
              type="number"
              min={0}
              value={evidemyRequired}
              onChange={(e) => setEvidemyRequired(Math.max(0, parseInt(e.target.value) || 0))}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-4 pt-2 border-t border-slate-100">
          <label className="flex items-center space-x-2 cursor-pointer">
            <input type="checkbox" checked={logbookVerified} onChange={(e) => setLogbookVerified(e.target.checked)} className="rounded text-slate-950 focus:ring-slate-950" />
            <span className="text-xs font-semibold text-slate-700">Physical logbook verified</span>
          </label>
          <label className="flex items-center space-x-2 cursor-pointer">
            <input type="checkbox" checked={feesPaid} onChange={(e) => setFeesPaid(e.target.checked)} className="rounded text-slate-950 focus:ring-slate-950" />
            <span className="text-xs font-semibold text-slate-700">Exam fees paid</span>
          </label>
          <label className="flex items-center space-x-2 cursor-pointer">
            <input type="checkbox" checked={formsSubmitted} onChange={(e) => setFormsSubmitted(e.target.checked)} className="rounded text-slate-950 focus:ring-slate-950" />
            <span className="text-xs font-semibold text-slate-700">College forms submitted</span>
          </label>
        </div>

        <div className="flex items-center space-x-3 pt-2">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="inline-flex items-center space-x-1.5 px-4 py-2 bg-slate-950 hover:bg-slate-900 disabled:bg-slate-400 text-white font-bold rounded-xl text-xs shadow-sm transition cursor-pointer"
          >
            <Save size={13} />
            <span>{isSaving ? 'Saving...' : 'Save'}</span>
          </button>
          {saveMessage && <span className="text-xs text-slate-500 font-medium">{saveMessage}</span>}
        </div>
      </div>

      {readiness?.oral_practice_score != null && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 flex items-center justify-between">
          <span className="text-xs font-bold text-slate-700">Average Mock Viva Score</span>
          <span className={`font-extrabold text-lg ${scoreColor(readiness.oral_practice_score)}`}>
            {readiness.oral_practice_score.toFixed(1)}%
          </span>
        </div>
      )}
    </div>
  );
};
