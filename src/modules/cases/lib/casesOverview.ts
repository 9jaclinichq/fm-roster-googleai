import type { CaseCaptureRecord } from './caseCaptureService';
import type { CaseContinuityAction } from './caseContinuityService';
import { dueGroupForAction, orderOpenContinuityActions, type CaseContinuityDueGroup } from './caseContinuityDomain';

export type CasesOverviewPriority = CaseContinuityDueGroup | 'recent_without_actions';

export interface CasesOverviewItem {
  id: string;
  displayTitle: string;
  capturedAt: string;
  lifecycleStatus: CaseCaptureRecord['lifecycle_status'];
  ownershipStatus: CaseCaptureRecord['ownership_status'];
  updatedAt: string;
  artifactCount: number;
  hasWriteUpRef: boolean;
  priority: CasesOverviewPriority;
  nextAction: string;
  openActionCount: number;
}

const UNSAFE_OVERVIEW_TEXT = /\b(?:https?:\/\/|phone|address|hospital number|raw note|photograph|photo|patient name|diagnosis|diagnosed|presenting complaint|history of presenting|clinical narrative)\b/i;

export function safeCaseTitle(record: Pick<CaseCaptureRecord, 'id' | 'title' | 'subject_label'>): string {
  const candidate = (record.subject_label || record.title || '').trim();
  if (!candidate || UNSAFE_OVERVIEW_TEXT.test(candidate)) return `Case ${record.id.slice(0, 8)}`;
  return candidate;
}

function newestTime(record: Pick<CaseCaptureRecord, 'updated_at' | 'captured_at' | 'created_at'>): number {
  const parsed = Date.parse(record.updated_at || record.captured_at || record.created_at);
  return Number.isFinite(parsed) ? parsed : 0;
}

function priorityRank(priority: CasesOverviewPriority): number {
  if (priority === 'overdue') return 0;
  if (priority === 'due_soon') return 1;
  if (priority === 'later') return 2;
  if (priority === 'unscheduled') return 3;
  return 4;
}

function priorityFromActions(actions: CaseContinuityAction[], now: Date): CasesOverviewPriority {
  const openActions = orderOpenContinuityActions(actions, now);
  if (openActions.length === 0) return 'recent_without_actions';
  return dueGroupForAction(openActions[0], now);
}

function nextActionForCase(record: CaseCaptureRecord, actions: CaseContinuityAction[], artifactCount: number, now: Date): string {
  const firstOpen = orderOpenContinuityActions(actions, now)[0];
  if (firstOpen) return firstOpen.safe_action_label;
  if (artifactCount === 0) return 'Add first case artifact';
  if (record.portfolio_ref) return 'Review linked case write-up';
  if (record.lifecycle_status === 'write_up_ready') return 'Open Casebook/Logbook';
  return 'Continue or review case';
}

export function projectCasesOverview(input: {
  records: CaseCaptureRecord[];
  artifactCountsByRecordId: Record<string, number>;
  continuityActions?: CaseContinuityAction[];
  now?: Date;
}): CasesOverviewItem[] {
  const now = input.now ?? new Date();
  const actionsByRecord = new Map<string, CaseContinuityAction[]>();
  for (const action of input.continuityActions ?? []) {
    const current = actionsByRecord.get(action.case_capture_record_id) ?? [];
    current.push(action);
    actionsByRecord.set(action.case_capture_record_id, current);
  }

  return input.records
    .map((record) => {
      const actions = actionsByRecord.get(record.id) ?? [];
      const openActionCount = actions.filter((action) => action.status === 'planned').length;
      const artifactCount = input.artifactCountsByRecordId[record.id] ?? 0;
      return {
        id: record.id,
        displayTitle: safeCaseTitle(record),
        capturedAt: record.captured_at,
        lifecycleStatus: record.lifecycle_status,
        ownershipStatus: record.ownership_status,
        updatedAt: record.updated_at,
        artifactCount,
        hasWriteUpRef: !!record.portfolio_ref,
        priority: priorityFromActions(actions, now),
        nextAction: nextActionForCase(record, actions, artifactCount, now),
        openActionCount,
      };
    })
    .sort((a, b) => {
      const rankDiff = priorityRank(a.priority) - priorityRank(b.priority);
      if (rankDiff !== 0) return rankDiff;
      if (a.priority === 'recent_without_actions') {
        return newestTime(input.records.find((record) => record.id === b.id)!) - newestTime(input.records.find((record) => record.id === a.id)!);
      }
      const aAction = orderOpenContinuityActions((input.continuityActions ?? []).filter((action) => action.case_capture_record_id === a.id), now)[0];
      const bAction = orderOpenContinuityActions((input.continuityActions ?? []).filter((action) => action.case_capture_record_id === b.id), now)[0];
      const aTime = Date.parse(aAction?.planned_for ?? a.updatedAt);
      const bTime = Date.parse(bAction?.planned_for ?? b.updatedAt);
      const timeDiff = (Number.isFinite(aTime) ? aTime : Number.MAX_SAFE_INTEGER) - (Number.isFinite(bTime) ? bTime : Number.MAX_SAFE_INTEGER);
      if (timeDiff !== 0) return timeDiff;
      return a.id.localeCompare(b.id);
    });
}

export const CASES_V1_ROUTES = {
  capture: '/doctor/cases',
  casebookLogbook: '/doctor/casebook-logbook',
  doctorWorkspace: '/doctor/home',
} as const;
