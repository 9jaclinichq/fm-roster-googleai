import { useState, useEffect, lazy, Suspense } from 'react';
import { HashRouter as Router, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Navbar } from './modules/shared/ui/Navbar';
import { UnifiedRecordView } from './modules/shared/ui/UnifiedRecordView';
import { IntelligenceHarnessHome } from './modules/shared/ui/IntelligenceHarnessHome';
import { DevHelper } from './modules/shared/ui/DevHelper';
import { LoadingShell } from './modules/shared/ui/LoadingShell';
import { OfflineBanner } from './modules/shared/ui/OfflineBanner';
import { ResidentLoginView } from './modules/auth/components/ResidentLoginView';
import { PostLoginEmailPrompt } from './modules/auth/components/PostLoginEmailPrompt';
import { LinkInstitutionalAccessPrompt } from './modules/auth/components/LinkInstitutionalAccessPrompt';
import { ResidentFormView } from './modules/form/components/ResidentFormView';
import { AnnouncementBoardView } from './modules/announcements/components/AnnouncementBoardView';
import { MyAssignmentView } from './modules/roster-engine/components/MyAssignmentView';
import { FullRosterView } from './modules/roster-engine/components/FullRosterView';
import { AuthLandingView } from './modules/auth/components/AuthLandingView';
import { TenantSelectorView } from './modules/auth/components/TenantSelectorView';
import { DoctorAuthView } from './modules/auth/components/DoctorAuthView';
import { DoctorHomeView } from './modules/doctors/components/DoctorHomeView';
import { AdminPortalChooserView } from './modules/auth/components/AdminPortalChooserView';
import { CreateOrganizationView } from './modules/doctors/components/CreateOrganizationView';
import { databaseService, DEFAULT_TENANT_ID } from './lib/databaseService';
import { TerminologyProvider } from './modules/shared/terminology';
import { getActiveBrand, getFooterBrand } from './modules/shared/config/branding';
import { WorkforceMember } from './types';

// Code-split the heavier resident views — each pulls its own weight in
// icons/logic and is only needed once a resident actually navigates to it.
// Named exports need the .then() wrapper since React.lazy expects a
// default export from the dynamic import.
//
// ChiefLoginView/ChiefDashboardView are lazy too, beyond the originally
// requested list — ChiefDashboardView alone is ~1900 lines, and the vast
// majority of sessions are residents who never touch a /chief/* route, so
// this was the single biggest lever toward the stated <150KB target.
const ChiefLoginView = lazy(() =>
  import('./modules/auth/components/ChiefLoginView').then(m => ({ default: m.ChiefLoginView }))
);
const ChiefDashboardView = lazy(() =>
  import('./modules/org-admin/components/ChiefDashboardView').then(m => ({ default: m.ChiefDashboardView }))
);
const DissertationAssistantView = lazy(() =>
  import('./modules/dissertation/components/DissertationAssistantView').then(m => ({ default: m.DissertationAssistantView }))
);
const KnowledgeLibraryView = lazy(() =>
  import('./modules/knowledge-packs/components/KnowledgeLibraryView').then(m => ({ default: m.KnowledgeLibraryView }))
);
const CasebookBuilderView = lazy(() =>
  import('./modules/casebook-logbook/components/CasebookBuilderView').then(m => ({ default: m.CasebookBuilderView }))
);
const ExamReadinessView = lazy(() =>
  import('./modules/exam-readiness/components/ExamReadinessView').then(m => ({ default: m.ExamReadinessView }))
);
const OralExamSimulatorView = lazy(() =>
  import('./modules/viva-simulator/components/OralExamSimulatorView').then(m => ({ default: m.OralExamSimulatorView }))
);
const ConsultantReviewView = lazy(() =>
  import('./modules/consultant-review/components/ConsultantReviewView').then(m => ({ default: m.ConsultantReviewView }))
);
const ResearchWorkspaceView = lazy(() =>
  import('./modules/research/components/ResearchWorkspaceView').then(m => ({ default: m.ResearchWorkspaceView }))
);
const CasebookWorkspaceView = lazy(() =>
  import('./modules/casebook-logbook/components/CasebookWorkspaceView').then(m => ({ default: m.CasebookWorkspaceView }))
);
// Public routes added by the SaaS multi-tenancy pass — neither is gated by
// resident/chief session state. GuestReviewView is reachable by anyone
// holding a review token (a capability URL); SaaSOperatorConsoleView
// handles its own separate login gate internally (see that file).
const GuestReviewView = lazy(() =>
  import('./modules/consultant-review/components/GuestReviewView').then(m => ({ default: m.GuestReviewView }))
);
const SaaSOperatorConsoleView = lazy(() =>
  import('./components/SaaSOperatorConsoleView').then(m => ({ default: m.SaaSOperatorConsoleView }))
);

