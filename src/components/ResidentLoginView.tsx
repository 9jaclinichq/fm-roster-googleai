import React, { useState, useEffect } from 'react';
import { databaseService } from '../lib/databaseService';
import { WorkforceMember } from '../types';
import { KeyRound, User, ChevronDown, Sparkles, Check, AlertCircle } from 'lucide-react';

interface ResidentLoginViewProps {
  onLoginSuccess: (resident: { id: string; name: string; category: string }) => void;
  onNavigateToChief: () => void;
  presetResident?: WorkforceMember | null;
}

export const ResidentLoginView: React.FC<ResidentLoginViewProps> = ({
  onLoginSuccess,
  onNavigateToChief,
  presetResident
}) => {
  const [workforce, setWorkforce] = useState<WorkforceMember[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [accessCode, setAccessCode] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);

  useEffect(() => {
    async function loadWorkforce() {
      setIsLoading(true);
      try {
        const data = await databaseService.getWorkforce();
        setWorkforce(data.filter((w) => w.active));
      } catch (err) {
        console.warn('Error loading workforce:', err);
        setError('Failed to fetch resident names from server.');
      } finally {
        setIsLoading(false);
      }
    }
    loadWorkforce();
  }, []);

  // Update selection if pre-selected from DevHelper
  useEffect(() => {
    if (presetResident) {
      setSelectedId(presetResident.id);
      setAccessCode(presetResident.resident_code);
      setError('');
    }
  }, [presetResident]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!selectedId) {
      setError('Please select your name from the workforce list.');
      return;
    }

    if (!accessCode) {
      setError('Please enter your 6-digit access code.');
      return;
    }

    if (accessCode.length !== 6 || !/^\d+$/.test(accessCode)) {
      setError('Resident Access Code must be exactly 6 numeric digits.');
      return;
    }

    setIsLoggingIn(true);
    try {
      const selectedResident = workforce.find((w) => w.id === selectedId);
      if (!selectedResident) {
        setError('Selected resident is invalid or no longer active.');
        setIsLoggingIn(false);
        return;
      }

      // Check access code
      if (selectedResident.resident_code === accessCode) {
        // Success
        onLoginSuccess({
          id: selectedResident.id,
          name: selectedResident.full_name,
          category: selectedResident.category,
        });
      } else {
        setError('Incorrect 6-digit Access Code. Please check and try again.');
      }
    } catch (err) {
      console.warn(err);
      setError('Authentication failed. Please contact your Chief Resident.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const selectedResidentObj = workforce.find((w) => w.id === selectedId);

  return (
    <div className="max-w-md mx-auto my-12 px-4">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
        {/* Header decoration banner */}
        <div className="bg-gradient-to-br from-blue-600 to-blue-700 p-6 text-white text-center">
          <div className="mx-auto bg-white/15 text-white w-12 h-12 rounded-xl flex items-center justify-center mb-3 shadow-inner">
            <KeyRound size={20} />
          </div>
          <h2 className="text-xl font-bold tracking-tight">Resident Portal</h2>
          <p className="text-xs text-blue-100/90 mt-1 font-medium">
            Access your Department of Family Medicine Residents Dashboard
          </p>
        </div>

        <form onSubmit={handleLogin} className="p-6 sm:p-8 space-y-5">
          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-3.5 flex items-start space-x-2 text-xs sm:text-sm animate-shake">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Selector */}
          <div className="space-y-1.5 relative">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
              Select Your Name
            </label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                disabled={isLoading}
                className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-left text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition disabled:opacity-60 cursor-pointer"
              >
                <span className="flex items-center space-x-2 truncate">
                  <User size={16} className="text-slate-400 shrink-0" />
                  <span className="truncate">
                    {isLoading
                      ? 'Loading workforce list...'
                      : selectedResidentObj
                      ? selectedResidentObj.full_name
                      : 'Choose your name...'}
                  </span>
                </span>
                <ChevronDown size={16} className="text-slate-400 shrink-0 ml-1" />
              </button>

              {isDropdownOpen && !isLoading && (
                <div className="absolute z-50 mt-1.5 w-full bg-white border border-slate-200 rounded-xl shadow-lg max-h-60 overflow-y-auto divide-y divide-slate-100">
                  {workforce.map((member) => (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => {
                        setSelectedId(member.id);
                        setIsDropdownOpen(false);
                        setError('');
                      }}
                      className="w-full text-left px-4 py-2.5 hover:bg-slate-50 text-sm font-medium text-slate-700 flex items-center justify-between transition cursor-pointer"
                    >
                      <div>
                        <div className="font-bold text-slate-800">{member.full_name}</div>
                        <div className="text-[10px] text-slate-500">{member.category}</div>
                      </div>
                      {selectedId === member.id && (
                        <Check size={14} className="text-blue-600 shrink-0 font-bold" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Access Code */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
              6-Digit Access Code
            </label>
            <div className="relative">
              <input
                type="password"
                maxLength={6}
                pattern="\d*"
                inputMode="numeric"
                value={accessCode}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '');
                  setAccessCode(val);
                  setError('');
                }}
                placeholder="Enter 6-digit access code"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold tracking-widest text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition placeholder:font-normal placeholder:tracking-normal placeholder:text-slate-400"
              />
            </div>
            <p className="text-[10px] text-slate-400 leading-relaxed font-medium">
              Enter your unique 6-digit resident code. No usernames or passwords required.
            </p>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isLoggingIn || isLoading}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:text-slate-500 text-white rounded-xl text-sm font-bold shadow-sm transition transform active:scale-[0.98] cursor-pointer"
          >
            {isLoggingIn ? 'Verifying access...' : 'Access My Form'}
          </button>
        </form>

        <div className="bg-slate-50 border-t border-slate-100 p-4 text-center">
          <button
            type="button"
            onClick={onNavigateToChief}
            className="text-xs font-bold text-blue-600 hover:text-blue-700 hover:underline cursor-pointer"
          >
            Are you the Chief Resident? Admin Portal &rarr;
          </button>
        </div>
      </div>
    </div>
  );
};
