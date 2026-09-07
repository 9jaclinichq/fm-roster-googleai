import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw, ShieldCheck } from 'lucide-react';
import { WorkforceMember } from '../../../types';
import { communicationService, AdminCommunicationSnapshot } from '../lib/communicationService';
import { CAPABILITY_BADGES, TENANT_CAPABILITIES, TenantCapability } from '../lib/communicationDomain';
import { CapabilityBadge } from './CapabilityBadge';

interface CapabilityDelegationPanelProps {
  adminCode: string;
  workforce: WorkforceMember[];
}

const EMPTY: AdminCommunicationSnapshot = { delegations: [], member_delivery_eligibility: [] };

export const CapabilityDelegationPanel: React.FC<CapabilityDelegationPanelProps> = ({ adminCode, workforce }) => {
  const [snapshot, setSnapshot] = useState<AdminCommunicationSnapshot>(EMPTY);
  const [memberId, setMemberId] = useState('');
  const [capability, setCapability] = useState<TenantCapability>('ROSTER_COORDINATE');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const activeDelegations = useMemo(
    () => snapshot.delegations.filter(delegation => delegation.status === 'ACTIVE'),
    [snapshot.delegations],
  );

  const load = async () => {
    setBusy(true);
    setError('');
    try {
      setSnapshot(await communicationService.getAdminSnapshot(adminCode));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load communication delegations.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    load();
    // Admin code is the complete server-reverified authority context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminCode]);

  const grant = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!memberId) return setError('Select a member.');
    setBusy(true);
    setError('');
    try {
      await communicationService.grantCapability(adminCode, memberId, capability);
      await load();
      setMemberId('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not grant capability.');
      setBusy(false);
    }
  };

  const revoke = async (delegationId: string) => {
    setBusy(true);
    setError('');
    try {
      await communicationService.revokeCapability(adminCode, delegationId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not revoke capability.');
      setBusy(false);
    }
  };

  return (
    <section className="lg:col-span-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6" aria-labelledby="capability-delegation-heading">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck size={17} className="text-blue-600" />
            <h3 id="capability-delegation-heading" className="font-bold text-slate-900">Explicit tenant capabilities</h3>
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-500">
            These narrow capabilities are separate from profile titles and legacy organization groups. Every grant and revocation is rechecked by the database against this tenant&apos;s administrator code.
          </p>
        </div>
        <button type="button" onClick={load} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw size={12} className={busy ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800" role="alert">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <form onSubmit={grant} className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">Grant capability</h4>
          <label className="block text-xs font-semibold text-slate-700">
            Member
            <select value={memberId} onChange={event => setMemberId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
              <option value="">Select a member…</option>
              {workforce.filter(member => member.active).map(member => (
                <option key={member.id} value={member.id}>{member.full_name} — {member.category}</option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-semibold text-slate-700">
            Capability
            <select value={capability} onChange={event => setCapability(event.target.value as TenantCapability)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
              {TENANT_CAPABILITIES.map(value => <option key={value} value={value}>{CAPABILITY_BADGES[value].label}</option>)}
            </select>
          </label>
          <button type="submit" disabled={busy || !memberId} className="w-full rounded-lg bg-slate-950 px-3 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-50">
            Grant capability
          </button>
          <p className="text-[10px] leading-relaxed text-slate-500">A member cannot grant themselves authority. Revocation takes effect on the next server request.</p>
        </form>

        <div className="space-y-2 lg:col-span-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">Active delegations ({activeDelegations.length})</h4>
          {busy && activeDelegations.length === 0 ? (
            <p className="rounded-xl border border-slate-200 p-4 text-sm text-slate-500">Loading delegations…</p>
          ) : activeDelegations.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">No explicit communication capabilities are delegated.</p>
          ) : activeDelegations.map(delegation => {
            const eligibility = snapshot.member_delivery_eligibility.find(row => row.workforce_id === delegation.workforce_id);
            return (
              <div key={delegation.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-900">{delegation.workforce_name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <CapabilityBadge capability={delegation.capability} />
                    {eligibility && (
                      <span className="text-[10px] text-slate-500" aria-label="Delivery eligibility only; contact details are hidden">
                        Email: {eligibility.email_state.replaceAll('_', ' ').toLowerCase()} · WhatsApp: {eligibility.whatsapp_state.replaceAll('_', ' ').toLowerCase()}
                      </span>
                    )}
                  </div>
                </div>
                <button type="button" onClick={() => revoke(delegation.id)} disabled={busy} className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50">
                  Revoke
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
