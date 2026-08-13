import React from 'react';
import { Hourglass, LogOut } from 'lucide-react';

interface DoctorHomeViewProps {
  doctor: { email: string; fullName: string };
  onLogout: () => void;
}

// Shown only when a doctor is authenticated but not yet linked to any
// workforce row — see supabase/migrations/18_individual_doctor_identity.sql.
// Deliberately minimal: no organizational features render here until a
// Chief links this account (WorkforceMember.doctor_id), per the review
// annotation this feature was built from ("only if a chief has added you to
// an organization will you have organizational features on your dashboard").
export const DoctorHomeView: React.FC<DoctorHomeViewProps> = ({ doctor, onLogout }) => {
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

        <div className="p-6 sm:p-8 space-y-4 text-sm text-slate-600 leading-relaxed">
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
