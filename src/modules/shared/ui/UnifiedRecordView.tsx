import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../../lib/databaseService';
import { getUnifiedDoctorRecord, UnifiedDoctorRecord, UdrInstanceType, UdrEntryType } from '../lib/udr';
import { runRubricComplianceChaserForDoctor } from '../lib/rubricComplianceAgent';
import {
  RefreshCw, IdCard, Building2, FolderKanban, History, GraduationCap, CreditCard, Sparkles, ChevronRight,
} from 'lucide-react';

// First real face for the L3 Spine's Unified Doctor Record read-composition
// layer (src/modules/shared/lib/udr.ts) — see that file's header and
// docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md §5. This component is a pure
// display of whatever getUnifiedDoctorRecord() returns; it performs no
// writes and reuses this app's existing card/loading/error conventions
// (see ResearchWorkspaceView.tsx / CasebookWorkspaceView.tsx) rather than
// inventing new visual language.
interface UnifiedRecordOwner {
  id: string;
  name: string;
  kind: 'workforce' | 'doctor';
  tenantId: string;
}

interface UnifiedRecordViewProps {
  owner: UnifiedRecordOwner;
}

const IDENTITY_KIND_LABEL: Record<UnifiedDoctorRecord['identity']['kind'], string> = {
  workforce: 'Workforce',
  doctor: 'Doctor',
  workforce_linked_to_doctor: 'Workforce (linked to Doctor)',
};

const INSTANCE_TYPE_LABEL: Record<UdrInstanceType, string> = {
  research_workspace: 'Research Workspace',
  casebook_workspace: 'Casebook Workspace',
};

const INSTANCE_ROUTE_SUFFIX: Record<UdrInstanceType, string> = {
  research_workspace: 'research',
  casebook_workspace: 'casebook-logbook',
};

const ENTRY_TYPE_LABEL: Record<UdrEntryType, string> = {
  submission: 'Submission',
  case_report: 'Case Report',
  dissertation_milestone: 'Dissertation Milestone',
};