// Silent backward-compatibility redirects for pre-rebrand URLs: any
// bookmarked /resident/* (or /resident-form) path lands on its /workspace/*
// equivalent with the query string preserved. See src/modules/shared/config/branding.ts
// for the rebrand context.
function LegacyResidentRedirect() {
  const location = useLocation();
  const target =
    location.pathname === '/resident-form'
      ? '/workspace/form'
      : location.pathname.replace(/^\/resident/, '/workspace');
  return <Navigate to={`${target}${location.search}`} replace />;
}

interface ResidentSession {
  id: string;
  name: string;
  category: string;
  // Populated after login (and refreshed on session restore) by checking
  // user_roles — see del_hitl.txt's design note: there is no separate
  // "consultant" login, a subadmin is just a resident whose workforce_id
  // holds one of these roles.
  subadminRoles: string[];
  // Added for billing/workspace-creation tenant correctness — without this,
  // a resident from a non-UCH tenant (self-serve orgs, migration 24) would
  // have their AI subscription and Research/Casebook workspaces silently
  // attributed to UCH via a hardcoded DEFAULT_TENANT_ID fallback. Optional
  // (not present on sessions restored from localStorage written before this
  // field existed) — every consumer falls back to DEFAULT_TENANT_ID.
  tenant_id?: string;
  // Whether workforce.email is currently set (migration 64's
  // verify_resident_login has_email column) — drives the post-login email
  // prompt below. Persisted with the rest of the session so a member who
  // already saved an email is never asked again on restore. Sessions
  // restored from localStorage written before this field existed treat it
  // as falsy (JS default), which only means the prompt may show once more
  // on their next fresh login — never a login block either way.
  hasEmail: boolean;
}

// Individual doctor identity (migration 18) — real Supabase Auth, separate
// from ResidentSession above. A doctor session only unlocks the existing
// resident dashboard once linked to a workforce row (see the effect that
// populates currentResident from it below); until then it just gates
// DoctorHomeView's waiting-room screen.
interface DoctorSession {
  id: string;
  email: string;
  fullName: string;
}

// Lazy useState initializers (found via adversarial QA, 2026-08-17) — read
// synchronously on the FIRST render, before React ever commits anything to
// the DOM. This used to be a useEffect (then briefly a useLayoutEffect)
// that ran AFTER the first render, which left a real window where
// currentResident/isChiefAuthenticated started false/null and every
// resident/chief-gated route committed a <Navigate to="/workspace/login">
// fallback. That fallback's own effect fires even once the "real" session
// value shows up moments later and a corrected re-render occurs — React
// does not reliably cancel a fiber's already-scheduled passive effect just
// because a synchronous layout-effect-triggered re-render replaced it
// before paint, so useLayoutEffect alone did NOT fully close this (verified
// empirically: a distinguishing `state` marker on the fallback's <Navigate>
// showed it firing even when the very same render's currentResident was
// already truthy). Reloading on ANY deep resident-gated route (wellbeing,
// tasks, focus, research, casebook, etc.) silently bounced the user back to
// the default "My Form" page, losing their place — reproduced against both
// the dev server and a real `vite build` production bundle. Reading
// localStorage synchronously in the initializer removes the race entirely:
// the wrong <Navigate> is never created on any render, so there's no effect
// to cancel or race to lose.
function readInitialResidentSession(): ResidentSession | null {
  const raw = localStorage.getItem('fm_session_resident');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ResidentSession;
  } catch (err) {
    // A corrupted/malformed value here (bad manual edit, storage
    // corruption, an old app version's shape) must not white-screen the
    // whole app — fall back to a clean logged-out state instead.
    console.warn('Discarding corrupted fm_session_resident:', err);
    localStorage.removeItem('fm_session_resident');
    return null;
  }
}

function readInitialChiefAuthenticated(): boolean {
  return localStorage.getItem('fm_session_chief') === 'true';
}

function MainAppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const brand = getActiveBrand();

  // Keep the tab title in sync with the active brand profile (B2C
  // independent-doctor vs. B2B institutional — see src/modules/shared/config/branding.ts).
  useEffect(() => {
    document.title = brand.productName;
  }, [brand.productName]);

  // Session State — lazily initialized straight from localStorage (see
  // readInitialResidentSession's own header comment for why this can't be
  // a useEffect/useLayoutEffect).
  const [currentResident, setCurrentResident] = useState<ResidentSession | null>(readInitialResidentSession);
  const [isChiefAuthenticated, setIsChiefAuthenticated] = useState<boolean>(readInitialChiefAuthenticated);
  const [currentDoctor, setCurrentDoctor] = useState<DoctorSession | null>(null);

  // Footer-only brand — reflects who's actually signed in (org vs.
  // personal), not just the domain. See getFooterBrand's doc comment.
  const footerBrand = getFooterBrand({
    hasInstitutionalSession: !!currentResident || isChiefAuthenticated,
    hasIndividualDoctorSession: !!currentDoctor,
  });

  // The tenant whose terminology_overrides should be active for this
  // session — previously TerminologyProvider was mounted once at the App()
  // root with no tenantId, so it was permanently pinned to DEFAULT_TENANT_ID
  // (UCH) regardless of who was actually logged in. Now that per-tenant
  // Chief admin codes and self-serve org creation are real (migrations
  // 23/24), a Chief or resident on a non-UCH tenant would otherwise see
  // UCH's vocabulary instead of their own org's. A doctor session with no
  // linked workforce row has no tenant of its own (individual doctors are
  // tenant-agnostic — see ResidentSession.tenant_id's own comment), so it
  // falls through to the default like every other tenant-less path in
  // this file (e.g. the doctor-owner ResearchWorkspaceView calls below).
  // Pre-login, no session exists yet to read a tenant_id from — but a
  // tenant may already have been picked on TenantSelectorView
  // (/workspace/select-org) just before landing on ResidentLoginView, which
  // carries it forward the same way ResidentLoginView's own
  // `incomingTenantId` does (location.state, falling back to a `?tenant=`
  // query param). Without this, a non-UCH org's login screen would render
  // with UCH's terminology_overrides (e.g. "Resident") instead of that
  // org's own (e.g. "Doctor").
  //
  // Priority-0 Tenant Surface slice P0-2: no DEFAULT_TENANT_ID fallback at
  // the end of this chain anymore — when none of the above resolve to a
  // real tenant (genuinely pre-login, no tenant picked yet), activeTenantId
  // is null and TerminologyProvider renders neutral defaults instead of
  // fetching UCH's terminology_overrides for every anonymous visitor.
  const incomingLoginTenantId =
    (location.state as { tenantId?: string } | null)?.tenantId ||
    new URLSearchParams(location.search).get('tenant') ||
    null;

  const activeTenantId =
    currentResident?.tenant_id ||
    (isChiefAuthenticated ? localStorage.getItem('fm_chief_tenant_id') : null) ||
    incomingLoginTenantId;

  // The resident's access code, held only in this component's in-memory
  // state — never persisted to localStorage, same pattern already used
  // for the platform operator's transitional shared code. Set only on a
  // fresh code-based login (never on session restore, and never for a
  // doctor-linked session, which has no PIN at all), so the post-login
  // email prompt below can call resident_set_email() without asking the
  // member to re-enter their PIN. Its absence (null) is exactly what
  // keeps the prompt from reappearing on every page reload — see
  // PostLoginEmailPrompt's own render guard below.
  const [residentAccessCode, setResidentAccessCode] = useState<string | null>(null);

  // DevHelper Preset triggers
  const [presetResident, setPresetResident] = useState<WorkforceMember | null>(null);
  const [presetAdminCode, setPresetAdminCode] = useState<string>('');

  // currentResident/isChiefAuthenticated are already correctly restored by
  // the lazy useState initializers above — this effect only needs to
  // refresh subadmin roles (a genuinely async fetch that can't happen
  // during the synchronous initializer) on mount, not set the initial
  // session state itself.
  useEffect(() => {
    if (currentResident) {
      // Re-check roles on every restore (not just at login) so a role the
      // Chief delegates/revokes mid-session takes effect on next refresh.
      refreshSubadminRoles(currentResident);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore/track the individual-doctor session (migration 18) — separate
  // from the localStorage-based restore above since Supabase Auth persists
  // its own session token. Fires once on mount with the restored session (if
  // any, event 'INITIAL_SESSION') and again on every subsequent sign-in/out.
  useEffect(() => {
    const unsubscribe = databaseService.onDoctorAuthStateChange(async (event, userId) => {
      if (!userId) {
        setCurrentDoctor(null);
        return;
      }
      try {
        const profile = await databaseService.getDoctorProfile(userId);
        if (!profile) return;
        setCurrentDoctor({ id: profile.id, email: profile.email, fullName: profile.full_name });

        // The convergence point: once this doctor is linked to a workforce
        // row, populate currentResident from it exactly as a code-based
        // login would — every existing resident view/route/nav-tab needs no
        // changes to work for a doctor-linked resident.
        const linkedWorkforce = await databaseService.getLinkedWorkforceForDoctor(profile.id);
        if (linkedWorkforce) {
          const session: ResidentSession = {
            id: linkedWorkforce.id,
            name: linkedWorkforce.full_name,
            category: linkedWorkforce.category,
            subadminRoles: [],
            // This session already has a real, verified email via
            // doctor_profiles (a Supabase Auth account) — never show the
            // workforce.email capture prompt for this path regardless of
            // that column's own state.
            hasEmail: true,
          };
          setCurrentResident(session);
          refreshSubadminRoles(session);
        }

        // Only redirect on an actual fresh login, never on a page-reload
        // restore (which would otherwise clobber a deep-linked resident route).
        if (event === 'SIGNED_IN') {
          navigate(linkedWorkforce ? '/workspace/home' : '/doctor/home');
        }
      } catch (err) {
        console.warn('Failed to resolve doctor session:', err);
      }
    });
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshSubadminRoles = async (resident: ResidentSession) => {
    try {
      const roles = await databaseService.getUserRolesForWorkforce(resident.id);
      // Migration 36: approval authority now comes from the org-defined
      // group's own grants_review_approval flag (or the fixed
      // super_admin platform role), not a hardcoded role_id list.
      const subadminRoles = roles
        .filter(r => r.role_id === 'super_admin' || r.org_group?.grants_review_approval === true)
        .map(r => r.org_group?.label || r.role_id || 'authorized');
      const updated = { ...resident, subadminRoles };
      setCurrentResident(updated);
      localStorage.setItem('fm_session_resident', JSON.stringify(updated));
    } catch (err) {
      console.warn('Failed to refresh subadmin roles:', err);
    }
  };

  // Determine current active view category for navigation rendering
  const getCurrentViewName = () => {
    const path = location.pathname;
    if (path.startsWith('/chief/dashboard')) return 'chief';
    if (path.startsWith('/chief')) return 'chief-login';
    if (path.startsWith('/admin-portal')) return 'chief-login';
    if (path.startsWith('/organization/new')) return 'chief-login';
    if (path.startsWith('/workspace/home')) return 'resident-home';
    if (path.startsWith('/workspace/announcements')) return 'resident-announcements';
    if (path.startsWith('/workspace/my-assignment')) return 'resident-my-assignment';
    if (path.startsWith('/workspace/full-roster')) return 'resident-full-roster';
    if (path.startsWith('/workspace/dissertation')) return 'resident-dissertation';
    if (path.startsWith('/workspace/casebook')) return 'resident-casebook';
    if (path.startsWith('/workspace/library')) return 'resident-library';
    if (path.startsWith('/workspace/exam-readiness')) return 'resident-exam-readiness';
    if (path.startsWith('/workspace/viva-simulator')) return 'resident-viva-simulator';
    if (path.startsWith('/workspace/consultant-review')) return 'resident-consultant-review';
    if (path.startsWith('/workspace/research')) return 'resident-research';
    if (path.startsWith('/workspace/casebook-logbook')) return 'resident-casebook-logbook';
    if (path.startsWith('/workspace/my-record')) return 'resident-my-record';
    if (path.startsWith('/workspace/form')) return 'resident';
    if (path === '/login') return 'auth-landing';
    if (path.startsWith('/doctor/register')) return 'doctor-register';
    if (path.startsWith('/doctor/login')) return 'doctor-login';
    if (path.startsWith('/doctor/home')) return 'doctor-home';
    return 'resident-login';
  };

  const handleResidentLogin = (resident: { id: string; name: string; category: string; tenant_id?: string; hasEmail: boolean; accessCode: string }) => {
    const { accessCode, ...residentFields } = resident;
    const session: ResidentSession = { ...residentFields, subadminRoles: [] };
    setCurrentResident(session);
    localStorage.setItem('fm_session_resident', JSON.stringify(session));
    // In-memory only — see residentAccessCode's own declaration comment.
    // Not included in the object persisted to localStorage above.
    setResidentAccessCode(accessCode);
    navigate('/workspace/home');
    // Clear preset
    setPresetResident(null);
    refreshSubadminRoles(session);
  };

  const handleResidentEmailSaved = () => {
    setCurrentResident(prev => {
      if (!prev) return prev;
      const updated: ResidentSession = { ...prev, hasEmail: true };
      localStorage.setItem('fm_session_resident', JSON.stringify(updated));
      return updated;
    });
  };

  const handleResidentLogout = () => {
    setCurrentResident(null);
    setResidentAccessCode(null);
    localStorage.removeItem('fm_session_resident');
    // No-op if this resident session didn't come from a doctor-link — but if
    // it did, this prevents the still-live Supabase Auth session from
    // silently re-populating currentResident on next reload (see the
    // doctor-auth-state effect above).
    databaseService.logoutDoctor();
    navigate('/workspace/login');
  };

  const handleDoctorLogout = () => {
    setCurrentDoctor(null);
    setCurrentResident(null);
    databaseService.logoutDoctor();
    navigate('/login');
  };

  const handleChiefLogin = (adminCode: string, tenantId: string, _tenantName: string) => {
    setIsChiefAuthenticated(true);
    localStorage.setItem('fm_session_chief', 'true');
    // Retained only to authorize the chief_* RPCs (workforce codes, admin
    // code changes) — the server re-verifies it on every privileged call.
    localStorage.setItem('fm_admin_code', adminCode);
    // Migration 23: settings/admin codes are per-tenant now — resolved once
    // at login and kept alongside the code so tenant-scoped views (e.g.
    // TenantCustomizationView) know which tenant they're operating on.
    localStorage.setItem('fm_chief_tenant_id', tenantId);
    navigate('/chief/dashboard');
    // Clear preset
    setPresetAdminCode('');
  };

  const handleChiefLogout = () => {
    setIsChiefAuthenticated(false);
    localStorage.removeItem('fm_session_chief');
    localStorage.removeItem('fm_admin_code');
    localStorage.removeItem('fm_chief_tenant_id');
    navigate('/chief/login');
  };

  // Dev helper clicks
  const handleSelectResidentFromHelper = (member: WorkforceMember) => {
    setPresetResident(member);
    navigate('/workspace/login');
  };

  const handleSelectAdminFromHelper = (code: string) => {
    setPresetAdminCode(code);
    navigate('/chief/login');
  };

  // Hands the freshly-generated admin code from CreateOrganizationView
  // (migration 24) into ChiefLoginView, same mechanism as the DevHelper
  // preset above.
  const handleOrganizationCreated = (adminCode: string) => {
    setPresetAdminCode(adminCode);
    navigate('/chief/login');
  };

  return (
    <TerminologyProvider tenantId={activeTenantId}>
    <div id="fm-app" className="min-h-screen flex flex-col bg-slate-50">
      {/* Navigation Header */}
      <Navbar
        currentResident={currentResident}
        isChiefAuthenticated={isChiefAuthenticated}
        currentDoctor={currentDoctor}
        onResidentLogout={handleResidentLogout}
        onChiefLogout={handleChiefLogout}
        onDoctorLogout={handleDoctorLogout}
        onNavigateToChief={() => navigate('/admin-portal')}
        onNavigateToResident={() => navigate('/workspace/login')}
        onLogoClick={() => navigate('/')}
        onNavigateToResidentForm={() => navigate('/workspace/form')}
        onNavigateToAnnouncements={() => navigate('/workspace/announcements')}
        onNavigateToMyAssignment={() => navigate('/workspace/my-assignment')}
        onNavigateToFullRoster={() => navigate('/workspace/full-roster')}
        onNavigateToDissertation={() => navigate('/workspace/dissertation')}
        onNavigateToCasebook={() => navigate('/workspace/casebook')}
        onNavigateToLibrary={() => navigate('/workspace/library')}
        onNavigateToExamReadiness={() => navigate('/workspace/exam-readiness')}
        onNavigateToVivaSimulator={() => navigate('/workspace/viva-simulator')}
        onNavigateToConsultantReview={() => navigate('/workspace/consultant-review')}
        onNavigateToResearch={() => navigate('/workspace/research')}
        onNavigateToCasebookLogbook={() => navigate('/workspace/casebook-logbook')}
        onNavigateToMyRecord={() => navigate('/workspace/my-record')}
        onNavigateToHome={() => navigate('/workspace/home')}
        currentView={getCurrentViewName()}
      />

      {/* Post-login email capture — only for a fresh code-based login
          whose workforce.email is still NULL (residentAccessCode is null
          on a restored/reloaded session, so this deliberately does not
          reappear on every page load — only on the member's next actual
          login if they skip it, per the locked V1 decision). Never blocks
          any route below it — a banner, not a gate. */}
      {currentResident && !currentResident.hasEmail && residentAccessCode && (
        <PostLoginEmailPrompt
          workforceId={currentResident.id}
          accessCode={residentAccessCode}
          onSaved={handleResidentEmailSaved}
        />
      )}

      {/* Institutional Identity Slice 2a — "Link institutional access".
          Shown ONLY when a real Supabase Auth session already exists
          (currentDoctor !== null — the only way any session currently
          gets one in this app) AND a resident session is ALSO active —
          exactly the "authenticated Supabase user is also operating in a
          resident context" precondition from the reviewed handoff/
          prompt1.txt, not a new convergence concept. The component itself
          checks whether this specific workforce_id is already linked
          (migration 76's resolver) and renders nothing if so. Never
          blocks any route below it — a banner, not a gate. Does not
          require or store the resident access code anywhere persistent;
          does not affect the legacy resident session on success or
          failure. */}
      {currentDoctor && currentResident && (
        <LinkInstitutionalAccessPrompt
          workforceId={currentResident.id}
          onLinked={() => {}}
        />
      )}

      {/* Dev helper panel — local development builds only. Never rendered
          in a production/preview build, so it can't leak into a deployed site. */}
      {import.meta.env.DEV && (
        <DevHelper
          onSelectResident={handleSelectResidentFromHelper}
          onSelectAdmin={handleSelectAdminFromHelper}
        />
      )}

      {/* Main page canvas */}
      <main className="flex-grow pb-12">
        <Suspense fallback={<LoadingShell />}>
        <Routes>
          {/* Default entry point */}
          <Route
            path="/"
            element={
              currentResident ? (
                <Navigate to="/workspace/home" replace />
              ) : currentDoctor ? (
                <Navigate to="/doctor/home" replace />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />

          {/* Auth landing chooser (institutional vs. individual doctor) */}
          <Route
            path="/login"
            element={
              currentResident ? (
                <Navigate to="/workspace/home" replace />
              ) : currentDoctor ? (
                <Navigate to="/doctor/home" replace />
              ) : (
                <AuthLandingView />
              )
            }
          />

          {/* Individual Doctor Login/Register (migration 18) */}
          <Route
            path="/doctor/login"
            element={
              currentDoctor ? <Navigate to="/doctor/home" replace /> : <DoctorAuthView />
            }
          />
          <Route
            path="/doctor/register"
            element={
              currentDoctor ? <Navigate to="/doctor/home" replace /> : <DoctorAuthView />
            }
          />
          <Route
            path="/doctor/home"
            element={
              currentDoctor ? (
                currentResident ? (
                  <Navigate to="/workspace/home" replace />
                ) : (
                  <DoctorHomeView doctor={currentDoctor} onLogout={handleDoctorLogout} />
                )
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />

          {/* Tenant-first institution selector — the new first step of the
              org-member login path (see AuthLandingView's header comment
              and CLAUDE.md's "Backlog: institution-first / self-serve org
              flow"). Lists active tenants + the individual-doctor path at
              the same top level; picking a tenant carries its id forward
              via route state into /workspace/login below. */}
          <Route
            path="/workspace/select-org"
            element={
              currentResident ? <Navigate to="/workspace/home" replace /> : <TenantSelectorView />
            }
          />

          {/* Resident Login */}
          <Route
            path="/workspace/login"
            element={
              currentResident ? (
                <Navigate to="/workspace/home" replace />
              ) : (
                <ResidentLoginView
                  onLoginSuccess={handleResidentLogin}
                  onNavigateToChief={() => navigate('/admin-portal')}
                  presetResident={presetResident}
                />
              )
            }
          />

          {/* Resident Submission Form */}
          <Route
            path="/workspace/form"
            element={
              currentResident ? (
                <ResidentFormView
                  resident={currentResident}
                  onLogout={handleResidentLogout}
                />
              ) : (
                <Navigate to="/workspace/login" replace />
              )
            }
          />

          {/* Intelligence Harness Home — mobile-first resident dashboard
              landing (see IntelligenceHarnessHome.tsx's own header for the
              full rationale). This is now every resident's default landing
              (all 7 post-login/redirect call sites above point here) —
              /workspace/form remains fully reachable via Navbar's "My Form"
              tab, direct URL, and Home's own Today's Focus CTA; only the
              default landing changed, per the reviewed "resident home /
              needs attention" engineering handoff (WORKSPC, dated
              2026-08-28). accessCode is the same in-memory-only PIN
              already threaded to /workspace/my-assignment and
              /workspace/full-roster below — null on a restored session,
              which IntelligenceHarnessHome's own assignment card handles
              without attempting the RPC or duplicating the PIN re-entry
              flow. */}
          <Route
            path="/workspace/home"
            element={
              currentResident ? (
                <IntelligenceHarnessHome resident={currentResident} accessCode={residentAccessCode} hasAuthenticatedSession={!!currentDoctor} />
              ) : (
                <Navigate to="/workspace/login" replace />
              )
            }
          />

          {/* Resident Announcement Board */}
          <Route
            path="/workspace/announcements"
            element={
              currentResident ? (
                <AnnouncementBoardView resident={currentResident} onViewFullRoster={() => navigate('/workspace/full-roster')} />
              ) : (
                <Navigate to="/workspace/login" replace />
              )
            }
          />

          {/* My Assignment — member-facing view of their own current
              published roster assignment (migration 67's
              resident_get_current_assignment() RPC, migrated by migration
              78 to try authenticated institutional membership before
              falling back to the legacy code). residentAccessCode is the
              in-memory-only PIN from a fresh login (null on session
              restore) — see MyAssignmentView's own header for why it is
              passed through rather than re-derived or persisted.
              hasAuthenticatedSession lets it attempt the RPC with no code
              at all on a restored, previously-claimed session. */}
          <Route
            path="/workspace/my-assignment"
            element={
              currentResident ? (
                <MyAssignmentView resident={currentResident} accessCode={residentAccessCode} hasAuthenticatedSession={!!currentDoctor} />
              ) : (
                <Navigate to="/workspace/login" replace />
              )
            }
          />

          {/* Full Roster — member-facing read-only projection of the ENTIRE
              currently published roster (migration 73's
              resident_get_current_full_roster() RPC, migrated by
              migration 79 to try authenticated institutional membership
              before falling back to the legacy code, same pattern as My
              Assignment). Same residentAccessCode threading, same
              rationale. hasAuthenticatedSession lets it attempt the RPC
              with no code at all on a restored, previously-claimed
              session. */}
          <Route
            path="/workspace/full-roster"
            element={
              currentResident ? (
                <FullRosterView resident={currentResident} accessCode={residentAccessCode} hasAuthenticatedSession={!!currentDoctor} />
              ) : (
                <Navigate to="/workspace/login" replace />
              )
            }
          />

          {/* Dissertation Assistant */}
          <Route
            path="/workspace/dissertation"
            element={
              currentResident ? (
                <DissertationAssistantView resident={currentResident} />
              ) : (
                <Navigate to="/workspace/login" replace />
              )
            }
          />

          {/* Casebook Builder */}
          <Route
            path="/workspace/casebook"
            element={
              currentResident ? (
                <CasebookBuilderView resident={currentResident} />
              ) : (
                <Navigate to="/workspace/login" replace />
              )
            }
          />

          {/* Knowledge Library */}
          <Route
            path="/workspace/library"
            element={
              currentResident ? (
                <KnowledgeLibraryView />
              ) : (
                <Navigate to="/workspace/login" replace />
              )
            }
          />

          {/* Exam Readiness Scorecard */}
          <Route
            path="/workspace/exam-readiness"
            element={
              currentResident ? (
                <ExamReadinessView resident={currentResident} />
              ) : (
                <Navigate to="/workspace/login" replace />
              )
            }
          />

          {/* Mock Viva Oral Exam Simulator */}
          <Route
            path="/workspace/viva-simulator"
            element={
              currentResident ? (
                <OralExamSimulatorView resident={currentResident} />
              ) : (
                <Navigate to="/workspace/login" replace />
              )
            }
          />

          {/* Review Workspace — open to every logged-in resident (co-resident
              peer-assist review), with subadmin roles additionally able to
              grant final approval (see ConsultantReviewView's canApprove prop). */}
          <Route
            path="/workspace/consultant-review"
            element={
              currentResident ? (
                <ConsultantReviewView reviewer={currentResident} canApprove={currentResident.subadminRoles.length > 0} />
              ) : (
                <Navigate to="/workspace/login" replace />
              )
            }
          />

          {/* Universal Research Engine */}
          <Route
            path="/workspace/research"
            element={
              currentResident ? (
                <ResearchWorkspaceView owner={{ id: currentResident.id, name: currentResident.name, kind: 'workforce', tenantId: currentResident.tenant_id ?? DEFAULT_TENANT_ID }} />
              ) : (
                <Navigate to="/workspace/login" replace />
              )
            }
          />

          {/* Casebook & Clinical Logbook Engine — sits alongside the
              original Casebook Builder (/workspace/casebook, case_reports)
              rather than replacing it; see migration 15's header. The
              Admin Logbook Panel inside this view is conditionally shown
              to residents holding a subadmin role, same gating pattern as
              ConsultantReviewView's canApprove prop. */}
          <Route
            path="/workspace/casebook-logbook"
            element={
              currentResident ? (
                <CasebookWorkspaceView
                  owner={{ id: currentResident.id, name: currentResident.name, kind: 'workforce', tenantId: currentResident.tenant_id ?? DEFAULT_TENANT_ID }}
                  canManageLogbooks={currentResident.subadminRoles.length > 0}
                />
              ) : (
                <Navigate to="/workspace/login" replace />
              )
            }
          />

          {/* Unified Doctor Record — first real caller of getUnifiedDoctorRecord()
              (src/modules/shared/lib/udr.ts), see UnifiedRecordView's own header. */}
          <Route
            path="/workspace/my-record"
            element={
              currentResident ? (
                <UnifiedRecordView owner={{ id: currentResident.id, name: currentResident.name, kind: 'workforce', tenantId: currentResident.tenant_id ?? DEFAULT_TENANT_ID }} />
              ) : (
                <Navigate to="/workspace/login" replace />
              )
            }
          />

          {/* Personal Productivity module (migration 51, 2026-08-16) — HIDDEN
              + DORMANT for V1 per the locked product-surface-containment
              decision. Its 4 routes (Focus Mode, Wellbeing, Tasks, Team
              Directory) and their /doctor/* mirrors are deliberately not
              registered here, so any URL under /workspace/focus|wellbeing|
              tasks|team falls through to the catch-all redirect below —
              the exact same "absent from routing entirely" convention
              M16-M18 (scheduling/meetings/clinical-writing) already use.
              The module's source, services, and data are untouched; only
              this entry point's wiring was removed. Reversible by
              restoring the 4 routes, the 4 imports at the top of this
              file, and the corresponding Navbar/IntelligenceHarnessHome/
              DoctorHomeView nav entries from source control history. */}

          {/* Unlinked individual-doctor personal workspaces (migration 25) —
              mirror the /workspace/* routes above but owner.kind: 'doctor'
              and no tenant/AI-Copilot access (see each view's owner.kind
              gating). An already-linked doctor is redirected to the
              institutional route instead, to avoid an ambiguous "which
              workspace am I in" state. */}
          <Route
            path="/doctor/research"
            element={
              currentResident ? (
                <Navigate to="/workspace/research" replace />
              ) : currentDoctor ? (
                <ResearchWorkspaceView owner={{ id: currentDoctor.id, name: currentDoctor.fullName, kind: 'doctor', tenantId: DEFAULT_TENANT_ID }} />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
          <Route
            path="/doctor/casebook-logbook"
            element={
              currentResident ? (
                <Navigate to="/workspace/casebook-logbook" replace />
              ) : currentDoctor ? (
                <CasebookWorkspaceView
                  owner={{ id: currentDoctor.id, name: currentDoctor.fullName, kind: 'doctor', tenantId: DEFAULT_TENANT_ID }}
                  canManageLogbooks={false}
                />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
          <Route
            path="/doctor/my-record"
            element={
              currentResident ? (
                <Navigate to="/workspace/my-record" replace />
              ) : currentDoctor ? (
                <UnifiedRecordView owner={{ id: currentDoctor.id, name: currentDoctor.fullName, kind: 'doctor', tenantId: DEFAULT_TENANT_ID }} />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
          {/* Admin entry chooser (migration 24 review follow-up) — sits in
              front of Chief login so "sign in" and "create a new
              organization" aren't both crammed into ChiefLoginView itself,
              and so the Platform Operator Console stays a separate,
              low-key path rather than merged into this one. */}
          <Route
            path="/admin-portal"
            element={isChiefAuthenticated ? <Navigate to="/chief/dashboard" replace /> : <AdminPortalChooserView />}
          />
          <Route
            path="/organization/new"
            element={
              isChiefAuthenticated ? (
                <Navigate to="/chief/dashboard" replace />
              ) : (
                <CreateOrganizationView onCreated={handleOrganizationCreated} />
              )
            }
          />

          {/* Chief Resident Login */}
          <Route
            path="/chief/login"
            element={
              isChiefAuthenticated ? (
                <Navigate to="/chief/dashboard" replace />
              ) : (
                <ChiefLoginView
                  onLoginSuccess={handleChiefLogin}
                  onNavigateToResident={() => navigate('/workspace/login')}
                  presetCode={presetAdminCode}
                />
              )
            }
          />

          {/* Chief Resident Dashboard */}
          <Route
            path="/chief/dashboard"
            element={
              isChiefAuthenticated ? (
                <ChiefDashboardView onLogout={handleChiefLogout} />
              ) : (
                <Navigate to="/chief/login" replace />
              )
            }
          />

          {/* Legacy pre-rebrand routes — silent redirects to /workspace/* */}
          <Route path="/resident-form" element={<LegacyResidentRedirect />} />
          <Route path="/resident" element={<Navigate to="/workspace/login" replace />} />
          <Route path="/resident/*" element={<LegacyResidentRedirect />} />

          {/* Guest Review — public, no login required (see GuestReviewView) */}
          <Route path="/guest-review/:token" element={<GuestReviewView />} />

          {/* SaaS Platform Operator Console — public route, but the
              component itself gates access behind a separate operator
              shared code (see SaaSOperatorConsoleView) */}
          <Route path="/saas-operator" element={<SaaSOperatorConsoleView />} />
          {/* docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md §7/§11 names this route
              /#admin. Redirect rather than rename outright — /saas-operator
              is the long-established, real route (linked from CLAUDE.md,
              deploy notes, and anyone who already knows the URL per the
              footer comment above); this closes the spec-naming gap without
              risking an existing bookmark/reference breaking. */}
          <Route path="/admin" element={<Navigate to="/saas-operator" replace />} />

          {/* Catch-all route */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </main>

      {/* Humble Footer — brand here is session-aware (org vs. personal),
          not just domain-based like everywhere else; see getFooterBrand's
          doc comment for why. */}
      <footer className="bg-white border-t border-slate-200 py-6 text-center text-xs text-slate-400 font-medium shrink-0">
        <div className="max-w-7xl mx-auto px-4">
          <p>&copy; {new Date().getFullYear()} {footerBrand.copyrightHolder}. All rights reserved.</p>
          <p className="mt-1 text-[10px] text-slate-300">{footerBrand.productName} &bull; Production Version 0.1</p>
          {/* Platform Operator Console link deliberately not advertised here —
              too sensitive to surface to every visitor. The /saas-operator
              route still resolves directly for anyone who already knows the
              URL; only the code itself gates access (see SaaSOperatorConsoleView). */}
        </div>
      </footer>

      {/* Renders regardless of active route/view — see OfflineBanner's own
          header for why this app can only be honest about offline state,
          not offline-functional (docs/PWA_ADDITION_SCOPING.md §2.3). */}
      <OfflineBanner />
    </div>
    </TerminologyProvider>
  );
}

export default function App() {
  return (
    <Router>
      <MainAppContent />
    </Router>
  );
}
