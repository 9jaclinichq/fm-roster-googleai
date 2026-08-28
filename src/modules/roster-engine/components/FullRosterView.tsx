import React, { useEffect, useState, useCallback } from 'react';
import { fullRosterService, FullRosterResult } from '../lib/fullRosterService';
import { Table2, RefreshCw, Lock, AlertCircle, StickyNote } from 'lucide-react';

interface FullRosterViewProps {
  resident: { id: string; name: string; category: string };
  // Same in-memory-only access PIN as MyAssignmentView — see that file's
  // own comment on why this is never persisted and why (workforce_id,
  // code) is required on every call under the current transitional
  // resident login model.
  accessCode: string | null;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Generic roster-section model this view actually renders against —
// deliberately NOT typed around GOP/A&E/Supervision/Satellite as distinct
// concepts anywhere below this point. Each of the 4 stored grids is
// reshaped ONCE (below, in buildSections) into this same generic shape:
// a roster section has rows, each row has an optional date/day, an
// optional duty/service-point label, and a list of assignees (each
// optionally carrying its own role label, e.g. Supervision's "1st On
// Duty" vs "2nd On Duty", or GOP's "Consultant" vs "Resident"). This is
// what lets the render logic below stay one generic loop instead of four
// near-duplicate ones, and is also what a future roster_section_config
// label/color layer can hook into later (swap `label` for a tenant's
// configured display label) without touching this transform or the
// render logic at all.
interface RosterAssignee {
  role?: string;
  name: string;
}
interface RosterRow {
  date_or_day: string | null;
  duty_or_service_point: string | null;
  assignees: RosterAssignee[];
}
interface RosterSection {
  key: 'gop' | 'emergency' | 'supervision' | 'satellite';
  // Current stored/display vocabulary, used verbatim for now per this
  // slice's explicit scope boundary (no roster_section_config yet) — this
  // is data/presentation text, not a hardcoded assumption baked into the
  // section's own key or into any matching/business logic.
  label: string;
  rows: RosterRow[];
  notes: string[];
}

function buildSections(result: FullRosterResult): RosterSection[] {
  return [
    {
      key: 'gop',
      label: 'GOP Clinic Grid',
      rows: result.gop_clinic_grid.slots.map((s) => ({
        date_or_day: s.date_or_day,
        duty_or_service_point: s.clinic_type,
        assignees: [
          ...s.consultants.map((name) => ({ role: 'Consultant', name })),
          ...((s.residents || []).map((name) => ({ role: 'Resident', name }))),
        ],
      })),
      notes: result.gop_clinic_grid.unparsed_notes,
    },
    {
      key: 'emergency',
      label: 'A&E Emergency Grid',
      rows: result.emergency_call_grid.shifts.map((s) => ({
        date_or_day: s.date_or_day,
        duty_or_service_point: s.shift,
        assignees: s.on_call.map((name) => ({ name })),
      })),
      notes: result.emergency_call_grid.unparsed_notes,
    },
    {
      key: 'supervision',
      label: 'Supervision Grid',
      rows: result.supervision_grid.duties.map((d) => ({
        date_or_day: d.date_or_day,
        duty_or_service_point: null,
        assignees: (
          [
            d.first_on_duty ? { role: '1st On Duty', name: d.first_on_duty } : null,
            d.second_on_duty ? { role: '2nd On Duty', name: d.second_on_duty } : null,
          ] as (RosterAssignee | null)[]
        ).filter((a): a is RosterAssignee => a !== null),
      })),
      notes: result.supervision_grid.unparsed_notes,
    },
    {
      key: 'satellite',
      label: 'Satellite Grid',
      rows: result.satellite_grid.postings.map((p) => ({
        date_or_day: p.date_or_day,
        duty_or_service_point: p.facility,
        assignees: p.assigned.map((name) => ({ name })),
      })),
      notes: result.satellite_grid.unparsed_notes,
    },
  ];
}

export const FullRosterView: React.FC<FullRosterViewProps> = ({ resident, accessCode }) => {
  const [enteredCode, setEnteredCode] = useState<string>('');
  const [activeCode, setActiveCode] = useState<string | null>(accessCode);
  const [result, setResult] = useState<FullRosterResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (code: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fullRosterService.getCurrentFullRoster(resident.id, code);
      setResult(res);
      setActiveCode(code);
    } catch (err) {
      console.warn('Failed to load current full roster:', err);
      setResult(null);
      setError('That access PIN was not accepted. Please check it and try again.');
    } finally {
      setIsLoading(false);
    }
  }, [resident.id]);

  useEffect(() => {
    if (accessCode) {
      load(accessCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessCode]);

  const handleConfirmCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enteredCode.trim()) return;
    await load(enteredCode.trim());
  };

  if (!activeCode && !isLoading) {
    return (
      <div className="max-w-md mx-auto my-8 px-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm text-center">
          <Lock className="mx-auto mb-3 text-slate-400" size={28} />
          <h2 className="font-bold text-slate-900 text-lg tracking-tight mb-1">Confirm Your Access PIN</h2>
          <p className="text-xs sm:text-sm text-slate-500 mb-4">
            To protect colleagues' assignment information, please re-enter
            your access PIN to view the full department roster.
          </p>
          <form onSubmit={handleConfirmCode} className="space-y-3">
            <input
              type="password"
              inputMode="numeric"
              autoFocus
              placeholder="Access PIN"
              value={enteredCode}
              onChange={(e) => setEnteredCode(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
            />
            {error && (
              <p className="text-xs text-rose-600 font-medium flex items-center justify-center gap-1">
                <AlertCircle size={13} /> {error}
              </p>
            )}
            <button
              type="submit"
              disabled={!enteredCode.trim()}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-sm font-semibold shadow-sm transition cursor-pointer"
            >
              View Full Roster
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto my-8 px-4 space-y-4">
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center space-x-2 mb-1">
          <Table2 className="text-slate-500" size={18} />
          <h2 className="font-bold text-slate-900 text-lg tracking-tight">Full Roster</h2>
        </div>
        <p className="text-[11px] text-slate-400 font-medium">
          {resident.name} &middot; {resident.category} &middot; the complete published duty roster
        </p>
      </div>

      {isLoading ? (
        <div className="text-center py-12 bg-white border border-slate-200 rounded-2xl">
          <RefreshCw size={26} className="text-slate-400 animate-spin mx-auto mb-2" />
          <p className="text-sm text-slate-500">Loading the full roster...</p>
        </div>
      ) : error ? (
        <div className="text-center py-10 bg-white border border-slate-200 rounded-2xl px-4">
          <AlertCircle size={26} className="text-rose-400 mx-auto mb-2" />
          <p className="text-sm text-rose-600 font-medium mb-3">{error}</p>
          <button
            onClick={() => { setActiveCode(null); setEnteredCode(''); setError(null); }}
            className="px-4 py-2 border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md text-xs font-semibold cursor-pointer"
          >
            Try Again
          </button>
        </div>
      ) : result?.status === 'not_published' ? (
        <div className="text-center py-12 bg-white border border-slate-200 rounded-2xl text-slate-400">
          <Table2 size={28} className="mx-auto mb-2" />
          <p className="text-sm font-medium text-slate-600">Roster not published yet</p>
          <p className="text-xs text-slate-400 mt-1">Check back once the current cycle's roster has been published.</p>
        </div>
      ) : result?.status === 'published' ? (
        <div className="space-y-5">
          <p className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">
            {result.month && result.year ? `${MONTH_NAMES[result.month - 1]} ${result.year}` : 'Current Cycle'}
          </p>
          {buildSections(result).map((section) => (
            <div key={section.key} className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-4 sm:px-5 py-3 border-b border-slate-100">
                <h3 className="font-bold text-slate-800 text-sm">{section.label}</h3>
              </div>

              {section.rows.length === 0 ? (
                <p className="px-4 sm:px-5 py-4 text-xs text-slate-400">No entries recorded for this section.</p>
              ) : (
                <>
                  {/* Desktop/tablet: table/grid structure, horizontally
                      scrollable rather than dropping columns. */}
                  <div className="hidden sm:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400 font-bold border-b border-slate-100">
                          <th className="px-4 sm:px-5 py-2 font-bold whitespace-nowrap">Date / Day</th>
                          <th className="px-4 sm:px-5 py-2 font-bold whitespace-nowrap">Duty / Service Point</th>
                          <th className="px-4 sm:px-5 py-2 font-bold">Assignees</th>
                        </tr>
                      </thead>
                      <tbody>
                        {section.rows.map((row, i) => (
                          <tr key={i} className="border-b border-slate-50 last:border-0 align-top">
                            <td className="px-4 sm:px-5 py-2.5 text-slate-500 font-medium whitespace-nowrap">
                              {row.date_or_day ?? <span className="text-slate-300">&mdash;</span>}
                            </td>
                            <td className="px-4 sm:px-5 py-2.5 text-slate-800 font-semibold whitespace-nowrap">
                              {row.duty_or_service_point ?? <span className="text-slate-300">&mdash;</span>}
                            </td>
                            <td className="px-4 sm:px-5 py-2.5 text-slate-700">
                              {row.assignees.length === 0 ? (
                                <span className="text-slate-300">Unassigned</span>
                              ) : (
                                <div className="flex flex-wrap gap-x-3 gap-y-1">
                                  {row.assignees.map((a, ai) => (
                                    <span key={ai}>
                                      {a.role && <span className="text-slate-400 text-xs mr-1">{a.role}:</span>}
                                      {a.name}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile: stacked cards, preserving every field — never
                      collapsed or summarized away. */}
                  <div className="sm:hidden divide-y divide-slate-50">
                    {section.rows.map((row, i) => (
                      <div key={i} className="px-4 py-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium text-slate-500">
                            {row.date_or_day ?? <span className="text-slate-300">&mdash;</span>}
                          </span>
                          {row.duty_or_service_point && (
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                              {row.duty_or_service_point}
                            </span>
                          )}
                        </div>
                        {row.assignees.length === 0 ? (
                          <p className="text-sm text-slate-300">Unassigned</p>
                        ) : (
                          <div className="space-y-0.5">
                            {row.assignees.map((a, ai) => (
                              <p key={ai} className="text-sm text-slate-800 font-semibold">
                                {a.role && <span className="text-slate-400 font-medium text-xs mr-1">{a.role}:</span>}
                                {a.name}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}

              {section.notes.length > 0 && (
                <div className="px-4 sm:px-5 py-3 border-t border-slate-100 bg-slate-50/60">
                  <div className="flex items-center gap-1.5 mb-1">
                    <StickyNote size={12} className="text-slate-400" />
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Notes</span>
                  </div>
                  {section.notes.map((n, i) => (
                    <p key={i} className="text-xs text-slate-500 leading-relaxed">{n}</p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};
