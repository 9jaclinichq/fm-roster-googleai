import type { Dissertation } from '../../../types';
import type { UdrInstance } from './udr';

export type RecentWorkDomain = 'cases' | 'research';

export interface RecentWorkScope {
  ownerId: string;
  ownerKind: 'workforce' | 'doctor';
  tenantId: string | null;
}

export interface RecentWorkCandidate {
  id: string;
  domain: RecentWorkDomain;
  source: 'casebook_workspace' | 'research_workspace' | 'dissertation';
  ownerId: string;
  ownerKind: 'workforce' | 'doctor';
  tenantId: string | null;
  title: string;
  status: string;
  lastUpdatedAt: string;
  timestampLabel: 'last updated' | 'created';
  route: string;
  supportsDirectResume: boolean;
}

export interface RecentWorkSelection {
  item: RecentWorkCandidate | null;
  fallbackPath: string;
}

const PRIVATE_URL_PATTERN = /\b(?:https?:\/\/|drive\.google\.com|docs\.google\.com|supabase\.co\/storage|document_url|file_url)\b/i;
const CLINICAL_DETAIL_PATTERN = /\b(?:patient|diagnosis|clinical narrative|raw note|photograph|photo|initials)\b/i;

export function containsUnsafeHomeMetadata(value: string): boolean {
  return PRIVATE_URL_PATTERN.test(value) || CLINICAL_DETAIL_PATTERN.test(value);
}

function safeTitle(title: string, fallback: string): string {
  const trimmed = title.trim();
  if (!trimmed || containsUnsafeHomeMetadata(trimmed)) return fallback;
  return trimmed;
}

function isTenantVisible(candidateTenantId: string | null, scopeTenantId: string | null): boolean {
  if (!scopeTenantId) return true;
  return candidateTenantId === null || candidateTenantId === scopeTenantId;
}

function isInScope(candidate: RecentWorkCandidate, scope: RecentWorkScope): boolean {
  return (
    candidate.ownerId === scope.ownerId &&
    candidate.ownerKind === scope.ownerKind &&
    isTenantVisible(candidate.tenantId, scope.tenantId)
  );
}

function recencyValue(candidate: RecentWorkCandidate): number {
  const parsed = Date.parse(candidate.lastUpdatedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function selectNewestRecentWork(
  candidates: RecentWorkCandidate[],
  scope: RecentWorkScope,
  options: { requireDirectRoute?: boolean; domain?: RecentWorkDomain } = {}
): RecentWorkCandidate | null {
  return candidates
    .filter((candidate) => isInScope(candidate, scope))
    .filter((candidate) => !options.domain || candidate.domain === options.domain)
    .filter((candidate) => !options.requireDirectRoute || candidate.supportsDirectResume)
    .filter((candidate) => !containsUnsafeHomeMetadata(`${candidate.title} ${candidate.route}`))
    .sort((a, b) => {
      const byDate = recencyValue(b) - recencyValue(a);
      if (byDate !== 0) return byDate;
      return a.id.localeCompare(b.id);
    })[0] ?? null;
}

export function buildRecentWorkCandidates(args: {
  scope: RecentWorkScope;
  instances: UdrInstance[];
  dissertation: Dissertation | null;
}): RecentWorkCandidate[] {
  const candidates: RecentWorkCandidate[] = [];

  for (const instance of args.instances) {
    if (instance.type === 'casebook_workspace') {
      candidates.push({
        id: instance.id,
        domain: 'cases',
        source: 'casebook_workspace',
        ownerId: args.scope.ownerId,
        ownerKind: args.scope.ownerKind,
        tenantId: instance.tenantId,
        title: safeTitle(instance.title, 'Casebook workspace'),
        status: instance.status,
        lastUpdatedAt: instance.createdAt,
        timestampLabel: 'created',
        route: args.scope.ownerKind === 'workforce' ? '/workspace/casebook-logbook' : '/doctor/casebook-logbook',
        supportsDirectResume: false,
      });
      continue;
    }

    candidates.push({
      id: instance.id,
      domain: 'research',
      source: 'research_workspace',
      ownerId: args.scope.ownerId,
      ownerKind: args.scope.ownerKind,
      tenantId: instance.tenantId,
      title: safeTitle(instance.title, 'Research workspace'),
      status: instance.status,
      lastUpdatedAt: instance.createdAt,
      timestampLabel: 'created',
      route: args.scope.ownerKind === 'workforce' ? '/workspace/research' : '/doctor/research',
      supportsDirectResume: false,
    });
  }

  if (args.dissertation && args.scope.ownerKind === 'workforce') {
    candidates.push({
      id: args.dissertation.id,
      domain: 'research',
      source: 'dissertation',
      ownerId: args.dissertation.workforce_id,
      ownerKind: 'workforce',
      tenantId: args.scope.tenantId,
      title: safeTitle(args.dissertation.title, 'Dissertation'),
      status: args.dissertation.stage,
      lastUpdatedAt: args.dissertation.updated_at,
      timestampLabel: 'last updated',
      route: '/workspace/dissertation',
      supportsDirectResume: true,
    });
  }

  return candidates;
}
