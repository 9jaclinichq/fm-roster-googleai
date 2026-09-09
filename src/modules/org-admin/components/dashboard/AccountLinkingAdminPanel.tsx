import React, { useEffect, useState } from 'react';
import { AlertCircle, Link2, RefreshCw, ShieldCheck } from 'lucide-react';
import { WorkforceMember } from '../../../../types';
import { AccountLinkAdminOverview, organisationMembershipService } from '../../../auth/lib/organisationMembershipService';

export const AccountLinkingAdminPanel: React.FC<{ workforce: WorkforceMember[] }> = ({ workforce }) => {
  const [overview, setOverview] = useState<AccountLinkAdminOverview | null>(null);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = async () => {
    setBusy(true); setError('');
    try { setOverview(await organisationMembershipService.adminOverview()); }
    catch { setError('Personal tenant-admin sign-in is required. The shared organization code cannot issue account links.'); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, []);

  const invite = async () => {
    if (!selected) return setError('Choose a member.');
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await organisationMembershipService.createInvitation(selected);
      setMessage(`Invitation ${result.state.toLowerCase().replaceAll('_', ' ')} for ${result.masked_destination ?? 'the organization-held contact'}.`);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Invitation could not be prepared.'); }
    finally { setBusy(false); }
  };

  const revoke = async (id: string) => {
    setBusy(true); setError('');
    try { await organisationMembershipService.revokeInvitation(id); setMessage('Invitation revoked.'); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Invitation could not be revoked.'); }
    finally { setBusy(false); }
  };

  return <section className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
    <div className="flex justify-between gap-3"><div className="flex gap-2"><Link2 className="text-blue-600" size={20} /><div><h3 className="font-bold text-slate-900">Institutional account linking</h3><p className="text-xs text-slate-500 mt-1">Invite a member through the pre-existing organization contact. The destination stays masked.</p></div></div><button type="button" onClick={load} disabled={busy} aria-label="Refresh account-link status"><RefreshCw size={16} /></button></div>
    {error && <p className="text-xs text-rose-700 flex gap-1"><AlertCircle size={14} />{error}</p>}{message && <p className="text-xs text-emerald-800 font-semibold">{message}</p>}
    {overview && <><div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{Object.entries(overview.counts).map(([label, count]) => <div key={label} className="bg-slate-50 rounded-lg p-3"><p className="text-lg font-bold">{count}</p><p className="text-[10px] uppercase text-slate-500">{label}</p></div>)}</div>
      <div className="flex flex-col sm:flex-row gap-2"><select value={selected} onChange={(e) => setSelected(e.target.value)} className="flex-1 px-3 py-2 border rounded-lg text-sm"><option value="">Choose active member…</option>{workforce.filter((member) => member.active).map((member) => <option key={member.id} value={member.id}>{member.full_name}</option>)}</select><button type="button" onClick={invite} disabled={busy || !selected} className="px-4 py-2 bg-blue-600 disabled:bg-slate-300 text-white rounded-lg text-xs font-bold">Send secure invitation</button></div>
      <div className="space-y-2">{overview.invitations.map((item) => <div key={item.id} className="border rounded-lg p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"><div><p className="text-sm font-bold">{item.member_name}</p><p className="text-xs text-slate-500">{item.masked_destination ?? 'Contact confirmation required'} · {item.status.toLowerCase().replaceAll('_', ' ')} · expires {new Date(item.expires_at).toLocaleString()}</p></div>{['ASSISTANCE_REQUESTED','PENDING_DELIVERY','SENT','DELIVERY_UNKNOWN'].includes(item.status) && <button type="button" onClick={() => revoke(item.id)} disabled={busy} className="text-xs font-bold text-rose-700">Revoke</button>}</div>)}</div>
      <p className="text-[10px] text-slate-500 flex gap-1"><ShieldCheck size={12} />Invitation acceptance still requires the recipient’s confirmed personal email to match the organization-held contact.</p>
    </>}
  </section>;
};
