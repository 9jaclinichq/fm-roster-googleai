import React, { useState } from 'react';
import { databaseService } from '../lib/databaseService';
import { WorkforceMember } from '../types';
import { Eye, EyeOff, Shield, Users, Key, Sparkles, CheckCircle2 } from 'lucide-react';

interface DevHelperProps {
  onSelectResident?: (member: WorkforceMember) => void;
  onSelectAdmin?: (code: string) => void;
}

export const DevHelper: React.FC<DevHelperProps> = ({ onSelectResident, onSelectAdmin }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [workforce, setWorkforce] = useState<WorkforceMember[]>([]);
  const [adminCode, setAdminCode] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const loadCodes = async () => {
    if (!isOpen) {
      setIsLoading(true);
      try {
        const [wfData, settingsData] = await Promise.all([
          databaseService.getWorkforce(),
          databaseService.getSettings()
        ]);
        setWorkforce(wfData.filter(w => w.active));
        if (settingsData && settingsData.admin_access_code) {
          setAdminCode(settingsData.admin_access_code);
        }
      } catch (err) {
        console.warn('Failed to load credentials explorer from Supabase', err);
      } finally {
        setIsLoading(false);
      }
    }
    setIsOpen(!isOpen);
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div id="dev-helper-panel" className="max-w-4xl mx-auto my-6 px-4">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 shadow-sm">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center space-x-3">
            <div className="bg-amber-100 p-2 rounded-lg text-amber-800">
              <Sparkles size={18} />
            </div>
            <div>
              <h3 className="font-bold text-amber-900 text-sm md:text-base">FM Roster Explorer (Live Supabase)</h3>
              <p className="text-xs text-amber-700">
                Reveal the randomly generated resident codes and admin keys stored in the database.
              </p>
            </div>
          </div>
          <button
            onClick={loadCodes}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-md text-xs font-bold shadow-sm transition cursor-pointer"
          >
            {isOpen ? <EyeOff size={14} /> : <Eye size={14} />}
            <span>{isOpen ? 'Hide Credentials' : 'Reveal Demo Credentials'}</span>
          </button>
        </div>

        {isOpen && (
          <div className="mt-4 pt-4 border-t border-amber-200 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center space-x-1.5 mb-2 text-amber-900 font-semibold text-xs uppercase tracking-wider">
                <Shield size={14} />
                <span>Administrative Access</span>
              </div>
              <div className="bg-white rounded-lg p-3 border border-amber-200 flex items-center justify-between text-xs">
                <div>
                  <span className="font-bold text-slate-700">Chief Resident Portal:</span>
                  <div className="font-mono text-amber-800 font-extrabold text-sm mt-0.5">
                    Admin Code: {isLoading ? '...' : adminCode || 'Not Seeded'}
                  </div>
                </div>
                {onSelectAdmin && adminCode && (
                  <button
                    onClick={() => onSelectAdmin(adminCode)}
                    className="px-2.5 py-1 bg-amber-100 text-amber-800 hover:bg-amber-200 font-bold rounded-md transition cursor-pointer"
                  >
                    Use Code
                  </button>
                )}
              </div>
            </div>

            <div>
              <div className="flex items-center space-x-1.5 mb-2 text-amber-900 font-semibold text-xs uppercase tracking-wider">
                <Users size={14} />
                <span>Resident Access Codes ({workforce.length})</span>
              </div>
              <div className="bg-white rounded-lg border border-amber-200 divide-y divide-amber-100 max-h-48 overflow-y-auto">
                {isLoading ? (
                  <div className="p-4 text-center text-xs text-slate-500 font-mono">Loading credentials...</div>
                ) : workforce.length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-500">No active residents found</div>
                ) : (
                  workforce.map((member) => (
                    <div key={member.id} className="p-2.5 flex items-center justify-between text-xs hover:bg-amber-50/50">
                      <div className="truncate pr-2">
                        <div className="font-bold text-slate-800 truncate">{member.full_name}</div>
                        <div className="text-[10px] text-slate-500">{member.category}</div>
                      </div>
                      <div className="flex items-center space-x-2 shrink-0">
                        <button
                          onClick={() => copyToClipboard(member.resident_code, member.id)}
                          className="font-mono bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-0.5 rounded-md font-bold border border-slate-200 cursor-pointer flex items-center space-x-1"
                          title="Click to Copy"
                        >
                          <span>{member.resident_code}</span>
                          {copied === member.id ? (
                            <CheckCircle2 size={10} className="text-green-600" />
                          ) : (
                            <Key size={10} className="text-slate-400" />
                          )}
                        </button>
                        {onSelectResident && (
                          <button
                            onClick={() => onSelectResident(member)}
                            className="px-2 py-0.5 bg-amber-100 hover:bg-amber-200 text-amber-800 font-bold rounded-md text-[10px] cursor-pointer"
                          >
                            Fill Form
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
