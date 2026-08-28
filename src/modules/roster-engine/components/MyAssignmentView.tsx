import React, { useEffect, useState, useCallback } from 'react';
import { myAssignmentService, MyAssignmentResult } from '../lib/myAssignmentService';
import { useTerminology } from '../../shared/terminology';
import { CalendarCheck, RefreshCw, Lock, AlertCircle } from 'lucide-react';

interface MyAssignmentViewProps {
  resident: { id: string; name: string; category: string };
  // The in-memory-only access PIN captured at fresh login (App.tsx's
  // residentAccessCode). Deliberately never persisted to localStorage —
  // see App.tsx's own comment on that state variable — so this is null on
  // every session restore (page reload / returning in a later visit), not
  // only occasionally. resident_get_current_assignment() requires
  // (workforce_id, code) on every call, same as every other resident RPC
  // (verify_resident_login, resident_set_email) — there is no session
  // token to substitute for it under the current transitional login
  // model, and inventing one is explicitly out of scope for this slice.
  accessCode: string | null;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const MyAssignmentView: React.FC<MyAssignmentViewProps> = ({ resident, accessCode }) => {
  const { t } = useTerminology();

  // The PIN re-entered here (only when accessCode is null) is held in this
  // component's state alone — never written to localStorage, never lifted
  // into App.tsx's session state, never reused outside this one RPC call.
  // Same non-persistence discipline as App.tsx's own residentAccessCode.
  const [enteredCode, setEnteredCode] = useState<string>('');
  const [activeCode, setActiveCode] = useState<string | null>(accessCode);
  const [result, setResult] = useState<MyAssignmentResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (code: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await myAssignmentService.getCurrentAssignment(resident.id, code);
      setResult(res);
      setActiveCode(code);
    } catch (err) {
      console.warn('Failed to load current assignment:', err);
      setResult(null);
      setError('That access PIN was not accepted. Please check it and try again.');
    } finally {
      setIsLoading(false);
    }
  }, [resident.id]);

  useEffect(() => {
    if (accessCode) {
      load(accessCode);
    }
    // Only run this on the code the session actually carried in at mount —
    // a subsequent manual re-entry below (activeCode) is handled by its
    // own submit handler, not by this effect re-firing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessCode]);

  const handleConfirmCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enteredCode.trim()) return;
    await load(enteredCode.trim());
  };

  // Session genuinely has no PIN in memory (restored session) and none has
  // been confirmed yet this view-visit — ask for it once, here, rather
  // than silently failing or inventing a persistent credential store.
  if (!activeCode && !isLoading) {
    return (
      <div className="max-w-md mx-auto my-8 px-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm text-center">
          <Lock className="mx-auto mb-3 text-slate-400" size={28} />
          <h2 className="font-bold text-slate-900 text-lg tracking-tight mb-1">Confirm Your Access PIN</h2>
          <p className="text-xs sm:text-sm text-slate-500 mb-4">
            To protect other {t('members', 'Residents')}' assignment information, please re-enter
            your access PIN to view your current assignment.
          </p>
          <form onSubmit={handleConfirmCode} className="space-y-3">
            <input
              type="password"
              inputMode="numeric"
              autoFocus
              placeholder="Access PIN"
              value={enteredCode}
              onChange={(e) => setEnteredCode(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
            />
            {error && (
              <p className="text-xs text-rose-600 font-medium flex items-center justify-center gap-1">
                <AlertCircle size={13} /> {error}
              </p>
            )}
            <button
              type="submit"
              disabled={!enteredCode.trim()}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold shadow-sm transition cursor-pointer"
            >
              View My Assignment
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto my-8 px-4 space-y-4">
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center space-x-2 mb-1">
          <CalendarCheck className="text-slate-500" size={18} />
          <h2 className="font-bold text-slate-900 text-lg tracking-tight">My Assignment</h2>
        </div>
        <p className="text-[11px] text-slate-400 font-medium">{resident.name} &middot; {resident.category}</p>
      </div>

      {isLoading ? (
        <div className="text-center py-12 bg-white border border-slate-200 rounded-2xl">
          <RefreshCw size={26} className="text-slate-400 animate-spin mx-auto mb-2" />
          <p className="text-sm text-slate-500">Loading your assignment...</p>
        </div>
      ) : error ? (
        <div className="text-center py-10 bg-white border border-slate-200 rounded-2xl px-4">
          <AlertCircle size={26} className="text-rose-400 mx-auto mb-2" />
          <p className="text-sm text-rose-600 font-medium mb-3">{error}</p>
          <button
            onClick={() => { setActiveCode(null); setEnteredCode(''); setError(null); }}
            className="px-4 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md text-xs font-semibold cursor-pointer"
          >
            Try Again
          </button>
        </div>
      ) : result?.status === 'not_published' ? (
        <div className="text-center py-12 bg-white border border-slate-200 rounded-2xl text-slate-400">
          <CalendarCheck size={28} className="mx-auto mb-2" />
          <p className="text-sm font-medium text-slate-600">Roster not published yet</p>
          <p className="text-xs text-slate-400 mt-1">Check back once the current cycle's roster has been published.</p>
        </div>
      ) : result?.status === 'published_no_assignment' ? (
        <div className="text-center py-12 bg-white border border-slate-200 rounded-2xl text-slate-400">
          <CalendarCheck size={28} className="mx-auto mb-2" />
          <p className="text-sm font-medium text-slate-600">
            {result.month && result.year ? `${MONTH_NAMES[result.month - 1]} ${result.year} roster is published` : 'Roster published'}
          </p>
          <p className="text-xs text-slate-400 mt-1">No assignment was found for you in this cycle.</p>
        </div>
      ) : result?.status === 'published_with_assignment' ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <p className="text-[10px] text-slate-400 uppercase tracking-wider font-bold mb-3">
            {result.month && result.year ? `${MONTH_NAMES[result.month - 1]} ${result.year}` : 'Current Cycle'}
          </p>
          <div className="space-y-2.5">
            {result.assignments.map((a, i) => (
              <div key={i} className="border border-slate-100 rounded-xl px-3.5 py-2.5">
                <div className="flex items-center justify-between mb-1">
                  {/* Migration 72: a Satellite/Special Coverage posting
                      representing a period/range rather than a single date
                      (e.g. a month-long posting) legitimately has
                      date_or_day = null — guarded the same way
                      assignment_detail already is below, so this renders
                      nothing rather than a blank span or fabricated text. */}
                  {a.date_or_day && (
                    <span className="text-xs font-medium text-slate-500">{a.date_or_day}</span>
                  )}
                  <span className="text-[10px] font-medium text-slate-400">{a.grid_label}</span>
                </div>
                {/* assignment_detail (migration 71) is additive — an older
                    RPC response or a genuinely detail-less entry simply
                    omits it, so this renders nothing extra rather than an
                    empty/undefined line. Rendered verbatim: whatever
                    service-point/shift/facility/duty text the
                    organization's own roster data (or the generic "1st On
                    Duty"/"2nd On Duty" duty-position label) contains —
                    never reinterpreted or mapped through any UCH-specific
                    vocabulary here. */}
                {a.assignment_detail && (
                  <p className="text-sm font-semibold text-slate-800">{a.assignment_detail}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};
