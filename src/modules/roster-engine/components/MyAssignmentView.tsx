import React, { useEffect, useState, useCallback } from 'react';
import { myAssignmentService, MyAssignmentResult } from '../lib/myAssignmentService';
import { rosterSectionPresentationService } from '../lib/rosterSectionPresentationService';
import { RosterSectionPresentation, GRID_LABEL_TO_SECTION_KEY, resolveRosterSectionPresentation } from '../lib/rosterSectionPresentation';
import { useTerminology } from '../../shared/terminology';
import { CalendarCheck, RefreshCw, Lock, AlertCircle } from 'lucide-react';

interface MyAssignmentViewProps {
  resident: { id: string; name: string; category: string };
  // The in-memory-only access PIN captured at fresh login (App.tsx's
  // residentAccessCode). Deliberately never persisted to localStorage —
  // see App.tsx's own comment on that state variable — so this is null on
  // every session restore (page reload / returning in a later visit), not
  // only occasionally.
  accessCode: string | null;
  // Migration 78: true when a real Supabase Auth session exists
  // (App.tsx's `!!currentDoctor`). Never a credential itself — only a
  // signal that it is worth attempting resident_get_current_assignment()
  // with no code at all, since that RPC's own authenticated-membership
  // check now runs before it ever inspects p_code. When false (a
  // legacy-only session), this component's behavior is byte-for-byte what
  // it was before this migration — no auth-first attempt, no added
  // latency, straight to the PIN form when accessCode is null.
  hasAuthenticatedSession: boolean;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const MyAssignmentView: React.FC<MyAssignmentViewProps> = ({ resident, accessCode, hasAuthenticatedSession }) => {
  const { t } = useTerminology();

  // The PIN re-entered here (only when neither accessCode nor an
  // authenticated-membership match is available) is held in this
  // component's state alone — never written to localStorage, never lifted
  // into App.tsx's session state, never reused outside this one RPC call.
  // Same non-persistence discipline as App.tsx's own residentAccessCode.
  const [enteredCode, setEnteredCode] = useState<string>('');
  const [result, setResult] = useState<MyAssignmentResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  // Migration 78: tracks whether at least one load attempt has completed
  // (silent auth-first, accessCode-based, or manual) — used only to decide
  // whether the PIN-entry form should render yet. The actual authorization
  // decision is made entirely server-side; this never gates the RPC call
  // itself, only this component's own "have we tried yet" UI state.
  const [hasAttempted, setHasAttempted] = useState<boolean>(false);
  // Migration 74: tenant-configured section presentation (display label
  // only — never assignment data). Loaded best-effort alongside the
  // assignment itself; if this call fails, resolveRosterSectionPresentation
  // still renders today's current fallback labels, so a presentation-load
  // failure never blocks or breaks the actual assignment view.
  const [presentation, setPresentation] = useState<RosterSectionPresentation[]>([]);

  const load = useCallback(async (code: string | null, options?: { silent?: boolean }) => {
    setIsLoading(true);
    if (!options?.silent) setError(null);
    try {
      const res = await myAssignmentService.getCurrentAssignment(resident.id, code);
      setResult(res);
      // roster-section presentation (migration 74) is explicitly out of
      // scope for migration 78 and still requires a real code — only
      // called here when one exists; a successful auth-first (code=null)
      // load simply keeps today's existing fallback display labels.
      if (code) {
        rosterSectionPresentationService.getResidentPresentation(resident.id, code)
          .then(setPresentation)
          .catch((err) => console.warn('Failed to load roster section presentation (using fallback labels):', err));
      }
    } catch (err) {
      console.warn('Failed to load current assignment:', err);
      setResult(null);
      // A silent auth-first attempt failing is the expected legacy/
      // unclaimed-resident case, not a user mistake — it falls through to
      // the ordinary PIN-entry form below with no error shown. Only a
      // manual PIN submission failure surfaces this message.
      if (!options?.silent) {
        setError('That access PIN was not accepted. Please check it and try again.');
      }
    } finally {
      setIsLoading(false);
      setHasAttempted(true);
    }
  }, [resident.id]);

  useEffect(() => {
    if (accessCode) {
      load(accessCode);
    } else if (hasAuthenticatedSession) {
      // Restored session, no PIN in memory, but a real Supabase Auth
      // session exists — try authenticated-membership-first (migration 78)
      // silently. If this resident hasn't claimed this workforce identity
      // (or has no active membership), the RPC's own legacy path simply
      // rejects the null code, exactly like an unrecognized code today,
      // and this falls through to the PIN form below with no error shown.
      load(null, { silent: true });
    }
    // Only re-run when the session's own carried-in credentials change —
    // a subsequent manual re-entry below is handled by its own submit
    // handler, not by this effect re-firing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessCode, hasAuthenticatedSession]);

  const handleConfirmCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enteredCode.trim()) return;
    await load(enteredCode.trim());
  };

  // Nothing has resolved yet (no result), no load is in flight, and at
  // least one attempt has already run its course (or there was never a
  // session to attempt with) — ask for the PIN once, here, rather than
  // silently failing or inventing a persistent credential store.
  if (!result && !isLoading && (hasAttempted || !hasAuthenticatedSession)) {
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
                  {/* Migration 74: a.grid_label is still the fixed string
                      resident_get_current_assignment() has always
                      returned (that RPC is unchanged) — resolved here to
                      the tenant's configured display label via the
                      section_key bridge, falling back to the raw
                      grid_label verbatim if it's ever unrecognized. */}
                  <span className="text-[10px] font-medium text-slate-400">
                    {(() => {
                      const sectionKey = GRID_LABEL_TO_SECTION_KEY[a.grid_label];
                      return sectionKey ? resolveRosterSectionPresentation(sectionKey, presentation).display_label : a.grid_label;
                    })()}
                  </span>
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
