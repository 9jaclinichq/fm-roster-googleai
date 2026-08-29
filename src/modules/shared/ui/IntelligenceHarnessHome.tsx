import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles, X, FileText, Megaphone, GraduationCap, ClipboardList, Library, Gauge, Mic,
  ShieldCheck, FlaskConical, Stethoscope, IdCard, Clock, CheckCircle2, ChevronRight,
  AlertTriangle, CalendarCheck, Table2, Lock,
} from 'lucide-react';
import { supabase, databaseService, DEFAULT_TENANT_ID } from '../../../lib/databaseService';
import { getActiveInsights, dismissInsight, InsightRow, SUBMISSION_CHASER_AGENT_KEY } from '../lib/submissionChaserAgent';
import { MEETING_ACTION_CHASER_AGENT_KEY } from '../lib/meetingActionAgent';
import { resolveCurrentCollection } from '../lib/submissionStatus';
import { useTerminology } from '../terminology';
import { SubmissionReviewStatus } from '../../../types';
import { ComplianceNudgesView } from '../../org-admin/components/ComplianceNudgesView';
import { myAssignmentService, MyAssignmentResult } from '../../roster-engine/lib/myAssignmentService';
import { rosterSectionPresentationService } from '../../roster-engine/lib/rosterSectionPresentationService';
import { RosterSectionPresentation, GRID_LABEL_TO_SECTION_KEY, resolveRosterSectionPresentation } from '../../roster-engine/lib/rosterSectionPresentation';

// Resident-facing "Intelligence Harness" home — the mobile-first productive
// workspace landing screen this app didn't have before: every existing
// resident route (form, research, casebook, library, ...) previously had no
// single entry point of its own beyond the Navbar's tab strip. Built from a
// set of reference product mockups the user supplied (a marketing concept
// for a Flutter app called "Workspc") — the VISUAL LANGUAGE here is
// deliberately NOT a wholesale reskin of that reference: this app is React +
// Tailwind with its own established light-card design system (see
// UnifiedRecordView.tsx, InsightsStrip.tsx), and CLAUDE.md's own coding
// standard is to match existing component style, not import a different
// product's dark theme wholesale. What IS carried over from the references:
// the STRUCTURE (greeting header, Quick Access module grid, Today's Focus,
// an intelligence/insights feed, a progress snapshot) and the mobile-first
// responsive posture (single column on mobile, multi-column grid from `sm`/
// `md` up).
//
// "Connected to the living intelligence architecture": the insights feed
// below is not decorative — it reads real `insights` rows (migration 37/49)
// written by this app's two live rung-1 agents (submissionChaserAgent.ts,
// meetingActionAgent.ts), filtered to what's relevant to THIS resident
// (their own workforce_id, or a tenant-wide/no-owner finding), with the same
// dismiss affordance InsightsStrip.tsx already established. A resident today
// has no dashboard at all showing agent-raised findings about their own
// work — InsightsStrip only renders on the Chief's dashboard — so this is
// also a real, new surface for the spine, not a duplicate of an existing one.
//
// SCOPE: this IS every resident's default post-login landing now (see
// App.tsx's 7 redirect call sites, all pointed at /workspace/home) — per
// the reviewed "resident home / needs attention" engineering handoff
// (WORKSPC, dated 2026-08-28). /workspace/form remains fully reachable
// (Navbar's "My Form" tab, direct URL, Today's Focus's own CTA below);
// only the default landing changed. This pass also folds in: a compact
// My Assignment summary (Section 4 of the handoff), a compact Needs
// Attention card reusing ComplianceNudgesView with one nudge type
// suppressed to avoid duplicating Today's Focus (Section 3), an insights
// filter clause suppressing the same duplication for Submission Chaser
// insights, two new Quick Access tiles, and a correctness fix to Today's
// Focus's own "currently open collection" resolution (Section 5).

const AGENT_LABELS: Record<string, string> = {
  [SUBMISSION_CHASER_AGENT_KEY]: 'Submission Chaser',
  [MEETING_ACTION_CHASER_AGENT_KEY]: 'Meeting Action Chaser',
};

interface HarnessResident {
  id: string;
  name: string;
  category: string;
  tenant_id?: string;
}

