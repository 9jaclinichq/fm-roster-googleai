import React, { useState, useEffect } from 'react';
import { databaseService } from '../../../lib/databaseService';
import { DissertationMilestoneWithContext, CaseReportWithWorkforce, ReviewTargetType } from '../../../types';
import { useTerminology } from '../../shared/terminology';
import {
  ShieldCheck,
  RefreshCw,
  FileText,
  GraduationCap,
  ClipboardList,
  CheckCircle2,
  XCircle,
  X,
  AlertTriangle,
} from 'lucide-react';

interface ConsultantReviewViewProps {
  reviewer: { id: string; name: string; category: string };
  // True when the reviewer holds a subadmin role (hod/rtc/cme_coord/
  // consultant/super_admin). False means a co-resident peer-assist review —
  // the RPC enforces this too (defense in depth), but hiding/disabling the
  // Approve button avoids a confusing guaranteed-to-fail action in the UI.
  canApprove: boolean;
}

interface ReviewTarget {
  type: ReviewTargetType;
  id: string;
  title: string;
  residentName: string;
  documentUrl: string | null;
}

export const ConsultantReviewView: React.FC<ConsultantReviewViewProps> = ({ reviewer, canApprove }) => {
  const { t } = useTerminology();
  const [activeTab, setActiveTab] = useState<'dissertations' | 'casebook'>('dissertations');
  const [milestones, setMilestones] = useState<DissertationMilestoneWithContext[]>([]);
  const [caseReports, setCaseReports] = useState<CaseReportWithWorkforce[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const [reviewTarget, setReviewTarget] = useState<ReviewTarget | null>(null);
  const [feedbackNotes, setFeedbackNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [reviewError, setReviewError] = useState<string>('');

  const load = async () => {
    setIsLoading(true);
    try {
      const [ms, cr] = await Promise.all([
        databaseService.getPendingDissertationMilestones(),
        databaseService.getPendingCaseReports(),
      ]);
      // Nobody reviews their own submission — mirrors the RPC's server-side check.
      setMilestones(ms.filter(m => m.dissertations?.workforce_id !== reviewer.id));
      setCaseReports(cr.filter(c => c.workforce_id !== reviewer.id));
    } catch (err) {
      console.warn('Failed to load review queue:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewer.id]);

  const openReview = (target: ReviewTarget) => {
    setReviewTarget(target);
    setFeedbackNotes('');
    setReviewError('');
  };

  const handleReviewAction = async (status: 'approved' | 'revisions_requested') => {
    if (!reviewTarget) return;
    setIsSubmitting(true);
    setReviewError('');
    try {
      await databaseService.submitConsultantReview(reviewer.id, reviewTarget.type, reviewTarget.id, status, feedbackNotes);
      if (reviewTarget.type === 'dissertation_milestone') {
        setMilestones(prev => prev.filter(m => m.id !== reviewTarget.id));
      } else {
        setCaseReports(prev => prev.filter(c => c.id !== reviewTarget.id));
      }
      setReviewTarget(null);
    } catch (err) {
      console.warn(err);
      setReviewError('Failed to submit review. You may not hold an authorized role.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isPdf = (url: string) => url.toLowerCase().endsWith('.pdf');

  return (
    <div className="max-w-5xl mx-auto my-8 px-4 space-y-6">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center space-x-2">
          <ShieldCheck className="text-slate-500" size={18} />
          <div>
            <h2 className="font-bold text-slate-900 text-lg tracking-tight">{t('senior_reviewer', 'Consultant')} Review Workspace</h2>
            <p className="text-xs text-slate-500">Reviewing as {reviewer.name}</p>
          </div>
        </div>
      </div>

      <div className="flex border-b border-slate-200 gap-4">
        <button
          onClick={() => setActiveTab('dissertations')}
          className={`pb-3 text-xs sm:text-sm font-bold border-b-2 px-1 transition cursor-pointer ${
            activeTab === 'dissertations' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Dissertation Milestones ({milestones.length})
        </button>
        <button
          onClick={() => setActiveTab('casebook')}
          className={`pb-3 text-xs sm:text-sm font-bold border-b-2 px-1 transition cursor-pointer ${
            activeTab === 'casebook' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Case Reports ({caseReports.length})
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 bg-white border border-slate-200 rounded-2xl">
          <RefreshCw size={28} className="text-slate-400 animate-spin mx-auto mb-2" />
          <p className="text-sm text-slate-500">Loading review queue...</p>
        </div>
      ) : activeTab === 'dissertations' ? (
        milestones.length === 0 ? (
          <div className="text-center py-12 bg-white border border-slate-200 rounded-2xl text-slate-400">
            <GraduationCap size={28} className="mx-auto mb-2" />
            <p className="text-sm font-medium">No dissertation milestones pending review.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {milestones.map(m => (
              <div key={m.id} className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 space-y-2">
                <span className="inline-block px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200">
                  {m.stage}
                </span>
                <h3 className="font-bold text-slate-900 text-sm">{m.dissertations?.workforce?.full_name || `Unknown ${t('member', 'resident').toLowerCase()}`}</h3>
                <p className="text-xs text-slate-500 truncate">{m.dissertations?.title}</p>
                <button
                  onClick={() => openReview({
                    type: 'dissertation_milestone',
                    id: m.id,
                    title: `${m.stage} — ${m.dissertations?.title || ''}`,
                    residentName: m.dissertations?.workforce?.full_name || `Unknown ${t('member', 'resident').toLowerCase()}`,
                    documentUrl: m.document_url,
                  })}
                  className="w-full mt-2 py-2 bg-slate-950 hover:bg-slate-900 text-white font-bold rounded-xl text-xs shadow-sm transition cursor-pointer"
                >
                  Review
                </button>
              </div>
            ))}
          </div>
        )
      ) : caseReports.length === 0 ? (
        <div className="text-center py-12 bg-white border border-slate-200 rounded-2xl text-slate-400">
          <ClipboardList size={28} className="mx-auto mb-2" />
          <p className="text-sm font-medium">No case reports pending review.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {caseReports.map(c => (
            <div key={c.id} className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 space-y-2">
              <span className="inline-block px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-amber-50 text-amber-700 border border-amber-200">
                Case {c.case_number}
              </span>
              <h3 className="font-bold text-slate-900 text-sm">{c.workforce?.full_name || `Unknown ${t('member', 'resident').toLowerCase()}`}</h3>
              <p className="text-xs text-slate-500 truncate">{c.diagnosis || 'No diagnosis recorded'}</p>
              <button
                onClick={() => openReview({
                  type: 'case_report',
                  id: c.id,
                  title: `Case ${c.case_number} — ${c.diagnosis || 'Untitled'}`,
                  residentName: c.workforce?.full_name || `Unknown ${t('member', 'resident').toLowerCase()}`,
                  documentUrl: c.document_url,
                })}
                className="w-full mt-2 py-2 bg-slate-950 hover:bg-slate-900 text-white font-bold rounded-xl text-xs shadow-sm transition cursor-pointer"
              >
                Review
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Review modal */}
      {reviewTarget && (
        <div className="fixed inset-0 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-slate-100 shadow-2xl">
            <div className="bg-slate-950 px-6 py-4 text-white flex justify-between items-center sticky top-0">
              <div>
                <h3 className="font-bold text-base">{reviewTarget.title}</h3>
                <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">{reviewTarget.residentName}</p>
              </div>
              <button onClick={() => setReviewTarget(null)} className="text-slate-300 hover:text-white cursor-pointer">
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {reviewError && (
                <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-3 text-xs flex items-center space-x-1.5">
                  <AlertTriangle size={13} />
                  <span>{reviewError}</span>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700 uppercase">Submitted Document</label>
                {reviewTarget.documentUrl ? (
                  <>
                    {isPdf(reviewTarget.documentUrl) ? (
                      <iframe
                        src={reviewTarget.documentUrl}
                        title="Document preview"
                        className="w-full h-80 border border-slate-200 rounded-xl"
                      />
                    ) : (
                      <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-500">
                        Preview not available for this file type — open it directly instead.
                      </div>
                    )}
                    <a
                      href={reviewTarget.documentUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center space-x-1.5 text-xs font-semibold text-slate-800 hover:underline"
                    >
                      <FileText size={13} className="text-slate-400" />
                      <span>Open in new tab</span>
                    </a>
                  </>
                ) : (
                  <p className="text-xs text-slate-400 italic">No document has been uploaded for this item.</p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 uppercase">Feedback</label>
                <textarea
                  rows={4}
                  value={feedbackNotes}
                  onChange={(e) => setFeedbackNotes(e.target.value)}
                  placeholder={`Write feedback for the ${t('member', 'resident').toLowerCase()}...`}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
                />
              </div>

              {!canApprove && (
                <p className="text-[10px] text-slate-400 italic">
                  You're reviewing as a co-resident — this is recorded as peer feedback and sends the item back for
                  revision. Final approval requires a supervisor/consultant role.
                </p>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => handleReviewAction('revisions_requested')}
                  disabled={isSubmitting}
                  className="flex-1 inline-flex items-center justify-center space-x-1.5 py-2.5 border border-rose-200 text-rose-700 hover:bg-rose-50 font-bold rounded-xl text-xs transition cursor-pointer"
                >
                  <XCircle size={14} />
                  <span>Request Revisions</span>
                </button>
                {canApprove && (
                  <button
                    onClick={() => handleReviewAction('approved')}
                    disabled={isSubmitting}
                    className="flex-1 inline-flex items-center justify-center space-x-1.5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-400 text-white font-bold rounded-xl text-xs shadow-sm transition cursor-pointer"
                  >
                    <CheckCircle2 size={14} />
                    <span>Approve</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
