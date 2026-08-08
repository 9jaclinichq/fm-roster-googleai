import React, { useState, useEffect } from 'react';
import { databaseService, DEFAULT_TENANT_ID } from '../lib/databaseService';
import { Tenant, CallDutyRule, TenantAiAdaptationRule } from '../types';
import { TERMINOLOGY_DEFAULTS } from '../lib/terminology';
import { Settings2, Sliders, Tag, Sparkles, RefreshCw, Plus } from 'lucide-react';

// Integrated into ChiefDashboardView as a tab. Operates on the single
// seeded tenant (DEFAULT_TENANT_ID) — there's no tenant-switching login
// yet, so "the Chief's tenant" is always UCH FM today. See migration 11's
// header for the full scope/architecture notes this component assumes.

const MODULE_TOGGLES: { key: string; label: string; description: string }[] = [
  { key: 'viva_simulator_enabled', label: 'Mock Viva Oral Exam Simulator', description: 'Residents can log self-scored practice viva sessions.' },
  { key: 'dissertation_module_enabled', label: 'Dissertation Assistant', description: 'WACP-stage dissertation tracking and AI-assisted writing checks.' },
  { key: 'exam_readiness_enabled', label: 'Exam Readiness Scorecard', description: 'Eligibility checklist (Evidemy, logbook, fees, forms).' },
];

const TERMINOLOGY_KEYS = Object.keys(TERMINOLOGY_DEFAULTS);

