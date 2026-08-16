import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { databaseService } from '../../../lib/databaseService';
import { GuestReviewInvitePublic, DissertationMilestoneWithContext, CaseReportWithWorkforce } from '../../../types';
import { ShieldCheck, RefreshCw, AlertTriangle, Camera, CheckCircle2, XCircle, FileText, Sparkles } from 'lucide-react';
import { useTerminology } from '../../shared/terminology';

// Public route (/guest-review/:token) — NOT gated by any login. Reachable
// by anyone holding the token (an unguessable UUID shared as a link), same
// capability-URL trust model as e.g. a Google Docs share link. See
// migration 11's header for why guest_review_invites has no direct SELECT
// policy: access is only through the RPCs this view calls.
export const GuestReviewView: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const { t } = useTerminology();

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [invite, setInvite] = useState<GuestReviewInvitePublic | null>(null);
  const [milestone, setMilestone] = useState<DissertationMilestoneWithContext | null>(null);
  const [caseReport, setCaseReport] = useState<CaseReportWithWorkforce | null>(null);

  const [guestName, setGuestName] = useState('');
  const [feedback, setFeedback] = useState('');
  const [signatureFile, setSignatureFile] = useState<File | null>(null);
  const [signaturePreview, setSignaturePreview] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitted, setSubmitted] = useState<'approved' | 'revisions_requested' | null>(null);

  useEffect(() => {
    if (!token) { setLoadError('No review link token provided.'); setIsLoading(false); return; }

    (async () => {
      try {
        const inv = await databaseService.getGuestReviewInvite(token);
        if (!inv) { setLoadError('This review link is invalid or has been revoked.'); return; }
        setInvite(inv);
        setGuestName(inv.guest_name || '');

        if (inv.target_type === 'dissertation_milestone') {
          const m = await databaseService.getDissertationMilestoneById(inv.target_id);
          setMilestone(m);
        } else {
          const c = await databaseService.getCaseReportById(inv.target_id);
          setCaseReport(c);
        }
      } catch (err) {
        console.warn(err);
        setLoadError('Failed to load this review link. Please ask for a new one.');
      } finally {
        setIsLoading(false);
      }
    })();
  }, [token]);

  const handleSignatureCapture = (file: File | null) => {
    setSignatureFile(file);
    if (file) {
      const reader = new FileReader();
      reader.onload = () => setSignaturePreview(reader.result as string);
      reader.readAsDataURL(file);
    } else {
      setSignaturePreview(null);
    }
  };

  const handleSubmit = async (status: 'approved' | 'revisions_requested') => {
    if (!token) return;
    setSubmitError('');
    if (!feedback.trim()) {
      setSubmitError('Please leave a short note before submitting.');
      return;
    }
    setIsSubmitting(true);
    try {
      let signatureUrl: string | null = null;
      if (signatureFile) {
        signatureUrl = await databaseService.uploadGuestSignature(signatureFile);
      }
      await databaseService.submitGuestReview(token, status, feedback.trim(), signatureUrl, guestName.trim() || undefined);
      setSubmitted(status);
    } catch (err) {
      console.warn(err);
      setSubmitError(
        err instanceof Error && err.message.includes('final approval')
          ? 'This link can only request revisions, not grant final approval.'
          : 'Failed to submit your review. The link may have already been used or expired.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-lg mx-auto my-16 p-8 text-center">
        <RefreshCw size={28} className="text-slate-400 animate-spin mx-auto mb-3" />
        <p className="text-sm text-slate-500">Loading review link...</p>
      </div>
    );
  }

  if (loadError || !invite) {
    return (
      <div className="max-w-lg mx-auto my-16 px-4">
        <div className="bg-white border border-rose-200 rounded-2xl shadow-sm p-6 text-center space-y-2">
          <AlertTriangle className="text-rose-500 mx-auto" size={28} />
          <p className="text-sm font-semibold text-rose-700">{loadError}</p>
        </div>
      </div>
    );
  }

  if (invite.status !== 'pending') {
    return (
      <div className="max-w-lg mx-auto my-16 px-4">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 text-center space-y-2">
          <CheckCircle2 className="text-slate-400 mx-auto" size={28} />
          <p className="text-sm font-semibold text-slate-600">
            {invite.status === 'completed' ? 'This review has already been submitted.' : 'This review link has been revoked.'}
          </p>
        </div>
      </div>
    );
  }

  // Expiry isn't reflected in `status` (submit_guest_review only checks it
  // at submit time) — without this check, a guest on an expired-but-still-
  // "pending" link would see the full form, write feedback, and only learn
  // it failed after submitting. Catch it upfront instead.
  if (new Date(invite.expires_at) < new Date()) {
    return (
      <div className="max-w-lg mx-auto my-16 px-4">
        <div className="bg-white border border-amber-200 rounded-2xl shadow-sm p-6 text-center space-y-2">
          <AlertTriangle className="text-amber-500 mx-auto" size={28} />
          <p className="text-sm font-semibold text-amber-700">This review link has expired.</p>
          <p className="text-xs text-slate-500">Please ask for a new review link.</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="max-w-lg mx-auto my-16 px-4 space-y-4">
        <div className="bg-white border border-emerald-200 rounded-2xl shadow-sm p-6 text-center space-y-2">
          <CheckCircle2 className="text-emerald-500 mx-auto" size={32} />
          <h2 className="font-bold text-slate-900">Thank you for your review</h2>
          <p className="text-sm text-slate-500">
            Your {submitted === 'approved' ? 'approval' : 'feedback'} has been recorded and the resident will be notified.
          </p>
        </div>
        {/* Soft nudge — never a hard block. Professors/senior reviewers who
            just want to help a colleague shouldn't be forced to sign up. */}
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 text-center space-y-2">
          <Sparkles className="text-slate-400 mx-auto" size={20} />
          <p className="text-sm font-semibold text-slate-700">Want to track your reviews, or explore more?</p>
          <p className="text-xs text-slate-500">
            Guest access only covers this one item. Create a free account to see your review history and other tools.
          </p>
          <Link to="/workspace/login" className="inline-block mt-1 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition">
            Explore the platform
          </Link>
        </div>
      </div>
    );
  }

  const title = invite.target_type === 'dissertation_milestone'
    ? `${milestone?.stage || 'Dissertation Milestone'} — ${milestone?.dissertations?.title || ''}`
    : `Case ${caseReport?.case_number || ''} — ${caseReport?.diagnosis || 'Untitled'}`;
  const residentName = invite.target_type === 'dissertation_milestone'
    ? milestone?.dissertations?.workforce?.full_name
    : caseReport?.workforce?.full_name;
  const documentUrl = invite.target_type === 'dissertation_milestone' ? milestone?.document_url : caseReport?.document_url;

  return (
    <div className="max-w-2xl mx-auto my-8 px-4 space-y-6">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
        <div className="flex items-center space-x-2 mb-1">
          <ShieldCheck className="text-slate-500" size={18} />
          <h2 className="font-bold text-slate-900 text-lg tracking-tight">Guest Review</h2>
        </div>
        <p className="text-xs text-slate-500">
          You've been invited to review this item as a guest — no account needed.
          {invite.invited_as === 'peer_reviewer' && ' This link can only request revisions, not grant final approval.'}
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-3">
        <h3 className="font-bold text-slate-800">{title}</h3>
        <p className="text-xs text-slate-500">{residentName || `Unknown ${t('member', 'resident').toLowerCase()}`}</p>
        {documentUrl ? (
          <a href={documentUrl} target="_blank" rel="noreferrer" className="inline-flex items-center space-x-1.5 text-xs font-semibold text-slate-800 hover:underline bg-slate-50 p-2.5 rounded-lg border border-slate-200 w-max">
            <FileText size={13} className="text-slate-400" />
            <span>Open submitted document</span>
          </a>
        ) : (
          <p className="text-xs text-slate-400 italic">No document has been uploaded for this item.</p>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-4">
        {submitError && (
          <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-3 text-xs flex items-start space-x-1.5">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
            <span>{submitError}</span>
          </div>
        )}

        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-700 uppercase">Your Name (optional)</label>
          <input
            type="text"
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            placeholder="e.g. Dr. Adewale"
            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-700 uppercase">Feedback</label>
          <textarea
            rows={4}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Write your feedback..."
            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-700 uppercase">Signature (optional — photo)</label>
          {signaturePreview ? (
            <div className="flex items-center gap-3">
              <img src={signaturePreview} alt="Signature preview" className="h-16 rounded-lg border border-slate-200 object-contain bg-slate-50" />
              <button onClick={() => handleSignatureCapture(null)} className="text-xs font-semibold text-rose-600 hover:underline cursor-pointer">Remove</button>
            </div>
          ) : (
            <label className="inline-flex items-center space-x-1.5 px-3 py-2 bg-slate-50 hover:bg-slate-100 border border-dashed border-slate-300 rounded-xl text-xs font-semibold text-slate-700 cursor-pointer transition">
              <Camera size={14} className="text-slate-400" />
              <span>Take a photo of your signature</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => handleSignatureCapture(e.target.files?.[0] || null)}
              />
            </label>
          )}
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={() => handleSubmit('revisions_requested')}
            disabled={isSubmitting}
            className="flex-1 inline-flex items-center justify-center space-x-1.5 py-2.5 border border-rose-200 text-rose-700 hover:bg-rose-50 font-bold rounded-xl text-xs transition cursor-pointer"
          >
            <XCircle size={14} />
            <span>Request Revisions</span>
          </button>
          {invite.invited_as === 'consultant' && (
            <button
              onClick={() => handleSubmit('approved')}
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
  );
};
