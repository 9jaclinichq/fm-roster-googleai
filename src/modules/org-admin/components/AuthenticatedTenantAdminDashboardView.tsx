import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Building2, CheckCircle2, RefreshCw, Settings2, ShieldCheck, Users } from 'lucide-react';
import { ConfirmationDialog } from '../../shared/ui/ConfirmationDialog';
import { useTerminology } from '../../shared/terminology';
import {
  hasUnsafeTenantVocabularyMarkup,
  TENANT_SETUP_LABELS,
  TENANT_SETUP_VOCABULARY_KEYS,
  TENANT_VOCABULARY_DEFAULTS,
} from '../../shared/tenantVocabulary';
import { tenantAdminService, TenantAdminDashboard } from '../lib/tenantAdminService';

interface AuthenticatedTenantAdminDashboardViewProps {
  expectedTenantId: string;
  onBackToWorkspace: () => void;
}

const MODULE_OPTIONS = [
  { key: 'dissertation_module_enabled', label: 'Research project workspace' },
  { key: 'viva_simulator_enabled', label: 'Assessment practice' },
  { key: 'exam_readiness_enabled', label: 'Readiness scorecard' },
] as const;

export const AuthenticatedTenantAdminDashboardView: React.FC<AuthenticatedTenantAdminDashboardViewProps> = ({
  expectedTenantId,
  onBackToWorkspace,
}) => {
  const { t } = useTerminology();
  const [dashboard, setDashboard] = useState<TenantAdminDashboard | null>(null);
  const [name, setName] = useState('');
  const [vocabulary, setVocabulary] = useState<Record<string, string>>({});
  const [moduleFlags, setModuleFlags] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState('Keep organisation identity and operational language current.');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await tenantAdminService.getDashboard();
      if (result.tenant_id !== expectedTenantId) throw new Error('The authenticated organisation does not match this workspace.');
      setDashboard(result);
      setName(result.tenant_name);
      setVocabulary({ ...TENANT_VOCABULARY_DEFAULTS, ...result.terminology_overrides, org_name: result.tenant_name });
      setModuleFlags(Object.fromEntries(MODULE_OPTIONS.map(option => [option.key, result.module_flags[option.key] !== false])));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Tenant administration could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [expectedTenantId]);

  const validationError = useMemo(() => {
    if (name.trim().length < 2 || name.trim().length > 100 || hasUnsafeTenantVocabularyMarkup(name)) {
      return 'Organisation name must be 2-100 plain-text characters.';
    }
    for (const key of TENANT_SETUP_VOCABULARY_KEYS) {
      const value = (vocabulary[key] ?? '').trim();
      if (!value || value.length > 64 || hasUnsafeTenantVocabularyMarkup(value)) {
        return `${TENANT_SETUP_LABELS[key]} must be 1-64 plain-text characters.`;
      }
    }
    if (reason.trim().length < 8 || reason.trim().length > 500) return 'Give a short reason (8-500 characters) for the audit record.';
    return '';
  }, [name, vocabulary, reason]);

  const save = async () => {
    if (!dashboard || saving || validationError) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const overrides = Object.fromEntries(
        Object.entries({ ...dashboard.terminology_overrides, ...vocabulary, org_name: name.trim() } as Record<string, string>)
          .map(([key, value]) => [key, value.trim()]),
      );
      const result = await tenantAdminService.updateSetup({
        tenantId: dashboard.tenant_id,
        name: name.trim(),
        overrides,
        moduleFlagsPatch: moduleFlags,
        reason: reason.trim(),
        idempotencyKey: `tenant-setup:${dashboard.tenant_id}:${crypto.randomUUID()}`,
      });
      window.dispatchEvent(new CustomEvent('workspc:tenant-vocabulary-updated', { detail: { tenantId: dashboard.tenant_id, overrides } }));
      setMessage(`Organisation setup saved with audit reference ${result.audit_id.slice(0, 8)}.`);
      setConfirming(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Organisation setup could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <main className="flex-1 flex items-center justify-center p-8" aria-busy="true"><RefreshCw className="animate-spin mr-2" size={18} /> Loading organisation dashboard…</main>;
  if (!dashboard) return <main className="flex-1 max-w-3xl mx-auto w-full p-4 sm:p-8"><div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800">{error || 'Tenant-administrator access is unavailable.'}</div><button type="button" onClick={onBackToWorkspace} className="mt-4 min-h-11 px-4 rounded-lg border font-semibold">Return to member workspace</button></main>;

  const adminLabel = t('admin', 'Organisation Administrator');
  const dashboardLabel = t('admin_dashboard', `${adminLabel} Dashboard`);

  return <main className="flex-1 max-w-6xl mx-auto w-full p-4 sm:p-8 space-y-6">
    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
      <div>
        <div className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 border border-blue-200 px-3 py-1 text-xs font-bold text-blue-800" aria-label={`Tenant administrator: ${adminLabel}`}><ShieldCheck size={14} /> {adminLabel}</div>
        <h1 className="mt-3 text-2xl sm:text-3xl font-bold text-slate-950">{dashboardLabel}</h1>
        <p className="mt-1 text-sm text-slate-600">{dashboard.tenant_name} · authority is derived from your active personal membership.</p>
      </div>
      <button type="button" onClick={onBackToWorkspace} className="min-h-11 inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"><ArrowLeft size={16} /> Member workspace</button>
    </div>

    {message && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900"><CheckCircle2 className="inline mr-2" size={16} />{message}</div>}
    {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div>}

    <section aria-label="Organisation overview" className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className="rounded-xl border bg-white p-4"><Users className="text-blue-600" size={19} /><p className="mt-2 text-2xl font-bold">{dashboard.counts.active_members}</p><p className="text-xs text-slate-500">Active {t('members', 'Members').toLowerCase()}</p></div>
      <div className="rounded-xl border bg-white p-4"><Building2 className="text-blue-600" size={19} /><p className="mt-2 text-2xl font-bold">{dashboard.counts.open_collections}</p><p className="text-xs text-slate-500">Open {t('collection_cycle', 'Submission Cycle').toLowerCase()} records</p></div>
      <div className="rounded-xl border bg-white p-4"><ShieldCheck className="text-blue-600" size={19} /><p className="mt-2 text-2xl font-bold">{dashboard.counts.active_admins}</p><p className="text-xs text-slate-500">Active tenant administrators</p></div>
    </section>

    <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 space-y-5" aria-labelledby="tenant-setup-heading">
      <div><h2 id="tenant-setup-heading" className="text-xl font-bold flex items-center gap-2"><Settings2 size={20} /> Tenant Setup &amp; Vocabulary</h2><p className="mt-1 text-sm text-slate-600">Labels change presentation only. They never grant administrator authority.</p></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="text-sm font-semibold">Organisation display name<input value={name} onChange={event => setName(event.target.value)} maxLength={100} className="mt-1 min-h-11 w-full rounded-lg border px-3 font-normal" /></label>
        {TENANT_SETUP_VOCABULARY_KEYS.filter(key => key !== 'org_name').map(key => <label key={key} className="text-sm font-semibold">{TENANT_SETUP_LABELS[key]}<input value={vocabulary[key] ?? ''} onChange={event => setVocabulary(current => ({ ...current, [key]: event.target.value }))} maxLength={64} className="mt-1 min-h-11 w-full rounded-lg border px-3 font-normal" /></label>)}
      </div>
      <fieldset className="space-y-2"><legend className="text-sm font-bold">Enabled modules</legend>{MODULE_OPTIONS.map(option => <label key={option.key} className="flex items-center gap-3 min-h-11 rounded-lg border px-3"><input type="checkbox" checked={moduleFlags[option.key] !== false} onChange={event => setModuleFlags(current => ({ ...current, [option.key]: event.target.checked }))} /><span className="text-sm">{option.label}</span></label>)}</fieldset>
      <div className="rounded-xl bg-slate-50 border p-4" aria-label="Terminology preview"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Preview</p><p className="mt-2 font-bold">{vocabulary.admin_dashboard || TENANT_VOCABULARY_DEFAULTS.admin_dashboard}</p><p className="text-sm text-slate-600">{name || TENANT_VOCABULARY_DEFAULTS.org_name} · {vocabulary.members || TENANT_VOCABULARY_DEFAULTS.members} · {vocabulary.schedule || TENANT_VOCABULARY_DEFAULTS.schedule} · {vocabulary.submission || TENANT_VOCABULARY_DEFAULTS.submission}</p></div>
      <label className="text-sm font-semibold">Reason for change<textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={500} className="mt-1 min-h-20 w-full rounded-lg border p-3 font-normal" /></label>
      {validationError && <p className="text-sm text-rose-700" role="alert">{validationError}</p>}
      <button type="button" disabled={saving || !!validationError} onClick={() => setConfirming(true)} className="min-h-11 rounded-lg bg-blue-600 px-5 text-sm font-bold text-white disabled:bg-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2">Review changes</button>
    </section>

    <ConfirmationDialog open={confirming} title="Apply organisation setup changes?" description="This updates tenant-scoped presentation and module visibility. Administrator authority is unchanged." details={[{ label: 'Organisation', value: name || 'Organisation' }, { label: 'Administrator label', value: vocabulary.admin || TENANT_VOCABULARY_DEFAULTS.admin }, { label: 'Reason', value: reason }]} confirmLabel="Save organisation setup" busy={saving} onCancel={() => setConfirming(false)} onConfirm={save} />
  </main>;
};