export const TenantCustomizationView: React.FC = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [callDutyRules, setCallDutyRules] = useState<CallDutyRule[]>([]);
  const [adaptationRules, setAdaptationRules] = useState<TenantAiAdaptationRule[]>([]);
  const [statusMessage, setStatusMessage] = useState('');

  const [moduleFlags, setModuleFlags] = useState<Record<string, unknown>>({});
  const [caseReportsRequired, setCaseReportsRequired] = useState<string>('15');
  const [terminology, setTerminology] = useState<Record<string, string>>({});
  const [newRuleKey, setNewRuleKey] = useState('');
  const [newRuleValue, setNewRuleValue] = useState('');
  const [newFeatureKey, setNewFeatureKey] = useState('');
  const [newFeaturePrompt, setNewFeaturePrompt] = useState('');

  const load = async () => {
    setIsLoading(true);
    try {
      const [t, rules, adapt] = await Promise.all([
        databaseService.getTenant(DEFAULT_TENANT_ID),
        databaseService.getCallDutyRules(DEFAULT_TENANT_ID),
        databaseService.getTenantAiAdaptationRules(DEFAULT_TENANT_ID),
      ]);
      if (t) {
        setTenant(t);
        setModuleFlags(t.module_flags || {});
        setCaseReportsRequired(String(t.module_flags?.case_reports_required_count ?? 15));
        setTerminology(t.terminology_overrides || {});
      }
      setCallDutyRules(rules);
      setAdaptationRules(adapt);
    } catch (err) {
      console.warn(err);
      setStatusMessage('Failed to load tenant customization data.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const toggleModule = async (key: string) => {
    const updated = { ...moduleFlags, [key]: !(moduleFlags[key] ?? true) };
    setModuleFlags(updated);
    try {
      await databaseService.updateTenantModuleFlags(DEFAULT_TENANT_ID, updated);
      setStatusMessage('Module setting saved.');
    } catch (err) {
      console.warn(err);
      setStatusMessage('Failed to save module setting.');
    }
  };

  const saveCaseReportsRequired = async () => {
    const count = Number(caseReportsRequired);
    if (!Number.isFinite(count) || count < 1) {
      setStatusMessage('Enter a valid case count.');
      return;
    }
    const updated = { ...moduleFlags, case_reports_required_count: count };
    setModuleFlags(updated);
    try {
      await databaseService.updateTenantModuleFlags(DEFAULT_TENANT_ID, updated);
      setStatusMessage(`Required case count set to ${count}. Note: CasebookBuilderView still hardcodes 15 slots — this value is not yet read by that component.`);
    } catch (err) {
      console.warn(err);
      setStatusMessage('Failed to save case count.');
    }
  };

  const saveTerminology = async () => {
    try {
      await databaseService.updateTenantTerminology(DEFAULT_TENANT_ID, terminology);
      setStatusMessage('Terminology saved. Applies to newly built tenant-aware views only — see TerminologyProvider scope note.');
    } catch (err) {
      console.warn(err);
      setStatusMessage('Failed to save terminology.');
    }
  };

  const addCallDutyRule = async () => {
    if (!newRuleKey.trim() || !newRuleValue.trim()) return;
    const value = Number(newRuleValue);
    if (!Number.isFinite(value)) { setStatusMessage('Rule value must be a number.'); return; }
    try {
      await databaseService.upsertCallDutyRule(DEFAULT_TENANT_ID, newRuleKey.trim(), value);
      setNewRuleKey(''); setNewRuleValue('');
      const rules = await databaseService.getCallDutyRules(DEFAULT_TENANT_ID);
      setCallDutyRules(rules);
      setStatusMessage('Call duty rule saved.');
    } catch (err) {
      console.warn(err);
      setStatusMessage('Failed to save call duty rule.');
    }
  };

  const addAdaptationRule = async () => {
    if (!newFeatureKey.trim()) return;
    let overrides: Record<string, unknown> = {};
    if (newFeaturePrompt.trim()) {
      try {
        overrides = JSON.parse(newFeaturePrompt);
      } catch {
        setStatusMessage('Prompt overrides must be valid JSON, e.g. {"tone": "formal"}.');
        return;
      }
    }
    try {
      await databaseService.upsertTenantAiAdaptationRule(DEFAULT_TENANT_ID, newFeatureKey.trim(), { adapted_prompt_overrides: overrides });
      setNewFeatureKey(''); setNewFeaturePrompt('');
      const adapt = await databaseService.getTenantAiAdaptationRules(DEFAULT_TENANT_ID);
      setAdaptationRules(adapt);
      setStatusMessage('AI adaptation rule saved (not yet applied by the Edge Functions — see note below).');
    } catch (err) {
      console.warn(err);
      setStatusMessage('Failed to save AI adaptation rule.');
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-16 text-slate-400"><RefreshCw className="animate-spin mr-2" size={18} /> Loading customization settings...</div>;
  }

  if (!tenant) {
    return <div className="p-6 text-sm text-rose-600">Could not load tenant configuration.</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2"><Settings2 size={20} /> Tenant Customization — {tenant.name}</h2>
        <p className="text-sm text-slate-500 mt-1">Granular module toggles, curriculum alignment, and local AI preferences for this department.</p>
      </div>

      {statusMessage && <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-xl p-3 text-sm">{statusMessage}</div>}

      {/* Module toggles */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <h3 className="font-bold text-slate-800 flex items-center gap-2 mb-3"><Sliders size={16} /> Module Toggles</h3>
        <div className="space-y-3">
          {MODULE_TOGGLES.map(mod => {
            const enabled = (moduleFlags[mod.key] ?? true) as boolean;
            return (
              <div key={mod.key} className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{mod.label}</p>
                  <p className="text-xs text-slate-500">{mod.description}</p>
                </div>
                <button
                  onClick={() => toggleModule(mod.key)}
                  className={`shrink-0 w-11 h-6 rounded-full transition relative cursor-pointer ${enabled ? 'bg-emerald-500' : 'bg-slate-300'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition ${enabled ? 'translate-x-5' : ''}`} />
                </button>
              </div>
            );
          })}
          <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-100">
            <div>
              <p className="text-sm font-semibold text-slate-800">Required Case Reports Count</p>
              <p className="text-xs text-slate-500">Note: CasebookBuilderView UI still hardcodes 15 — this setting is stored but not yet read there.</p>
            </div>
            <div className="flex items-center gap-2">
              <input type="number" value={caseReportsRequired} onChange={e => setCaseReportsRequired(e.target.value)} className="w-16 px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-center" />
              <button onClick={saveCaseReportsRequired} className="text-xs font-bold bg-slate-900 text-white px-3 py-1.5 rounded-lg hover:bg-slate-800 cursor-pointer">Save</button>
            </div>
          </div>
        </div>
      </div>

      {/* Curriculum Alignment — call duty rules */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <h3 className="font-bold text-slate-800 flex items-center gap-2 mb-3"><Tag size={16} /> Curriculum Alignment — Call Duty Limits</h3>
        <div className="space-y-2 mb-3">
          {callDutyRules.length === 0 && <p className="text-xs text-slate-400">No call duty rules configured yet.</p>}
          {callDutyRules.map(rule => (
            <div key={rule.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2 text-sm">
              <span className="font-semibold text-slate-700">{rule.rule_key}</span>
              <span className="font-mono text-slate-600">{rule.rule_value}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <input value={newRuleKey} onChange={e => setNewRuleKey(e.target.value)} placeholder="rule key, e.g. max_calls_per_month" className="flex-1 min-w-[180px] px-3 py-2 border border-slate-200 rounded-lg text-sm" />
          <input value={newRuleValue} onChange={e => setNewRuleValue(e.target.value)} placeholder="value" type="number" className="w-24 px-3 py-2 border border-slate-200 rounded-lg text-sm" />
          <button onClick={addCallDutyRule} className="flex items-center gap-1 text-xs font-bold bg-slate-900 text-white px-3 py-2 rounded-lg hover:bg-slate-800 cursor-pointer"><Plus size={14} /> Add</button>
        </div>
      </div>

      {/* Terminology overrides */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <h3 className="font-bold text-slate-800 flex items-center gap-2 mb-1"><Tag size={16} /> Local Terminology</h3>
        <p className="text-xs text-slate-500 mb-3">
          Applies only to newly-built tenant-aware views in this pass, not the whole app yet — see TerminologyProvider's scope note.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
          {TERMINOLOGY_KEYS.map(key => (
            <div key={key}>
              <label className="text-[10px] font-bold text-slate-400 uppercase">{key}</label>
              <input
                value={terminology[key] ?? ''}
                onChange={e => setTerminology(prev => ({ ...prev, [key]: e.target.value }))}
                placeholder={TERMINOLOGY_DEFAULTS[key]}
                className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm"
              />
            </div>
          ))}
        </div>
        <button onClick={saveTerminology} className="text-xs font-bold bg-slate-900 text-white px-3 py-2 rounded-lg hover:bg-slate-800 cursor-pointer">Save Terminology</button>
      </div>

      {/* AI Behavior Tuning */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <h3 className="font-bold text-slate-800 flex items-center gap-2 mb-1"><Sparkles size={16} /> AI Behavior Tuning</h3>
        <p className="text-xs text-slate-500 mb-3">
          Stored per feature (e.g. citation style, local ethics board formats). Not yet applied by the Edge
          Functions when constructing prompts — schema/UI only in this pass, see migration 11's header.
        </p>
        <div className="space-y-2 mb-3">
          {adaptationRules.map(rule => (
            <div key={rule.id} className="bg-slate-50 rounded-lg p-3 text-xs">
              <p className="font-bold text-slate-700">{rule.feature_key}</p>
              <pre className="text-[10px] text-slate-500 mt-1 whitespace-pre-wrap">{JSON.stringify(rule.adapted_prompt_overrides, null, 2)}</pre>
            </div>
          ))}
        </div>
        <div className="space-y-2">
          <input value={newFeatureKey} onChange={e => setNewFeatureKey(e.target.value)} placeholder="feature key, e.g. academic_copilot.vancouver_format" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
          <textarea value={newFeaturePrompt} onChange={e => setNewFeaturePrompt(e.target.value)} placeholder='JSON overrides, e.g. {"citation_style": "APA"}' rows={2} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono" />
          <button onClick={addAdaptationRule} className="flex items-center gap-1 text-xs font-bold bg-slate-900 text-white px-3 py-2 rounded-lg hover:bg-slate-800 cursor-pointer"><Plus size={14} /> Save Rule</button>
        </div>
      </div>
    </div>
  );
};
