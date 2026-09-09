import React, { useEffect, useState } from 'react';
import { AlertCircle, ShieldCheck } from 'lucide-react';
import { databaseService } from '../../../lib/databaseService';
import { ConfirmationDialog } from '../../shared/ui/ConfirmationDialog';
import { loginFailureMessage, validatePersonalPassword } from '../lib/authJourney';
import { AccountLinkInvitationPreview, organisationMembershipService } from '../lib/organisationMembershipService';

interface Props {
  authenticated: boolean;
  onAccepted: (workforceId: string) => Promise<void>;
}

export const InstitutionalAccountLinkInvitationView: React.FC<Props> = ({ authenticated, onAccepted }) => {
  const token = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('invitation') ?? '';
  const validToken = /^[A-Za-z0-9_-]{40,100}$/.test(token);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [state, setState] = useState('');
  const [review, setReview] = useState<AccountLinkInvitationPreview | null>(null);
  const [pendingAction, setPendingAction] = useState<'accept' | 'reject' | null>(null);

  useEffect(() => {
    if (!authenticated || !validToken) return;
    let cancelled = false;
    setBusy(true);
    organisationMembershipService.previewInvitation(token)
      .then(value => { if (!cancelled) setReview(value); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'This invitation is unavailable or no longer valid.'); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [authenticated, token, validToken]);

  const signIn = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    const passwordError = validatePersonalPassword(password);
    if (passwordError) { setBusy(false); return setError(passwordError); }
    try { await databaseService.loginDoctor(email, password); setState('Signed in. Review the affected profile and organization below before deciding.'); }
    catch (err) { setError(loginFailureMessage(err)); }
    finally { setBusy(false); }
  };

  const requestPasswordReset = async () => {
    setError('');
    if (!email.trim()) return setError('Enter your personal account email first.');
    setBusy(true);
    try {
      await databaseService.requestDoctorPasswordReset(email);
      setState('If a personal account exists for this email, a password-reset message has been requested. Check your inbox and spam folder.');
    } catch (err) { setError(loginFailureMessage(err)); }
    finally { setBusy(false); }
  };

  const act = async () => {
    if (!pendingAction || busy) return;
    setBusy(true); setError('');
    try {
      if (pendingAction === 'accept') {
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
      setPendingAction(null);
    } catch (err) { setError(err instanceof Error ? err.message : 'This invitation is unavailable or no longer valid.'); }
    finally { setBusy(false); }
  };

  const available = review && ['SENT', 'DELIVERY_UNKNOWN', 'PENDING_DELIVERY'].includes(review.state);
  return <div className="mx-auto my-12 max-w-md px-4"><div className="space-y-4 rounded-2xl border bg-white p-6 shadow-xl">
    <div className="flex gap-3"><ShieldCheck className="shrink-0 text-blue-600" /><div><h1 className="font-bold text-slate-900">Review institutional account link</h1><p className="mt-1 text-xs text-slate-500">Accept only if you expected an organization to link its existing profile to your personal account.</p></div></div>
    {!validToken && <p className="text-sm text-rose-700" role="alert">This invitation link is incomplete.</p>}
    {!authenticated && validToken && <form onSubmit={signIn} className="space-y-3"><p className="text-xs text-slate-600">Sign in personally first. Your personal password is separate from the institutional access code.</p><input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="Personal account email" className="w-full rounded-lg border px-3 py-2" /><input type="password" minLength={6} autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="Personal account password" className="w-full rounded-lg border px-3 py-2" /><p className="text-[11px] text-slate-500">At least 6 characters; do not enter your institution&apos;s six-digit access code here.</p><button disabled={busy} className="w-full rounded-lg bg-blue-600 py-2 text-sm font-bold text-white disabled:bg-slate-300">Sign in to review</button><button type="button" onClick={requestPasswordReset} disabled={busy || !email.trim()} className="w-full text-xs font-bold text-blue-700 disabled:text-slate-400">Forgot personal password?</button></form>}
    {authenticated && validToken && !review && !error && <p className="text-sm text-slate-500" role="status">Loading the protected invitation review…</p>}
    {review && <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4"><dl className="space-y-2 text-xs"><div><dt className="font-bold text-slate-500">Member profile</dt><dd className="text-slate-900">{review.member_name}</dd></div><div><dt className="font-bold text-slate-500">Organization</dt><dd className="text-slate-900">{review.tenant_name}</dd></div><div><dt className="font-bold text-slate-500">Confirmed account</dt><dd className="text-slate-900">{review.masked_destination}</dd></div><div><dt className="font-bold text-slate-500">Invitation</dt><dd className="text-slate-900">{review.state.toLowerCase().replaceAll('_', ' ')} · expires {new Date(review.expires_at).toLocaleString()}</dd></div></dl><p className="text-xs leading-relaxed text-slate-600">Accepting creates a durable, revocable membership. Rejecting closes this single-use invitation and links nothing.</p></div>}
    {available && <div className="flex gap-2"><button type="button" onClick={() => setPendingAction('accept')} disabled={busy} className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-bold text-white disabled:bg-slate-300">Review acceptance</button><button type="button" onClick={() => setPendingAction('reject')} disabled={busy} className="flex-1 rounded-lg border border-rose-200 py-2 text-sm font-bold text-rose-700 disabled:text-slate-400">Review rejection</button></div>}
    {error && <p className="flex gap-1 text-xs text-rose-700" role="alert"><AlertCircle size={14} />{error}</p>}{state && <p className="text-xs font-semibold text-emerald-800" role="status">{state}</p>}
  </div>
  <ConfirmationDialog open={pendingAction !== null} title={pendingAction === 'accept' ? 'Accept this account link?' : 'Reject this account link?'} description={pendingAction === 'accept' ? 'Your confirmed personal account will become the authoritative identity for this existing institutional profile.' : 'This invitation will be closed without linking an account. A tenant administrator would need to issue a new invitation later.'} details={[{ label: 'Member', value: review?.member_name ?? 'Protected member' }, { label: 'Organization', value: review?.tenant_name ?? 'Protected organization' }, { label: 'Account', value: review?.masked_destination ?? 'Masked contact' }]} confirmLabel={pendingAction === 'accept' ? 'Accept and link' : 'Reject invitation'} tone={pendingAction === 'reject' ? 'danger' : 'primary'} busy={busy} onCancel={() => setPendingAction(null)} onConfirm={act} />
  </div>;
};
