import React, { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardList } from 'lucide-react';
import {
  createAdvisoryFieldworkReadiness,
  FieldworkReadinessDefinition,
} from '../lib/fieldworkReadiness';

interface FieldworkReadinessPanelProps {
  projectRef: string;
  definition?: FieldworkReadinessDefinition;
  proposalApproved?: boolean;
}

function stateLabel(state: string): string {
  return state.replace(/_/g, ' ');
}

export const FieldworkReadinessPanel: React.FC<FieldworkReadinessPanelProps> = ({ projectRef, definition, proposalApproved }) => {
  const readiness = useMemo(
    () => definition ?? createAdvisoryFieldworkReadiness(projectRef, { proposalApproved }),
    [definition, projectRef, proposalApproved]
  );
  const blockers = readiness.lanes.filter((lane) => lane.state !== 'complete');
  const findingsAwaitingDisposition = readiness.findings.filter(
    (finding) => finding.disposition === 'material_amendment_requires_approval' && !finding.approvalEvidenceRecorded
  );

  return (
    <section className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ClipboardList size={17} className="text-slate-500" />
            <h3 className="font-bold text-slate-900 text-sm">Research Fieldwork Readiness</h3>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Workspc readiness guidance — approved research documents remain authoritative.
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Current phase</p>
          <p className="text-xs font-bold text-slate-800">{stateLabel(readiness.studyPhase)}</p>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {readiness.lanes.map((lane) => (
          <div key={lane.key} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
            <div className="flex items-start gap-2">
              {lane.state === 'complete'
                ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-600" />
                : <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600" />}
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-800">{lane.label}</p>
                <p className="mt-0.5 text-[10px] uppercase tracking-wider text-slate-500">{stateLabel(lane.state)}</p>
                {lane.blocker && <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{lane.blocker}</p>}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Next action</p>
          <p className="mt-1 text-xs font-semibold text-slate-800 leading-relaxed">{readiness.nextAction}</p>
        </div>
        <div className="rounded-xl border border-slate-200 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Findings awaiting disposition</p>
          <p className="mt-1 text-xs font-semibold text-slate-800">{findingsAwaitingDisposition.length}</p>
        </div>
        <div className="rounded-xl border border-slate-200 p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Next phase readiness</p>
          <p className={`mt-1 text-xs font-bold ${readiness.readyForNextPhase ? 'text-emerald-700' : 'text-amber-700'}`}>
            {readiness.readyForNextPhase ? 'Ready with evidence' : `${blockers.length} blocker${blockers.length === 1 ? '' : 's'}`}
          </p>
        </div>
      </div>
    </section>
  );
};
