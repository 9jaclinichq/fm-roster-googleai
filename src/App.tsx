import { useState, useEffect, lazy, Suspense } from 'react';
import { HashRouter as Router, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { DevHelper } from './components/DevHelper';
import { LoadingShell } from './components/LoadingShell';
import { ResidentLoginView } from './components/ResidentLoginView';
import { ResidentFormView } from './components/ResidentFormView';
import { AnnouncementBoardView } from './components/AnnouncementBoardView';
import { databaseService } from './lib/databaseService';
import { TerminologyProvider } from './lib/terminology';
import { getActiveBrand } from './config/branding';
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
  import('./components/ChiefLoginView').then(m => ({ default: m.ChiefLoginView }))
);
const ChiefDashboardView = lazy(() =>
  import('./components/ChiefDashboardView').then(m => ({ default: m.ChiefDashboardView }))
);
const DissertationAssistantView = lazy(() =>
  import('./components/DissertationAssistantView').then(m => ({ default: m.DissertationAssistantView }))
);
const KnowledgeLibraryView = lazy(() =>
  import('./components/KnowledgeLibraryView').then(m => ({ default: m.KnowledgeLibraryView }))
);
const CasebookBuilderView = lazy(() =>
  import('./components/CasebookBuilderView').then(m => ({ default: m.CasebookBuilderView }))
);
const ExamReadinessView = lazy(() =>
  import('./components/ExamReadinessView').then(m => ({ default: m.ExamReadinessView }))
);
const OralExamSimulatorView = lazy(() =>
  import('./components/OralExamSimulatorView').then(m => ({ default: m.OralExamSimulatorView }))
);
const ConsultantReviewView = lazy(() =>
  import('./components/ConsultantReviewView').then(m => ({ default: m.ConsultantReviewView }))
);
const ResearchWorkspaceView = lazy(() =>
  import('./components/ResearchWorkspaceView').then(m => ({ default: m.ResearchWorkspaceView }))
);
const CasebookWorkspaceView = lazy(() =>
  import('./components/CasebookWorkspaceView').then(m => ({ default: m.CasebookWorkspaceView }))
);
// Public routes added by the SaaS multi-tenancy pass — neither is gated by
// resident/chief session state. GuestReviewView is reachable by anyone
// holding a review token (a capability URL); SaaSOperatorConsoleView
// handles its own separate login gate internally (see that file).
const GuestReviewView = lazy(() =>
  import('./components/GuestReviewView').then(m => ({ default: m.GuestReviewView }))
);
const SaaSOperatorConsoleView = lazy(() =>
  import('./components/SaaSOperatorConsoleView').then(m => ({ default: m.SaaSOperatorConsoleView }))
);

const SUBADMIN_ROLE_IDS = ['hod', 'rtc', 'cme_coord', 'consultant', 'super_admin'];

// Silent backward-compatibility redirects for pre-rebrand URLs: any
// bookmarked /resident/* (or /resident-form) path lands on its /workspace/*
// equivalent with the query string preserved. See src/config/branding.ts
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
}

function MainAppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const brand = getActiveBrand();

  // Keep the tab title in sync with the active brand profile (B2C
  // independent-doctor vs. B2B institutional — see src/config/branding.ts).
  useEffect(() => {
    document.title = brand.productName;
  }, [brand.productName]);

  // Session State
  const [currentResident, setCurrentResident] = useState<ResidentSession | null>(null);
  const [isChiefAuthenticated, setIsChiefAuthenticated] = useState<boolean>(false);

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

  const refreshSubadminRoles = async (resident: ResidentSession) => {
    try {
      const roles = await databaseService.getUserRolesForWorkforce(resident.id);
      const subadminRoles = roles.map(r => r.role_id).filter(r => SUBADMIN_ROLE_IDS.includes(r));
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
    if (path.startsWith('/workspace/announcements')) return 'resident-announcements';
    if (path.startsWith('/workspace/dissertation')) return 'resident-dissertation';
    if (path.startsWith('/workspace/casebook')) return 'resident-casebook';
    if (path.startsWith('/workspace/library')) return 'resident-library';
    if (path.startsWith('/workspace/exam-readiness')) return 'resident-exam-readiness';
    if (path.startsWith('/workspace/viva-simulator')) return 'resident-viva-simulator';
    if (path.startsWith('/workspace/consultant-review')) return 'resident-consultant-review';
    if (path.startsWith('/workspace/research')) return 'resident-research';
    if (path.startsWith('/workspace/casebook-logbook')) return 'resident-casebook-logbook';
    if (path.startsWith('/workspace/form')) return 'resident';
    return 'resident-login';
  };

  const handleResidentLogin = (resident: { id: string; name: string; category: string }) => {
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
    navigate('/workspace/login');
  };

  const handleChiefLogin = (adminCode: string) => {
    setIsChiefAuthenticated(true);
    localStorage.setItem('fm_session_chief', 'true');
    // Retained only to authorize the chief_* RPCs (workforce codes, admin
    // code changes) — the server re-verifies it on every privileged call.
    localStorage.setItem('fm_admin_code', adminCode);
    navigate('/chief/dashboard');
    // Clear preset
    setPresetAdminCode('');
  };

  const handleChiefLogout = () => {
    setIsChiefAuthenticated(false);
    localStorage.removeItem('fm_session_chief');
    localStorage.removeItem('fm_admin_code');
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

  return (
    <div id="fm-app" className="min-h-screen flex flex-col bg-slate-50">
      {/* Navigation Header */}
      <Navbar
        currentResident={currentResident}
        isChiefAuthenticated={isChiefAuthenticated}
        onResidentLogout={handleResidentLogout}
        onChiefLogout={handleChiefLogout}
        onNavigateToChief={() => navigate('/chief/login')}
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
              currentResident 
                ? <Navigate to="/workspace/form" replace /> 
                : <Navigate to="/workspace/login" replace />
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
                  onNavigateToChief={() => navigate('/chief/login')}
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

          {/* Universal Research Engine — gated the same as every other
              resident view today (see ResearchWorkspaceView's header note:
              a standalone "independent doctor" identity is schema-ready
              but not built, so this route is resident-session-only for now). */}
          <Route
            path="/workspace/research"
            element={
              currentResident ? (
                <ResearchWorkspaceView resident={currentResident} />
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
                <CasebookWorkspaceView resident={currentResident} canManageLogbooks={currentResident.subadminRoles.length > 0} />
              ) : (
                <Navigate to="/workspace/login" replace />
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

      {/* Humble Footer */}
      <footer className="bg-white border-t border-slate-200 py-6 text-center text-xs text-slate-400 font-medium shrink-0">
        <div className="max-w-7xl mx-auto px-4">
          <p>&copy; {new Date().getFullYear()} {brand.copyrightHolder}. All rights reserved.</p>
          <p className="mt-1 text-[10px] text-slate-300">{brand.productName} &bull; Production Version 0.1</p>
          <p className="mt-2">
            <a href="#/saas-operator" className="text-[10px] text-slate-300 hover:text-slate-500 hover:underline">
              Platform Operator Console
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <TerminologyProvider>
        <MainAppContent />
      </TerminologyProvider>
    </Router>
  );
}
