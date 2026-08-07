import React, { useState } from 'react';
import { databaseService } from '../lib/databaseService';
import { WorkforceMember } from '../types';
import { Eye, EyeOff, Users, Sparkles } from 'lucide-react';

interface DevHelperProps {
  onSelectResident?: (member: WorkforceMember) => void;
  onSelectAdmin?: (code: string) => void;
}

// Local-development-only convenience panel (see App.tsx — only rendered when
// import.meta.env.DEV is true). Resident/admin access codes are no longer
// fetchable by the client at all (locked down at the database level), so
// this only helps pick a resident name to speed up manual testing; look up
// actual codes in the Supabase SQL editor.
export const DevHelper: React.FC<DevHelperProps> = ({ onSelectResident }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [workforce, setWorkforce] = useState<WorkforceMember[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const loadWorkforce = async () => {
    if (!isOpen) {
      setIsLoading(true);
      try {
        const wfData = await databaseService.getWorkforce();
        setWorkforce(wfData.filter(w => w.active));
      } catch (err) {
        console.warn('Failed to load workforce for dev helper', err);
      } finally {
        setIsLoading(false);
      }
    }
    setIsOpen(!isOpen);
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
              <h3 className="font-bold text-amber-900 text-sm md:text-base">Dev Helper (local only)</h3>
              <p className="text-xs text-amber-700">
                Pick a resident name to pre-fill the login form. Access codes are not readable here — check the Supabase SQL editor.
              </p>
            </div>
          </div>
          <button
            onClick={loadWorkforce}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-md text-xs font-bold shadow-sm transition cursor-pointer"
          >
            {isOpen ? <EyeOff size={14} /> : <Eye size={14} />}
            <span>{isOpen ? 'Hide' : 'Show Residents'}</span>
          </button>
        </div>

        {isOpen && (
          <div className="mt-4 pt-4 border-t border-amber-200">
            <div className="flex items-center space-x-1.5 mb-2 text-amber-900 font-semibold text-xs uppercase tracking-wider">
              <Users size={14} />
              <span>Active Residents ({workforce.length})</span>
            </div>
            <div className="bg-white rounded-lg border border-amber-200 divide-y divide-amber-100 max-h-48 overflow-y-auto">
              {isLoading ? (
                <div className="p-4 text-center text-xs text-slate-500 font-mono">Loading workforce...</div>
              ) : workforce.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-500">No active residents found</div>
              ) : (
                workforce.map((member) => (
                  <div key={member.id} className="p-2.5 flex items-center justify-between text-xs hover:bg-amber-50/50">
                    <div className="truncate pr-2">
                      <div className="font-bold text-slate-800 truncate">{member.full_name}</div>
                      <div className="text-[10px] text-slate-500">{member.category}</div>
                    </div>
                    {onSelectResident && (
                      <button
                        onClick={() => onSelectResident(member)}
                        className="px-2 py-0.5 bg-amber-100 hover:bg-amber-200 text-amber-800 font-bold rounded-md text-[10px] cursor-pointer shrink-0"
                      >
                        Select
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
