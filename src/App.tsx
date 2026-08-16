import { useState, useEffect, lazy, Suspense } from 'react';
import { HashRouter as Router, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Navbar } from './modules/shared/ui/Navbar';
import { UnifiedRecordView } from './modules/shared/ui/UnifiedRecordView';
import { DevHelper } from './modules/shared/ui/DevHelper';
import { LoadingShell } from './modules/shared/ui/LoadingShell';
import { OfflineBanner } from './modules/shared/ui/OfflineBanner';
import { ResidentLoginView } from './modules/auth/components/ResidentLoginView';
import { ResidentFormView } from './modules/form/components/ResidentFormView';
import { AnnouncementBoardView } from './modules/announcements/components/AnnouncementBoardView';
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

function MainAppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const brand = getActiveBrand();

  // Keep the tab title in sync with the active brand profile (B2C
  // independent-doctor vs. B2B institutional — see src/modules/shared/config/branding.ts).
  useEffect(() => {
    document.title = brand.productName;
  }, [brand.productName]);

  // Session State
  const [currentResident, setCurrentResident] = useState<ResidentSession | null>(null);
  const [isChiefAuthenticated, setIsChiefAuthenticated] = useState<boolean>(false);
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
  const activeTenantId =
    currentResident?.tenant_id ||
    (isChiefAuthenticated ? localStorage.getItem('fm_chief_tenant_id') : null) ||
    DEFAULT_TENANT_ID;

  // DevHelper Preset triggers
  const [presetResident, setPresetResident] = useState<WorkforceMember | null>(null);
  const [presetAdminCode, setPresetAdminCode] = useState<string>('');

  // Load session from storage on mount
  useEffect(() => {
    const residentSession = localStorage.getItem('fm_session_resident');
    if (residentSession) {
      const parsed: ResidentSession = JSON.parse(residentSession);
      setCurrentResident(parsed);
      // Re-check roles on every restore (not just at login) so a role the
      // Chief delegates/revokes mid-session takes effect on next refresh.
      refreshSubadminRoles(parsed);
    }

    const chiefSession = localStorage.getItem('fm_session_chief');
    if (chiefSession === 'true') {
      setIsChiefAuthenticated(true);
    }
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
          };
          setCurrentResident(session);
          refreshSubadminRoles(session);
        }

        // Only redirect on an actual fresh login, never on a page-reload
        // restore (which would otherwise clobber a deep-linked resident route).
        if (event === 'SIGNED_IN') {
          navigate(linkedWorkforce ? '/workspace/form' : '/doctor/home');
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
    if (path.startsWith('/workspace/announcements')) return 'resident-announcements';
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

  const handleResidentLogin = (resident: { id: string; name: string; category: string; tenant_id?: string }) => {
    const session: ResidentSession = { ...resident, subadminRoles: [] };
    setCurrentResident(session);
    localStorage.setItem('fm_session_resident', JSON.stringify(session));
    navigate('/workspace/form');
    // Clear preset
    setPresetResident(null);
    refreshSubadminRoles(session);
  };

  const handleResidentLogout = () => {
    setCurrentResident(null);
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
        onNavigateToResidentForm={() => navigate('/workspace/form')}
        onNavigateToAnnouncements={() => navigate('/workspace/announcements')}
        onNavigateToDissertation={() => navigate('/workspace/dissertation')}
        onNavigateToCasebook={() => navigate('/workspace/casebook')}
        onNavigateToLibrary={() => navigate('/workspace/library')}
        onNavigateToExamReadiness={() => navigate('/workspace/exam-readiness')}
        onNavigateToVivaSimulator={() => navigate('/workspace/viva-simulator')}
        onNavigateToConsultantReview={() => navigate('/workspace/consultant-review')}
        onNavigateToResearch={() => navigate('/workspace/research')}
        onNavigateToCasebookLogbook={() => navigate('/workspace/casebook-logbook')}
        onNavigateToMyRecord={() => navigate('/workspace/my-record')}
        currentView={getCurrentViewName()}
      />

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
                <Navigate to="/workspace/form" replace />
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
                <Navigate to="/workspace/form" replace />
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
                  <Navigate to="/workspace/form" replace />
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
              currentResident ? <Navigate to="/workspace/form" replace /> : <TenantSelectorView />
            }
          />

          {/* Resident Login */}
          <Route
            path="/workspace/login"
            element={
              currentResident ? (
                <Navigate to="/workspace/form" replace />
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

          {/* Resident Announcement Board */}
          <Route
            path="/workspace/announcements"
            element={
              currentResident ? (
                <AnnouncementBoardView resident={currentResident} />
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
