import React, { useState, useEffect } from 'react';
import { databaseService } from '../../../../lib/databaseService';
import { ChiefTenantConfig, CallDutyRule, TenantAiAdaptationRule } from '../../../../types';
import { TERMINOLOGY_DEFAULTS, useTerminology } from '../../../shared/terminology';
import { RosterSectionKey, RosterSectionPresentation, ROSTER_SECTION_KEYS, ROSTER_SECTION_ICON_NAMES } from '../../../roster-engine/lib/rosterSectionPresentation';
import { Settings2, Sliders, Tag, Sparkles, RefreshCw, Plus, Palette } from 'lucide-react';

// Integrated into ChiefDashboardView as a tab. Operates on the Chief's own
// resolved tenant (migration 23 made the admin code per-tenant, closing
// the "no tenant-switching login yet" gap this component used to be
// hardcoded around) — see migration 11's header for the full scope/
// architecture notes this component otherwise assumes.

// A function rather than a plain module-level constant because the first
// toggle's description embeds the tenant-aware `members` term (was a
// hardcoded "Residents" — see docs/LIVING_SYSTEM_GAP_AUDIT.md's terminology
// audit) and `t()` is only available from useTerminology() inside the
// component.
const getModuleToggles = (t: (key: string, fallback?: string) => string): { key: string; label: string; description: string }[] => [
  { key: 'viva_simulator_enabled', label: 'Mock Viva Oral Exam Simulator', description: `${t('members', 'Residents')} can log self-scored practice viva sessions.` },
  { key: 'dissertation_module_enabled', label: 'Dissertation Assistant', description: 'WACP-stage dissertation tracking and AI-assisted writing checks.' },
  { key: 'exam_readiness_enabled', label: 'Exam Readiness Scorecard', description: 'Eligibility checklist (Evidemy, logbook, fees, forms).' },
];

const TERMINOLOGY_KEYS = Object.keys(TERMINOLOGY_DEFAULTS);

interface TenantCustomizationViewProps {
  tenantId: string;
  // Verified Chief admin code, re-checked server-side by
  // chiefUpdateTenantTerminology()/chiefUpdateTenantModuleFlags() (migration
  // 59, Priority-0 Tenant Surface slice P0-3) — passed through from the
  // existing Chief session (ChiefDashboardView's `fm_admin_code` localStorage
  // read), not a new persistence mechanism.
  adminCode: string;
}

