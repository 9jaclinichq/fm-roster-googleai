import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Stethoscope, ChevronRight } from 'lucide-react';
import { getActiveBrand } from '../../shared/config/branding';

// Landing chooser between the two, independent identity tracks this app
// supports — see supabase/migrations/18_individual_doctor_identity.sql:
//   - Institutional: existing plaintext-code Resident/Chief flow, unchanged.
//   - Individual doctor: new self-service email+password flow.
// Since the doc.*/workspace.* domain split was retired, this is now the
// ONLY place that split is decided — no hostname-based pre-highlighting,
// both paths are presented neutrally (see src/modules/shared/config/branding.ts).
//
// The institutional path now leads to TenantSelectorView (/workspace/select-org)
// first, not straight to ResidentLoginView — "select your institution" before
// name+code entry, per the tenant-first login-order backlog item. The
// individual-doctor path stays a single hop to /doctor/login, and is also
// re-offered at the top level of TenantSelectorView itself.
export const AuthLandingView: React.FC = () => {
  const navigate = useNavigate();
  const brand = getActiveBrand();

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
            onClick={() => navigate('/workspace/select-org')}
            className="w-full flex items-center justify-between px-5 py-4 rounded-xl border border-slate-200 hover:bg-slate-50 text-left transition cursor-pointer"
          >
            <span className="flex items-center space-x-3">
              <Building2 size={18} className="text-blue-600 shrink-0" />
              <span>
                <span className="block text-sm font-bold text-slate-800">My organization has an access code</span>
                {/* Platform-level, pre-tenant wording — deliberately NOT
                    routed through useTerminology()'s t(). Workspc is
                    multidisciplinary; "Resident"/"Chief Resident" are UCH
                    Family Medicine's own tenant terminology, not a
                    universal identity. Once a tenant is selected, that
                    tenant's own terminology continues to apply downstream
                    (ResidentLoginView/ChiefLoginView) — this literal
                    string covers only this pre-tenant entry screen. */}
                <span className="block text-[11px] text-slate-500 mt-0.5">Organisation Member or Organisation Admin login</span>
              </span>
            </span>
            <ChevronRight size={16} className="text-slate-400 shrink-0" />
          </button>

          <button
            type="button"
            onClick={() => navigate('/doctor/login')}
            className="w-full flex items-center justify-between px-5 py-4 rounded-xl border border-slate-200 hover:bg-slate-50 text-left transition cursor-pointer"
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
