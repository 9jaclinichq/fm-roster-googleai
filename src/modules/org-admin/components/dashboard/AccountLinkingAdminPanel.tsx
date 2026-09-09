import React, { useEffect, useState } from 'react';
import { AlertCircle, Link2, RefreshCw, ShieldCheck } from 'lucide-react';
import { WorkforceMember } from '../../../../types';
import { AccountLinkAdminOverview, organisationMembershipService } from '../../../auth/lib/organisationMembershipService';
import { ConfirmationDialog } from '../../../shared/ui/ConfirmationDialog';

export const AccountLinkingAdminPanel: React.FC<{ workforce: WorkforceMember[] }> = ({ workforce }) => {
  const [overview, setOverview] = useState<AccountLinkAdminOverview | null>(null);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState<{ action: 'invite'; workforceId: string; memberName: string } | { action: 'revoke'; invitationId: string; memberName: string; maskedDestination: string } | null>(null);

  const load = async () => {
    setBusy(true); setError('');
    try { setOverview(await organisationMembershipService.adminOverview()); }
    catch { setError('Personal tenant-admin sign-in is required. The shared organization code cannot issue account links.'); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, []);

  const invite = async () => {
    if (!selected) return setError('Choose a member.');
    const member = workforce.find(item => item.id === selected);
    if (!member) return setError('Choose an active member.');
    setPending({ action: 'invite', workforceId: member.id, memberName: member.full_name });
  };

  const performPending = async () => {
    if (!pending || busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      if (pending.action === 'invite') {
        const result = await organisationMembershipService.createInvitation(pending.workforceId);
        setMessage(`Invitation ${result.state.toLowerCase().replaceAll('_', ' ')} for ${result.masked_destination ?? 'the organization-held contact'}.`);
        setSelected('');
      } else {
        await organisationMembershipService.revokeInvitation(pending.invitationId);
        setMessage('Invitation revoked.');
      }
      setPending(null);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'The account-link action could not be completed.'); }
    finally { setBusy(false); }
  };

  const revoke = (invitation: AccountLinkAdminOverview['invitations'][number]) => {
    setPending({ action: 'revoke', invitationId: invitation.id, memberName: invitation.member_name, maskedDestination: invitation.masked_destination ?? 'Masked contact unavailable' });
  };

  return <section className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
    <div className="flex justify-between gap-3"><div className="flex gap-2"><Link2 className="text-blue-600" size={20} /><div><h3 className="font-bold text-slate-900">Institutional account linking</h3><p className="text-xs text-slate-500 mt-1">Invite a member through the pre-existing organization contact. The destination stays masked.</p></div></div><button type="button" onClick={load} disabled={busy} aria-label="Refresh account-link status"><RefreshCw size={16} /></button></div>
    {error && <p className="text-xs text-rose-700 flex gap-1" role="alert"><AlertCircle size={14} />{error}</p>}{message && <p className="text-xs text-emerald-800 font-semibold" role="status">{message}</p>}
    {overview && <><div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{Object.entries(overview.counts).map(([label, count]) => <div key={label} className="bg-slate-50 rounded-lg p-3"><p className="text-lg font-bold">{count}</p><p className="text-[10px] uppercase text-slate-500">{label}</p></div>)}</div>
      <div className="flex flex-col sm:flex-row gap-2"><select value={selected} onChange={(e) => setSelected(e.target.value)} className="flex-1 px-3 py-2 border rounded-lg text-sm"><option value="">Choose active member…</option>{workforce.filter((member) => member.active).map((member) => <option key={member.id} value={member.id}>{member.full_name}</option>)}</select><button type="button" onClick={invite} disabled={busy || !selected} className="px-4 py-2 bg-blue-600 disabled:bg-slate-300 text-white rounded-lg text-xs font-bold">Send secure invitation</button></div>
      <div className="space-y-2">{overview.invitations.map((item) => <div key={item.id} className="border rounded-lg p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"><div><p className="text-sm font-bold">{item.member_name}</p><p className="text-xs text-slate-500">{item.masked_destination ?? 'Contact confirmation required'} · {item.status.toLowerCase().replaceAll('_', ' ')} · expires {new Date(item.expires_at).toLocaleString()}</p></div>{['ASSISTANCE_REQUESTED','PENDING_DELIVERY','SENT','DELIVERY_UNKNOWN'].includes(item.status) && <button type="button" onClick={() => revoke(item)} disabled={busy} className="text-xs font-bold text-rose-700">Review revocation</button>}</div>)}</div>
      <p className="text-[10px] text-slate-500 flex gap-1"><ShieldCheck size={12} />Invitation acceptance still requires the recipient’s confirmed personal email to match the organization-held contact.</p>
    </>}
    <ConfirmationDialog open={pending !== null} title={pending?.action === 'invite' ? 'Send this secure account-link invitation?' : 'Revoke this account-link invitation?'} description={pending?.action === 'invite' ? 'Workspc will send one single-use, expiring invitation to the organization-held contact. Sending does not link the account.' : 'The invitation will stop accepting responses immediately. Existing linked memberships are not changed.'} details={[{ label: 'Member', value: pending?.memberName ?? 'Selected member' }, { label: 'Organization', value: overview?.tenant_name ?? 'Current organization' }, { label: 'Contact', value: pending?.action === 'revoke' ? pending.maskedDestination : 'Organization-held contact (masked after send)' }]} confirmLabel={pending?.action === 'invite' ? 'Send secure invitation' : 'Revoke invitation'} tone={pending?.action === 'revoke' ? 'danger' : 'primary'} busy={busy} onCancel={() => setPending(null)} onConfirm={performPending} />
  </section>;
};
