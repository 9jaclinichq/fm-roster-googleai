import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Stethoscope, ChevronRight } from 'lucide-react';
import { getActiveBrand } from '../config/branding';

// Landing chooser between the two, independent identity tracks this app
// supports — see supabase/migrations/18_individual_doctor_identity.sql:
//   - Institutional: existing plaintext-code Resident/Chief flow, unchanged.
//   - Individual doctor: new self-service email+password flow.
// The B2C/B2B domain only pre-highlights a default; both paths are always
// manually reachable — domain is a cosmetic hint, never an auth boundary
// (see src/config/branding.ts's own header comment).
export const AuthLandingView: React.FC = () => {
  const navigate = useNavigate();
  const brand = getActiveBrand();
  const individualIsDefault = brand.key === 'b2c_independent';

  return (
    <div className="max-w-md mx-auto my-12 px-4">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
        <div className="bg-gradient-to-br from-blue-600 to-blue-700 p-6 text-white text-center">
          <h2 className="text-xl font-bold tracking-tight">Welcome to {brand.shortName}</h2>
          <p className="text-xs text-blue-100/90 mt-1 font-medium">
            How are you using {brand.shortName}?
          </p>
        </div>

        <div className="p-6 sm:p-8 space-y-4">
          <button
            type="button"
            onClick={() => navigate('/workspace/login')}
            className={`w-full flex items-center justify-between px-5 py-4 rounded-xl border text-left transition cursor-pointer ${
              !individualIsDefault
                ? 'border-blue-500 bg-blue-50/60 ring-1 ring-blue-100'
                : 'border-slate-200 hover:bg-slate-50'
            }`}
          >
            <span className="flex items-center space-x-3">
              <Building2 size={18} className="text-blue-600 shrink-0" />
              <span>
                <span className="block text-sm font-bold text-slate-800">My organization has an access code</span>
                <span className="block text-[11px] text-slate-500 mt-0.5">Resident or Chief Resident login</span>
              </span>
            </span>
            <ChevronRight size={16} className="text-slate-400 shrink-0" />
          </button>

          <button
            type="button"
            onClick={() => navigate('/doctor/login')}
            className={`w-full flex items-center justify-between px-5 py-4 rounded-xl border text-left transition cursor-pointer ${
              individualIsDefault
                ? 'border-blue-500 bg-blue-50/60 ring-1 ring-blue-100'
                : 'border-slate-200 hover:bg-slate-50'
            }`}
          >
            <span className="flex items-center space-x-3">
              <Stethoscope size={18} className="text-blue-600 shrink-0" />
              <span>
                <span className="block text-sm font-bold text-slate-800">I'm an independent doctor</span>
                <span className="block text-[11px] text-slate-500 mt-0.5">Sign in or register with email</span>
              </span>
            </span>
            <ChevronRight size={16} className="text-slate-400 shrink-0" />
          </button>
        </div>
      </div>
    </div>
  );
};
