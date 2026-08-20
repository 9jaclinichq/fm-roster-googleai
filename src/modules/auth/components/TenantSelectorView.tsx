import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Stethoscope, ChevronRight, AlertCircle, Loader2 } from 'lucide-react';
import { databaseService } from '../../../lib/databaseService';
import { PublicTenant } from '../../../types';

// Tenant-first login step ("select your institution" before name+code entry
// — see CLAUDE.md's "Backlog: institution-first / self-serve org flow").
// Sits between AuthLandingView's "My organization has an access code"
// choice and ResidentLoginView: lists every active tenant as a selectable
// card, PLUS the individual-doctor path at the SAME top level (not buried
// behind another click) — per the "neutral until known" rule, no specific
// tenant's own branding/org-label renders here, only the literal list of
// tenant names being chosen between. Selecting a tenant carries its id forward via route
// state into ResidentLoginView, which filters its member/name dropdown by
// it (with a safe fallback to the default tenant if state is missing, so
// legacy links straight into /workspace/login keep working).
export const TenantSelectorView: React.FC = () => {
  const navigate = useNavigate();
  const [tenants, setTenants] = useState<PublicTenant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function loadTenants() {
      try {
        // list_public_tenants() (migration 58) already filters to
        // active/discoverable tenants server-side — no client-side status
        // filter needed or possible (status isn't part of this projection).
        const data = await databaseService.listPublicTenants();
        if (!cancelled) setTenants(data);
      } catch (err) {
        console.warn('Error loading organizations:', err);
        if (!cancelled) setError('Failed to fetch the organization list from server.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    loadTenants();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectTenant = (tenant: PublicTenant) => {
    navigate('/workspace/login', { state: { tenantId: tenant.id } });
  };

  return (
    <div className="max-w-md mx-auto my-12 px-4">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
        <div className="bg-gradient-to-br from-blue-600 to-blue-700 p-6 text-white text-center">
          <h2 className="text-xl font-bold tracking-tight">Select Your Organization</h2>
          {/* Platform-level, pre-tenant wording — deliberately NOT routed
              through useTerminology()'s t(): no tenant is selected yet at
              this exact screen, so tenant-specific terminology cannot
              apply here regardless. Once a tenant is chosen, that
              tenant's own terminology continues downstream
              (ResidentLoginView/ChiefLoginView). */}
          <p className="text-xs text-blue-100/90 mt-1 font-medium">
            Which organisation are you a member of?
          </p>
        </div>

        <div className="p-6 sm:p-8 space-y-3">
          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-3.5 flex items-start space-x-2 text-xs sm:text-sm">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-slate-400 text-sm">
              <Loader2 size={18} className="animate-spin mr-2" />
              Loading organizations...
            </div>
          ) : (
            <>
              {tenants.map((tenant) => (
                <button
                  key={tenant.id}
                  type="button"
                  onClick={() => selectTenant(tenant)}
                  className="w-full flex items-center justify-between px-5 py-4 rounded-xl border border-slate-200 hover:bg-slate-50 text-left transition cursor-pointer"
                >
                  <span className="flex items-center space-x-3 min-w-0">
                    <Building2 size={18} className="text-blue-600 shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-sm font-bold text-slate-800 truncate">{tenant.name}</span>
                      {(tenant.institution || tenant.department) && (
                        <span className="block text-[11px] text-slate-500 mt-0.5 truncate">
                          {[tenant.institution, tenant.department].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </span>
                  </span>
                  <ChevronRight size={16} className="text-slate-400 shrink-0" />
                </button>
              ))}

              {tenants.length === 0 && !error && (
                <p className="text-center text-xs text-slate-400 py-4">
                  No organizations are currently available.
                </p>
              )}
            </>
          )}

          <div className="pt-1">
            <div className="relative py-2">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-100" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-white px-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">or</span>
              </div>
            </div>

            {/* Individual path — deliberately at the SAME top level as the
                tenant cards above, not a secondary/buried link, per spec:
                "the individual path visible at the top level." */}
            <button
              type="button"
              onClick={() => navigate('/doctor/login')}
              className="w-full flex items-center justify-between px-5 py-4 rounded-xl border border-slate-200 hover:bg-slate-50 text-left transition cursor-pointer"
            >
              <span className="flex items-center space-x-3">
                <Stethoscope size={18} className="text-blue-600 shrink-0" />
                <span>
                  <span className="block text-sm font-bold text-slate-800">I'm not affiliated with an organization</span>
                  <span className="block text-[11px] text-slate-500 mt-0.5">Sign in or register with email</span>
                </span>
              </span>
              <ChevronRight size={16} className="text-slate-400 shrink-0" />
            </button>
          </div>
        </div>

        <div className="bg-slate-50 border-t border-slate-100 p-4 text-center">
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="text-xs font-bold text-blue-600 hover:text-blue-700 hover:underline cursor-pointer"
          >
            &larr; Back
          </button>
        </div>
      </div>
    </div>
  );
};