export const TenantCustomizationView: React.FC<TenantCustomizationViewProps> = ({ tenantId, adminCode }) => {
  const { t } = useTerminology();
  const MODULE_TOGGLES = getModuleToggles(t);
  const [isLoading, setIsLoading] = useState(true);
  const [tenant, setTenant] = useState<ChiefTenantConfig | null>(null);
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
  // Migration 74 — tenant-configurable roster section presentation.
  // Already resolved-with-fallback by chief_get_roster_section_config
  // (same shape residents receive), so this panel always shows "what
  // would currently display" even with zero configuration saved yet.
  const [rosterSections, setRosterSections] = useState<RosterSectionPresentation[]>([]);

  const load = async () => {
    setIsLoading(true);
    try {
      const [chiefTenant, rules, adapt, sections] = await Promise.all([
        databaseService.chiefGetTenant(adminCode),
        databaseService.getCallDutyRules(tenantId),
        databaseService.getTenantAiAdaptationRules(tenantId),
        databaseService.chiefGetRosterSectionConfig(adminCode),
      ]);
      if (chiefTenant) {
        setTenant(chiefTenant);
        setModuleFlags(chiefTenant.module_flags || {});
        setCaseReportsRequired(String(chiefTenant.module_flags?.case_reports_required_count ?? 15));
        setTerminology(chiefTenant.terminology_overrides || {});
      }
      setCallDutyRules(rules);
      setAdaptationRules(adapt);
      setRosterSections(sections);
    } catch (err) {
      console.warn(err);
      setStatusMessage('Failed to load tenant customization data.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, [tenantId]);

  const toggleModule = async (key: string) => {
    const updated = { ...moduleFlags, [key]: !(moduleFlags[key] ?? true) };
    setModuleFlags(updated);
    try {
      await databaseService.chiefUpdateTenantModuleFlags(adminCode, updated);
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
      await databaseService.chiefUpdateTenantModuleFlags(adminCode, updated);
      setStatusMessage(`Required case count set to ${count}. Note: CasebookBuilderView still hardcodes 15 slots — this value is not yet read by that component.`);
    } catch (err) {
      console.warn(err);
      setStatusMessage('Failed to save case count.');
    }
  };

  const saveTerminology = async () => {
    try {
      await databaseService.chiefUpdateTenantTerminology(adminCode, terminology);
      setStatusMessage('Terminology saved. Applies to newly built tenant-aware views only — see TerminologyProvider scope note.');
    } catch (err) {
      console.warn(err);
      setStatusMessage('Failed to save terminology.');
    }
  };

  const updateRosterSectionField = <K extends keyof RosterSectionPresentation>(sectionKey: RosterSectionKey, field: K, value: RosterSectionPresentation[K]) => {
    setRosterSections(prev => prev.map(s => (s.section_key === sectionKey ? { ...s, [field]: value } : s)));
  };

  const saveRosterSection = async (section: RosterSectionPresentation) => {
    try {
      await databaseService.chiefUpsertRosterSectionConfig(adminCode, section.section_key, {
        display_label: section.display_label,
        short_label: section.short_label,
        display_order: section.display_order,
        accent_color: section.accent_color,
        icon: section.icon,
      });
      setStatusMessage(`${section.display_label} presentation saved.`);
    } catch (err) {
      console.warn(err);
      setStatusMessage('Failed to save roster section presentation.');
    }
  };

  const addCallDutyRule = async () => {
    if (!newRuleKey.trim() || !newRuleValue.trim()) return;
    const value = Number(newRuleValue);
    if (!Number.isFinite(value)) { setStatusMessage('Rule value must be a number.'); return; }
    try {
      await databaseService.upsertCallDutyRule(tenantId, newRuleKey.trim(), value);
      setNewRuleKey(''); setNewRuleValue('');
      const rules = await databaseService.getCallDutyRules(tenantId);
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
        setStatusMessage('Prompt overrides must be valid JSON, e.g. {"extra_instructions": "Always cite our institution\'s own guidelines over external ones where the two differ."}.');
        return;
      }
    }
    try {
      await databaseService.upsertTenantAiAdaptationRule(tenantId, newFeatureKey.trim(), { adapted_prompt_overrides: overrides });
      setNewFeatureKey(''); setNewFeaturePrompt('');
      const adapt = await databaseService.getTenantAiAdaptationRules(tenantId);
      setAdaptationRules(adapt);
      setStatusMessage('AI adaptation rule saved — applied on the next matching AI action.');
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
              <p className="text-xs text-slate-500">Clamped to 1–15 in CasebookBuilderView (case_reports.case_number has a DB-level CHECK BETWEEN 1 AND 15).</p>
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
          Applies across the login flow, main navigation, Chief dashboard, roster editor, and review flow — see
          src/modules/shared/terminology.tsx's header for exact current coverage.
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

      {/* Roster section presentation (migration 74) — display label/short
          label/order/color/icon ONLY. Never touches assignment data,
          matching logic, or any other tenant's configuration; unchanged
          fields simply keep resolving to today's current behavior. */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <h3 className="font-bold text-slate-800 flex items-center gap-2 mb-1"><Palette size={16} /> Roster Section Presentation</h3>
        <p className="text-xs text-slate-500 mb-3">
          Controls how each roster section is labeled, ordered, and colored for {t('members', 'Residents')} in
          Full Roster and My Assignment. Purely presentational — assignment data and matching are never affected.
          Leave a field blank to keep today's default.
        </p>
        <div className="space-y-3">
          {ROSTER_SECTION_KEYS.map((key) => {
            const section = rosterSections.find(s => s.section_key === key);
            if (!section) return null;
            return (
              <div key={key} className="border border-slate-100 rounded-xl p-3">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-2">section_key: {key}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Display Label</label>
                    <input
                      value={section.display_label}
                      onChange={e => updateRosterSectionField(key, 'display_label', e.target.value)}
                      className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Short Label</label>
                    <input
                      value={section.short_label ?? ''}
                      onChange={e => updateRosterSectionField(key, 'short_label', e.target.value || null)}
                      className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Display Order</label>
                    <input
                      type="number"
                      value={section.display_order}
                      onChange={e => updateRosterSectionField(key, 'display_order', Number(e.target.value))}
                      className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Accent Color (optional)</label>
                    <div className="flex items-center gap-2">
                      <input
                        value={section.accent_color ?? ''}
                        onChange={e => updateRosterSectionField(key, 'accent_color', e.target.value || null)}
                        placeholder="#2563eb"
                        className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm font-mono"
                      />
                      {section.accent_color && (
                        <span className="w-6 h-6 rounded-full border border-slate-200 shrink-0" style={{ backgroundColor: section.accent_color }} title={section.accent_color} />
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Icon (optional)</label>
                    <select
                      value={section.icon ?? ''}
                      onChange={e => updateRosterSectionField(key, 'icon', e.target.value || null)}
                      className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white"
                    >
                      <option value="">None</option>
                      {ROSTER_SECTION_ICON_NAMES.map(name => <option key={name} value={name}>{name}</option>)}
                    </select>
                  </div>
                </div>
                <button
                  onClick={() => saveRosterSection(section)}
                  className="mt-3 text-xs font-bold bg-slate-900 text-white px-3 py-1.5 rounded-lg hover:bg-slate-800 cursor-pointer"
                >
                  Save {section.display_label}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* AI Behavior Tuning */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <h3 className="font-bold text-slate-800 flex items-center gap-2 mb-1"><Sparkles size={16} /> AI Behavior Tuning</h3>
        <p className="text-xs text-slate-500 mb-3">
          One free-text instruction per AI Copilot feature, appended on top of its base prompt for
          scoring/structure/style choices only — it can never override the safety, honesty, or human-review
          framing already built into every action. Applies to <code className="text-[10px] bg-slate-100 px-1 py-0.5 rounded">casebook_copilot</code>,{' '}
          <code className="text-[10px] bg-slate-100 px-1 py-0.5 rounded">academic_copilot</code>,{' '}
          <code className="text-[10px] bg-slate-100 px-1 py-0.5 rounded">research_copilot</code>, and{' '}
          <code className="text-[10px] bg-slate-100 px-1 py-0.5 rounded">roster_parser</code> — use one of
          these exact feature keys below, and only the <code className="text-[10px] bg-slate-100 px-1 py-0.5 rounded">extra_instructions</code> field
          in the JSON is read; anything else is ignored.
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
          <input value={newFeatureKey} onChange={e => setNewFeatureKey(e.target.value)} placeholder="feature key, e.g. academic_copilot" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
          <textarea value={newFeaturePrompt} onChange={e => setNewFeaturePrompt(e.target.value)} placeholder='{"extra_instructions": "Prefer our own institutional guidance where sources conflict."}' rows={2} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono" />
          <button onClick={addAdaptationRule} className="flex items-center gap-1 text-xs font-bold bg-slate-900 text-white px-3 py-2 rounded-lg hover:bg-slate-800 cursor-pointer"><Plus size={14} /> Save Rule</button>
        </div>
      </div>
    </div>
  );
};
