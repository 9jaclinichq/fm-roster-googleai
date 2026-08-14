import React, { useState, useEffect, useRef } from 'react';
import { databaseService, DEFAULT_TENANT_ID } from '../lib/databaseService';
import { VivaSimulation, VivaVignette, ScoringBreakdown } from '../types';
import {
  Mic,
  Clock,
  RefreshCw,
  ChevronLeft,
  Play,
  Square,
  History,
  Stethoscope,
} from 'lucide-react';

interface OralExamSimulatorViewProps {
  resident: { id: string; name: string; category: string; tenant_id?: string };
}

const DOMAINS: { key: keyof ScoringBreakdown; label: string }[] = [
  { key: 'diagnostic_reasoning', label: 'Diagnostic Reasoning' },
  { key: 'management', label: 'Management' },
  { key: 'safety', label: 'Safety' },
  { key: 'communication', label: 'Communication' },
];

type Phase = 'select' | 'practicing' | 'scoring';

export const OralExamSimulatorView: React.FC<OralExamSimulatorViewProps> = ({ resident }) => {
  const [phase, setPhase] = useState<Phase>('select');
  const [activeVignette, setActiveVignette] = useState<VivaVignette | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [scores, setScores] = useState<ScoringBreakdown>({ diagnostic_reasoning: 70, management: 70, safety: 70, communication: 70 });
  const [feedback, setFeedback] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const [history, setHistory] = useState<VivaSimulation[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(true);

  // Migration 28 — vignettes are no longer hardcoded; global (tenant_id
  // NULL) plus this resident's own org's vignettes.
  const [vignettes, setVignettes] = useState<VivaVignette[]>([]);
  const [isLoadingVignettes, setIsLoadingVignettes] = useState<boolean>(true);

  useEffect(() => {
    databaseService.getVivaSimulations(resident.id)
      .then(setHistory)
      .catch(err => console.warn('Failed to load viva history:', err))
      .finally(() => setIsLoadingHistory(false));
  }, [resident.id]);

  useEffect(() => {
    const tenantId = resident.tenant_id ?? DEFAULT_TENANT_ID;
    databaseService.getVivaVignettes()
      .then(all => setVignettes(all.filter(v => v.tenant_id === null || v.tenant_id === tenantId)))
      .catch(err => console.warn('Failed to load viva vignettes:', err))
      .finally(() => setIsLoadingVignettes(false));
  }, [resident.tenant_id]);

  const startVignette = (vignette: VivaVignette) => {
    setActiveVignette(vignette);
    setElapsedSeconds(0);
    setPhase('practicing');
    timerRef.current = setInterval(() => setElapsedSeconds(s => s + 1), 1000);
  };

  const stopAndScore = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setPhase('scoring');
  };

  const cancelSession = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setActiveVignette(null);
    setPhase('select');
  };

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const handleSubmitScore = async () => {
    if (!activeVignette) return;
    setIsSaving(true);
    try {
      const saved = await databaseService.createVivaSimulation({
        workforce_id: resident.id,
        case_title: activeVignette.title,
        category: activeVignette.category,
        duration_seconds: elapsedSeconds,
        scoring_breakdown: scores,
        feedback_summary: feedback.trim() || null,
      });
      setHistory(prev => [saved, ...prev]);
      setPhase('select');
      setActiveVignette(null);
      setFeedback('');
      setScores({ diagnostic_reasoning: 70, management: 70, safety: 70, communication: 70 });
    } catch (err) {
      console.warn(err);
    } finally {
      setIsSaving(false);
    }
  };

  if (phase === 'practicing' && activeVignette) {
    return (
      <div className="max-w-2xl mx-auto my-8 px-4 space-y-5">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <button onClick={cancelSession} className="flex items-center space-x-1 text-xs font-bold text-slate-500 hover:text-slate-800 cursor-pointer">
              <ChevronLeft size={14} />
              <span>Cancel</span>
            </button>
            <div className="flex items-center space-x-1.5 text-slate-700 font-mono font-bold text-sm">
              <Clock size={14} />
              <span>{formatTime(elapsedSeconds)}</span>
            </div>
          </div>
          <span className="inline-block mb-2 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200">
            {activeVignette.category}
          </span>
          <h2 className="font-bold text-slate-900 text-lg mb-2">{activeVignette.title}</h2>
          <p className="text-sm text-slate-700 leading-relaxed bg-slate-50 border border-slate-200 rounded-xl p-3">{activeVignette.scenario}</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-3">
          <h3 className="font-bold text-slate-800 text-sm flex items-center space-x-1.5">
            <Stethoscope size={15} className="text-slate-500" />
            <span>Examiner Prompts</span>
          </h3>
          <ol className="space-y-2 list-decimal list-inside">
            {activeVignette.prompts.map((p, i) => (
              <li key={i} className="text-sm text-slate-700">{p}</li>
            ))}
          </ol>
          <p className="text-[10px] text-slate-400 italic">Practice speaking your answers aloud, as you would in the real viva.</p>
        </div>

        <button
          onClick={stopAndScore}
          className="w-full inline-flex items-center justify-center space-x-2 py-3 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl shadow-sm transition cursor-pointer"
        >
          <Square size={15} />
          <span>Finish & Self-Score</span>
        </button>
      </div>
    );
  }

  if (phase === 'scoring' && activeVignette) {
    return (
      <div className="max-w-2xl mx-auto my-8 px-4 space-y-5">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-4">
          <button onClick={cancelSession} className="flex items-center space-x-1 text-xs font-bold text-slate-500 hover:text-slate-800 cursor-pointer">
            <ChevronLeft size={14} />
            <span>Cancel</span>
          </button>
          <h2 className="font-bold text-slate-900 text-lg">Self-Score: {activeVignette.title}</h2>
          <p className="text-xs text-slate-500">
            Rate your own performance honestly across each domain (0-100). This is self-assessment for practice, not an examiner or AI grade.
          </p>

          {DOMAINS.map(d => (
            <div key={d.key} className="space-y-1">
              <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                <span>{d.label}</span>
                <span>{scores[d.key]}</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={scores[d.key]}
                onChange={(e) => setScores(prev => ({ ...prev, [d.key]: parseInt(e.target.value) }))}
                className="w-full cursor-pointer"
              />
            </div>
          ))}

          <div className="space-y-1 pt-2 border-t border-slate-100">
            <label className="text-xs font-bold text-slate-700 uppercase">Self-Reflection Notes (optional)</label>
            <textarea
              rows={3}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="What went well? What would you improve next time?"
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
            />
          </div>

          <button
            onClick={handleSubmitScore}
            disabled={isSaving}
            className="w-full py-2.5 bg-slate-950 hover:bg-slate-900 disabled:bg-slate-400 text-white font-bold rounded-xl text-sm shadow-sm transition cursor-pointer"
          >
            {isSaving ? 'Saving...' : 'Save Session'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto my-8 px-4 space-y-6">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
        <div className="flex items-center space-x-2 mb-1">
          <Mic className="text-slate-500" size={18} />
          <h2 className="font-bold text-slate-900 text-lg tracking-tight">Mock Viva Oral Exam Simulator</h2>
        </div>
        <p className="text-xs text-slate-500">
          Timed self-practice for Family Medicine Part II viva voce. Pick a vignette to begin — these are illustrative practice
          scenarios, not official past exam questions.
        </p>
      </div>

      {isLoadingVignettes ? (
        <div className="text-center py-8">
          <RefreshCw size={20} className="text-slate-400 animate-spin mx-auto" />
        </div>
      ) : vignettes.length === 0 ? (
        <p className="text-xs text-slate-400 text-center py-8">No practice vignettes available yet.</p>
      ) : (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {vignettes.map(v => (
          <button
            key={v.id}
            onClick={() => startVignette(v)}
            className="text-left bg-white border border-slate-200 hover:border-slate-300 rounded-2xl shadow-sm p-4 transition cursor-pointer space-y-2"
          >
            <span className="inline-block px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200">
              {v.category}
            </span>
            <h3 className="font-bold text-slate-900 text-sm">{v.title}</h3>
            <p className="text-xs text-slate-500 line-clamp-2">{v.scenario}</p>
            <span className="inline-flex items-center space-x-1.5 text-xs font-bold text-slate-700">
              <Play size={12} />
              <span>Start Practice</span>
            </span>
          </button>
        ))}
      </div>
      )}

      {/* History */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-3">
        <div className="flex items-center space-x-2">
          <History className="text-slate-500" size={16} />
          <h3 className="font-bold text-slate-800 text-sm">Past Sessions</h3>
        </div>
        {isLoadingHistory ? (
          <div className="text-center py-6">
            <RefreshCw size={20} className="text-slate-400 animate-spin mx-auto" />
          </div>
        ) : history.length === 0 ? (
          <p className="text-xs text-slate-400">No practice sessions recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {history.map(session => {
              const breakdown = session.scoring_breakdown as ScoringBreakdown;
              const avg = DOMAINS.reduce((sum, d) => sum + (breakdown[d.key] || 0), 0) / DOMAINS.length;
              return (
                <div key={session.id} className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <div>
                    <div className="text-xs font-bold text-slate-800">{session.case_title}</div>
                    <div className="text-[10px] text-slate-400">
                      {new Date(session.created_at).toLocaleDateString()} &bull; {session.duration_seconds ? `${Math.round(session.duration_seconds / 60)} min` : '—'}
                    </div>
                  </div>
                  <span className="font-extrabold text-sm text-slate-700">{avg.toFixed(0)}%</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
