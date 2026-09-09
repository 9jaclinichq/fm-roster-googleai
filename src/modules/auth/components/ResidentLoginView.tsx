import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, Building2, Check, ChevronDown, KeyRound, Mail } from 'lucide-react';
import { databaseService } from '../../../lib/databaseService';
import { PublicTenant, WorkforceMember } from '../../../types';
import { useTerminology } from '../../shared/terminology';

interface ResidentLoginViewProps {
  onLoginSuccess: (resident: { id: string; name: string; category: string; tenant_id?: string; hasEmail: boolean; accessCode: string }) => void;
  onNavigateToChief: () => void;
  presetResident?: WorkforceMember | null;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Request timed out')), ms))]);
}

// Migration 86 deliberately removes the anonymous workforce directory. A
// member identifies their organization and enters the code already issued to
// them; only an exact server-side match returns a minimal session projection.
export const ResidentLoginView: React.FC<ResidentLoginViewProps> = ({ onLoginSuccess, onNavigateToChief }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const incomingTenantId = (location.state as { tenantId?: string } | null)?.tenantId || new URLSearchParams(location.search).get('tenant') || '';
  const [tenants, setTenants] = useState<PublicTenant[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [tenantOpen, setTenantOpen] = useState(false);
  const [accessCode, setAccessCode] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const { t } = useTerminology();

  useEffect(() => {
    let cancelled = false;
    withTimeout(databaseService.listPublicTenants(), 15000)
      .then((rows) => {
        if (cancelled) return;
        setTenants(rows);
        setTenantId(rows.some((row) => row.id === incomingTenantId) ? incomingTenantId : rows[0]?.id ?? '');
      })
      .catch(() => !cancelled && setError('Organizations could not be loaded. Check your connection and reload.'))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [incomingTenantId]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!tenantId) return setError('Select your organization.');
    if (!/^\d{6}$/.test(accessCode)) return setError('Access code must be exactly 6 digits.');
    setSubmitting(true);
    try {
      const member = await databaseService.verifyResidentLoginByCode(tenantId, accessCode, email);
      if (!member) {
        setError('Those details did not match an active institutional profile. Check your code and registered email.');
        return;
      }
      onLoginSuccess({ id: member.id, name: member.full_name, category: member.category, tenant_id: tenantId, hasEmail: member.has_email, accessCode });
    } catch {
      setError(`Sign-in could not be completed. Contact your ${t('admin', 'organization administrator')}.`);
    } finally {
      setSubmitting(false);
    }
  };

  const selectedTenant = tenants.find((tenant) => tenant.id === tenantId);
  return (
    <div className="max-w-md mx-auto my-12 px-4">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
        <div className="bg-gradient-to-br from-blue-600 to-blue-700 p-6 text-white text-center">
          <div className="mx-auto bg-white/15 w-12 h-12 rounded-xl flex items-center justify-center mb-3"><KeyRound size={20} /></div>
          <h2 className="text-xl font-bold">{t('member', 'Resident')} Portal</h2>
          {selectedTenant && <p className="text-xs text-blue-100 mt-1 flex justify-center items-center gap-1"><Building2 size={12} />{selectedTenant.name}</p>}
        </div>
        <form onSubmit={submit} className="p-6 sm:p-8 space-y-5">
          {error && <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-3 flex gap-2 text-sm"><AlertCircle size={16} className="shrink-0 mt-0.5" />{error}</div>}
          {tenants.length > 1 && !incomingTenantId && (
            <div className="relative space-y-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase">Organization</label>
              <button type="button" onClick={() => setTenantOpen(!tenantOpen)} className="w-full flex justify-between px-4 py-3 bg-slate-50 border rounded-xl text-sm font-semibold"><span>{selectedTenant?.name ?? 'Choose your organization'}</span><ChevronDown size={16} /></button>
              {tenantOpen && <div className="absolute z-50 w-full mt-1 bg-white border rounded-xl shadow-lg">{tenants.map((tenant) => <button key={tenant.id} type="button" onClick={() => { setTenantId(tenant.id); setTenantOpen(false); }} className="w-full px-4 py-3 text-left text-sm flex justify-between hover:bg-slate-50">{tenant.name}{tenant.id === tenantId && <Check size={14} className="text-blue-600" />}</button>)}</div>}
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase">6-Digit Institutional Code</label>
            <input type="password" inputMode="numeric" maxLength={6} value={accessCode} onChange={(e) => setAccessCode(e.target.value.replace(/\D/g, ''))} className="w-full px-4 py-3 bg-slate-50 border rounded-xl tracking-widest" placeholder="Enter your code" />
            <p className="text-[10px] text-slate-400">Your code identifies the profile issued to you. It does not create a personal account or prove email ownership.</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase">Registered email, if required</label>
            <div className="relative"><Mail size={16} className="absolute left-4 top-3.5 text-slate-400" /><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full pl-11 pr-4 py-3 bg-slate-50 border rounded-xl" placeholder="you@example.com" /></div>
          </div>
          <button type="submit" disabled={loading || submitting} className="w-full py-3 bg-blue-600 disabled:bg-slate-300 text-white rounded-xl text-sm font-bold">{submitting ? 'Checking…' : 'Open institutional workspace'}</button>
          <button type="button" onClick={() => navigate('/doctor/login')} className="w-full text-xs font-bold text-blue-600">Already linked? Sign in with your personal account</button>
        </form>
        <div className="bg-slate-50 border-t p-4 flex justify-between text-xs"><button onClick={() => navigate('/workspace/select-org')} className="font-bold text-blue-600">← Back</button><button onClick={onNavigateToChief} className="font-bold text-blue-600">Organization Admin →</button></div>
      </div>
    </div>
  );
};
