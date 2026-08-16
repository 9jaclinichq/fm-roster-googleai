import React, { useEffect, useRef, useState } from 'react';
import {
  Play, Pause, Square, RefreshCw, Timer, Target, Flame, History,
} from 'lucide-react';
import {
  logFocusSession, getFocusSessionsForOwner, FocusSessionOwnerRef, FocusSessionRow,
} from '../lib/focusSessionService';

// Focus Mode — a Pomodoro-style deep-work timer, one of 4 modules selected
// from the "Workspc" Flutter reference study (see migration 51's header for
// the full selection rationale). Matches UnifiedRecordView.tsx's
// established dual-identity-aware full-page view pattern: an `owner` prop
// with `kind: 'workforce' | 'doctor'`, self-contained data fetching in a
// useEffect, light Tailwind card styling. This app deliberately does NOT
// reskin the dark Flutter reference mockups — structure/functionality only,
// not the dark theme (see IntelligenceHarnessHome.tsx's own header for the
// fuller reasoning). Timer survives re-renders via useRef, mirroring
// OralExamSimulatorView.tsx's own timerRef/setInterval/cleanup pattern.

interface FocusModeViewOwner {
  id: string;
  name: string;
  kind: 'workforce' | 'doctor';
  tenantId: string;
}

interface FocusModeViewProps {
  owner: FocusModeViewOwner;
}

const DURATION_PRESETS_MINUTES = [15, 25, 45, 60];
const DEFAULT_DURATION_MINUTES = 25;
const RECENT_SESSIONS_LIMIT = 10;

type TimerPhase = 'setup' | 'active';

function toOwnerRef(owner: FocusModeViewOwner): FocusSessionOwnerRef {
  return owner.kind === 'workforce'
    ? { workforceId: owner.id, tenantId: owner.tenantId }
    : { doctorId: owner.id };
}

