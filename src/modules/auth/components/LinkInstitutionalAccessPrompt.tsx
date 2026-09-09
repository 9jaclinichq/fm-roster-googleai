import React, { useEffect, useState } from 'react';
import { AlertCircle, ShieldCheck } from 'lucide-react';
import { databaseService } from '../../../lib/databaseService';
import { ConfirmationDialog } from '../../shared/ui/ConfirmationDialog';
import {
  AUTH_EMAIL_COOLDOWN_SECONDS,
  loginFailureMessage,
  registrationNextStepMessage,
  validatePersonalPassword,
} from '../lib/authJourney';
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
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [dismissed, setDismissed] = useState(false);
  const [alreadyLinked, setAlreadyLinked] = useState(false);
  const [linkedJustNow, setLinkedJustNow] = useState(false);
  const [checkingMembership, setCheckingMembership] = useState(hasAuthenticatedAccount);
  const [confirmLink, setConfirmLink] = useState(false);
  const [emailCooldown, setEmailCooldown] = useState(0);

  useEffect(() => {
    if (accessCode && !preflight) void inspect(accessCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessCode, workforceId]);

  useEffect(() => {
    if (emailCooldown <= 0) return;
    const timer = window.setTimeout(() => setEmailCooldown(value => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [emailCooldown]);

  useEffect(() => {
    if (!hasAuthenticatedAccount) { setCheckingMembership(false); return; }
    let cancelled = false;
    organisationMembershipService.getCurrentUserMemberships()
      .then(rows => { if (!cancelled) setAlreadyLinked(rows.some(row => row.status === 'active' && row.workforce_id === workforceId)); })
      .catch(() => { /* keep the optional prompt available after a transient read failure */ })
      .finally(() => { if (!cancelled) setCheckingMembership(false); });
    return () => { cancelled = true; };
  }, [hasAuthenticatedAccount, workforceId]);

  const inspect = async (value = code) => {
    setError('');
    if (!/^\d{6}$/.test(value)) return setError('Re-enter your six-digit institutional access code.');
    setBusy(true);
    try { setPreflight(await organisationMembershipService.preflight(workforceId, value)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Institutional details could not be verified.'); }
    finally { setBusy(false); }
  };

  const claim = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await organisationMembershipService.claimWorkforceMember(workforceId, code);
      setMessage('Institutional access is now linked to your personally signed-in account.');
      setLinkedJustNow(true);
      setAlreadyLinked(true);
      setConfirmLink(false);
      onLinked();
    } catch (err) { setError(err instanceof Error ? err.message : 'The account link could not be completed.'); }
    finally { setBusy(false); }
  };

  const authenticate = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      if (!await organisationMembershipService.emailMatches(workforceId, code, email)) {
        throw new Error('Use the email already held by your organization. The institutional code alone cannot link an account.');
      }
      const passwordError = validatePersonalPassword(password);
      if (passwordError) throw new Error(passwordError);
      if (mode === 'register') {
        if (!name.trim()) throw new Error('Enter your full name.');
        const result = await databaseService.registerDoctor(email.trim(), password, name.trim());
        if (result.needsEmailConfirmation) {
          setMessage(registrationNextStepMessage());
          setMode('login'); setPassword(''); setEmailCooldown(AUTH_EMAIL_COOLDOWN_SECONDS); return;
        }
      } else {
        await databaseService.loginDoctor(email.trim(), password);
      }
      setMessage('Personally signed in. Review “Complete secure link” to finish.');
    } catch (err) { setError(loginFailureMessage(err)); }
    finally { setBusy(false); }
  };

  const requestPasswordReset = async () => {
    setError('');
    if (!email.trim()) return setError('Enter your personal account email first.');
    setBusy(true);
    try {
      await databaseService.requestDoctorPasswordReset(email);
      setMessage('If a personal account exists for this email, a password-reset message has been requested. Check your inbox and spam folder.');
      setEmailCooldown(AUTH_EMAIL_COOLDOWN_SECONDS);
    } catch (err) { setError(loginFailureMessage(err)); }
    finally { setBusy(false); }
  };

  const resendConfirmation = async () => {
    setError('');
    if (!email.trim()) return setError('Enter your personal account email first.');
    setBusy(true);
    try {
      await databaseService.resendDoctorConfirmation(email);
      setMessage('If this email has an unconfirmed personal account, a new confirmation message has been requested. Check your inbox and spam folder.');
      setEmailCooldown(AUTH_EMAIL_COOLDOWN_SECONDS);
    } catch (err) { setError(loginFailureMessage(err)); }
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

  if (dismissed || checkingMembership || (alreadyLinked && !linkedJustNow)) return null;
  if (linkedJustNow) return <div className="mx-auto max-w-3xl px-4 pt-4"><div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900" role="status">{message}</div></div>;

  return <div className="mx-auto max-w-3xl px-4 pt-4"><div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50 p-4">
    <div className="flex gap-3"><ShieldCheck size={18} className="shrink-0 text-blue-700" /><div><p className="text-sm font-bold text-blue-900">Link this institutional profile to a personal account</p><p className="mt-1 text-xs text-blue-800">Institutional access and personal sign-in are separate. Linking preserves your current workspace while adding a durable, revocable identity.</p></div></div>
    {!preflight && <div className="flex flex-col gap-2 sm:flex-row"><input aria-label="Institutional access code" type="password" inputMode="numeric" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} placeholder="Re-enter institutional access code" className="flex-1 rounded-lg border bg-white px-3 py-2 tracking-widest" /><button type="button" onClick={() => inspect()} disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:bg-slate-300">Check linking options</button></div>}
    {preflight?.state === 'CONTACT_CONFIRMATION_REQUIRED' && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><p className="font-bold">Organization contact confirmation required</p><p className="mt-1">This profile has no independently verified contact eligible for safe linking.</p><button type="button" onClick={requestHelp} disabled={busy} className="mt-2 rounded-lg border border-amber-300 bg-white px-3 py-2 font-bold">Request administrator help</button></div>}
    {preflight?.state === 'CONTACT_READY' && <div className="space-y-3"><p className="text-xs text-blue-900">Organization contact: <strong>{preflight.masked_destination}</strong>. Your confirmed personal account must match it.</p>{hasAuthenticatedAccount ? <button type="button" onClick={() => setConfirmLink(true)} disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:bg-slate-300">Complete secure link</button> : <form onSubmit={authenticate} className="grid gap-2 sm:grid-cols-2">{mode === 'register' && <input value={name} onChange={event => setName(event.target.value)} placeholder="Full name" className="rounded-lg border bg-white px-3 py-2 text-sm" />}<input type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="Organization-held email" className="rounded-lg border bg-white px-3 py-2 text-sm" /><input type="password" minLength={6} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} placeholder="Personal account password" className="rounded-lg border bg-white px-3 py-2 text-sm" /><p className="text-[11px] text-blue-800 sm:col-span-2">At least 6 characters. This password is separate from the institutional access code.</p><button disabled={busy} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white disabled:bg-slate-300">{mode === 'register' ? 'Create personal account' : 'Sign in personally'}</button><button type="button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')} className="text-xs font-bold text-blue-700">{mode === 'login' ? 'Need a personal account? Create one' : 'Already registered? Sign in'}</button>{mode === 'login' && <div className="flex gap-3 sm:col-span-2"><button type="button" onClick={requestPasswordReset} disabled={busy || !email.trim() || emailCooldown > 0} className="text-xs font-bold text-blue-700 disabled:text-slate-400">{emailCooldown > 0 ? `Email available in ${emailCooldown}s` : 'Forgot personal password?'}</button><button type="button" onClick={resendConfirmation} disabled={busy || !email.trim() || emailCooldown > 0} className="text-xs font-bold text-blue-700 disabled:text-slate-400">Resend confirmation</button></div>}</form>}</div>}
    {error && <p className="flex gap-1 text-xs text-rose-700" role="alert"><AlertCircle size={14} />{error}</p>}{message && <p className="text-xs font-semibold text-emerald-800" role="status">{message}</p>}<button type="button" onClick={() => setDismissed(true)} className="text-xs font-bold text-slate-500">Not now</button>
  </div>
  <ConfirmationDialog open={confirmLink} title="Link this institutional profile?" description="This creates a durable, revocable membership between your confirmed personal account and the existing institutional profile. The institutional access code remains a separate credential until an administrator disables it." details={[{ label: 'Member', value: preflight?.member_name ?? 'Current member' }, { label: 'Organization', value: preflight?.tenant_name ?? 'Current organization' }, { label: 'Verified contact', value: preflight?.masked_destination ?? 'Masked contact unavailable' }]} confirmLabel="Link institutional profile" busy={busy} onCancel={() => setConfirmLink(false)} onConfirm={claim} />
  </div>;
};
