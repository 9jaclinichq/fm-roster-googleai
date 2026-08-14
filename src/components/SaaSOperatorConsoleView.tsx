import React, { useState, useEffect } from 'react';
import { databaseService } from '../lib/databaseService';
import { Tenant, TenantPlanType, TenantAiAdaptationRule } from '../types';
import {
  ShieldCheck, AlertCircle, RefreshCw, Building2, Users, ListChecks,
  Sparkles, Plus, LogOut, BadgeCheck, Ban, ChevronDown,
} from 'lucide-react';

// Self-contained: handles its own login gate + console, same pattern as
// MultiRosterManagerView, so App.tsx only needs one lazy route. Session is
// deliberately separate from the Chief's (localStorage key + shared code
// are both distinct) — a platform operator administers ALL tenants, not
// one department's Chief.
const OPERATOR_SESSION_KEY = 'fm_session_operator';

const PLAN_TYPES: TenantPlanType[] = ['free_seeded', 'tier_1', 'tier_2', 'enterprise'];

interface OperatorSession {
  id: string;
  name: string;
}

export const SaaSOperatorConsoleView: React.FC = () => {
  const [session, setSession] = useState<OperatorSession | null>(null);
  const [code, setCode] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem(OPERATOR_SESSION_KEY);
    if (raw) {
      try {
        setSession(JSON.parse(raw));
      } catch {
        localStorage.removeItem(OPERATOR_SESSION_KEY);
      }
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    if (!code.trim()) {
      setLoginError('Enter the platform operator code.');
      return;
    }
    setLoggingIn(true);
    try {
      const operator = await databaseService.verifyPlatformOperatorLogin(code.trim());
      if (!operator) {
        setLoginError('Incorrect operator code. Access denied.');
        return;
      }
      const sess: OperatorSession = { id: operator.id, name: operator.name };
      setSession(sess);
      localStorage.setItem(OPERATOR_SESSION_KEY, JSON.stringify(sess));
      await databaseService.logOperatorEvent(operator.id, 'operator_login');
    } catch (err) {
      console.warn(err);
      setLoginError('An error occurred during verification. Please try again.');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = () => {
    setSession(null);
    localStorage.removeItem(OPERATOR_SESSION_KEY);
    setCode('');
  };

  if (!session) {
    return (
      <div className="max-w-md mx-auto my-12 px-4">
        <div className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
          <div className="bg-gradient-to-br from-slate-800 to-slate-950 p-6 text-white text-center">
            <div className="mx-auto bg-white/10 text-white w-12 h-12 rounded-xl flex items-center justify-center mb-3 border border-white/10">
              <ShieldCheck size={20} />
            </div>
            <h2 className="text-xl font-bold tracking-tight">Platform Operator Console</h2>
            <p className="text-xs text-slate-300 mt-1 font-medium">
              Cross-tenant administration — not a department Chief login.
            </p>
          </div>
          <form onSubmit={handleLogin} className="p-6 sm:p-8 space-y-5">
            {loginError && (
              <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-3.5 flex items-start space-x-2 text-xs sm:text-sm">
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                <span>{loginError}</span>
              </div>
            )}
            <div className="space-y-1.5">
              <label htmlFor="operator-code" className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
                Operator Access Code
              </label>
              <input
                id="operator-code"
                type="password"
                value={code}
                onChange={(e) => { setCode(e.target.value); setLoginError(''); }}
                placeholder="Enter operator code"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold tracking-widest text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-200 focus:border-slate-600 transition"
              />
            </div>
            <button
              type="submit"
              disabled={loggingIn}
              className="w-full py-3 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white rounded-xl text-sm font-bold shadow-md transition flex items-center justify-center cursor-pointer"
            >
              {loggingIn ? (<><RefreshCw size={14} className="animate-spin mr-1.5" /><span>Verifying...</span></>) : 'Verify Operator Access'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return <OperatorConsole operatorId={session.id} operatorName={session.name} onLogout={handleLogout} />;
};

const OperatorConsole: React.FC<{ operatorId: string; operatorName: string; onLogout: () => void }> = ({
  operatorId, operatorName, onLogout,
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [analytics, setAnalytics] = useState<{ totalTenants: number; totalMembers: number; activeMasterRosters: number; aiActionCount: number } | null>(null);
  const [usageBreakdown, setUsageBreakdown] = useState<Awaited<ReturnType<typeof databaseService.getTenantUsageBreakdown>>>([]);
  const [statusMessage, setStatusMessage] = useState('');
  const [showProvisionForm, setShowProvisionForm] = useState(false);

  // Provisioning form state
  const [newName, setNewName] = useState('');
  const [newShortCode, setNewShortCode] = useState('');
  const [newInstitution, setNewInstitution] = useState('');
  const [newDepartment, setNewDepartment] = useState('');
  const [withBilling, setWithBilling] = useState(false);
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [percentageCharge, setPercentageCharge] = useState('5');
  const [provisioning, setProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState('');

  const [selectedTenantId, setSelectedTenantId] = useState<string>('');
  const [adaptationRules, setAdaptationRules] = useState<TenantAiAdaptationRule[]>([]);

  const load = async () => {
    setIsLoading(true);
    try {
      const [t, a, u] = await Promise.all([
        databaseService.getTenants(),
        databaseService.getPlatformAnalyticsSummary(),
        databaseService.getTenantUsageBreakdown(),
      ]);
      setTenants(t);
      setAnalytics(a);
      setUsageBreakdown(u.slice().sort((x, y) => y.aiActionsThisWindow - x.aiActionsThisWindow));
    } catch (err) {
      console.warn(err);
      setStatusMessage('Failed to load operator console data.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!selectedTenantId) { setAdaptationRules([]); return; }
    databaseService.getTenantAiAdaptationRules(selectedTenantId).then(setAdaptationRules).catch(console.warn);
  }, [selectedTenantId]);

  const handleProvision = async (e: React.FormEvent) => {
    e.preventDefault();
    setProvisionError('');
    if (!newName.trim() || !newShortCode.trim()) {
      setProvisionError('Name and short code are required.');
      return;
    }
    setProvisioning(true);
    try {
      let tenant: Tenant;
      if (withBilling) {
        if (!bankCode.trim() || !accountNumber.trim()) {
          setProvisionError('Bank code and account number are required to set up billing.');
          setProvisioning(false);
          return;
        }
        tenant = await databaseService.provisionTenantWithSubaccount({
          name: newName.trim(),
          short_code: newShortCode.trim(),
          institution: newInstitution.trim() || null,
          department: newDepartment.trim() || null,
          business_name: newName.trim(),
          settlement_bank: bankCode.trim(),
          account_number: accountNumber.trim(),
          percentage_charge: Number(percentageCharge) || 5,
        });
      } else {
        tenant = await databaseService.createTenant({
          name: newName.trim(),
          short_code: newShortCode.trim(),
          institution: newInstitution.trim() || null,
          department: newDepartment.trim() || null,
        });
      }
      await databaseService.logOperatorEvent(operatorId, 'tenant_provisioned', { tenant_id: tenant.id, short_code: tenant.short_code, with_billing: withBilling });
      setStatusMessage(`Tenant "${tenant.name}" provisioned.`);
      setNewName(''); setNewShortCode(''); setNewInstitution(''); setNewDepartment('');
      setBankCode(''); setAccountNumber(''); setWithBilling(false);
      setShowProvisionForm(false);
      await load();
    } catch (err) {
      console.warn(err);
      setProvisionError(err instanceof Error ? err.message : 'Failed to provision tenant.');
    } finally {
      setProvisioning(false);
    }
  };

  const handlePlanChange = async (tenant: Tenant, plan: TenantPlanType) => {
    try {
      await databaseService.updateTenantPlan(tenant.id, plan);
      await databaseService.logOperatorEvent(operatorId, 'tenant_plan_changed', { tenant_id: tenant.id, plan });
      await load();
    } catch (err) {
      console.warn(err);
      setStatusMessage('Failed to update plan.');
    }
  };

  const handleStatusToggle = async (tenant: Tenant) => {
    const nextStatus = tenant.status === 'active' ? 'suspended' : 'active';
    try {
      await databaseService.updateTenantStatus(tenant.id, nextStatus);
      await databaseService.logOperatorEvent(operatorId, 'tenant_status_changed', { tenant_id: tenant.id, status: nextStatus });
      await load();
    } catch (err) {
      console.warn(err);
      setStatusMessage('Failed to update tenant status.');
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <ShieldCheck className="text-slate-700" size={24} /> Platform Operator Console
          </h1>
          <p className="text-sm text-slate-500 mt-1">Signed in as {operatorName}</p>
        </div>
        <button onClick={onLogout} className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-rose-600 cursor-pointer">
          <LogOut size={14} /> Sign out
        </button>
      </div>

      {statusMessage && (
        <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-xl p-3 text-sm">{statusMessage}</div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-slate-400"><RefreshCw className="animate-spin mr-2" size={18} /> Loading...</div>
      ) : (
        <>
          {/* Platform Analytics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Tenants', value: analytics?.totalTenants ?? 0, icon: Building2 },
              { label: 'Total Members', value: analytics?.totalMembers ?? 0, icon: Users },
              { label: 'Published Rosters', value: analytics?.activeMasterRosters ?? 0, icon: ListChecks },
              { label: 'AI Actions Logged', value: analytics?.aiActionCount ?? 0, icon: Sparkles },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="bg-white rounded-xl border border-slate-200 p-4">
                <Icon size={16} className="text-slate-400 mb-2" />
                <p className="text-2xl font-bold text-slate-900">{value}</p>
                <p className="text-xs text-slate-500 font-medium mt-0.5">{label}</p>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 -mt-2">
            Global counts across all tenants (not tenant-scoped). Revenue metrics require live subscription/charge
            data, which this pass does not build — see paystack-subaccount's scope note.
          </p>

          {/* Per-Tenant Usage Breakdown */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-100">
              <h2 className="font-bold text-slate-800 flex items-center gap-2"><Sparkles size={16} /> Per-Tenant Usage</h2>
              <p className="text-xs text-slate-500 mt-0.5">Sorted by AI actions this 14-day window — spot free-tier heavy users (upsell candidates) or paying tenants gone quiet.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    <th className="px-4 py-2">Tenant</th>
                    <th className="px-4 py-2">Plan</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2 text-right">Members</th>
                    <th className="px-4 py-2 text-right">AI Actions (14d)</th>
                    <th className="px-4 py-2 text-right">Submissions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {usageBreakdown.map(row => (
                    <tr key={row.tenantId}>
                      <td className="px-4 py-2 font-semibold text-slate-800">{row.name}</td>
                      <td className="px-4 py-2 text-slate-600">{row.planType}</td>
                      <td className="px-4 py-2">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${row.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                          {row.status}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right text-slate-600">{row.memberCount}</td>
                      <td className="px-4 py-2 text-right font-semibold text-slate-800">{row.aiActionsThisWindow}</td>
                      <td className="px-4 py-2 text-right text-slate-600">{row.submissionCount}</td>
                    </tr>
                  ))}
                  {usageBreakdown.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-6 text-center text-xs text-slate-400">No tenants yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Tenant Management */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 flex items-center gap-2"><Building2 size={16} /> Tenant Management</h2>
              <button
                onClick={() => setShowProvisionForm(v => !v)}
                className="flex items-center gap-1 text-xs font-bold bg-slate-900 text-white px-3 py-2 rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                <Plus size={14} /> Provision Tenant
              </button>
            </div>

            {showProvisionForm && (
              <form onSubmit={handleProvision} className="p-4 border-b border-slate-100 bg-slate-50 space-y-3">
                {provisionError && (
                  <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-lg p-2.5 text-xs">{provisionError}</div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Organization name" className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                  <input value={newShortCode} onChange={e => setNewShortCode(e.target.value)} placeholder="Short code (e.g. uch_fm)" className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                  <input value={newInstitution} onChange={e => setNewInstitution(e.target.value)} placeholder="Institution (optional)" className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                  <input value={newDepartment} onChange={e => setNewDepartment(e.target.value)} placeholder="Department (optional)" className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                </div>
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                  <input type="checkbox" checked={withBilling} onChange={e => setWithBilling(e.target.checked)} />
                  Set up Paystack billing now (creates a real live subaccount)
                </label>
                {withBilling && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <input value={bankCode} onChange={e => setBankCode(e.target.value)} placeholder="Settlement bank code" className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                    <input value={accountNumber} onChange={e => setAccountNumber(e.target.value)} placeholder="Account number" className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                    <input value={percentageCharge} onChange={e => setPercentageCharge(e.target.value)} placeholder="Platform % charge" className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                  </div>
                )}
                <button type="submit" disabled={provisioning} className="text-xs font-bold bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white px-4 py-2 rounded-lg cursor-pointer">
                  {provisioning ? 'Provisioning...' : 'Create Tenant'}
                </button>
              </form>
            )}

            <div className="divide-y divide-slate-100">
              {tenants.map(tenant => (
                <div key={tenant.id} className="p-4 flex flex-wrap items-center gap-3 justify-between">
                  <div>
                    <p className="font-semibold text-slate-800 text-sm">{tenant.name}</p>
                    <p className="text-xs text-slate-500">{tenant.short_code} &bull; {tenant.institution || '—'} &bull; {tenant.department || '—'}</p>
                    {tenant.paystack_subaccount_code && (
                      <p className="text-[10px] text-emerald-600 font-mono mt-0.5">{tenant.paystack_subaccount_code}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <select
                        value={tenant.plan_type}
                        onChange={e => handlePlanChange(tenant, e.target.value as TenantPlanType)}
                        className="appearance-none text-xs font-semibold border border-slate-200 rounded-lg pl-2.5 pr-7 py-1.5 bg-white cursor-pointer"
                      >
                        {PLAN_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                      <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    </div>
                    <button
                      onClick={() => handleStatusToggle(tenant)}
                      className={`flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-lg cursor-pointer ${
                        tenant.status === 'active' ? 'bg-emerald-50 text-emerald-700 hover:bg-rose-50 hover:text-rose-700' : 'bg-rose-50 text-rose-700 hover:bg-emerald-50 hover:text-emerald-700'
                      }`}
                    >
                      {tenant.status === 'active' ? <><BadgeCheck size={12} /> Active</> : <><Ban size={12} /> Suspended</>}
                    </button>
                    <button
                      onClick={() => setSelectedTenantId(tenant.id === selectedTenantId ? '' : tenant.id)}
                      className="text-xs font-bold text-slate-500 hover:text-slate-800 underline cursor-pointer"
                    >
                      AI tuning
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Global AI Tuning */}
          {selectedTenantId && (
            <div className="bg-white rounded-2xl border border-slate-200 p-4">
              <h2 className="font-bold text-slate-800 flex items-center gap-2 mb-1"><Sparkles size={16} /> AI Adaptation Rules — {tenants.find(t => t.id === selectedTenantId)?.name}</h2>
              <p className="text-[11px] text-slate-400 mb-3">
                Inspect only in this pass — the academic-copilot and roster-parser Edge Functions do not yet read
                or apply these overrides when constructing prompts (deferred, see migration 11's header). Editing
                here stores data but has no live effect on AI output yet.
              </p>
              {adaptationRules.length === 0 ? (
                <p className="text-xs text-slate-400">No adaptation rules recorded for this tenant yet.</p>
              ) : (
                <div className="space-y-2">
                  {adaptationRules.map(rule => (
                    <div key={rule.id} className="bg-slate-50 rounded-lg p-3 text-xs">
                      <p className="font-bold text-slate-700">{rule.feature_key}</p>
                      <pre className="text-[10px] text-slate-500 mt-1 whitespace-pre-wrap">{JSON.stringify(rule.adapted_prompt_overrides, null, 2)}</pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
