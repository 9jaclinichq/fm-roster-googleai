import React from 'react';
import { databaseService } from '../lib/databaseService';
import { Shield, Users, LogOut, Database, Wifi, FileText, Megaphone, GraduationCap, ClipboardList, Library, Gauge, Mic } from 'lucide-react';

interface NavbarProps {
  currentResident: { id: string; name: string; category: string } | null;
  isChiefAuthenticated: boolean;
  onResidentLogout: () => void;
  onChiefLogout: () => void;
  onNavigateToChief: () => void;
  onNavigateToResident: () => void;
  onNavigateToResidentForm: () => void;
  onNavigateToAnnouncements: () => void;
  onNavigateToDissertation: () => void;
  onNavigateToCasebook: () => void;
  onNavigateToLibrary: () => void;
  onNavigateToExamReadiness: () => void;
  onNavigateToVivaSimulator: () => void;
  currentView:
    | 'resident'
    | 'resident-announcements'
    | 'resident-dissertation'
    | 'resident-casebook'
    | 'resident-library'
    | 'resident-exam-readiness'
    | 'resident-viva-simulator'
    | 'chief'
    | 'resident-login'
    | 'chief-login';
}

const RESIDENT_VIEWS = [
  'resident',
  'resident-announcements',
  'resident-dissertation',
  'resident-casebook',
  'resident-library',
  'resident-exam-readiness',
  'resident-viva-simulator',
];

export const Navbar: React.FC<NavbarProps> = ({
  currentResident,
  isChiefAuthenticated,
  onResidentLogout,
  onChiefLogout,
  onNavigateToChief,
  onNavigateToResident,
  onNavigateToResidentForm,
  onNavigateToAnnouncements,
  onNavigateToDissertation,
  onNavigateToCasebook,
  onNavigateToLibrary,
  onNavigateToExamReadiness,
  onNavigateToVivaSimulator,
  currentView
}) => {
  return (
    <header id="app-header" className="bg-white border-b border-slate-200 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16 flex-wrap md:flex-nowrap gap-4 py-2 md:py-0">
          <div className="flex items-center space-x-3 cursor-pointer shrink-0" onClick={onNavigateToResident}>
            <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-base shadow-sm">
              FM
            </div>
            <div>
              <h1 className="font-bold text-slate-900 tracking-tight text-base sm:text-lg leading-tight">Residents <span className="text-blue-600 font-semibold">Dashboard</span></h1>
              <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Department of Family Medicine</p>
            </div>
          </div>

          <div className="flex items-center space-x-2 sm:space-x-4 ml-auto">
            {/* Supabase Status Badge */}
            <div 
              className={`flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-bold border ${
                databaseService.isMock 
                  ? 'bg-amber-50 text-amber-700 border-amber-100' 
                  : 'bg-emerald-50 text-emerald-700 border-emerald-100'
              }`}
              title={databaseService.isMock ? 'Running with browser Local Storage for preview' : 'Connected to live Supabase database'}
            >
              <Database size={12} className={databaseService.isMock ? 'text-amber-500' : 'text-emerald-500'} />
              <span>{databaseService.isMock ? 'PREVIEW ENGINE' : 'LIVE DB'}</span>
            </div>

            {/* View switcher & Session states */}
            {currentResident && (
              <div className="flex items-center space-x-2">
                <div className="hidden md:block text-right">
                  <div className="text-xs font-bold text-slate-800">{currentResident.name}</div>
                  <div className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold">{currentResident.category}</div>
                </div>
                <button
                  onClick={onResidentLogout}
                  className="flex items-center space-x-1.5 px-3 py-1.5 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md text-xs font-semibold shadow-sm transition cursor-pointer"
                >
                  <LogOut size={13} />
                  <span className="hidden sm:inline">Exit Form</span>
                </button>
              </div>
            )}

            {isChiefAuthenticated && currentView.startsWith('chief') && (
              <div className="flex items-center space-x-2">
                <div className="hidden md:block text-right">
                  <div className="text-xs font-bold text-slate-800 font-sans">Chief Resident</div>
                  <div className="text-[9px] text-blue-600 uppercase tracking-wider font-bold">Admin Panel</div>
                </div>
                <button
                  onClick={onChiefLogout}
                  className="flex items-center space-x-1.5 px-3 py-1.5 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md text-xs font-semibold shadow-sm transition cursor-pointer"
                >
                  <LogOut size={13} />
                  <span className="hidden sm:inline">Logout</span>
                </button>
              </div>
            )}

            {!currentResident && (!isChiefAuthenticated || !currentView.startsWith('chief')) && (
              <div className="flex items-center space-x-2">
                {currentView.startsWith('chief') ? (
                  <button
                    onClick={onNavigateToResident}
                    className="flex items-center space-x-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-xs font-semibold shadow-sm transition cursor-pointer"
                  >
                    <Users size={13} />
                    <span>Resident Portal</span>
                  </button>
                ) : (
                  <button
                    onClick={onNavigateToChief}
                    className="flex items-center space-x-1.5 px-3 py-1.5 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md text-xs font-semibold shadow-sm transition cursor-pointer"
                  >
                    <Shield size={13} className="text-slate-500" />
                    <span>Chief Portal</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Resident sub-navigation */}
        {currentResident && RESIDENT_VIEWS.includes(currentView) && (
          <div className="flex items-center space-x-4 border-t border-slate-100 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 overflow-x-auto">
            <button
              onClick={onNavigateToResidentForm}
              className={`flex items-center space-x-1.5 py-2.5 text-xs font-bold border-b-2 transition cursor-pointer whitespace-nowrap ${
                currentView === 'resident'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <FileText size={13} />
              <span>My Form</span>
            </button>
            <button
              onClick={onNavigateToAnnouncements}
              className={`flex items-center space-x-1.5 py-2.5 text-xs font-bold border-b-2 transition cursor-pointer whitespace-nowrap ${
                currentView === 'resident-announcements'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Megaphone size={13} />
              <span>Announcements</span>
            </button>
            <button
              onClick={onNavigateToDissertation}
              className={`flex items-center space-x-1.5 py-2.5 text-xs font-bold border-b-2 transition cursor-pointer whitespace-nowrap ${
                currentView === 'resident-dissertation'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <GraduationCap size={13} />
              <span>Dissertation</span>
            </button>
            <button
              onClick={onNavigateToCasebook}
              className={`flex items-center space-x-1.5 py-2.5 text-xs font-bold border-b-2 transition cursor-pointer whitespace-nowrap ${
                currentView === 'resident-casebook'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <ClipboardList size={13} />
              <span>Casebook</span>
            </button>
            <button
              onClick={onNavigateToLibrary}
              className={`flex items-center space-x-1.5 py-2.5 text-xs font-bold border-b-2 transition cursor-pointer whitespace-nowrap ${
                currentView === 'resident-library'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Library size={13} />
              <span>Library</span>
            </button>
            <button
              onClick={onNavigateToExamReadiness}
              className={`flex items-center space-x-1.5 py-2.5 text-xs font-bold border-b-2 transition cursor-pointer whitespace-nowrap ${
                currentView === 'resident-exam-readiness'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Gauge size={13} />
              <span>Exam Readiness</span>
            </button>
            <button
              onClick={onNavigateToVivaSimulator}
              className={`flex items-center space-x-1.5 py-2.5 text-xs font-bold border-b-2 transition cursor-pointer whitespace-nowrap ${
                currentView === 'resident-viva-simulator'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Mic size={13} />
              <span>Viva Simulator</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
