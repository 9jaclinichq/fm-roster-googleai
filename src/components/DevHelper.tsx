import React, { useState } from 'react';
import { databaseService } from '../lib/databaseService';
import { WorkforceMember } from '../types';
import { Eye, EyeOff, Users, Key, Sparkles, CheckCircle2, AlertTriangle } from 'lucide-react';

interface DevHelperProps {
  onSelectResident?: (member: WorkforceMember) => void;
  onSelectAdmin?: (code: string) => void;
}

export const DevHelper: React.FC<DevHelperProps> = ({ onSelectResident }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [workforce, setWorkforce] = useState<WorkforceMember[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const loadCodes = async () => {
    if (!isOpen) {
      setIsLoading(true);
      try {
        const wfData = await databaseService.getWorkforce();
        setWorkforce(wfData.filter(w => w.active));
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
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center space-x-3 flex-1 min-w-[280px]">
            <div className="bg-amber-100 p-2 rounded-lg text-amber-800 shrink-0">
              <Sparkles size={18} />
            </div>
            <div>
              <h3 className="font-bold text-amber-900 text-sm md:text-base">FM Residents Temporary Directory</h3>
              <p className="text-xs text-amber-700 leading-relaxed mt-0.5">
                First-time system setup directory for residents to find their login access codes.
              </p>
            </div>
          </div>
          <button
            onClick={loadCodes}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-md text-xs font-bold shadow-sm transition cursor-pointer shrink-0"
          >
            {isOpen ? <EyeOff size={14} /> : <Eye size={14} />}
            <span>{isOpen ? 'Hide Access Directory' : 'Show Access Directory'}</span>
          </button>
        </div>

        {isOpen && (
          <div className="mt-4 pt-4 border-t border-amber-200 grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Warning Message Box */}
            <div className="bg-amber-100/60 border border-amber-200 rounded-xl p-4 flex flex-col justify-center">
              <div className="flex items-start space-x-2.5">
                <AlertTriangle className="text-amber-700 shrink-0 mt-0.5" size={18} />
                <div>
                  <h4 className="font-bold text-amber-900 text-xs uppercase tracking-wider">
                    Attention Residents
                  </h4>
                  <p className="text-xs text-amber-800 font-medium mt-1.5 leading-relaxed">
                    This directory helper is provided <strong className="text-amber-950 font-bold">strictly for the initial setup phase</strong> to transition smoothly.
                  </p>
                  <p className="text-xs text-amber-800 font-medium mt-2 leading-relaxed">
                    It will be <strong className="text-amber-950 font-bold">removed shortly</strong>. Please find your name, <strong className="text-amber-950 font-bold">copy and save your 6-digit access code</strong> to a secure place right away. You will need it for all future submissions.
                  </p>
                </div>
              </div>
            </div>

            {/* Resident Codes Box */}
            <div>
              <div className="flex items-center space-x-1.5 mb-2 text-amber-900 font-semibold text-xs uppercase tracking-wider">
                <Users size={14} />
                <span>Resident Access Codes ({workforce.length})</span>
              </div>
              <div className="bg-white rounded-lg border border-amber-200 divide-y divide-amber-100 max-h-56 overflow-y-auto">
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
                          title="Click to Copy Code"
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
