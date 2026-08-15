import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Stethoscope, AlertCircle, CheckCircle2 } from 'lucide-react';
import { databaseService } from '../../../lib/databaseService';

// Self-service email+password login/register for individual doctors
// (migration 18) — the first real-auth flow in this app. On success this
// component does NOT navigate itself; App.tsx's onDoctorAuthStateChange
// listener picks up the new session and routes to /doctor/home or
// /workspace/form (if already linked to an organization) once it resolves.
export const DoctorAuthView: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<'login' | 'register'>(
    location.pathname === '/doctor/register' ? 'register' : 'login'
  );
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [confirmationNotice, setConfirmationNotice] = useState('');

  // User-initiated tab click: navigates so the URL/back-button stay
  // meaningful. NOT used for the post-registration confirmation-required
  // case below — navigating there would remount this component (different
  // <Route>) and wipe the confirmationNotice state before it's ever seen.
  const switchMode = (next: 'login' | 'register') => {
    setMode(next);
    setError('');
    setConfirmationNotice('');
    navigate(next === 'register' ? '/doctor/register' : '/doctor/login', { replace: true });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setConfirmationNotice('');

    if (!email || !password) {
      setError('Please enter your email and 6-digit PIN.');
      return;
    }

    // PIN unification (migration 26): individual and institutional logins
    // both present as "identify yourself, then a 6-digit PIN" now. Under
    // the hood this is still a real Supabase Auth password — a 6-digit
    // numeric string satisfies Supabase's default minimum password length,
    // so no auth-mechanism change was needed to make the two feel the same.
    if (!/^\d{6}$/.test(password)) {
      setError('PIN must be exactly 6 digits.');
      return;
    }

    if (mode === 'register') {
      if (!fullName.trim()) {
        setError('Please enter your full name.');
        return;
      }
      if (password !== confirmPassword) {
        setError('PINs do not match.');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      if (mode === 'register') {
        const { needsEmailConfirmation } = await databaseService.registerDoctor(email, password, fullName.trim());
        if (needsEmailConfirmation) {
          // Flip to the Login tab WITHOUT navigating — navigate() here would
          // switch to the /doctor/login Route and remount this component,
          // wiping the notice before it's ever shown.
          setMode('login');
          setPassword('');
          setConfirmPassword('');
          setConfirmationNotice('Account created — check your email to confirm it, then log in.');
        }
        // If no confirmation is required, App.tsx's auth-state listener
        // picks up the session and routes away automatically.
      } else {
        await databaseService.loginDoctor(email, password);
      }
    } catch (err) {
      console.warn(err);
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-md mx-auto my-12 px-4">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
        <div className="bg-gradient-to-br from-blue-600 to-blue-700 p-6 text-white text-center">
          <div className="mx-auto bg-white/15 text-white w-12 h-12 rounded-xl flex items-center justify-center mb-3 shadow-inner">
            <Stethoscope size={20} />
          </div>
          <h2 className="text-xl font-bold tracking-tight">Individual Doctor {mode === 'register' ? 'Registration' : 'Login'}</h2>
          <p className="text-xs text-blue-100/90 mt-1 font-medium">
            {mode === 'register' ? 'Create your own PrivyDoc account' : 'Sign in with your email and 6-digit PIN'}
          </p>
        </div>

        <div className="flex border-b border-slate-100">
          <button
            type="button"
            onClick={() => switchMode('login')}
            className={`flex-1 py-3 text-xs font-bold cursor-pointer transition ${
              mode === 'login' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            Log In
          </button>
          <button
            type="button"
            onClick={() => switchMode('register')}
            className={`flex-1 py-3 text-xs font-bold cursor-pointer transition ${
              mode === 'register' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            Register
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 sm:p-8 space-y-4">
          {confirmationNotice && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-3.5 flex items-start space-x-2 text-xs sm:text-sm">
              <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
              <span>{confirmationNotice}</span>
            </div>
          )}
          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-3.5 flex items-start space-x-2 text-xs sm:text-sm animate-shake">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {mode === 'register' && (
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Full Name</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Dr. Jane Doe"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">6-Digit PIN</label>
            <input
              type="password"
              maxLength={6}
              pattern="\d*"
              inputMode="numeric"
              value={password}
              onChange={(e) => setPassword(e.target.value.replace(/\D/g, ''))}
              placeholder={mode === 'register' ? 'Choose a 6-digit PIN' : 'Enter your 6-digit PIN'}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold tracking-widest text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition placeholder:font-normal placeholder:tracking-normal"
            />
          </div>

          {mode === 'register' && (
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Confirm PIN</label>
              <input
                type="password"
                maxLength={6}
                pattern="\d*"
                inputMode="numeric"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value.replace(/\D/g, ''))}
                placeholder="Re-enter your 6-digit PIN"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold tracking-widest text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition placeholder:font-normal placeholder:tracking-normal"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:text-slate-500 text-white rounded-xl text-sm font-bold shadow-sm transition transform active:scale-[0.98] cursor-pointer"
          >
            {isSubmitting ? 'Please wait...' : mode === 'register' ? 'Create Account' : 'Log In'}
          </button>
        </form>

        <div className="bg-slate-50 border-t border-slate-100 p-4 text-center">
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="text-xs font-bold text-blue-600 hover:text-blue-700 hover:underline cursor-pointer"
          >
            &larr; Back
          </button>
        </div>
      </div>
    </div>
  );
};
