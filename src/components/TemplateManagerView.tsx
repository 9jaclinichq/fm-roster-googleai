import React, { useState, useEffect } from 'react';
import { databaseService } from '../lib/databaseService';
import { forkTemplate } from '../lib/research/templateEngine';
import { ResearchTemplate, CasebookTemplate, CasebookFrameworkType, VivaVignette } from '../types';
import { BookOpen, ClipboardList, Plus, Trash2, RefreshCw, GitFork, X, Globe, Building2, Mic, Lock } from 'lucide-react';

// Migration 27 — lets a Chief create/edit/delete their own organization's
// Research Engine and Casebook templates, instead of only ever using the
// global seed templates (never editable/deletable here) or relying on an
// individual resident's personal fork. Integrated into ChiefDashboardView
// as a "Templates" tab, sibling to "customization" (same lazy-import +
// tab-button pattern as TenantCustomizationView).
//
// Migration 28 (Phase 4) adds a third section here — org-admin CRUD for
// the Viva Simulator's practice vignette bank, same global/own split and
// SECURITY-DEFINER-RPC pattern as the Casebook Templates section below.

interface TemplateManagerViewProps {
  tenantId: string;
  adminCode: string;
}

// Supabase RPC errors surface as PostgrestError-shaped objects (a `message`
// string, but not `instanceof Error`), not thrown Error instances — this
// covers both so the plan-gate rejection message from migration 29's RPCs
// (and any other RPC failure) reaches the user instead of a generic string.
function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return fallback;
}

const CASEBOOK_FRAMEWORKS: { value: CasebookFrameworkType; label: string }[] = [
  { value: 'WACP_PMR_10', label: 'WACP PMR 10-Case (Membership)' },
  { value: 'WACP_CASEBOOK_15', label: 'WACP 15-Casebook (Fellowship)' },
  { value: 'NPMCN_CASEBOOK_15', label: 'NPMCN 15-Casebook' },
  { value: 'GENERIC_10', label: 'Generic 10-Case Portfolio' },
  { value: 'CUSTOM_CLINICAL', label: 'Custom Clinical Track' },
];

