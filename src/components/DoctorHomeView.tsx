import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Hourglass, LogOut, FlaskConical, Stethoscope, ChevronRight } from 'lucide-react';

interface DoctorHomeViewProps {
  doctor: { id: string; email: string; fullName: string };
  onLogout: () => void;
}

// Shown when a doctor is authenticated but not yet linked to any workforce
// row — see supabase/migrations/18_individual_doctor_identity.sql. Until
// migration 25 this was a bare waiting-room screen with zero features
// (per the review annotation it was built from: "only if a chief has added
// you to an organization will you have organizational features"). Migration
// 25 gives an unaffiliated doctor two personal, non-institutional tools
// instead — see ResearchWorkspaceView/CasebookWorkspaceView's owner.kind
// gating for exactly what's available (no AI Copilot, no tenant/logbook
// features) vs. what's still Chief-link-only.
export const DoctorHomeView: React.FC<DoctorHomeViewProps> = ({ doctor, onLogout }) => {
  const navigate = useNavigate();
  return (
    <div className="max-w-md mx-auto my-12 px-4">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
        <div className="bg-gradient-to-br from-blue-600 to-blue-700 p-6 text-white text-center">
          <div className="mx-auto bg-white/15 text-white w-12 h-12 rounded-xl flex items-center justify-center mb-3 shadow-inner">
            <Hourglass size={20} />
          </div>
          <h2 className="text-xl font-bold tracking-tight">Welcome, {doctor.fullName || doctor.email}</h2>
          <p className="text-xs text-blue-100/90 mt-1 font-medium">Your account is not yet linked to an organization</p>
        </div>

        <div className="p-6 sm:p-8 space-y-4">
          <div className="space-y-4 text-sm text-slate-600 leading-relaxed">
            <p>
              You're registered as an independent doctor. Ask your Chief Resident / Administrator to add you
              to their organization's workforce roster using this email:
            </p>
            <p className="font-mono font-bold text-slate-800 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-center break-all">
              {doctor.email}
            </p>
            <p className="text-xs text-slate-400">
              Once they link your account, this page will be replaced by your full resident dashboard automatically the
              next time you sign in.
            </p>
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-100">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">In the meantime</p>
            <button
              type="button"
              onClick={() => navigate('/doctor/research')}
              className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-left transition cursor-pointer"
            >
              <span className="flex items-center space-x-3">
                <FlaskConical size={16} className="text-blue-600 shrink-0" />
                <span>
                  <span className="block text-sm font-bold text-slate-800">Personal Research Workspace</span>
                  <span className="block text-[11px] text-slate-500 mt-0.5">PICO framework, chapters, rubric scorecard</span>
                </span>
              </span>
              <ChevronRight size={16} className="text-slate-400 shrink-0" />
            </button>
            <button
              type="button"
              onClick={() => navigate('/doctor/casebook-logbook')}
              className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-left transition cursor-pointer"
            >
              <span className="flex items-center space-x-3">
                <Stethoscope size={16} className="text-blue-600 shrink-0" />
                <span>
                  <span className="block text-sm font-bold text-slate-800">Personal Casebook</span>
                  <span className="block text-[11px] text-slate-500 mt-0.5">WACP/NPMCN case write-ups, family tools</span>
                </span>
              </span>
              <ChevronRight size={16} className="text-slate-400 shrink-0" />
            </button>
            <p className="text-[10px] text-slate-400 leading-relaxed">
              AI Copilot and logbook tracking aren't available on personal workspaces yet — those unlock once a
              Chief links your account to an organization.
            </p>
          </div>
        </div>

        <div className="bg-slate-50 border-t border-slate-100 p-4 text-center">
          <button
            type="button"
            onClick={onLogout}
            className="inline-flex items-center space-x-1.5 text-xs font-bold text-slate-500 hover:text-slate-800 hover:underline cursor-pointer"
          >
            <LogOut size={13} />
            <span>Log Out</span>
          </button>
        </div>
      </div>
    </div>
  );
};
