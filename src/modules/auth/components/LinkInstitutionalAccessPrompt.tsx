import React, { useEffect, useState } from 'react';
import { AlertCircle, ShieldCheck } from 'lucide-react';
import { databaseService } from '../../../lib/databaseService';
import { AccountLinkPreflight, organisationMembershipService } from '../lib/organisationMembershipService';

interface Props {
  workforceId: string;
  accessCode: string | null;
  hasAuthenticatedAccount: boolean;
  onLinked: () => void;
}

// The legacy code only opens the already-issued institutional profile. The
// independent proof step is a confirmed Supabase Auth email matched by the
// database against the organization's pre-migration contact snapshot.
export const LinkInstitutionalAccessPrompt: React.FC<Props> = ({ workforceId, accessCode, hasAuthenticatedAccount, onLinked }) => {
  const [code, setCode] = useState(accessCode ?? '');
  const [preflight, setPreflight] = useState<AccountLinkPreflight | null>(null);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [dismissed, setDismissed] = useState(false);
  const [alreadyLinked, setAlreadyLinked] = useState(false);
  const [checkingMembership, setCheckingMembership] = useState(hasAuthenticatedAccount);

  useEffect(() => {
    if (accessCode && !preflight) void inspect(accessCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessCode, workforceId]);

  useEffect(() => {
    if (!hasAuthenticatedAccount) { setCheckingMembership(false); return; }
    let cancelled = false;
    organisationMembershipService.getCurrentUserMemberships()
      .then((rows) => { if (!cancelled) setAlreadyLinked(rows.some((row) => row.status === 'active' && row.workforce_id === workforceId)); })
      .catch(() => { /* keep the optional prompt available after a transient read failure */ })
      .finally(() => { if (!cancelled) setCheckingMembership(false); });
    return () => { cancelled = true; };
  }, [hasAuthenticatedAccount, workforceId]);

  const inspect = async (value = code) => {
    setError('');
    if (!/^\d{6}$/.test(value)) return setError('Re-enter your 6-digit institutional code.');
    setBusy(true);
    try { setPreflight(await organisationMembershipService.preflight(workforceId, value)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Institutional details could not be verified.'); }
    finally { setBusy(false); }
  };

  const claim = async () => {
    setBusy(true); setError('');
    try {
      await organisationMembershipService.claimWorkforceMember(workforceId, code);
      setMessage('Institutional access is now linked to your personally signed-in account.');
      setAlreadyLinked(true);
      onLinked();
    } catch (err) { setError(err instanceof Error ? err.message : 'The account link could not be completed.'); }
    finally { setBusy(false); }
  };

  const authenticate = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      if (!await organisationMembershipService.emailMatches(workforceId, code, email)) {
        throw new Error('Use the email already held by your organization. The code alone cannot link an account.');
      }
      if (!/^\d{6}$/.test(pin)) throw new Error('Your personal account PIN must be exactly 6 digits.');
      if (mode === 'register') {
        if (!name.trim()) throw new Error('Enter your full name.');
        const result = await databaseService.registerDoctor(email.trim(), pin, name.trim());
        if (result.needsEmailConfirmation) {
          setMessage('Account created. Confirm the email from your inbox, then return here and sign in to finish linking.');
          setMode('login'); setPin(''); return;
        }
      } else {
        await databaseService.loginDoctor(email.trim(), pin);
      }
      setMessage('Personally signed in. Select “Complete secure link” to finish.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Personal sign-in could not be completed.'); }
    finally { setBusy(false); }
  };

  const requestHelp = async () => {
    setBusy(true); setError('');
    try {
      await organisationMembershipService.requestAssistance(workforceId, code);
      setMessage('Your organization has been asked to confirm a contact for this profile. No account was linked.');
    } catch (err) { setError(err instanceof Error ? err.message : 'The assistance request could not be recorded.'); }
    finally { setBusy(false); }
  };

  if (dismissed || checkingMembership || alreadyLinked) return null;
  return <div className="max-w-3xl mx-auto px-4 pt-4"><div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
    <div className="flex gap-3"><ShieldCheck size={18} className="text-blue-700 shrink-0" /><div><p className="text-sm font-bold text-blue-900">Link this institutional profile to a personal account</p><p className="text-xs text-blue-800 mt-1">Institutional access and personal sign-in are separate. Linking preserves your current workspace while adding a durable, revocable identity.</p></div></div>
    {!preflight && <div className="flex flex-col sm:flex-row gap-2"><input type="password" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="Re-enter institutional code" className="flex-1 px-3 py-2 bg-white border rounded-lg tracking-widest" /><button type="button" onClick={() => inspect()} disabled={busy} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold">Check linking options</button></div>}
    {preflight?.state === 'CONTACT_CONFIRMATION_REQUIRED' && <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900"><p className="font-bold">Organization contact confirmation required</p><p className="mt-1">This profile has no independently verified contact eligible for safe linking.</p><button type="button" onClick={requestHelp} disabled={busy} className="mt-2 px-3 py-2 bg-white border border-amber-300 rounded-lg font-bold">Request administrator help</button></div>}
    {preflight?.state === 'CONTACT_READY' && <div className="space-y-3"><p className="text-xs text-blue-900">Organization contact: <strong>{preflight.masked_destination}</strong>. Your confirmed personal account must match it.</p>{hasAuthenticatedAccount ? <button type="button" onClick={claim} disabled={busy} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold">Complete secure link</button> : <form onSubmit={authenticate} className="grid sm:grid-cols-2 gap-2">{mode === 'register' && <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className="px-3 py-2 bg-white border rounded-lg text-sm" />}<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Organization-held email" className="px-3 py-2 bg-white border rounded-lg text-sm" /><input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="Personal 6-digit PIN" className="px-3 py-2 bg-white border rounded-lg text-sm" /><button disabled={busy} className="px-3 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold">{mode === 'register' ? 'Create personal account' : 'Sign in personally'}</button><button type="button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')} className="text-xs font-bold text-blue-700 sm:col-span-2">{mode === 'login' ? 'Need a personal account? Create one' : 'Already have one? Sign in'}</button></form>}</div>}
    {error && <p className="text-xs text-rose-700 flex gap-1"><AlertCircle size={14} />{error}</p>}{message && <p className="text-xs font-semibold text-emerald-800">{message}</p>}<button type="button" onClick={() => setDismissed(true)} className="text-xs font-bold text-slate-500">Not now</button>
  </div></div>;
};