export const UnifiedRecordView: React.FC<UnifiedRecordViewProps> = ({ owner }) => {
  const navigate = useNavigate();
  const [record, setRecord] = useState<UnifiedDoctorRecord | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    const load = async () => {
      // Doctor-scoped sweep of the Rubric Compliance Chaser agent (see
      // src/modules/shared/lib/rubricComplianceAgent.ts) runs FIRST, awaited,
      // so a freshly-raised insight is committed before the UDR read below —
      // otherwise it wouldn't show up until a second visit. Best-effort/
      // non-fatal, same pattern as InsightsStrip.tsx's own
      // runSubmissionChaser call: a failure here must never block the record
      // from loading. The workforce-owned org-wide sweep is a separate
      // concern wired into InsightsStrip.tsx elsewhere, not here.
      if (owner.kind === 'doctor') {
        try {
          await runRubricComplianceChaserForDoctor(supabase, owner.id);
        } catch (err) {
          console.warn('UnifiedRecordView: runRubricComplianceChaserForDoctor failed (non-fatal)', err);
        }
      }

      try {
        const result = await getUnifiedDoctorRecord(
          supabase,
          owner.kind === 'workforce' ? { workforceId: owner.id } : { doctorId: owner.id }
        );
        if (!cancelled) setRecord(result);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load your Unified Record.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [owner.id, owner.kind]);

  if (isLoading) {
    return (
      <div className="text-center py-16">
        <RefreshCw size={28} className="text-slate-400 animate-spin mx-auto mb-2" />
        <p className="text-sm text-slate-500">Loading Unified Record...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-5xl mx-auto my-8 px-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      </div>
    );
  }

  if (!record) return null;

  // This app has no deep-link routing to one specific research/casebook
  // workspace instance — /workspace/research (or /doctor/research) always
  // shows that owner's own list/picker view, so linking to the module
  // route is correct here, not a shortcut.
  const routePrefix = owner.kind === 'workforce' ? '/workspace' : '/doctor';

  return (
    <div className="max-w-5xl mx-auto my-8 px-4 space-y-6">
      {/* Header card */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center space-x-2">
            <IdCard className="text-slate-500" size={18} />
            <div>
              <h2 className="font-bold text-slate-900 text-lg tracking-tight">
                {record.identity.fullName || 'Unified Record'}
              </h2>
              <p className="text-xs text-slate-500">
                {record.identity.category || 'No category set'}
              </p>
            </div>
          </div>
          <span className="inline-block px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border bg-slate-100 text-slate-600 border-slate-200">
            {IDENTITY_KIND_LABEL[record.identity.kind]}
          </span>
        </div>
        <div className="mt-4 pt-4 border-t border-slate-100 flex items-center space-x-2">
          <Building2 size={14} className="text-slate-400 shrink-0" />
          <span className="text-xs text-slate-600 font-medium">
            {record.tenant ? record.tenant.name : 'Not affiliated with an organization'}
          </span>
        </div>
      </div>

      {/* Instances */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
        <div className="flex items-center space-x-2">
          <FolderKanban size={16} className="text-slate-500" />
          <h3 className="font-bold text-slate-900 text-sm">Workspaces</h3>
        </div>
        {record.instances.length === 0 ? (
          <p className="text-sm text-slate-500">No workspaces yet.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {record.instances.map((instance) => (
              <button
                key={instance.id}
                type="button"
                onClick={() => navigate(`${routePrefix}/${INSTANCE_ROUTE_SUFFIX[instance.type]}`)}
                className="bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-xl p-4 text-left transition cursor-pointer space-y-1 flex flex-col"
              >
                <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">
                  {INSTANCE_TYPE_LABEL[instance.type]}
                </span>
                <span className="font-bold text-slate-900 text-sm">{instance.title}</span>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
                    {instance.status.replace(/_/g, ' ')}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {new Date(instance.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Entries timeline */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
        <div className="flex items-center space-x-2">
          <History size={16} className="text-slate-500" />
          <h3 className="font-bold text-slate-900 text-sm">Entries</h3>
        </div>
        {record.entries.length === 0 ? (
          <p className="text-sm text-slate-500">No entries yet.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {record.entries.map((entry) => (
              <div key={`${entry.type}-${entry.id}`} className="py-3 flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-start space-x-3">
                  <span className="inline-block px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border bg-slate-100 text-slate-600 border-slate-200 shrink-0 mt-0.5">
                    {ENTRY_TYPE_LABEL[entry.type]}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{entry.summary}</p>
                    {entry.status && (
                      <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mt-0.5">
                        {entry.status.replace(/_/g, ' ')}
                      </p>
                    )}
                  </div>
                </div>
                <span className="text-[10px] text-slate-400 shrink-0">
                  {new Date(entry.createdAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Academic summary */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex items-center space-x-2">
          <GraduationCap size={16} className="text-slate-500" />
          <h3 className="font-bold text-slate-900 text-sm">Academic Summary</h3>
        </div>

        <div>
          <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-1">Dissertation</p>
          {record.academic.dissertation ? (
            <p className="text-sm text-slate-700">
              {record.academic.dissertation.title}
              <span className="text-slate-400"> &bull; {record.academic.dissertation.stage}</span>
            </p>
          ) : (
            <p className="text-sm text-slate-500">Not started</p>
          )}
        </div>

        <div>
          <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-1">Exam Readiness</p>
          {record.academic.examReadiness ? (
            <ul className="text-sm text-slate-700 space-y-1">
              <li>
                Evidemy: {record.academic.examReadiness.evidemy_completed_count} / {record.academic.examReadiness.evidemy_total_required}
              </li>
              <li>Physical logbook verified: {record.academic.examReadiness.physical_logbook_verified ? 'Yes' : 'No'}</li>
              <li>Exam fees paid: {record.academic.examReadiness.exam_fees_paid ? 'Yes' : 'No'}</li>
              <li>College forms submitted: {record.academic.examReadiness.college_forms_submitted ? 'Yes' : 'No'}</li>
              <li>
                Oral practice score:{' '}
                {record.academic.examReadiness.oral_practice_score != null
                  ? record.academic.examReadiness.oral_practice_score
                  : 'None'}
              </li>
            </ul>
          ) : (
            <p className="text-sm text-slate-500">Not started</p>
          )}
        </div>

        <div>
          <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-1">Case Reports</p>
          <p className="text-sm text-slate-700">
            {record.academic.caseReportsCount > 0 ? record.academic.caseReportsCount : 'None'}
          </p>
        </div>
      </div>

      {/* Billing status */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-2">
        <div className="flex items-center space-x-2">
          <CreditCard size={16} className="text-slate-500" />
          <h3 className="font-bold text-slate-900 text-sm">Billing</h3>
        </div>
        {record.billing.activeSubscription ? (
          <p className="text-sm text-slate-700">
            {record.billing.activeSubscription.plan.replace(/_/g, ' ')}
            <span className="text-slate-400"> &bull; {record.billing.activeSubscription.status}</span>
            {record.billing.activeSubscription.current_period_end && (
              <span className="text-slate-400">
                {' '}&bull; renews {new Date(record.billing.activeSubscription.current_period_end).toLocaleDateString()}
              </span>
            )}
          </p>
        ) : (
          <p className="text-sm text-slate-500">Free plan &mdash; no active subscription</p>
        )}
      </div>

      {/* Insights */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
        <div className="flex items-center space-x-2">
          <Sparkles size={16} className="text-slate-500" />
          <h3 className="font-bold text-slate-900 text-sm">Insights</h3>
        </div>
        {record.insights.length === 0 ? (
          <p className="text-sm text-slate-500">No open insights right now.</p>
        ) : (
          <div className="space-y-2">
            {record.insights.map((insight) => (
              <div key={insight.id} className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex items-start justify-between gap-3">
                <div className="flex items-start space-x-2">
                  <ChevronRight size={13} className="text-slate-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-slate-800">{insight.text}</p>
                    <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mt-0.5">
                      Rung {insight.rung}
                    </p>
                  </div>
                </div>
                <span className="text-[10px] text-slate-400 shrink-0">
                  {new Date(insight.createdAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
