import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../../lib/databaseService';
import { getUnifiedDoctorRecord, UnifiedDoctorRecord } from '../lib/udr';
import {
  projectProfessionalRecordCommandCentre,
  ProfessionalRecordLaneStatus,
} from '../lib/professionalRecordCommandCentre';
import { runRubricComplianceChaserForDoctor } from '../lib/rubricComplianceAgent';
import {
  ArrowRight,
  BookOpen,
  BriefcaseBusiness,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  CreditCard,
  FileWarning,
  GraduationCap,
  IdCard,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

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
  workforce_linked_to_doctor: 'Workforce linked to Doctor',
};

const LANE_STATUS_LABEL: Record<ProfessionalRecordLaneStatus, string> = {
  available: 'Available',
  no_records_yet: 'No records yet',
  not_connected: 'Not connected',
  not_currently_tracked: 'Not currently tracked',
  needs_attention: 'Needs attention',
};

const LANE_STATUS_CLASS: Record<ProfessionalRecordLaneStatus, string> = {
  available: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  no_records_yet: 'bg-slate-50 text-slate-600 border-slate-200',
  not_connected: 'bg-amber-50 text-amber-700 border-amber-200',
  not_currently_tracked: 'bg-slate-50 text-slate-500 border-slate-200',
  needs_attention: 'bg-rose-50 text-rose-700 border-rose-200',
};

const LANE_ICON = {
  workforce: BriefcaseBusiness,
  cases: ClipboardList,
  research: BookOpen,
  learning: GraduationCap,
  meetings: CalendarDays,
  billing: CreditCard,
  audit: FileWarning,
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
        <p className="text-sm text-slate-500">Loading My Professional Record...</p>
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

  const projection = projectProfessionalRecordCommandCentre(record, {
    ownerId: owner.id,
    ownerKind: owner.kind,
    tenantId: owner.kind === 'workforce' ? owner.tenantId : null,
  });

  return (
    <div className="max-w-5xl mx-auto my-8 px-4 space-y-6">
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <IdCard className="text-slate-500" size={18} />
              <h2 className="font-bold text-slate-900 text-lg tracking-tight">My Professional Record</h2>
            </div>
            <p className="text-xs text-slate-500">
              A longitudinal overview of identity, assignments, portfolio, academic work, learning, and tracked professional activity.
            </p>
          </div>
          <button
            type="button"
            disabled={!projection.nextActionRoute}
            onClick={() => projection.nextActionRoute && navigate(projection.nextActionRoute)}
            className="inline-flex items-center space-x-1.5 px-3 py-2 bg-slate-950 hover:bg-slate-900 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-xl text-xs font-bold shadow-sm transition cursor-pointer disabled:cursor-not-allowed"
          >
            <ArrowRight size={14} />
            <span>{projection.nextActionLabel}</span>
          </button>
        </div>

        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="border border-slate-200 rounded-xl p-3 bg-slate-50">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Professional identity</p>
            <p className="text-sm font-bold text-slate-900 truncate">{projection.identityName}</p>
            <p className="text-[11px] text-slate-500">{projection.identityRole}</p>
          </div>
          <div className="border border-slate-200 rounded-xl p-3 bg-slate-50">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Institution</p>
            <p className="text-sm font-bold text-slate-900 truncate">{projection.tenantName}</p>
            <p className="text-[11px] text-slate-500">{IDENTITY_KIND_LABEL[record.identity.kind]}</p>
          </div>
          <div className="border border-slate-200 rounded-xl p-3 bg-slate-50">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Current assignment</p>
            <p className="text-sm font-bold text-slate-900">{projection.currentAssignment}</p>
          </div>
          <div className="border border-slate-200 rounded-xl p-3 bg-slate-50">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Last activity</p>
            <p className="text-sm font-bold text-slate-900">{projection.lastActivityLabel}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {projection.lanes.map((lane) => {
          const Icon = LANE_ICON[lane.key];
          return (
            <div key={lane.key} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start space-x-2 min-w-0">
                  <Icon size={16} className="text-slate-500 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <h3 className="font-bold text-slate-900 text-sm">{lane.title}</h3>
                    <p className="text-xs text-slate-500 mt-1">{lane.summary}</p>
                  </div>
                </div>
                <span className={`inline-block px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border shrink-0 ${LANE_STATUS_CLASS[lane.status]}`}>
                  {LANE_STATUS_LABEL[lane.status]}
                </span>
              </div>
              {lane.route ? (
                <button
                  type="button"
                  onClick={() => navigate(lane.route!)}
                  className="inline-flex items-center space-x-1.5 px-2.5 py-1.5 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-[11px] font-bold transition cursor-pointer"
                >
                  <span>{lane.actionLabel}</span>
                  <ChevronRight size={12} />
                </button>
              ) : (
                <p className="text-[11px] text-slate-400">{lane.actionLabel}</p>
              )}
            </div>
          );
        })}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
        <div className="flex items-center space-x-2">
          <ShieldCheck size={16} className="text-slate-500" />
          <h3 className="font-bold text-slate-900 text-sm">Record Boundaries</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Detail level</p>
            <p className="text-xs text-slate-600 mt-1">
              Overview only. Case narratives, raw notes, feedback, and private document links stay in their source modules.
            </p>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Meetings and audit</p>
            <p className="text-xs text-slate-600 mt-1">
              Shown only when a real per-person source exists. Unsupported audit data is not fabricated.
            </p>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Data source</p>
            <p className="text-xs text-slate-600 mt-1">
              Read from the Unified Doctor Record for this authenticated identity and tenant context.
            </p>
          </div>
        </div>
      </div>

      {record.insights.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
          <div className="flex items-center space-x-2">
            <Sparkles size={16} className="text-slate-500" />
            <h3 className="font-bold text-slate-900 text-sm">Open Insights</h3>
          </div>
          <div className="space-y-2">
            {record.insights.slice(0, 3).map((insight) => (
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
        </div>
      )}
    </div>
  );
};
