import React, { useEffect, useMemo, useState } from 'react';
import { Laugh, Smile, Meh, Frown, Angry, RefreshCw, Moon, NotebookPen, Save } from 'lucide-react';
import { supabase } from '../../../lib/databaseService';
import {
  getRecentEntries,
  upsertTodaysEntry,
  WellbeingEntryRow,
  WellbeingOwnerRef,
  MoodValue,
} from '../lib/wellbeingService';

// Wellbeing module (migration 51) — self-contained mood check-in + sleep
// tracking screen, one of 4 modules selected from the "Workspc" reference
// study (see migration 51's own header). Follows this app's established
// dual-identity-aware full-page view pattern (UnifiedRecordView.tsx: an
// `owner` prop, self-contained data fetching in a useEffect, light Tailwind
// card styling, loading/error states) — NOT a reskin of the dark Flutter
// mockup, per IntelligenceHarnessHome.tsx's own header on why this app
// carries over structure/functionality rather than the dark theme.
//
// New, standalone file — not wired into any route/nav yet; the parent
// session wires this in alongside the other 3 new modules built in
// parallel this session (Focus Mode, Tasks, Team Directory).

interface WellbeingViewOwner {
  id: string;
  name: string;
  kind: 'workforce' | 'doctor';
  tenantId: string;
}

interface WellbeingViewProps {
  owner: WellbeingViewOwner;
}

const MOOD_OPTIONS: { value: MoodValue; label: string; Icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
  { value: 'great', label: 'Great', Icon: Laugh },
  { value: 'good', label: 'Good', Icon: Smile },
  { value: 'okay', label: 'Okay', Icon: Meh },
  { value: 'low', label: 'Low', Icon: Frown },
  { value: 'bad', label: 'Bad', Icon: Angry },
];

// Ordered worst -> best for the trend bar's height/color scale.
const MOOD_RANK: Record<MoodValue, number> = { bad: 1, low: 2, okay: 3, good: 4, great: 5 };

const MOOD_BAR_COLOR: Record<MoodValue, string> = {
  great: 'bg-emerald-500',
  good: 'bg-teal-500',
  okay: 'bg-amber-400',
  low: 'bg-orange-400',
  bad: 'bg-rose-500',
};

const MOOD_LABEL: Record<MoodValue, string> = {
  great: 'Great',
  good: 'Good',
  okay: 'Okay',
  low: 'Low',
  bad: 'Bad',
};

function toOwnerRef(owner: WellbeingViewOwner): WellbeingOwnerRef {
  return owner.kind === 'workforce'
    ? { workforceId: owner.id, tenantId: owner.tenantId }
    : { doctorId: owner.id };
}

function todayIso(): string {
  return new Date().toISOString().split('T')[0];
}