function formatClock(totalSeconds: number): string {
  const clamped = Math.max(0, totalSeconds);
  const m = Math.floor(clamped / 60).toString().padStart(2, '0');
  const s = Math.floor(clamped % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function formatRelativeTime(isoString: string): string {
  const then = new Date(isoString).getTime();
  const diffMs = Date.now() - then;
  const diffMinutes = Math.round(diffMs / 60000);
  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}

function isToday(isoString: string): boolean {
  const d = new Date(isoString);
  const now = new Date();
  return d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
}

const RING_RADIUS = 88;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export const FocusModeView: React.FC<FocusModeViewProps> = ({ owner }) => {
  const ownerRef = toOwnerRef(owner);

  const [selectedDuration, setSelectedDuration] = useState<number>(DEFAULT_DURATION_MINUTES);
  const [goalLabel, setGoalLabel] = useState<string>('');

  const [phase, setPhase] = useState<TimerPhase>('setup');
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [totalSeconds, setTotalSeconds] = useState<number>(0);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [sessions, setSessions] = useState<FocusSessionRow[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingSessions(true);
    setLoadError(null);

    getFocusSessionsForOwner(toOwnerRef(owner))
      .then((rows) => { if (!cancelled) setSessions(rows); })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load focus sessions.');
      })
      .finally(() => { if (!cancelled) setIsLoadingSessions(false); });

    return () => { cancelled = true; };
  }, [owner.id, owner.kind]);

  // Cleanup on unmount only — matches OralExamSimulatorView.tsx's own
  // pattern of a separate empty-deps cleanup effect alongside imperative
  // start/stop calls in the handlers below.
  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const clearTimerInterval = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const runInterval = () => {
    clearTimerInterval();
    timerRef.current = setInterval(() => {
      setRemainingSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
  };

  const finalizeSession = async (elapsedSeconds: number) => {
    clearTimerInterval();

    // Skip logging entirely if less than 1 full minute elapsed — don't log
    // zero-value noise for a session cancelled/reset almost immediately.
    if (elapsedSeconds >= 60) {
      const elapsedMinutes = Math.max(1, Math.round(elapsedSeconds / 60));
      setIsSaving(true);
      try {
        const saved = await logFocusSession(toOwnerRef(owner), elapsedMinutes, goalLabel.trim() || null);
        setSessions((prev) => [saved, ...prev]);
      } catch (err) {
        console.warn('Failed to log focus session:', err);
      } finally {
        setIsSaving(false);
      }
    }

    setPhase('setup');
    setIsPaused(false);
    setTotalSeconds(0);
    setRemainingSeconds(0);
    setGoalLabel('');
  };

  // Natural completion — the countdown reached zero on its own.
  useEffect(() => {
    if (phase === 'active' && !isPaused && totalSeconds > 0 && remainingSeconds === 0) {
      finalizeSession(totalSeconds);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingSeconds]);

  const startSession = () => {
    const total = selectedDuration * 60;
    setTotalSeconds(total);
    setRemainingSeconds(total);
    setPhase('active');
    setIsPaused(false);
    runInterval();
  };

  const pauseSession = () => {
    clearTimerInterval();
    setIsPaused(true);
  };

  const resumeSession = () => {
    setIsPaused(false);
    runInterval();
  };

  const endSession = () => {
    const elapsedSeconds = totalSeconds - remainingSeconds;
    finalizeSession(elapsedSeconds);
  };

  const todaysSessions = sessions.filter((s) => isToday(s.completed_at));
  const todaysMinutes = todaysSessions.reduce((sum, s) => sum + s.duration_minutes, 0);
  const recentSessions = sessions.slice(0, RECENT_SESSIONS_LIMIT);

  const progressFraction = totalSeconds > 0 ? remainingSeconds / totalSeconds : 1;
  const ringOffset = RING_CIRCUMFERENCE * (1 - progressFraction);

  return (
    <div className="max-w-2xl mx-auto my-8 px-4 space-y-6">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
        <div className="flex items-center space-x-2 mb-1">
          <Timer className="text-slate-500" size={18} />
          <h2 className="font-bold text-slate-900 text-lg tracking-tight">Focus Mode</h2>
        </div>
        <p className="text-xs text-slate-500">
          A Pomodoro-style deep-work timer for {owner.name}. Pick a duration, set today&apos;s goal, and start.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 flex flex-col items-center space-y-5">
        <div className="relative w-56 h-56">
          <svg viewBox="0 0 200 200" className="w-56 h-56 -rotate-90">
            <circle
              cx="100"
              cy="100"
              r={RING_RADIUS}
              fill="none"
              stroke="#e2e8f0"
              strokeWidth="10"
            />
            <circle
              cx="100"
              cy="100"
              r={RING_RADIUS}
              fill="none"
              stroke="#0f172a"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={phase === 'active' ? ringOffset : 0}
              style={{ transition: 'stroke-dashoffset 1s linear' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-mono font-extrabold text-4xl text-slate-900 tabular-nums">
              {phase === 'active' ? formatClock(remainingSeconds) : formatClock(selectedDuration * 60)}
            </span>
            {phase === 'active' && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-1">
                {isPaused ? 'Paused' : 'Focusing'}
              </span>
            )}
          </div>
        </div>

        {phase === 'setup' ? (
          <div className="w-full space-y-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Duration</p>
              <div className="grid grid-cols-4 gap-2">
                {DURATION_PRESETS_MINUTES.map((minutes) => (
                  <button
                    key={minutes}
                    type="button"
                    onClick={() => setSelectedDuration(minutes)}
                    className={`py-2 rounded-xl text-sm font-bold border transition cursor-pointer ${
                      selectedDuration === minutes
                        ? 'bg-slate-950 text-white border-slate-950'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    {minutes}m
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="flex items-center space-x-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                <Target size={12} />
                <span>Today&apos;s Goal (optional)</span>
              </label>
              <input
                type="text"
                value={goalLabel}
                onChange={(e) => setGoalLabel(e.target.value)}
                placeholder="e.g. Draft discussion section"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
              />
            </div>

            <button
              type="button"
              onClick={startSession}
              className="w-full inline-flex items-center justify-center space-x-2 py-3 bg-slate-950 hover:bg-slate-900 text-white font-bold rounded-xl shadow-sm transition cursor-pointer"
            >
              <Play size={15} />
              <span>Start Session</span>
            </button>
          </div>
        ) : (
          <div className="w-full space-y-3">
            {goalLabel.trim() && (
              <p className="text-center text-xs text-slate-500 font-medium">
                Goal: <span className="text-slate-700 font-semibold">{goalLabel.trim()}</span>
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              {isPaused ? (
                <button
                  type="button"
                  onClick={resumeSession}
                  className="inline-flex items-center justify-center space-x-2 py-3 bg-slate-950 hover:bg-slate-900 text-white font-bold rounded-xl shadow-sm transition cursor-pointer"
                >
                  <Play size={15} />
                  <span>Resume</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={pauseSession}
                  className="inline-flex items-center justify-center space-x-2 py-3 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-xl shadow-sm transition cursor-pointer"
                >
                  <Pause size={15} />
                  <span>Pause</span>
                </button>
              )}
              <button
                type="button"
                onClick={endSession}
                disabled={isSaving}
                className="inline-flex items-center justify-center space-x-2 py-3 bg-rose-600 hover:bg-rose-700 disabled:bg-rose-300 text-white font-bold rounded-xl shadow-sm transition cursor-pointer"
              >
                <Square size={15} />
                <span>{isSaving ? 'Saving...' : 'End Session'}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
        <div className="flex items-center space-x-2 mb-3">
          <Flame className="text-slate-500" size={16} />
          <h3 className="font-bold text-slate-800 text-sm">Today</h3>
        </div>
        {isLoadingSessions ? (
          <div className="text-center py-4">
            <RefreshCw size={18} className="text-slate-400 animate-spin mx-auto" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
              <p className="text-2xl font-extrabold text-slate-900">{todaysMinutes}</p>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-0.5">Focus minutes</p>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
              <p className="text-2xl font-extrabold text-slate-900">{todaysSessions.length}</p>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mt-0.5">Sessions</p>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-3">
        <div className="flex items-center space-x-2">
          <History className="text-slate-500" size={16} />
          <h3 className="font-bold text-slate-800 text-sm">Recent Sessions</h3>
        </div>
        {loadError ? (
          <p className="text-xs text-red-600">{loadError}</p>
        ) : isLoadingSessions ? (
          <div className="text-center py-4">
            <RefreshCw size={18} className="text-slate-400 animate-spin mx-auto" />
          </div>
        ) : recentSessions.length === 0 ? (
          <p className="text-xs text-slate-400">No focus sessions logged yet.</p>
        ) : (
          <div className="space-y-2">
            {recentSessions.map((session) => (
              <div key={session.id} className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-xl">
                <div>
                  <div className="text-xs font-bold text-slate-800">
                    {session.duration_minutes} min{session.goal_label ? ` — ${session.goal_label}` : ''}
                  </div>
                  <div className="text-[10px] text-slate-400">{formatRelativeTime(session.completed_at)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
