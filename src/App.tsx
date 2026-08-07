import { useState, useEffect } from 'react';
import { HashRouter as Router, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { DevHelper } from './components/DevHelper';
import { ResidentLoginView } from './components/ResidentLoginView';
import { ResidentFormView } from './components/ResidentFormView';
import { AnnouncementBoardView } from './components/AnnouncementBoardView';
import { DissertationAssistantView } from './components/DissertationAssistantView';
import { KnowledgeLibraryView } from './components/KnowledgeLibraryView';
import { CasebookBuilderView } from './components/CasebookBuilderView';
import { ExamReadinessView } from './components/ExamReadinessView';
import { OralExamSimulatorView } from './components/OralExamSimulatorView';
import { ChiefLoginView } from './components/ChiefLoginView';
import { ChiefDashboardView } from './components/ChiefDashboardView';
import { WorkforceMember } from './types';

interface ResidentSession {
  id: string;
  name: string;
  category: string;
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
      setCurrentResident(JSON.parse(residentSession));
    }

    const chiefSession = localStorage.getItem('fm_session_chief');
    if (chiefSession === 'true') {
      setIsChiefAuthenticated(true);
    }
  }, []);

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
    if (path.startsWith('/resident-form')) return 'resident';
    return 'resident-login';
  };

  const handleResidentLogin = (resident: ResidentSession) => {
    setCurrentResident(resident);
    localStorage.setItem('fm_session_resident', JSON.stringify(resident));
    navigate('/resident-form');
    // Clear preset
    setPresetResident(null);
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

          {/* Catch-all route */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {/* Humble Footer */}
      <footer className="bg-white border-t border-slate-200 py-6 text-center text-xs text-slate-400 font-medium shrink-0">
        <div className="max-w-7xl mx-auto px-4">
          <p>&copy; {new Date().getFullYear()} Department of Family Medicine. All rights reserved.</p>
          <p className="mt-1 text-[10px] text-slate-300">FM Residents Dashboard &bull; Production Version 0.1</p>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <MainAppContent />
    </Router>
  );
}
