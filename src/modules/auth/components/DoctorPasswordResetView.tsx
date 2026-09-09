import React, { useState } from 'react';
import { AlertCircle, KeyRound, ShieldCheck } from 'lucide-react';
import { databaseService } from '../../../lib/databaseService';
import { loginFailureMessage, validatePersonalPassword } from '../lib/authJourney';

export const DoctorPasswordResetView: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    const passwordError = validatePersonalPassword(password);
    if (passwordError) return setError(passwordError);
    if (password !== confirmation) return setError('Passwords do not match.');
    setBusy(true);
    try {
      await databaseService.updateDoctorPassword(password);
      setPassword('');
      setConfirmation('');
      setComplete(true);
    } catch (err) {
      setError(loginFailureMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto my-12 max-w-md px-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-blue-50 p-2 text-blue-700"><KeyRound size={20} /></div>
          <div>
            <h1 className="text-lg font-bold text-slate-900">Set a new personal password</h1>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">This changes only your Supabase personal-account password. It does not change or replace your institution&apos;s six-digit access code.</p>
          </div>
        </div>

        {complete ? (
          <div className="mt-5 space-y-4" role="status">
            <p className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><ShieldCheck size={17} className="mt-0.5 shrink-0" />Personal password updated. Your account is signed in; continue to the workspace to complete linking.</p>
            <button type="button" onClick={onComplete} className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white">Continue securely</button>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-5 space-y-4">
            {error && <p className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800" role="alert"><AlertCircle size={15} className="mt-0.5 shrink-0" />{error}</p>}
            <label className="block text-xs font-bold text-slate-700">New personal password
              <input type="password" minLength={6} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" />
            </label>
            <label className="block text-xs font-bold text-slate-700">Confirm new password
              <input type="password" minLength={6} autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm" />
            </label>
            <p className="text-[11px] leading-relaxed text-slate-500">Use at least 6 characters. A longer unique password is safer. The reset link must still be valid.</p>
            <button type="submit" disabled={busy} className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white disabled:bg-slate-300">{busy ? 'Updating…' : 'Update personal password'}</button>
          </form>
        )}
      </div>
    </div>
  );
};
