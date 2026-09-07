import type { CaseContinuityAction } from './caseContinuityService';

export type CaseContinuityDueGroup = 'overdue' | 'due_soon' | 'later' | 'unscheduled';

export const CASE_CONTINUITY_ACTION_LABEL_MAX = 96;

const UNSAFE_ACTION_LABEL_PATTERN = /\b(?:https?:\/\/|phone|address|hospital number|raw note|photograph|photo)\b/i;

export function isSafeContinuityActionLabel(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= CASE_CONTINUITY_ACTION_LABEL_MAX && !UNSAFE_ACTION_LABEL_PATTERN.test(trimmed);
}

export function normalizeContinuityActionLabel(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!isSafeContinuityActionLabel(trimmed)) {
    throw new Error('Use a short de-identified action label with no patient identifiers, raw notes, photos, private links, or URLs.');
  }
  return trimmed;
}

export function dueGroupForAction(action: Pick<CaseContinuityAction, 'planned_for' | 'status'>, now = new Date()): CaseContinuityDueGroup {
  if (action.status !== 'planned' || !action.planned_for) return 'unscheduled';
  const planned = Date.parse(action.planned_for);
  if (!Number.isFinite(planned)) return 'unscheduled';

  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const plannedDay = new Date(planned);
  const plannedDate = Date.UTC(plannedDay.getUTCFullYear(), plannedDay.getUTCMonth(), plannedDay.getUTCDate());
  const days = Math.floor((plannedDate - today) / 86400000);

  if (days < 0) return 'overdue';
  if (days <= 7) return 'due_soon';
  return 'later';
}

function dueRank(group: CaseContinuityDueGroup): number {
  if (group === 'overdue') return 0;
  if (group === 'due_soon') return 1;
  if (group === 'later') return 2;
  return 3;
}

function actionTime(action: Pick<CaseContinuityAction, 'planned_for' | 'updated_at' | 'created_at'>): number {
  const source = action.planned_for ?? action.updated_at ?? action.created_at;
  const parsed = Date.parse(source);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

export function orderOpenContinuityActions(actions: CaseContinuityAction[], now = new Date()): CaseContinuityAction[] {
  return [...actions]
    .filter((action) => action.status === 'planned')
    .sort((a, b) => {
      const groupDiff = dueRank(dueGroupForAction(a, now)) - dueRank(dueGroupForAction(b, now));
      if (groupDiff !== 0) return groupDiff;
      const timeDiff = actionTime(a) - actionTime(b);
      if (timeDiff !== 0) return timeDiff;
      return a.id.localeCompare(b.id);
    });
}

export function continuityActionRoute(): string {
  return '/doctor/cases';
}
