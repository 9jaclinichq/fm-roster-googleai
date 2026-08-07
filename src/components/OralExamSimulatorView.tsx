import React, { useState, useEffect, useRef } from 'react';
import { databaseService } from '../lib/databaseService';
import { VivaSimulation, ScoringBreakdown } from '../types';
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
  resident: { id: string; name: string; category: string };
}

interface Vignette {
  title: string;
  category: string;
  scenario: string;
  prompts: string[];
}

// Illustrative practice vignettes for self-rehearsal — NOT official WACP
// past questions, and not clinically authoritative content. Deliberately
// kept to brief scenario framing + generic examiner-style prompts across
// the four scored domains, rather than detailed management guidance.
const VIGNETTES: Vignette[] = [
  {
    title: 'Poorly Controlled Hypertension',
    category: 'Chronic Disease Management',
    scenario: 'A 58-year-old presents to your clinic with blood pressure readings consistently above target despite being on two antihypertensive agents.',
    prompts: [
      'What is your differential for resistant hypertension in this patient?',
      'Outline your approach to reviewing and adjusting this patient\'s management plan.',
      'What safety-netting would you put in place before their next review?',
      'How would you explain the treatment plan and check the patient\'s understanding?',
    ],
  },
  {
    title: 'Antenatal Patient with Gestational Diabetes',
    category: 'Obstetric Care',
    scenario: 'A patient at 26 weeks gestation is newly diagnosed with gestational diabetes on routine screening.',
    prompts: [
      'What is your immediate diagnostic reasoning and next steps?',
      'Describe your management and referral plan for this patient.',
      'What red flags would prompt urgent escalation?',
      'How would you counsel the patient and family on the diagnosis?',
    ],
  },
  {
    title: 'Febrile Child with Rash',
    category: 'Paediatric Case',
    scenario: 'A 4-year-old is brought in with a 3-day history of fever and a new rash noticed this morning.',
    prompts: [
      'What differentials are you considering, and what history would you prioritise?',
      'What is your initial management plan pending further assessment?',
      'What features would make you concerned about a serious underlying cause?',
      'How would you communicate your assessment and plan to the caregiver?',
    ],
  },
  {
    title: 'Elderly Patient with Polypharmacy',
    category: 'Geriatrics',
    scenario: 'A 76-year-old on 8 regular medications presents with increasing falls over the past month.',
    prompts: [
      'What is your reasoning for the likely contributors to this presentation?',
      'How would you approach medication review and deprescribing here?',
      'What safety measures would you prioritise for this patient?',
      'How would you involve the patient and family in decision-making?',
    ],
  },
  {
    title: 'Acute Breathlessness in Adult',
    category: 'Emergency / Acute Presentation',
    scenario: 'A 45-year-old presents acutely with sudden-onset breathlessness and pleuritic chest pain.',
    prompts: [
      'Talk through your differential diagnosis and initial assessment priorities.',
      'What is your immediate management plan in a primary care/emergency setting?',
      'What are the key safety considerations you must not miss?',
      'How would you communicate urgency to the patient while keeping them calm?',
    ],
  },
];

const DOMAINS: { key: keyof ScoringBreakdown; label: string }[] = [
  { key: 'diagnostic_reasoning', label: 'Diagnostic Reasoning' },
  { key: 'management', label: 'Management' },
  { key: 'safety', label: 'Safety' },
  { key: 'communication', label: 'Communication' },
];

type Phase = 'select' | 'practicing' | 'scoring';

export const OralExamSimulatorView: React.FC<OralExamSimulatorViewProps> = ({ resident }) => {
  const [phase, setPhase] = useState<Phase>('select');
  const [activeVignette, setActiveVignette] = useState<Vignette | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [scores, setScores] = useState<ScoringBreakdown>({ diagnostic_reasoning: 70, management: 70, safety: 70, communication: 70 });
  const [feedback, setFeedback] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const [history, setHistory] = useState<VivaSimulation[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(true);

  useEffect(() => {
    databaseService.getVivaSimulations(resident.id)
      .then(setHistory)
      .catch(err => console.warn('Failed to load viva history:', err))
      .finally(() => setIsLoadingHistory(false));
  }, [resident.id]);

  const startVignette = (vignette: Vignette) => {
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {VIGNETTES.map(v => (
          <button
            key={v.title}
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
