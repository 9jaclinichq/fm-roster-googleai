import React, { useEffect, useState, useCallback } from 'react';
import { fullRosterService, FullRosterResult } from '../lib/fullRosterService';
import { rosterSectionPresentationService } from '../lib/rosterSectionPresentationService';
import { RosterSectionKey, RosterSectionPresentation, ROSTER_SECTION_KEYS, resolveRosterSectionPresentation } from '../lib/rosterSectionPresentation';
import { Table2, RefreshCw, Lock, AlertCircle, StickyNote, Stethoscope, ShieldCheck, MapPin, Clock, Users } from 'lucide-react';

// Small, bounded icon-name -> component lookup for the OPTIONAL
// tenant-configured `icon` field (migration 74). Not an extensible
// icon-picker system — just enough to prove the config model cleanly. An
// unrecognized/absent icon renders nothing (safe fallback), never a
// broken reference.
const ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  Table2, Stethoscope, ShieldCheck, MapPin, Clock, Users,
};

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
  key: RosterSectionKey;
  // Migration 74: resolved via resolveRosterSectionPresentation (tenant
  // config with deterministic current-behavior fallback) — never
  // hardcoded here directly. Presentation only; rows/assignees below are
  // completely unaffected by any of these fields.
  label: string;
  shortLabel: string | null;
  accentColor: string | null;
  icon: string | null;
  rows: RosterRow[];
  notes: string[];
}

function buildSections(result: FullRosterResult, presentation: RosterSectionPresentation[]): RosterSection[] {
  const bySectionKey: Record<RosterSectionKey, Omit<RosterSection, 'label' | 'shortLabel' | 'accentColor' | 'icon'>> = {
    gop: {
      key: 'gop',
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
    emergency: {
      key: 'emergency',
      rows: result.emergency_call_grid.shifts.map((s) => ({
        date_or_day: s.date_or_day,
        duty_or_service_point: s.shift,
        assignees: s.on_call.map((name) => ({ name })),
      })),
      notes: result.emergency_call_grid.unparsed_notes,
    },
    supervision: {
      key: 'supervision',
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
    satellite: {
      key: 'satellite',
      rows: result.satellite_grid.postings.map((p) => ({
        date_or_day: p.date_or_day,
        duty_or_service_point: p.facility,
        assignees: p.assigned.map((name) => ({ name })),
      })),
      notes: result.satellite_grid.unparsed_notes,
    },
  };

  // Order follows tenant-configured display_order where configured,
  // falling back to today's current order — never a fixed literal order
  // here.
  return ROSTER_SECTION_KEYS
    .map((key) => {
      const resolved = resolveRosterSectionPresentation(key, presentation);
      return {
        ...bySectionKey[key],
        label: resolved.display_label,
        shortLabel: resolved.short_label,
        accentColor: resolved.accent_color,
        icon: resolved.icon,
        _order: resolved.display_order,
      };
    })
    .sort((a, b) => a._order - b._order)
    .map(({ _order, ...section }) => section);
}

export const FullRosterView: React.FC<FullRosterViewProps> = ({ resident, accessCode }) => {
  const [enteredCode, setEnteredCode] = useState<string>('');
  const [activeCode, setActiveCode] = useState<string | null>(accessCode);
  const [result, setResult] = useState<FullRosterResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  // Migration 74: tenant-configured section presentation. Loaded
  // best-effort alongside the roster itself — a failed load simply leaves
  // this empty, and resolveRosterSectionPresentation still renders
  // today's current fallback labels/order, so a presentation-load
  // failure never blocks or breaks the actual roster view.
  const [presentation, setPresentation] = useState<RosterSectionPresentation[]>([]);

  const load = useCallback(async (code: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fullRosterService.getCurrentFullRoster(resident.id, code);
      setResult(res);
      setActiveCode(code);
      rosterSectionPresentationService.getResidentPresentation(resident.id, code)
        .then(setPresentation)
        .catch((err) => console.warn('Failed to load roster section presentation (using fallback labels):', err));
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
          {buildSections(result, presentation).map((section) => {
            // Color is purely visual metadata (migration 74) — never a
            // substitute for the textual label, which always renders
            // regardless of whether a color is configured. An
            // unrecognized/absent accent_color simply renders no
            // border/dot at all (safe fallback), never a broken style.
            const SectionIcon = section.icon ? ICON_MAP[section.icon] : undefined;
            return (
            <div
              key={section.key}
              className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden"
              style={section.accentColor ? { borderLeftWidth: 4, borderLeftColor: section.accentColor } : undefined}
            >
              <div className="px-4 sm:px-5 py-3 border-b border-slate-100 flex items-center gap-2">
                {section.accentColor && (
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: section.accentColor }} aria-hidden="true" />
                )}
                {SectionIcon && <SectionIcon size={14} className="text-slate-400 shrink-0" />}
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
            );
          })}
        </div>
      ) : null}
    </div>
  );
};