export const WellbeingView: React.FC<WellbeingViewProps> = ({ owner }) => {
  const ownerRef = useMemo(() => toOwnerRef(owner), [owner.id, owner.kind, owner.tenantId]);

  const [entries, setEntries] = useState<WellbeingEntryRow[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedJustNow, setSavedJustNow] = useState<boolean>(false);

  const [mood, setMood] = useState<MoodValue | null>(null);
  const [sleepHours, setSleepHours] = useState<string>('');
  const [journalNote, setJournalNote] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    getRecentEntries(ownerRef, 14)
      .then((rows) => {
        if (cancelled) return;
        setEntries(rows);
        const today = todayIso();
        const todaysEntry = rows.find((row) => row.entry_date === today);
        if (todaysEntry) {
          setMood(todaysEntry.mood);
          setSleepHours(todaysEntry.sleep_hours != null ? String(todaysEntry.sleep_hours) : '');
          setJournalNote(todaysEntry.journal_note || '');
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load wellbeing entries.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [ownerRef]);

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    setSavedJustNow(false);
    try {
      const parsedSleep = sleepHours.trim() === '' ? null : Number(sleepHours);
      const saved = await upsertTodaysEntry(ownerRef, {
        mood: mood ?? undefined,
        sleep_hours: parsedSleep,
        journal_note: journalNote.trim() === '' ? null : journalNote,
      });
      setEntries((prev) => {
        const today = todayIso();
        const withoutToday = prev.filter((row) => row.entry_date !== today);
        return [saved, ...withoutToday].sort((a, b) => (a.entry_date < b.entry_date ? 1 : -1));
      });
      setSavedJustNow(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save your check-in.');
    } finally {
      setIsSaving(false);
    }
  };

  // Trend strip: last 14 days (oldest -> newest), one bar per day, only
  // filled for days with a recorded mood.
  const trendDays = useMemo(() => {
    const days: { dateIso: string; label: string; entry: WellbeingEntryRow | null }[] = [];
    for (let i = 13; i >= 0; i -= 1) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateIso = d.toISOString().split('T')[0];
      const entry = entries.find((row) => row.entry_date === dateIso) || null;
      days.push({
        dateIso,
        label: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
        entry,
      });
    }
    return days;
  }, [entries]);

  const recentWithContent = useMemo(
    () => entries.filter((row) => row.mood || (row.journal_note && row.journal_note.trim() !== '')),
    [entries]
  );

  if (!supabase) {
    return (
      <div className="max-w-3xl mx-auto my-8 px-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <p className="text-sm text-red-600">Supabase is not configured yet.</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="text-center py-16">
        <RefreshCw size={28} className="text-slate-400 animate-spin mx-auto mb-2" />
        <p className="text-sm text-slate-500">Loading your wellbeing check-ins...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-3xl mx-auto my-8 px-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto my-8 px-4 space-y-6">
      {/* Today's check-in */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex items-center space-x-2">
          <Smile className="text-slate-500" size={18} />
          <h2 className="font-bold text-slate-900 text-lg tracking-tight">Today&apos;s Check-In</h2>
        </div>

        <div>
          <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-2">How are you feeling?</p>
          <div className="grid grid-cols-5 gap-2">
            {MOOD_OPTIONS.map(({ value, label, Icon }) => {
              const selected = mood === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMood(value)}
                  className={`flex flex-col items-center justify-center gap-1 rounded-xl border py-3 px-1 transition cursor-pointer ${
                    selected
                      ? 'bg-slate-900 border-slate-900 text-white'
                      : 'bg-slate-50 border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  <Icon size={20} />
                  <span className="text-[10px] font-semibold">{label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label htmlFor="wellbeing-sleep-hours" className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-1 flex items-center gap-1">
            <Moon size={12} /> Sleep hours (optional)
          </label>
          <input
            id="wellbeing-sleep-hours"
            type="number"
            min={0}
            max={24}
            step={0.5}
            value={sleepHours}
            onChange={(e) => setSleepHours(e.target.value)}
            placeholder="e.g. 7.5"
            className="w-full sm:w-40 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
          />
        </div>

        <div>
          <label htmlFor="wellbeing-journal-note" className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-1 flex items-center gap-1">
            <NotebookPen size={12} /> Journal note (optional)
          </label>
          <textarea
            id="wellbeing-journal-note"
            rows={3}
            value={journalNote}
            onChange={(e) => setJournalNote(e.target.value)}
            placeholder="Anything on your mind..."
            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
          />
        </div>

        {saveError && <p className="text-xs text-red-600">{saveError}</p>}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || mood === null}
            className="inline-flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold px-4 py-2 rounded-xl transition cursor-pointer"
          >
            <Save size={14} />
            {isSaving ? 'Saving...' : 'Save Check-In'}
          </button>
          {savedJustNow && !isSaving && <span className="text-xs text-emerald-600 font-semibold">Saved</span>}
          {mood === null && <span className="text-xs text-slate-400">Pick a mood to save</span>}
        </div>
      </div>

      {/* Mood trend */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
        <h3 className="font-bold text-slate-900 text-sm">Mood Trend (14 days)</h3>
        <div className="flex items-end gap-1.5 h-24">
          {trendDays.map((day) => {
            const rank = day.entry?.mood ? MOOD_RANK[day.entry.mood] : 0;
            const heightPct = rank === 0 ? 6 : 20 + rank * 16;
            const colorClass = day.entry?.mood ? MOOD_BAR_COLOR[day.entry.mood] : 'bg-slate-100';
            return (
              <div key={day.dateIso} className="flex-1 flex flex-col items-center justify-end h-full gap-1">
                <div
                  className={`w-full rounded-md ${colorClass}`}
                  style={{ height: `${heightPct}%` }}
                  title={day.entry?.mood ? `${day.label}: ${MOOD_LABEL[day.entry.mood]}` : `${day.label}: no entry`}
                />
              </div>
            );
          })}
        </div>
        <div className="flex gap-1.5">
          {trendDays.map((day) => (
            <div key={day.dateIso} className="flex-1 text-center">
              <span className="text-[8px] text-slate-400 font-medium">{day.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Recent entries */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
        <h3 className="font-bold text-slate-900 text-sm">Recent Entries</h3>
        {recentWithContent.length === 0 ? (
          <p className="text-sm text-slate-500">No entries yet — your check-ins will appear here.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {recentWithContent.map((row) => (
              <div key={row.id} className="py-3 flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-start space-x-3">
                  {row.mood ? (
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border shrink-0 mt-0.5 ${
                        row.mood === 'great' || row.mood === 'good'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : row.mood === 'okay'
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : 'bg-rose-50 text-rose-700 border-rose-200'
                      }`}
                    >
                      {MOOD_LABEL[row.mood]}
                    </span>
                  ) : null}
                  <div>
                    <p className="text-sm font-semibold text-slate-800">
                      {new Date(row.entry_date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
                      {row.sleep_hours != null && (
                        <span className="text-slate-400 font-normal"> &bull; {row.sleep_hours}h sleep</span>
                      )}
                    </p>
                    {row.journal_note && (
                      <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">
                        {row.journal_note.length > 140 ? `${row.journal_note.slice(0, 140)}...` : row.journal_note}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
