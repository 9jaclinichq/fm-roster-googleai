import React, { useState, useEffect } from 'react';
import { databaseService } from '../lib/databaseService';
import { ShieldAlert, AlertCircle, Key, RefreshCw } from 'lucide-react';

interface ChiefLoginViewProps {
  onLoginSuccess: () => void;
  onNavigateToResident: () => void;
  presetCode?: string;
}

export const ChiefLoginView: React.FC<ChiefLoginViewProps> = ({
  onLoginSuccess,
  onNavigateToResident,
  presetCode
}) => {
  const [adminCode, setAdminCode] = useState<string>('');
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

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
      setError('Please enter the Admin Access Code.');
      return;
    }

    setIsLoggingIn(true);
    try {
      const settings = await databaseService.getSettings();
      
      if (settings.admin_access_code === adminCode) {
        // Success
        onLoginSuccess();
      } else {
        setError('Incorrect Admin Access Code. Access Denied.');
      }
    } catch (err) {
      console.warn(err);
      setError('An error occurred during verification. Please try again.');
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
          <h2 className="text-xl font-bold tracking-tight">Chief Resident Portal</h2>
          <p className="text-xs text-blue-100/90 mt-1 font-medium">
            Department administrative login & roster dashboard
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
              Admin Access Code
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
                placeholder="Enter Admin Access Code"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold tracking-widest text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition placeholder:font-normal placeholder:tracking-normal placeholder:text-slate-400"
              />
            </div>
            <p className="text-[10px] text-slate-400 leading-relaxed font-medium">
              Input the Department administrative code to access management grids, reset resident codes, export reports, and adjust deadlines.
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
              <span>Verify Administrative Access</span>
            )}
          </button>
        </form>

        <div className="bg-slate-50 border-t border-slate-100 p-4 text-center">
          <button
            type="button"
            onClick={onNavigateToResident}
            className="text-xs font-bold text-blue-600 hover:text-blue-700 hover:underline cursor-pointer"
          >
            Go back to Resident Roster Submission form &rarr;
          </button>
        </div>
      </div>
    </div>
  );
};