export const TemplateManagerView: React.FC<TemplateManagerViewProps> = ({ tenantId, adminCode }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [researchTemplates, setResearchTemplates] = useState<ResearchTemplate[]>([]);
  const [casebookTemplates, setCasebookTemplates] = useState<CasebookTemplate[]>([]);
  const [statusMessage, setStatusMessage] = useState('');

  // Research fork ("create") — editing/deep-editing a research template's
  // rubric fields already has a dedicated UI in ResearchWorkspaceView; here
  // a Chief only needs to fork a global template into their org's own
  // copy, or remove one they no longer want (reset to defaults).
  const [showResearchForkModal, setShowResearchForkModal] = useState(false);
  const [researchForkSourceId, setResearchForkSourceId] = useState('');
  const [researchForkName, setResearchForkName] = useState('');
  const [isForkingResearch, setIsForkingResearch] = useState(false);

  // Casebook create/edit — this module had no admin CRUD at all before
  // migration 27, so create and edit share one form.
  const [showCasebookModal, setShowCasebookModal] = useState(false);
  const [editingCasebookId, setEditingCasebookId] = useState<string | null>(null);
  const [cbName, setCbName] = useState('');
  const [cbFramework, setCbFramework] = useState<CasebookFrameworkType>('GENERIC_10');
  const [cbDistribution, setCbDistribution] = useState('{}');
  const [cbRubric, setCbRubric] = useState('{}');
  const [cbFormatting, setCbFormatting] = useState('{}');
  const [isSavingCasebook, setIsSavingCasebook] = useState(false);

  // Viva Vignettes create/edit (migration 28) — same create-and-edit-share-
  // one-form shape as Casebook Templates above; prompts are edited as one
  // examiner question per line rather than JSON, since it's a plain string list.
  const [vivaVignettes, setVivaVignettes] = useState<VivaVignette[]>([]);
  const [showVivaModal, setShowVivaModal] = useState(false);
  const [editingVivaId, setEditingVivaId] = useState<string | null>(null);
  const [vvTitle, setVvTitle] = useState('');
  const [vvCategory, setVvCategory] = useState('');
  const [vvScenario, setVvScenario] = useState('');
  const [vvPrompts, setVvPrompts] = useState('');
  const [isSavingViva, setIsSavingViva] = useState(false);

  // Phase 5 — org-custom content creation (casebook templates, viva
  // vignettes, research template forks) requires a paid tenant plan.
  // Chiefs have no workforce_id of their own, so this is gated on the
  // ORGANIZATION's plan_type, not the per-resident user_subscriptions Pro
  // gate used elsewhere in this app. See migration 29's header for the
  // full rationale, including the deliberately-flagged gap that there is
  // no self-serve tenant-plan upgrade checkout yet.
  const [isFreeTier, setIsFreeTier] = useState(false);

  const load = async () => {
    setIsLoading(true);
    try {
      const [rt, ct, vv, tenant] = await Promise.all([
        databaseService.getResearchTemplates(),
        databaseService.getCasebookTemplates(),
        databaseService.getVivaVignettes(),
        databaseService.getTenant(tenantId),
      ]);
      setResearchTemplates(rt);
      setCasebookTemplates(ct);
      setVivaVignettes(vv);
      setIsFreeTier((tenant?.plan_type ?? 'free_seeded') === 'free_seeded');
    } catch (err) {
      console.warn(err);
      setStatusMessage('Failed to load templates.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, [tenantId]);

  const researchGlobal = researchTemplates.filter(t => t.tenant_id === null);
  const researchOwn = researchTemplates.filter(t => t.tenant_id === tenantId);
  const casebookGlobal = casebookTemplates.filter(t => t.tenant_id === null);
  const casebookOwn = casebookTemplates.filter(t => t.tenant_id === tenantId);
  const vivaGlobal = vivaVignettes.filter(v => v.tenant_id === null);
  const vivaOwn = vivaVignettes.filter(v => v.tenant_id === tenantId);

  const openResearchFork = (sourceId: string) => {
    if (isFreeTier) {
      setStatusMessage('Creating custom research templates requires a paid plan. Contact the platform to upgrade your organization.');
      return;
    }
    const src = researchTemplates.find(t => t.id === sourceId);
    setResearchForkSourceId(sourceId);
    setResearchForkName(src ? `${src.name} (Org Custom)` : '');
    setShowResearchForkModal(true);
  };

  const handleForkResearch = async () => {
    if (!researchForkSourceId || !researchForkName.trim()) return;
    // Client-side only — research_templates has no gating RPC (see
    // migration 29's header). Weaker than the server-enforced casebook/viva
    // gates below; flagged, not hidden.
    if (isFreeTier) {
      setStatusMessage('Creating custom research templates requires a paid plan. Contact the platform to upgrade your organization.');
      return;
    }
    setIsForkingResearch(true);
    try {
      // workforceId: null — the Chief authoring this isn't a workforce
      // member themselves (see templateEngine.forkTemplate's comment).
      await forkTemplate(researchForkSourceId, null, {
        scope: 'tenant',
        newName: researchForkName.trim(),
        tenantId,
      });
      setShowResearchForkModal(false);
      setResearchForkName('');
      setStatusMessage('Research template created for your organization.');
      await load();
    } catch (err) {
      console.warn(err);
      setStatusMessage(errorMessage(err, 'Failed to create research template.'));
    } finally {
      setIsForkingResearch(false);
    }
  };

  const handleDeleteResearch = async (id: string) => {
    try {
      await databaseService.chiefDeleteResearchTemplate(adminCode, id);
      setStatusMessage('Research template removed — the global default remains available to residents.');
      await load();
    } catch (err) {
      console.warn(err);
      setStatusMessage('Failed to remove research template.');
    }
  };

  const openCreateCasebook = () => {
    if (isFreeTier) {
      setStatusMessage('Creating custom casebook templates requires a paid plan. Contact the platform to upgrade your organization.');
      return;
    }
    setEditingCasebookId(null);
    setCbName('');
    setCbFramework('GENERIC_10');
    setCbDistribution('{}');
    setCbRubric('{}');
    setCbFormatting('{}');
    setShowCasebookModal(true);
  };

  const openEditCasebook = (t: CasebookTemplate) => {
    setEditingCasebookId(t.id);
    setCbName(t.name);
    setCbFramework(t.framework_type);
    setCbDistribution(JSON.stringify(t.thematic_distribution, null, 2));
    setCbRubric(JSON.stringify(t.scoring_rubric, null, 2));
    setCbFormatting(JSON.stringify(t.formatting_rules, null, 2));
    setShowCasebookModal(true);
  };

  const handleSaveCasebook = async () => {
    if (!cbName.trim()) {
      setStatusMessage('Template name is required.');
      return;
    }
    let distribution: Record<string, unknown>;
    let rubric: Record<string, unknown>;
    let formatting: Record<string, unknown>;
    try {
      distribution = JSON.parse(cbDistribution || '{}');
      rubric = JSON.parse(cbRubric || '{}');
      formatting = JSON.parse(cbFormatting || '{}');
    } catch {
      setStatusMessage('Distribution, scoring rubric, and formatting rules must each be valid JSON.');
      return;
    }
    setIsSavingCasebook(true);
    try {
      if (editingCasebookId) {
        await databaseService.chiefUpdateCasebookTemplate(adminCode, editingCasebookId, {
          name: cbName.trim(),
          thematic_distribution: distribution,
          scoring_rubric: rubric,
          formatting_rules: formatting,
        });
        setStatusMessage('Casebook template updated.');
      } else {
        await databaseService.chiefCreateCasebookTemplate(adminCode, {
          name: cbName.trim(),
          framework_type: cbFramework,
          thematic_distribution: distribution,
          scoring_rubric: rubric,
          formatting_rules: formatting,
        });
        setStatusMessage('Casebook template created for your organization.');
      }
      setShowCasebookModal(false);
      await load();
    } catch (err) {
      console.warn(err);
      setStatusMessage(errorMessage(err, 'Failed to save casebook template.'));
    } finally {
      setIsSavingCasebook(false);
    }
  };

  const handleDeleteCasebook = async (id: string) => {
    try {
      await databaseService.chiefDeleteCasebookTemplate(adminCode, id);
      setStatusMessage('Casebook template removed — the global default remains available to residents.');
      await load();
    } catch (err) {
      console.warn(err);
      setStatusMessage('Failed to remove casebook template.');
    }
  };

  const openCreateViva = () => {
    if (isFreeTier) {
      setStatusMessage('Creating custom viva vignettes requires a paid plan. Contact the platform to upgrade your organization.');
      return;
    }
    setEditingVivaId(null);
    setVvTitle('');
    setVvCategory('');
    setVvScenario('');
    setVvPrompts('');
    setShowVivaModal(true);
  };

  const openEditViva = (v: VivaVignette) => {
    setEditingVivaId(v.id);
    setVvTitle(v.title);
    setVvCategory(v.category);
    setVvScenario(v.scenario);
    setVvPrompts(v.prompts.join('\n'));
    setShowVivaModal(true);
  };

  const handleSaveViva = async () => {
    if (!vvTitle.trim() || !vvCategory.trim() || !vvScenario.trim()) {
      setStatusMessage('Title, category, and scenario are all required.');
      return;
    }
    const prompts = vvPrompts.split('\n').map(p => p.trim()).filter(Boolean);
    if (prompts.length === 0) {
      setStatusMessage('Add at least one examiner prompt (one per line).');
      return;
    }
    setIsSavingViva(true);
    try {
      const entry = { title: vvTitle.trim(), category: vvCategory.trim(), scenario: vvScenario.trim(), prompts };
      if (editingVivaId) {
        await databaseService.chiefUpdateVivaVignette(adminCode, editingVivaId, entry);
        setStatusMessage('Viva vignette updated.');
      } else {
        await databaseService.chiefCreateVivaVignette(adminCode, entry);
        setStatusMessage('Viva vignette created for your organization.');
      }
      setShowVivaModal(false);
      await load();
    } catch (err) {
      console.warn(err);
      setStatusMessage(errorMessage(err, 'Failed to save viva vignette.'));
    } finally {
      setIsSavingViva(false);
    }
  };

  const handleDeleteViva = async (id: string) => {
    try {
      await databaseService.chiefDeleteVivaVignette(adminCode, id);
      setStatusMessage('Viva vignette removed.');
      await load();
    } catch (err) {
      console.warn(err);
      setStatusMessage('Failed to remove viva vignette.');
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-16 text-slate-400"><RefreshCw className="animate-spin mr-2" size={18} /> Loading templates...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2"><ClipboardList size={20} /> Template Manager</h2>
        <p className="text-sm text-slate-500 mt-1">
          Create, edit, and remove your organization's own Research and Casebook templates. Global platform
          defaults are always read-only here and can be forked into your own editable copy.
        </p>
      </div>

      {isFreeTier && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3 text-sm flex items-center gap-2">
          <Lock size={15} className="shrink-0" />
          Your organization is on the Free plan. Creating custom Research/Casebook templates and Viva Vignettes
          requires the Pro plan (₦12,000/month) — contact the platform to upgrade. Global defaults and your
          organization's existing custom content remain fully usable.
        </div>
      )}

      {statusMessage && <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-xl p-3 text-sm">{statusMessage}</div>}

      {/* Research Templates */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <h3 className="font-bold text-slate-800 flex items-center gap-2 mb-3"><BookOpen size={16} /> Research Templates</h3>
        <div className="space-y-2 mb-3">
          {researchOwn.length === 0 && <p className="text-xs text-slate-400">Your organization has no custom research templates yet — fork one below.</p>}
          {researchOwn.map(t => (
            <div key={t.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <Building2 size={13} className="text-blue-500 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{t.name}</p>
                  <p className="text-[10px] text-slate-500">{t.organization_or_body} &bull; {t.referencing_style}</p>
                </div>
              </div>
              <button
                onClick={() => handleDeleteResearch(t.id)}
                className="shrink-0 flex items-center gap-1 text-[10px] font-bold text-rose-600 hover:text-rose-700 px-2 py-1 rounded-lg hover:bg-rose-50 cursor-pointer"
                title="Reset to defaults (removes your org's copy; the global template remains available)"
              >
                <Trash2 size={12} /> Reset to Default
              </button>
            </div>
          ))}
        </div>
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Global Defaults — fork to customize</p>
          {researchGlobal.map(t => (
            <div key={t.id} className="flex items-center justify-between px-3 py-2 border border-slate-100 rounded-lg">
              <div className="flex items-center gap-2 min-w-0">
                <Globe size={13} className="text-slate-400 shrink-0" />
                <p className="text-sm font-medium text-slate-700 truncate">{t.name}</p>
              </div>
              <button
                onClick={() => openResearchFork(t.id)}
                className="shrink-0 flex items-center gap-1 text-[10px] font-bold text-slate-700 border border-slate-200 hover:bg-slate-50 px-2 py-1 rounded-lg cursor-pointer"
                title={isFreeTier ? 'Requires the Pro plan' : undefined}
              >
                {isFreeTier ? <Lock size={12} /> : <GitFork size={12} />} Fork for My Org
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Casebook Templates */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-slate-800 flex items-center gap-2"><ClipboardList size={16} /> Casebook Templates</h3>
          <button
            onClick={openCreateCasebook}
            className="flex items-center gap-1 text-xs font-bold bg-slate-900 text-white px-3 py-1.5 rounded-lg hover:bg-slate-800 cursor-pointer"
            title={isFreeTier ? 'Requires the Pro plan' : undefined}
          >
            {isFreeTier ? <Lock size={14} /> : <Plus size={14} />} New Template
          </button>
        </div>
        <div className="space-y-2 mb-3">
          {casebookOwn.length === 0 && <p className="text-xs text-slate-400">Your organization has no custom casebook templates yet.</p>}
          {casebookOwn.map(t => (
            <div key={t.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <Building2 size={13} className="text-blue-500 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{t.name}</p>
                  <p className="text-[10px] text-slate-500">{t.framework_type}</p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => openEditCasebook(t)} className="text-[10px] font-bold text-slate-700 border border-slate-200 hover:bg-white px-2 py-1 rounded-lg cursor-pointer">Edit</button>
                <button
                  onClick={() => handleDeleteCasebook(t.id)}
                  className="flex items-center gap-1 text-[10px] font-bold text-rose-600 hover:text-rose-700 px-2 py-1 rounded-lg hover:bg-rose-50 cursor-pointer"
                >
                  <Trash2 size={12} /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Global Defaults (read-only)</p>
          {casebookGlobal.map(t => (
            <div key={t.id} className="flex items-center gap-2 px-3 py-2 border border-slate-100 rounded-lg">
              <Globe size={13} className="text-slate-400 shrink-0" />
              <p className="text-sm font-medium text-slate-700">{t.name}</p>
              <span className="text-[10px] text-slate-400">({t.framework_type})</span>
            </div>
          ))}
        </div>
      </div>

      {/* Viva Vignettes (migration 28) */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-slate-800 flex items-center gap-2"><Mic size={16} /> Viva Vignettes</h3>
          <button
            onClick={openCreateViva}
            className="flex items-center gap-1 text-xs font-bold bg-slate-900 text-white px-3 py-1.5 rounded-lg hover:bg-slate-800 cursor-pointer"
            title={isFreeTier ? 'Requires the Pro plan' : undefined}
          >
            {isFreeTier ? <Lock size={14} /> : <Plus size={14} />} New Vignette
          </button>
        </div>
        <p className="text-xs text-slate-500 mb-3">
          Practice scenarios for the Mock Viva Oral Exam Simulator. The 5 global vignettes are illustrative,
          not specialty-specific — add your own to match your program's case mix.
        </p>
        <div className="space-y-2 mb-3">
          {vivaOwn.length === 0 && <p className="text-xs text-slate-400">Your organization has no custom vignettes yet.</p>}
          {vivaOwn.map(v => (
            <div key={v.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <Building2 size={13} className="text-blue-500 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{v.title}</p>
                  <p className="text-[10px] text-slate-500">{v.category} &bull; {v.prompts.length} prompts</p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => openEditViva(v)} className="text-[10px] font-bold text-slate-700 border border-slate-200 hover:bg-white px-2 py-1 rounded-lg cursor-pointer">Edit</button>
                <button
                  onClick={() => handleDeleteViva(v.id)}
                  className="flex items-center gap-1 text-[10px] font-bold text-rose-600 hover:text-rose-700 px-2 py-1 rounded-lg hover:bg-rose-50 cursor-pointer"
                >
                  <Trash2 size={12} /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Global Defaults (read-only)</p>
          {vivaGlobal.map(v => (
            <div key={v.id} className="flex items-center gap-2 px-3 py-2 border border-slate-100 rounded-lg">
              <Globe size={13} className="text-slate-400 shrink-0" />
              <p className="text-sm font-medium text-slate-700">{v.title}</p>
              <span className="text-[10px] text-slate-400">({v.category})</span>
            </div>
          ))}
        </div>
      </div>

      {/* Research fork modal */}
      {showResearchForkModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setShowResearchForkModal(false)}>
          <div className="bg-white rounded-2xl p-5 w-full max-w-sm space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-slate-900 text-sm">Fork Research Template</h4>
              <button onClick={() => setShowResearchForkModal(false)} className="text-slate-400 hover:text-slate-700 cursor-pointer"><X size={16} /></button>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase">New Name</label>
              <input value={researchForkName} onChange={e => setResearchForkName(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
            </div>
            <button
              onClick={handleForkResearch}
              disabled={isForkingResearch || !researchForkName.trim()}
              className="w-full text-xs font-bold bg-slate-900 text-white px-3 py-2 rounded-lg hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
            >
              {isForkingResearch ? 'Creating...' : 'Create for My Organization'}
            </button>
          </div>
        </div>
      )}

      {/* Casebook create/edit modal */}
      {showCasebookModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setShowCasebookModal(false)}>
          <div className="bg-white rounded-2xl p-5 w-full max-w-lg space-y-3 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-slate-900 text-sm">{editingCasebookId ? 'Edit Casebook Template' : 'New Casebook Template'}</h4>
              <button onClick={() => setShowCasebookModal(false)} className="text-slate-400 hover:text-slate-700 cursor-pointer"><X size={16} /></button>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase">Name</label>
              <input value={cbName} onChange={e => setCbName(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
            </div>
            {!editingCasebookId && (
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Framework</label>
                <select value={cbFramework} onChange={e => setCbFramework(e.target.value as CasebookFrameworkType)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">
                  {CASEBOOK_FRAMEWORKS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase">Thematic Distribution (JSON)</label>
              <textarea value={cbDistribution} onChange={e => setCbDistribution(e.target.value)} rows={3} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase">Scoring Rubric (JSON)</label>
              <textarea value={cbRubric} onChange={e => setCbRubric(e.target.value)} rows={3} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase">Formatting Rules (JSON)</label>
              <textarea value={cbFormatting} onChange={e => setCbFormatting(e.target.value)} rows={2} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs font-mono" />
            </div>
            <button
              onClick={handleSaveCasebook}
              disabled={isSavingCasebook}
              className="w-full text-xs font-bold bg-slate-900 text-white px-3 py-2 rounded-lg hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
            >
              {isSavingCasebook ? 'Saving...' : editingCasebookId ? 'Save Changes' : 'Create Template'}
            </button>
          </div>
        </div>
      )}

      {/* Viva vignette create/edit modal */}
      {showVivaModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setShowVivaModal(false)}>
          <div className="bg-white rounded-2xl p-5 w-full max-w-lg space-y-3 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-slate-900 text-sm">{editingVivaId ? 'Edit Viva Vignette' : 'New Viva Vignette'}</h4>
              <button onClick={() => setShowVivaModal(false)} className="text-slate-400 hover:text-slate-700 cursor-pointer"><X size={16} /></button>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase">Title</label>
              <input value={vvTitle} onChange={e => setVvTitle(e.target.value)} placeholder="e.g. Neonatal Jaundice" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase">Category</label>
              <input value={vvCategory} onChange={e => setVvCategory(e.target.value)} placeholder="e.g. Paediatric Case" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase">Scenario</label>
              <textarea value={vvScenario} onChange={e => setVvScenario(e.target.value)} rows={3} placeholder="Brief clinical scenario framing..." className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-400 uppercase">Examiner Prompts (one per line)</label>
              <textarea value={vvPrompts} onChange={e => setVvPrompts(e.target.value)} rows={4} placeholder={'What is your differential diagnosis?\nOutline your management plan.'} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
            </div>
            <button
              onClick={handleSaveViva}
              disabled={isSavingViva}
              className="w-full text-xs font-bold bg-slate-900 text-white px-3 py-2 rounded-lg hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
            >
              {isSavingViva ? 'Saving...' : editingVivaId ? 'Save Changes' : 'Create Vignette'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
