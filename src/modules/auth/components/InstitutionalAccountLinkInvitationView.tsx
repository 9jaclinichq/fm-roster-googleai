import React, { useState } from 'react';
import { AlertCircle, ShieldCheck } from 'lucide-react';
import { databaseService } from '../../../lib/databaseService';
import { organisationMembershipService } from '../lib/organisationMembershipService';

interface Props {
  authenticated: boolean;
  onAccepted: (workforceId: string) => Promise<void>;
}

export const InstitutionalAccountLinkInvitationView: React.FC<Props> = ({ authenticated, onAccepted }) => {
  const token = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('invitation') ?? '';
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [state, setState] = useState('');

  const signIn = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try { await databaseService.loginDoctor(email, pin); setState('Signed in. Review and accept the link below.'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Personal sign-in failed.'); }
    finally { setBusy(false); }
  };

  const act = async (action: 'accept' | 'reject') => {
    setBusy(true); setError('');
    try {
      if (action === 'accept') {
        const result = await organisationMembershipService.acceptInvitation(token);
        if (!result.workforce_id || !['ACCEPTED', 'ALREADY_ACCEPTED'].includes(result.state)) {
          setState(`This invitation is ${result.state.toLowerCase().replaceAll('_', ' ')}. No account was linked.`);
          return;
        }
        await onAccepted(result.workforce_id);
        setState('Institutional access linked. You may continue to your workspace.');
      } else {
        await organisationMembershipService.rejectInvitation(token);
        setState('Invitation rejected. No account was linked.');
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'This invitation is unavailable or no longer valid.'); }
    finally { setBusy(false); }
  };

  return <div className="max-w-md mx-auto my-12 px-4"><div className="bg-white border rounded-2xl shadow-xl p-6 space-y-4">
    <div className="flex gap-3"><ShieldCheck className="text-blue-600 shrink-0" /><div><h1 className="font-bold text-slate-900">Review institutional account link</h1><p className="text-xs text-slate-500 mt-1">Accept only if you expected an organization to link its existing profile to your personal account.</p></div></div>
    {!/^[A-Za-z0-9_-]{40,100}$/.test(token) && <p className="text-sm text-rose-700">This invitation link is incomplete.</p>}
    {!authenticated && <form onSubmit={signIn} className="space-y-3"><p className="text-xs text-slate-600">Sign in personally first. This is separate from your institutional code.</p><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Personal account email" className="w-full px-3 py-2 border rounded-lg" /><input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="Personal 6-digit PIN" className="w-full px-3 py-2 border rounded-lg" /><button disabled={busy} className="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-bold">Sign in to review</button></form>}
    {authenticated && token && <div className="flex gap-2"><button type="button" onClick={() => act('accept')} disabled={busy} className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold">Accept and link</button><button type="button" onClick={() => act('reject')} disabled={busy} className="flex-1 py-2 border border-rose-200 text-rose-700 rounded-lg text-sm font-bold">Reject</button></div>}
    {error && <p className="text-xs text-rose-700 flex gap-1"><AlertCircle size={14} />{error}</p>}{state && <p className="text-xs font-semibold text-emerald-800">{state}</p>}
  </div></div>;
};
