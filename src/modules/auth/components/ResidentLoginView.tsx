import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { databaseService } from '../../../lib/databaseService';
import { WorkforceMember, Tenant } from '../../../types';
import { KeyRound, User, ChevronDown, Sparkles, Check, AlertCircle, Building2, Mail } from 'lucide-react';
import { useTerminology } from '../../shared/terminology';

interface ResidentLoginViewProps {
  onLoginSuccess: (resident: { id: string; name: string; category: string; tenant_id?: string }) => void;
  onNavigateToChief: () => void;
  presetResident?: WorkforceMember | null;
}

// A connection-level network failure (offline, DNS failure) can leave the
// underlying fetch() never settling — unlike an HTTP-level error, which
// supabase-js already surfaces cleanly as {error}. Bounds any promise to a
// max wait so callers always reach their catch block instead of hanging.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Request timed out')), ms)),
  ]);
}

export const ResidentLoginView: React.FC<ResidentLoginViewProps> = ({
  onLoginSuccess,
  onNavigateToChief,
  presetResident
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  // Carried forward from TenantSelectorView (/workspace/select-org), the new
  // tenant-first login step — see that component's header comment. Falls
  // back to a query param (`?tenant=<id>`, mirroring this app's existing
  // `?src=` convention) for bookmarkability, and to nothing at all for any
  // old link straight into /workspace/login: the effect below then falls
  // back to the first active tenant, same as before this change, so no
  // existing bookmarked/legacy link into this page breaks.
  const incomingTenantId =
    (location.state as { tenantId?: string } | null)?.tenantId ||
    new URLSearchParams(location.search).get('tenant') ||
    '';
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string>('');
  const [isTenantDropdownOpen, setIsTenantDropdownOpen] = useState<boolean>(false);
  const [workforce, setWorkforce] = useState<WorkforceMember[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [accessCode, setAccessCode] = useState<string>('');
  const [registeredEmail, setRegisteredEmail] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);
  const { t } = useTerminology();
  // Portal label reads through the tenant terminology system (same pattern
  // as ChiefLoginView's admin label) instead of a hardcoded brand check, so
  // a tenant that overrides `member` to "Doctor" gets that label here too.
  const portalLabel = `${t('member', 'Resident')} Portal`;

  // Organization picker (migration 26): loads the active-tenant list once,
  // then defaults to the first one so single-tenant deployments (today's
  // reality — only UCH Family Medicine is seeded) don't force an extra
  // click, while still being ready for a second organization to appear.
  //
  // Found via adversarial QA (2026-08-17): a connection-level network
  // failure (offline, DNS failure — not an HTTP error response, which
  // supabase-js already surfaces cleanly via its own {error}) can leave the
  // underlying fetch() never settling within any reasonable time, since
  // nothing here ever bounded how long to wait. That left this effect's
  // try/catch never reached at all, so selectedTenantId was never set,
  // which in turn left the workforce-loading effect below permanently
  // stuck on "Loading resident list..." with no error shown — the app's
  // error UI was correct, it just never got a chance to run. withTimeout
  // bounds both fetches so a hard network failure surfaces the same error
  // state as an HTTP-level one, instead of hanging indefinitely.
  useEffect(() => {
    async function loadTenants() {
      try {
        const data = await withTimeout(databaseService.getTenants(), 15000);
        const active = data.filter((tn) => tn.status === 'active');
        setTenants(active);
        // Prefer the tenant already chosen on TenantSelectorView, as long as
        // it's still a real active tenant; otherwise fall back to the first
        // active one (the pre-selector default behavior, preserved for any
        // legacy link straight into this page).
        if (incomingTenantId && active.some((tn) => tn.id === incomingTenantId)) {
          setSelectedTenantId(incomingTenantId);
        } else if (active.length > 0) {
          setSelectedTenantId(active[0].id);
        }
      } catch (err) {
        console.warn('Error loading organizations:', err);
        setError('Failed to fetch organization list from server. Check your connection and reload.');
      }
    }
    loadTenants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedTenantId) return;
    async function loadWorkforce() {
      setIsLoading(true);
      try {
        const data = await withTimeout(databaseService.getWorkforce(selectedTenantId), 15000);
        setWorkforce(data.filter((w) => w.active));
      } catch (err) {
        console.warn('Error loading workforce:', err);
        setError(`Failed to fetch ${t('member', 'resident').toLowerCase()} names from server. Check your connection and reload.`);
      } finally {
        setIsLoading(false);
      }
    }
    loadWorkforce();
  }, [selectedTenantId]);

  // Update selection if pre-selected from DevHelper (code is left blank —
  // resident codes are no longer readable by the client, see DevHelper.tsx)
  useEffect(() => {
    if (presetResident) {
      setSelectedId(presetResident.id);
      setError('');
    }
  }, [presetResident]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!selectedId) {
      setError(`Please select your name from the ${t('members', 'Residents').toLowerCase()} list.`);
      return;
    }

    if (!accessCode) {
      setError('Please enter your 6-digit access code.');
      return;
    }

    if (accessCode.length !== 6 || !/^\d+$/.test(accessCode)) {
      setError(`${t('member', 'Resident')} Access Code must be exactly 6 numeric digits.`);
      return;
    }

    if (!registeredEmail.trim()) {
      setError('Please enter the email registered with your organization.');
      return;
    }

    setIsLoggingIn(true);
    try {
      const selectedResident = workforce.find((w) => w.id === selectedId);
      if (!selectedResident) {
        setError(`Selected ${t('member', 'resident').toLowerCase()} is invalid or no longer active.`);
        setIsLoggingIn(false);
        return;
      }

      // Verified server-side — the resident_code column is never sent to the client.
      const verified = await databaseService.verifyResidentLogin(selectedResident.id, accessCode, registeredEmail.trim());

      if (verified) {
        onLoginSuccess({
          id: verified.id,
          name: verified.full_name,
          category: verified.category,
          // verify_resident_login's RETURNS TABLE doesn't include tenant_id
          // (migration 26) — take it from the already-fetched workforce
          // list row instead (same row, just verified).
          tenant_id: selectedResident.tenant_id,
        });
      } else {
        setError('Incorrect access code or registered email. Please check and try again.');
      }
    } catch (err) {
      console.warn(err);
      setError(`Authentication failed. Please contact your ${t('admin', 'Chief Resident')}.`);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const selectedResidentObj = workforce.find((w) => w.id === selectedId);
  const selectedTenantName = tenants.find((tn) => tn.id === selectedTenantId)?.name;
  // The org picker below only renders when there's genuinely a choice to
  // make (more than one active tenant) AND it wasn't already made on
  // TenantSelectorView. Whenever the picker is hidden for EITHER reason —
  // not just the incomingTenantId case — this screen must show the org
  // name some other way, or it gives zero indication of which
  // organization's login form is being shown. This mirrors the picker's
  // own condition exactly (negated) rather than only checking
  // incomingTenantId, which missed today's actual reality: only one
  // active tenant exists, so the picker is ALSO hidden on a direct/
  // bookmarked visit with no carried-forward tenant state.
  const isOrgPickerHidden = !(tenants.length > 1 && !incomingTenantId);

  return (
    <div className="max-w-md mx-auto my-12 px-4">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
        {/* Header decoration banner */}
        <div className="bg-gradient-to-br from-blue-600 to-blue-700 p-6 text-white text-center">
          <div className="mx-auto bg-white/15 text-white w-12 h-12 rounded-xl flex items-center justify-center mb-3 shadow-inner">
            <KeyRound size={20} />
          </div>
          <h2 className="text-xl font-bold tracking-tight">{portalLabel}</h2>
          {isOrgPickerHidden && selectedTenantName && (
            <p className="flex items-center justify-center space-x-1.5 text-xs text-blue-100 mt-1.5 font-semibold">
              <Building2 size={12} className="shrink-0" />
              <span>{selectedTenantName}</span>
            </p>
          )}
          <p className="text-xs text-blue-100/90 mt-1 font-medium">
            Access your medical workspace
          </p>
        </div>

        <form onSubmit={handleLogin} className="p-6 sm:p-8 space-y-5">
          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-3.5 flex items-start space-x-2 text-xs sm:text-sm animate-shake">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Organization picker (migration 26) — only shown once there's
              more than one active organization to choose between, AND the
              tenant wasn't already picked on TenantSelectorView just now
              (re-showing it here would be a redundant second selection).
              With today's single-tenant reality it would otherwise just be
              a disabled dropdown nobody needs to touch. */}
          {tenants.length > 1 && !incomingTenantId && (
            <div className="space-y-1.5 relative">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
                Select Your Organization
              </label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsTenantDropdownOpen(!isTenantDropdownOpen)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-left text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition cursor-pointer"
                >
                  <span className="flex items-center space-x-2 truncate">
                    <Building2 size={16} className="text-slate-400 shrink-0" />
                    <span className="truncate">
                      {tenants.find((tn) => tn.id === selectedTenantId)?.name || 'Choose your organization...'}
                    </span>
                  </span>
                  <ChevronDown size={16} className="text-slate-400 shrink-0 ml-1" />
                </button>

                {isTenantDropdownOpen && (
                  <div className="absolute z-50 mt-1.5 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-60 overflow-y-auto divide-y divide-slate-100">
                    {tenants.map((tn) => (
                      <button
                        key={tn.id}
                        type="button"
                        onClick={() => {
                          setSelectedTenantId(tn.id);
                          setSelectedId('');
                          setIsTenantDropdownOpen(false);
                          setError('');
                        }}
                        className="w-full text-left px-4 py-2.5 hover:bg-slate-50 text-sm font-medium text-slate-700 flex items-center justify-between transition cursor-pointer"
                      >
                        <span className="font-bold text-slate-800">{tn.name}</span>
                        {selectedTenantId === tn.id && <Check size={14} className="text-blue-600 shrink-0 font-bold" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Selector */}
          <div className="space-y-1.5 relative">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
              Select Your Name
            </label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                disabled={isLoading}
                className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-left text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition disabled:opacity-60 cursor-pointer"
              >
                <span className="flex items-center space-x-2 truncate">
                  <User size={16} className="text-slate-400 shrink-0" />
                  <span className="truncate">
                    {isLoading
                      ? 'Loading workforce list...'
                      : selectedResidentObj
                      ? selectedResidentObj.full_name
                      : 'Choose your name...'}
                  </span>
                </span>
                <ChevronDown size={16} className="text-slate-400 shrink-0 ml-1" />
              </button>

              {isDropdownOpen && !isLoading && (
                <div className="absolute z-50 mt-1.5 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-60 overflow-y-auto divide-y divide-slate-100">
                  {workforce.map((member) => (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => {
                        setSelectedId(member.id);
                        setIsDropdownOpen(false);
                        setError('');
                      }}
                      className="w-full text-left px-4 py-2.5 hover:bg-slate-50 text-sm font-medium text-slate-700 flex items-center justify-between transition cursor-pointer"
                    >
                      <div>
                        <div className="font-bold text-slate-800">{member.full_name}</div>
                        <div className="text-[10px] text-slate-500">{member.category}</div>
                      </div>
                      {selectedId === member.id && (
                        <Check size={14} className="text-blue-600 shrink-0 font-bold" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Access Code */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
              6-Digit Access Code
            </label>
            <div className="relative">
              <input
                type="password"
                maxLength={6}
                pattern="\d*"
                inputMode="numeric"
                value={accessCode}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '');
                  setAccessCode(val);
                  setError('');
                }}
                placeholder="Enter 6-digit access code"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold tracking-widest text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition placeholder:font-normal placeholder:tracking-normal placeholder:text-slate-400"
              />
            </div>
            <p className="text-[10px] text-slate-400 leading-relaxed font-medium">
              Enter your unique 6-digit {t('member', 'resident').toLowerCase()} code. No usernames or passwords required.
            </p>
          </div>

          {/* Registered Email (migration 26) */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
              Registered Email
            </label>
            <div className="relative">
              <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="email"
                value={registeredEmail}
                onChange={(e) => {
                  setRegisteredEmail(e.target.value);
                  setError('');
                }}
                placeholder="Enter the email registered with your organization"
                className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition placeholder:font-normal placeholder:text-slate-400"
              />
            </div>
            <p className="text-[10px] text-slate-400 leading-relaxed font-medium">
              A one-time check against your organization's records — no password is created or stored here.
            </p>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isLoggingIn || isLoading}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:text-slate-500 text-white rounded-xl text-sm font-bold shadow-sm transition transform active:scale-[0.98] cursor-pointer"
          >
            {isLoggingIn ? 'Verifying access...' : 'Access My Workspace'}
          </button>
        </form>

        <div className="bg-slate-50 border-t border-slate-100 p-4 flex items-center justify-between text-xs">
          <button
            type="button"
            onClick={() => navigate('/workspace/select-org')}
            className="font-bold text-blue-600 hover:text-blue-700 hover:underline cursor-pointer"
          >
            &larr; Back
          </button>
          <button
            type="button"
            onClick={onNavigateToChief}
            className="font-bold text-blue-600 hover:text-blue-700 hover:underline cursor-pointer"
          >
            Organizational Admin Portal &rarr;
          </button>
        </div>
      </div>
    </div>
  );
};
