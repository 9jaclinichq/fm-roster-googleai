import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { databaseService } from '../../../lib/databaseService';
import { ShieldAlert, AlertCircle, Key, RefreshCw } from 'lucide-react';
import { useTerminology } from '../../shared/terminology';

interface ChiefLoginViewProps {
  onLoginSuccess: (adminCode: string, tenantId: string, tenantName: string) => void;
  onNavigateToResident: () => void;
  presetCode?: string;
}

// A connection-level network failure (offline, DNS failure) can leave the
// underlying fetch() never settling — unlike an HTTP-level error, which
// supabase-js already surfaces cleanly as {error}. Without this, a Chief
// on a dropped connection would see "Verifying admin level..." forever
// with no error and a permanently disabled submit button (found via
// adversarial QA, 2026-08-17 — same root cause as ResidentLoginView's
// identical withTimeout fix).
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Request timed out')), ms)),
  ]);
}

export const ChiefLoginView: React.FC<ChiefLoginViewProps> = ({
  onLoginSuccess,
  onNavigateToResident,
  presetCode
}) => {
  const navigate = useNavigate();
  const [adminCode, setAdminCode] = useState<string>('');
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const { t } = useTerminology();

  useEffect(() => {
    if (presetCode) {
      setAdminCode(presetCode);
      setError('');
    }
  }, [presetCode]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!adminCode) {
      setError(`Please enter the ${t('admin', 'Organisation Administrator')} recovery access code.`);
      return;
    }

    setIsLoggingIn(true);
    try {
      // Verified server-side — the admin_access_code column is never sent to the client.
      // Migration 23: the code itself resolves which tenant this Chief belongs to.
      const verified = await withTimeout(databaseService.verifyChiefLogin(adminCode), 15000);

      if (verified) {
        onLoginSuccess(adminCode, verified.tenantId, verified.tenantName);
      } else {
        setError('Incorrect Admin Access Code. Access Denied.');
      }
    } catch (err) {
      console.warn(err);
      setError('An error occurred during verification. Check your connection and try again.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  return (
    <div className="max-w-md mx-auto my-12 px-4">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
        {/* Admin Header Decorative Bar */}
        <div className="bg-gradient-to-br from-blue-700 to-indigo-900 p-6 text-white text-center">
          <div className="mx-auto bg-white/10 text-white w-12 h-12 rounded-xl flex items-center justify-center mb-3 border border-white/10">
            <ShieldAlert size={20} />
          </div>
          <h2 className="text-xl font-bold tracking-tight">Transitional administrator recovery</h2>
          <p className="text-xs text-blue-100/90 mt-1 font-medium">
            Use personal sign-in for normal organisation administration
          </p>
        </div>

        <form onSubmit={handleLogin} className="p-6 sm:p-8 space-y-5">
          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-3.5 flex items-start space-x-2 text-xs sm:text-sm">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Admin Code Input */}
          <div className="space-y-1.5">
            <label htmlFor="admin-code" className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
              Recovery access code
            </label>
            <div className="relative">
              <input
                id="admin-code"
                type="password"
                value={adminCode}
                onChange={(e) => {
                  setAdminCode(e.target.value);
                  setError('');
                }}
                placeholder="Enter recovery access code"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold tracking-widest text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition placeholder:font-normal placeholder:tracking-normal placeholder:text-slate-400"
              />
            </div>
            <p className="text-[10px] text-slate-400 leading-relaxed font-medium">
              This shared-code route is retained temporarily for recovery. It does not create or grant personal tenant-administrator authority.
            </p>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isLoggingIn}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded-xl text-sm font-bold shadow-md transition transform active:scale-[0.98] cursor-pointer flex items-center justify-center"
          >
            {isLoggingIn ? (
              <>
                <RefreshCw size={14} className="animate-spin mr-1.5" />
                <span>Verifying admin level...</span>
              </>
            ) : (
              <span>Verify recovery access</span>
            )}
          </button>
        </form>

        <div className="bg-slate-50 border-t border-slate-100 p-4 flex items-center justify-between text-xs">
          <button
            type="button"
            onClick={() => navigate('/admin-portal')}
            className="font-bold text-blue-600 hover:text-blue-700 hover:underline cursor-pointer"
          >
            &larr; Back
          </button>
          <button
            type="button"
            onClick={onNavigateToResident}
            className="font-bold text-blue-600 hover:text-blue-700 hover:underline cursor-pointer"
          >
            Go to {t('member', 'Member')} Dashboard &rarr;
          </button>
        </div>
      </div>
    </div>
  );
};
