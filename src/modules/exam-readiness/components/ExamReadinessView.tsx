import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { databaseService, DEFAULT_TENANT_ID } from '../../../lib/databaseService';
import { CaseReport, Collection, Dissertation, DissertationMilestone, ExamReadiness, KnowledgePack, Submission, VivaSimulation } from '../../../types';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Gauge,
  GraduationCap,
  Library,
  Mic,
  RefreshCw,
  Save,
  ShieldCheck,
} from 'lucide-react';
import { LearningCapabilityStatus, projectLearningAssessmentCommandCentre } from '../lib/learningAssessmentCommandCentre';

interface ExamReadinessViewProps {
  resident: { id: string; name: string; category: string; tenant_id?: string };
}

const STATUS_LABEL: Record<LearningCapabilityStatus, string> = {
  working: 'Working',
  partial: 'Partial',
  scaffolded: 'Scaffolded',
  absent: 'Absent',
};

const STATUS_CLASS: Record<LearningCapabilityStatus, string> = {
  working: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  partial: 'bg-amber-50 text-amber-700 border-amber-200',
  scaffolded: 'bg-slate-50 text-slate-600 border-slate-200',
  absent: 'bg-rose-50 text-rose-700 border-rose-200',
};

const LANE_ICON = {
  exam: Gauge,
  viva: Mic,
  library: Library,
  review: ShieldCheck,
  record: GraduationCap,
};

export const ExamReadinessView: React.FC<ExamReadinessViewProps> = ({ resident }) => {
  const navigate = useNavigate();
  const tenantId = resident.tenant_id ?? DEFAULT_TENANT_ID;
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [dissertation, setDissertation] = useState<Dissertation | null>(null);
  const [milestones, setMilestones] = useState<DissertationMilestone[]>([]);
  const [caseReports, setCaseReports] = useState<CaseReport[]>([]);
  const [readiness, setReadiness] = useState<ExamReadiness | null>(null);
  const [vivaSimulations, setVivaSimulations] = useState<VivaSimulation[]>([]);
  const [knowledgePacks, setKnowledgePacks] = useState<KnowledgePack[]>([]);
  const [currentCollection, setCurrentCollection] = useState<Collection | null>(null);
  const [currentSubmission, setCurrentSubmission] = useState<Submission | null>(null);

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
      const [diss, reports, ready, settings, collections, vivaHistory, packs] = await Promise.all([
        databaseService.getDissertationForWorkforce(resident.id),
        databaseService.getCaseReports(resident.id),
        databaseService.getOrCreateExamReadiness(resident.id),
        databaseService.getSettings(tenantId),
        databaseService.getCollections(tenantId),
        databaseService.getVivaSimulations(resident.id),
        databaseService.getKnowledgePacks(undefined, tenantId),
      ]);

      setDissertation(diss);
      const dissertationMilestones = diss ? await databaseService.getDissertationMilestones(diss.id) : [];
      setMilestones(dissertationMilestones);
      setCaseReports(reports);
      setReadiness(ready);
      setVivaSimulations(vivaHistory);
      setKnowledgePacks(packs);
      setEvidemyCompleted(ready.evidemy_completed_count);
      setEvidemyRequired(ready.evidemy_total_required);
      setLogbookVerified(ready.physical_logbook_verified);
      setFeesPaid(ready.exam_fees_paid);
      setFormsSubmitted(ready.college_forms_submitted);

      const activeColl = collections.find(c => c.id === settings.current_collection_id) || null;
      setCurrentCollection(activeColl);
      setCurrentSubmission(activeColl ? await databaseService.getSubmissionForWorkforceAndCollection(resident.id, activeColl.id) : null);
    } catch (err) {
      console.warn('Failed to load learning and assessment data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resident.id, tenantId]);

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
        <p className="text-sm font-medium text-slate-600">Loading learning and assessment...</p>
      </div>
    );
  }

  const projection = projectLearningAssessmentCommandCentre({
    readiness,
    dissertation,
    milestones,
    caseReports,
    vivaSimulations,
    knowledgePacks,
    currentCollection,
    currentSubmission,
  });

  return (
    <div className="max-w-5xl mx-auto my-8 px-4 space-y-6">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <BookOpen className="text-slate-500" size={18} />
              <h2 className="font-bold text-slate-900 text-lg tracking-tight">Learning and Assessment</h2>
            </div>
            <p className="text-xs text-slate-500 max-w-2xl">
              A resident-owned view of existing exam readiness, viva practice, library resources, review workflow, and professional record continuity.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate(projection.nextActionRoute)}
            className="inline-flex items-center space-x-1.5 px-3 py-2 bg-slate-950 hover:bg-slate-900 text-white rounded-xl text-xs font-bold shadow-sm transition cursor-pointer"
          >
            <ArrowRight size={14} />
            <span>{projection.nextActionLabel}</span>
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Recent activity</p>
            <p className="text-sm font-bold text-slate-900 mt-1">{projection.recentActivity}</p>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-blue-700">Next action</p>
            <p className="text-sm font-bold text-slate-900 mt-1">{projection.nextActionDetail}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
        {projection.lanes.map((lane) => {
          const Icon = LANE_ICON[lane.key];
          return (
            <div key={lane.key} className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 flex flex-col">
              <div className="flex items-start gap-2">
                <Icon size={16} className="text-slate-500 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <h3 className="font-bold text-slate-900 text-sm">{lane.title}</h3>
                  <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">{lane.role}</p>
                </div>
              </div>
              <span className={`mt-3 w-fit inline-block px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border ${STATUS_CLASS[lane.status]}`}>
                {STATUS_LABEL[lane.status]}
              </span>
              <p className="text-xs text-slate-700 mt-3 leading-relaxed min-h-[54px]">{lane.summary}</p>
              <p className="text-[11px] text-slate-500 mt-2">Updated: {lane.recentActivity}</p>
              <button
                type="button"
                onClick={() => navigate(lane.route)}
                className="mt-auto w-full inline-flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 border border-slate-200 hover:border-slate-300 text-slate-800 rounded-lg text-xs font-bold transition cursor-pointer"
              >
                <span>{lane.actionLabel}</span>
                <ArrowRight size={13} />
              </button>
            </div>
          );
        })}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-4">
        <div>
          <h3 className="font-bold text-slate-800 text-sm">Update Tracked Exam Items</h3>
          <p className="text-xs text-slate-500 mt-1">
            These are explicit resident-maintained fields. Unsupported readiness scores, completion percentages, exam dates, supervisor approvals, and recommendations are not inferred.
          </p>
        </div>
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

      <div className="flex items-start space-x-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3">
        <AlertTriangle size={14} className="shrink-0 mt-0.5" />
        <span>{projection.privacyBoundary}</span>
      </div>
    </div>
  );
};
