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
    if (path.startsWith('/resident/announcements')) return 'resident-announcements';
    if (path.startsWith('/resident/dissertation')) return 'resident-dissertation';
    if (path.startsWith('/resident/casebook')) return 'resident-casebook';
    if (path.startsWith('/resident/library')) return 'resident-library';
    if (path.startsWith('/resident/exam-readiness')) return 'resident-exam-readiness';
    if (path.startsWith('/resident/viva-simulator')) return 'resident-viva-simulator';
    if (path.startsWith('/resident/consultant-review')) return 'resident-consultant-review';
    if (path.startsWith('/resident/research')) return 'resident-research';
    if (path.startsWith('/resident/casebook-logbook')) return 'resident-casebook-logbook';
    if (path.startsWith('/resident-form')) return 'resident';
    return 'resident-login';
  };

  const handleResidentLogin = (resident: { id: string; name: string; category: string }) => {
    const session: ResidentSession = { ...resident, subadminRoles: [] };
    setCurrentResident(session);
    localStorage.setItem('fm_session_resident', JSON.stringify(session));
    navigate('/resident-form');
    // Clear preset
    setPresetResident(null);
    refreshSubadminRoles(session);
  };

  const handleResidentLogout = () => {
    setCurrentResident(null);
    localStorage.removeItem('fm_session_resident');
    navigate('/resident/login');
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
    navigate('/resident/login');
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
        onNavigateToResident={() => navigate('/resident/login')}
        onNavigateToResidentForm={() => navigate('/resident-form')}
        onNavigateToAnnouncements={() => navigate('/resident/announcements')}
        onNavigateToDissertation={() => navigate('/resident/dissertation')}
        onNavigateToCasebook={() => navigate('/resident/casebook')}
        onNavigateToLibrary={() => navigate('/resident/library')}
        onNavigateToExamReadiness={() => navigate('/resident/exam-readiness')}
        onNavigateToVivaSimulator={() => navigate('/resident/viva-simulator')}
        onNavigateToConsultantReview={() => navigate('/resident/consultant-review')}
        onNavigateToResearch={() => navigate('/resident/research')}
        onNavigateToCasebookLogbook={() => navigate('/resident/casebook-logbook')}
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
                ? <Navigate to="/resident-form" replace /> 
                : <Navigate to="/resident/login" replace />
            } 
          />

          {/* Resident Login */}
          <Route
            path="/resident/login"
            element={
              currentResident ? (
                <Navigate to="/resident-form" replace />
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
            path="/resident-form"
            element={
              currentResident ? (
                <ResidentFormView
                  resident={currentResident}
                  onLogout={handleResidentLogout}
                />
              ) : (
                <Navigate to="/resident/login" replace />
              )
            }
          />

          {/* Resident Announcement Board */}
          <Route
            path="/resident/announcements"
            element={
              currentResident ? (
                <AnnouncementBoardView resident={currentResident} />
              ) : (
                <Navigate to="/resident/login" replace />
              )
            }
          />

          {/* Dissertation Assistant */}
          <Route
            path="/resident/dissertation"
            element={
              currentResident ? (
                <DissertationAssistantView resident={currentResident} />
              ) : (
                <Navigate to="/resident/login" replace />
              )
            }
          />

          {/* Casebook Builder */}
          <Route
            path="/resident/casebook"
            element={
              currentResident ? (
                <CasebookBuilderView resident={currentResident} />
              ) : (
                <Navigate to="/resident/login" replace />
              )
            }
          />

          {/* Knowledge Library */}
          <Route
            path="/resident/library"
            element={
              currentResident ? (
                <KnowledgeLibraryView />
              ) : (
                <Navigate to="/resident/login" replace />
              )
            }
          />

          {/* Exam Readiness Scorecard */}
          <Route
            path="/resident/exam-readiness"
            element={
              currentResident ? (
                <ExamReadinessView resident={currentResident} />
              ) : (
                <Navigate to="/resident/login" replace />
              )
            }
          />

          {/* Mock Viva Oral Exam Simulator */}
          <Route
            path="/resident/viva-simulator"
            element={
              currentResident ? (
                <OralExamSimulatorView resident={currentResident} />
              ) : (
                <Navigate to="/resident/login" replace />
              )
            }
          />

          {/* Review Workspace — open to every logged-in resident (co-resident
              peer-assist review), with subadmin roles additionally able to
              grant final approval (see ConsultantReviewView's canApprove prop). */}
          <Route
            path="/resident/consultant-review"
            element={
              currentResident ? (
                <ConsultantReviewView reviewer={currentResident} canApprove={currentResident.subadminRoles.length > 0} />
              ) : (
                <Navigate to="/resident/login" replace />
              )
            }
          />

          {/* Universal Research Engine — gated the same as every other
              resident view today (see ResearchWorkspaceView's header note:
              a standalone "independent doctor" identity is schema-ready
              but not built, so this route is resident-session-only for now). */}
          <Route
            path="/resident/research"
            element={
              currentResident ? (
                <ResearchWorkspaceView resident={currentResident} />
              ) : (
                <Navigate to="/resident/login" replace />
              )
            }
          />

          {/* Casebook & Clinical Logbook Engine — sits alongside the
              original Casebook Builder (/resident/casebook, case_reports)
              rather than replacing it; see migration 15's header. The
              Admin Logbook Panel inside this view is conditionally shown
              to residents holding a subadmin role, same gating pattern as
              ConsultantReviewView's canApprove prop. */}
          <Route
            path="/resident/casebook-logbook"
            element={
              currentResident ? (
                <CasebookWorkspaceView resident={currentResident} canManageLogbooks={currentResident.subadminRoles.length > 0} />
              ) : (
                <Navigate to="/resident/login" replace />
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
                  onNavigateToResident={() => navigate('/resident/login')}
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
          <p>&copy; {new Date().getFullYear()} Department of Family Medicine. All rights reserved.</p>
          <p className="mt-1 text-[10px] text-slate-300">FM Residents Dashboard &bull; Production Version 0.1</p>
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