interface IntelligenceHarnessHomeProps {
  resident: HarnessResident;
  // The in-memory-only access PIN captured at fresh login (App.tsx's
  // residentAccessCode) — the exact same value already passed to
  // /workspace/my-assignment and /workspace/full-roster. null on every
  // session restore (page reload / returning later).
  accessCode: string | null;
  // Migration 78: true when a real Supabase Auth session exists (App.tsx's
  // `!!currentDoctor`). When true, the My Assignment card below attempts
  // resident_get_current_assignment() even with accessCode null, since
  // that RPC's own authenticated-membership check now runs before it ever
  // inspects the code — a claimed, actively-linked resident can see their
  // assignment here after a restore without retaining the PIN. When false
  // (legacy-only session), behavior is byte-for-byte unchanged: the static
  // link-out card below, no RPC attempt, no duplicated PIN re-entry flow.
  hasAuthenticatedSession: boolean;
}

interface QuickAccessTile {
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  path: string;
  accent: string; // Tailwind bg/text pair for the icon chip
}

function greetingForNow(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

// A naive `name.split(' ')[0]` breaks when full_name includes an honorific
// prefix (e.g. "Dr. Adebayo" -> "Dr."), a real case in this app's live data
// — the greeting would show "Dr. 👋" with no actual name. Strips common
// honorifics before taking the first remaining word.
const HONORIFIC_PREFIXES = ['dr', 'dr.', 'prof', 'prof.', 'mr', 'mr.', 'mrs', 'mrs.', 'ms', 'ms.'];
function firstNameFor(fullName: string): string {
  const words = fullName.trim().split(/\s+/);
  const firstReal = words.find((w) => !HONORIFIC_PREFIXES.includes(w.toLowerCase()));
  return firstReal || words[0] || fullName;
}

interface TodaysFocusState {
  loading: boolean;
  collectionTitle: string | null;
  deadline: string | null;
  hasSubmitted: boolean;
  pastDeadline: boolean;
  // Migration-free — reads submissions.review_status (already existing
  // column, SubmissionReviewStatus = 'submitted' | 'reviewed') for the
  // resident's own current-collection submission, if any. null whenever
  // hasSubmitted is false (nothing to review yet).
  reviewStatus: SubmissionReviewStatus | null;
}

export const IntelligenceHarnessHome: React.FC<IntelligenceHarnessHomeProps> = ({ resident, accessCode, hasAuthenticatedSession }) => {
  const navigate = useNavigate();
  const { t } = useTerminology();
  const tenantId = resident.tenant_id ?? DEFAULT_TENANT_ID;

  const [insights, setInsights] = useState<InsightRow[]>([]);
  const [dismissingIds, setDismissingIds] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState<TodaysFocusState>({
    loading: true,
    collectionTitle: null,
    deadline: null,
    hasSubmitted: false,
    pastDeadline: false,
    reviewStatus: null,
  });
  const [assignment, setAssignment] = useState<MyAssignmentResult | null>(null);
  const [assignmentPresentation, setAssignmentPresentation] = useState<RosterSectionPresentation[]>([]);
  const [assignmentLoading, setAssignmentLoading] = useState<boolean>(!!accessCode || hasAuthenticatedSession);
  // Migration 78: true only when there is genuinely nothing to attempt
  // with (no code, no authenticated session) OR a real attempt already
  // ran and failed — distinct from "haven't tried yet", so the initial
  // render never briefly flashes "Roster not yet published" before the
  // authenticated-membership attempt below has even started.
  const [assignmentUnavailable, setAssignmentUnavailable] = useState<boolean>(!accessCode && !hasAuthenticatedSession);

  useEffect(() => {
    let cancelled = false;

    // Insights: read-only here, deliberately NOT re-running either agent —
    // InsightsStrip.tsx (mounted on the Chief's dashboard) already owns
    // triggering both runs; a resident's own home screen just needs to
    // display whatever the spine has already raised, scoped to what's
    // relevant to this resident specifically.
    (async () => {
      if (!supabase) return;
      try {
        const active = await getActiveInsights(supabase, tenantId);
        if (!cancelled) {
          // Submission Chaser insights are excluded here — Today's Focus
          // (below) already surfaces this exact same fact directly and
          // more prominently; showing both would be the duplication this
          // slice is meant to remove (see Section 3 of the reviewed
          // handoff). Meeting Action Chaser and any other agent's
          // insights are unaffected.
          setInsights(active.filter((i) =>
            (i.workforce_id === resident.id || i.workforce_id === null)
            && i.agent_key !== SUBMISSION_CHASER_AGENT_KEY
          ));
        }
      } catch (err) {
        console.warn('IntelligenceHarnessHome: getActiveInsights failed (non-fatal)', err);
      }
    })();

    // Today's Focus: the tenant's CANONICAL currently-open collection
    // (settings.current_collection_id, matched via resolveCurrentCollection
    // — the same locked rule ComplianceNudgesView already uses) + whether
    // this resident has already submitted into it. Correctness fix: this
    // previously used an ad-hoc `collections.find(c => c.status === 'open')`
    // check, which disagreed with the canonical rule whenever an open
    // collection existed that was NOT the tenant's current_collection_id
    // pointer — see Section 5 of the reviewed handoff.
    (async () => {
      try {
        const [settings, collections] = await Promise.all([
          databaseService.getSettings(tenantId),
          databaseService.getCollections(tenantId),
        ]);
        const current = resolveCurrentCollection({
          tenantId,
          currentCollectionId: settings.current_collection_id,
          collections,
        });
        if (!current) {
          if (!cancelled) setFocus({ loading: false, collectionTitle: null, deadline: null, hasSubmitted: false, pastDeadline: false, reviewStatus: null });
          return;
        }
        const submission = await databaseService.getSubmissionForWorkforceAndCollection(resident.id, current.id);
        if (!cancelled) {
          setFocus({
            loading: false,
            collectionTitle: current.title,
            deadline: current.deadline,
            hasSubmitted: !!submission,
            pastDeadline: new Date(current.deadline).getTime() < Date.now(),
            reviewStatus: submission?.review_status ?? null,
          });
        }
      } catch (err) {
        console.warn('IntelligenceHarnessHome: Today\'s Focus load failed (non-fatal)', err);
        if (!cancelled) setFocus((prev) => ({ ...prev, loading: false }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tenantId, resident.id]);

  // My Assignment compact summary. Migration 78: calls the RPC whenever
  // either a fresh-login accessCode is present OR a real Supabase Auth
  // session exists (hasAuthenticatedSession) — the RPC's own
  // authenticated-membership-first check runs before it ever inspects a
  // null code, so a claimed, actively-linked resident can see this card
  // populate after a restore without retaining the PIN. A legacy-only
  // session (neither present) never fires this at all, and the render
  // below shows the static link-out card instead, never a second PIN
  // re-entry form (that already lives on /workspace/my-assignment).
  useEffect(() => {
    let cancelled = false;
    if (!accessCode && !hasAuthenticatedSession) {
      setAssignmentLoading(false);
      setAssignmentUnavailable(true);
      return;
    }
    setAssignmentLoading(true);
    setAssignmentUnavailable(false);
    (async () => {
      try {
        const res = await myAssignmentService.getCurrentAssignment(resident.id, accessCode);
        if (!cancelled) setAssignment(res);
        // roster-section presentation (migration 74) is out of scope for
        // migration 78 and still requires a real code — skipped here when
        // accessCode is null (an authenticated-membership-only load keeps
        // today's existing fallback display labels instead).
        if (accessCode) {
          rosterSectionPresentationService.getResidentPresentation(resident.id, accessCode)
            .then((p) => { if (!cancelled) setAssignmentPresentation(p); })
            .catch((err) => console.warn('IntelligenceHarnessHome: roster section presentation load failed (using fallback labels)', err));
        }
      } catch (err) {
        console.warn('IntelligenceHarnessHome: My Assignment summary load failed (non-fatal)', err);
        if (!cancelled) setAssignmentUnavailable(true);
      } finally {
        if (!cancelled) setAssignmentLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessCode, hasAuthenticatedSession, resident.id]);

  const handleDismiss = async (id: string) => {
    if (!supabase) return;
    setDismissingIds((prev) => new Set(prev).add(id));
    try {
      await dismissInsight(supabase, id);
      setInsights((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      console.warn('IntelligenceHarnessHome: dismissInsight failed', err);
      setDismissingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const quickAccess: QuickAccessTile[] = [
    { label: t('form_label', 'My Form'), icon: FileText, path: '/workspace/form', accent: 'bg-blue-50 text-blue-600 border-blue-100' },
    { label: 'Announcements', icon: Megaphone, path: '/workspace/announcements', accent: 'bg-amber-50 text-amber-600 border-amber-100' },
    { label: 'Research Engine', icon: FlaskConical, path: '/workspace/research', accent: 'bg-violet-50 text-violet-600 border-violet-100' },
    { label: 'Casebook & Logbook', icon: Stethoscope, path: '/workspace/casebook-logbook', accent: 'bg-emerald-50 text-emerald-600 border-emerald-100' },
    { label: 'Dissertation', icon: GraduationCap, path: '/workspace/dissertation', accent: 'bg-indigo-50 text-indigo-600 border-indigo-100' },
    { label: 'Casebook Builder', icon: ClipboardList, path: '/workspace/casebook', accent: 'bg-rose-50 text-rose-600 border-rose-100' },
    { label: 'Library', icon: Library, path: '/workspace/library', accent: 'bg-cyan-50 text-cyan-600 border-cyan-100' },
    { label: 'Exam Readiness', icon: Gauge, path: '/workspace/exam-readiness', accent: 'bg-orange-50 text-orange-600 border-orange-100' },
    { label: 'Viva Simulator', icon: Mic, path: '/workspace/viva-simulator', accent: 'bg-fuchsia-50 text-fuchsia-600 border-fuchsia-100' },
    { label: 'Review Workspace', icon: ShieldCheck, path: '/workspace/consultant-review', accent: 'bg-teal-50 text-teal-600 border-teal-100' },
    { label: 'My Record', icon: IdCard, path: '/workspace/my-record', accent: 'bg-slate-100 text-slate-600 border-slate-200' },
    { label: 'My Assignment', icon: CalendarCheck, path: '/workspace/my-assignment', accent: 'bg-sky-50 text-sky-600 border-sky-100' },
    { label: 'Full Roster', icon: Table2, path: '/workspace/full-roster', accent: 'bg-lime-50 text-lime-700 border-lime-100' },
  ];

  return (
    <div className="max-w-5xl mx-auto my-6 px-4 space-y-5">
      {/* Greeting header */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{greetingForNow()}</p>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight mt-0.5">{firstNameFor(resident.name)} 👋</h1>
        <p className="text-xs text-slate-500 mt-1">{resident.category} &bull; {t('member', 'Resident')}</p>
      </div>

      {/* Quick Access — mobile-first: 2 cols by default, scaling up with
          viewport width. horizontal-scroll on very small screens is avoided
          in favor of wrapping, so nothing sits off-screen with no scroll
          affordance shown. */}
      <div>
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 px-1">Quick Access</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {quickAccess.map(({ label, icon: Icon, path, accent }) => (
            <button
              key={path}
              type="button"
              onClick={() => navigate(path)}
              className="bg-white border border-slate-200 hover:border-slate-300 rounded-2xl p-4 text-left shadow-sm transition flex flex-col gap-2 cursor-pointer"
            >
              <div className={`h-9 w-9 rounded-xl border flex items-center justify-center ${accent}`}>
                <Icon size={17} />
              </div>
              <span className="text-xs font-semibold text-slate-800 leading-tight">{label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Today's Focus */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center space-x-2 mb-3">
            <Clock size={16} className="text-slate-500" />
            <h3 className="font-bold text-slate-900 text-sm">Today&apos;s Focus</h3>
          </div>
          {focus.loading ? (
            <p className="text-sm text-slate-400">Loading&hellip;</p>
          ) : !focus.collectionTitle ? (
            <p className="text-sm text-slate-500">No collection cycle is currently open.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-800">{focus.collectionTitle}</p>
              <p className="text-xs text-slate-500">
                Deadline: {new Date(focus.deadline as string).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
              {focus.hasSubmitted ? (
                focus.reviewStatus === 'reviewed' ? (
                  // Distinct from plain "Submitted" — real, current data
                  // (submissions.review_status), not a fabricated combined
                  // "reviewed and needs attention" state (see Section 5 of
                  // the reviewed handoff: that combined state does not
                  // exist today and is not invented here).
                  <div className="flex items-center space-x-1.5 text-indigo-600 text-xs font-semibold">
                    <CheckCircle2 size={14} />
                    <span>Reviewed</span>
                  </div>
                ) : (
                  <div className="flex items-center space-x-1.5 text-emerald-600 text-xs font-semibold">
                    <CheckCircle2 size={14} />
                    <span>Submitted</span>
                  </div>
                )
              ) : (
                <button
                  type="button"
                  onClick={() => navigate('/workspace/form')}
                  className={`flex items-center space-x-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition ${
                    focus.pastDeadline
                      ? 'bg-red-50 text-red-600 border border-red-200 hover:bg-red-100'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  <span>{focus.pastDeadline ? 'Overdue — Submit Now' : 'Submit Now'}</span>
                  <ChevronRight size={13} />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Insights — the real spine feed, not a mock. */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center space-x-2 mb-3">
            <Sparkles size={16} className="text-amber-600" />
            <h3 className="font-bold text-slate-900 text-sm">Insights</h3>
          </div>
          {insights.length === 0 ? (
            <p className="text-sm text-slate-500">No open insights right now.</p>
          ) : (
            <div className="space-y-2">
              {insights.map((insight) => (
                <div key={insight.id} className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-slate-800 leading-snug">{insight.text}</p>
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mt-1">
                      {AGENT_LABELS[insight.agent_key] ?? insight.agent_key}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDismiss(insight.id)}
                    disabled={dismissingIds.has(insight.id)}
                    className="flex-shrink-0 p-1 rounded border border-slate-200 text-slate-400 hover:text-slate-800 hover:bg-white transition disabled:opacity-50"
                    title="Dismiss"
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* My Assignment (compact) — reuses myAssignmentService/
            rosterSectionPresentation directly (no new service). Never
            duplicates MyAssignmentView's own PIN re-entry form: when
            neither accessCode nor an authenticated-membership match is
            available, this renders a static link-out only and never
            attempts the RPC (migration 78: it DOES attempt the RPC with a
            null code whenever hasAuthenticatedSession is true, even with
            accessCode null — see assignmentUnavailable above). */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center space-x-2 mb-3">
            <CalendarCheck size={16} className="text-slate-500" />
            <h3 className="font-bold text-slate-900 text-sm">My Assignment</h3>
          </div>
          {assignmentUnavailable ? (
            <div className="flex items-center space-x-2 text-slate-500 text-xs">
              <Lock size={14} className="shrink-0" />
              <span>View your current duty assignment</span>
            </div>
          ) : assignmentLoading ? (
            <p className="text-sm text-slate-400">Loading&hellip;</p>
          ) : !assignment || assignment.status === 'not_published' ? (
            <p className="text-sm text-slate-500">Roster not yet published.</p>
          ) : assignment.status === 'published_no_assignment' ? (
            <p className="text-sm text-slate-500">No assignment for you this period.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">This period&apos;s assignment(s)</p>
              {/* No "today vs. next" split — date_or_day is opaque,
                  organization-supplied text (sometimes a range, sometimes
                  null); see Section 4 of the reviewed handoff for why
                  inventing that logic is explicitly out of scope here. */}
              {assignment.assignments.slice(0, 2).map((a, i) => (
                <div key={i} className="border border-slate-100 rounded-xl px-3 py-2">
                  <div className="flex items-center justify-between mb-0.5">
                    {a.date_or_day && (
                      <span className="text-xs font-medium text-slate-500">{a.date_or_day}</span>
                    )}
                    <span className="text-[10px] font-medium text-slate-400">
                      {(() => {
                        const sectionKey = GRID_LABEL_TO_SECTION_KEY[a.grid_label];
                        return sectionKey ? resolveRosterSectionPresentation(sectionKey, assignmentPresentation).display_label : a.grid_label;
                      })()}
                    </span>
                  </div>
                  {a.assignment_detail && (
                    <p className="text-sm font-semibold text-slate-800">{a.assignment_detail}</p>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-4 mt-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => navigate('/workspace/my-assignment')}
              className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-700 cursor-pointer"
            >
              <span>View My Assignment</span>
              <ChevronRight size={12} />
            </button>
            <button
              type="button"
              onClick={() => navigate('/workspace/full-roster')}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-700 cursor-pointer"
            >
              <span>View Full Roster</span>
              <ChevronRight size={11} />
            </button>
          </div>
        </div>

        {/* Needs Attention — ComplianceNudgesView reused in compact mode,
            with roster_pending suppressed (Today's Focus above already
            surfaces that exact fact). Every other nudge type is
            unaffected — this is presentation-only; deriveNudges() and the
            compliance_nudges table are completely unchanged. */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center space-x-2 mb-3">
            <AlertTriangle size={16} className="text-amber-600" />
            <h3 className="font-bold text-slate-900 text-sm">Needs Attention</h3>
          </div>
          <ComplianceNudgesView resident={resident} compact excludeNudgeTypes={['roster_pending']} />
        </div>
      </div>
    </div>
  );
};
