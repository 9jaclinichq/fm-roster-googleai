// Shared deterministic submission-status core.
//
// Unifies the one genuinely duplicated computation between
// ComplianceNudgesView.tsx (resident/self-facing) and submissionChaserAgent.ts
// (Chief/tenant-wide): whether a given workforce member has submitted to
// the tenant's currently-open collection. Pure — takes already-fetched data,
// makes no network/DB call of its own, decides nothing about persistence,
// dismissal, notifications, or free/paid tiering. Those remain caller
// responsibilities; see each caller's own file for that logic.
//
// CANONICAL "currently-open collection" RULE (locked; do not silently
// change): a collection is current only when ALL of the following hold —
// it belongs to the requested tenantId; its id equals that tenant's
// settings.current_collection_id; its status === 'open'. The settings
// pointer identifies WHICH collection is current; the collection's own
// status determines whether it is open. There is no fallback to "most
// recently created open collection" — an open collection that is not the
// settings pointer is never current, and a closed or missing settings
// pointer target means no currently-open collection, not an error.
//
// Product framing (recorded here once, not scattered through the code):
// this deterministic detection is free product intelligence (Free =
// Operate). A future scheduled/notification layer wrapping this same core
// would be the paid automation tier (Paid = Automate) — not implemented
// here.
import { Collection } from '../../../types';

// Deliberately carries no tenant_id — cross-tenant protection lives
// entirely at the collection-resolution gate (resolveCurrentCollection
// below rejects a collection whose tenant_id doesn't match), not here.
// Callers must still only ever pass already tenant-scoped submissions.
export type SubmissionRef = { workforce_id: string; collection_id: string };

export type SubmissionStatusResult =
  | { status: 'no_current_collection' }
  | { status: 'open_not_submitted'; collection: Collection }
  | { status: 'open_submitted'; collection: Collection };

/**
 * Resolves the tenant's canonical currently-open collection from
 * already-fetched data, per the locked rule above. Returns null for every
 * "not current" case (missing pointer, missing collection, wrong tenant,
 * closed status) — callers must not invent a fallback collection.
 */
export function resolveCurrentCollection(params: {
  tenantId: string;
  currentCollectionId: string | null;
  collections: Collection[];
}): Collection | null {
  const { tenantId, currentCollectionId, collections } = params;
  if (!currentCollectionId) return null;

  const collection = collections.find((c) => c.id === currentCollectionId);
  if (!collection) return null;
  if (collection.tenant_id !== tenantId) return null;
  if (collection.status !== 'open') return null;

  return collection;
}

/**
 * Deterministically answers, for one workforce member: is there a valid
 * currently-open collection, and if so, have they submitted to it yet?
 * Duplicate submissions for the same (workforce_id, collection_id) pair do
 * not change the result — a single matching row is sufficient.
 */
export function getSubmissionStatus(params: {
  tenantId: string;
  workforceId: string;
  currentCollectionId: string | null;
  collections: Collection[];
  submissions: SubmissionRef[];
}): SubmissionStatusResult {
  const { workforceId, submissions } = params;

  const collection = resolveCurrentCollection(params);
  if (!collection) return { status: 'no_current_collection' };

  const hasSubmitted = submissions.some(
    (s) => s.workforce_id === workforceId && s.collection_id === collection.id
  );

  return hasSubmitted
    ? { status: 'open_submitted', collection }
    : { status: 'open_not_submitted', collection };
}
