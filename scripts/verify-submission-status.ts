#!/usr/bin/env -S npx tsx
// Shared deterministic submission-status core — regression coverage.
// Dependency-free by design, matching scripts/verify-roster-reconciliation.ts's
// existing convention — no Vitest/Jest/Playwright. Pure in-memory fixtures
// against the real module; no network call, no database, no writes anywhere.
//
// Covers the locked canonical rule (see submissionStatus.ts's own header):
// a collection is current only when it belongs to the requested tenantId,
// its id equals that tenant's settings.current_collection_id, and its
// status === 'open' — no fallback to "most recently created open collection."
//
// Also proves, via narrow static assertions (not just logic-level tests),
// that both real callers (ComplianceNudgesView.tsx, submissionChaserAgent.ts)
// actually consume this shared primitive rather than retaining their own
// duplicate open-collection/submission derivation, and that Compliance
// Nudges no longer relies on the implicit DEFAULT_TENANT_ID fallback for
// this signal.
//
// Run: npx tsx scripts/verify-submission-status.ts

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { getSubmissionStatus, resolveCurrentCollection } from '../src/modules/shared/lib/submissionStatus';
import type { Collection } from '../src/types';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;

function check(label: string, cond: boolean) {
  if (cond) {
    console.log(`OK:   ${label}`);
  } else {
    console.error(`FAIL: ${label}`);
    failures += 1;
  }
}

function readFile(relPath: string): string | null {
  const abs = path.join(REPO_ROOT, relPath);
  if (!fs.existsSync(abs)) {
    check(`${relPath} exists`, false);
    return null;
  }
  return fs.readFileSync(abs, 'utf8');
}

function makeCollection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: 'coll-1',
    title: 'September 2026 Rotation',
    deadline: '2026-09-30T00:00:00.000Z',
    status: 'open',
    created_at: '2026-09-01T00:00:00.000Z',
    tenant_id: 'tenant-a',
    ...overrides,
  };
}

// ============================================================
// LOGIC-LEVEL: pure-function fixtures against the real primitive
// ============================================================

// 1. open collection + member submitted -> submitted
{
  const collection = makeCollection();
  const result = getSubmissionStatus({
    tenantId: 'tenant-a',
    workforceId: 'w1',
    currentCollectionId: 'coll-1',
    collections: [collection],
    submissions: [{ workforce_id: 'w1', collection_id: 'coll-1' }],
  });
  check('open collection + member submitted -> open_submitted', result.status === 'open_submitted');
}

// 2. open collection + member absent -> not submitted
{
  const collection = makeCollection();
  const result = getSubmissionStatus({
    tenantId: 'tenant-a',
    workforceId: 'w1',
    currentCollectionId: 'coll-1',
    collections: [collection],
    submissions: [],
  });
  check('open collection + member absent from submissions -> open_not_submitted', result.status === 'open_not_submitted');
}

// 3. no open collection (missing settings pointer)
{
  const result = getSubmissionStatus({
    tenantId: 'tenant-a',
    workforceId: 'w1',
    currentCollectionId: null,
    collections: [makeCollection()],
    submissions: [],
  });
  check('missing settings pointer -> no_current_collection', result.status === 'no_current_collection');
}

// 4. settings pointer -> open same-tenant collection -> valid current collection
{
  const collection = makeCollection({ id: 'coll-2', tenant_id: 'tenant-a', status: 'open' });
  const resolved = resolveCurrentCollection({
    tenantId: 'tenant-a',
    currentCollectionId: 'coll-2',
    collections: [collection],
  });
  check('settings pointer -> open same-tenant collection -> resolves as current', resolved !== null && resolved.id === 'coll-2');
}

// 5. settings pointer -> closed collection -> no current open collection
{
  const collection = makeCollection({ status: 'closed' });
  const resolved = resolveCurrentCollection({
    tenantId: 'tenant-a',
    currentCollectionId: 'coll-1',
    collections: [collection],
  });
  check('settings pointer -> closed collection -> no current open collection', resolved === null);
}

// 6. settings pointer -> collection from another tenant -> no current open collection
{
  const collection = makeCollection({ tenant_id: 'tenant-b', status: 'open' });
  const resolved = resolveCurrentCollection({
    tenantId: 'tenant-a',
    currentCollectionId: 'coll-1',
    collections: [collection],
  });
  check('settings pointer -> collection from another tenant -> no current open collection', resolved === null);
}

// 7. another open collection exists but is not the settings pointer -> do not fall back to it
{
  const pointedTo = makeCollection({ id: 'coll-1', status: 'closed' });
  const otherOpen = makeCollection({ id: 'coll-999', status: 'open', created_at: '2026-09-15T00:00:00.000Z' });
  const resolved = resolveCurrentCollection({
    tenantId: 'tenant-a',
    currentCollectionId: 'coll-1',
    collections: [pointedTo, otherOpen],
  });
  check(
    'another open collection exists but is not the settings pointer -> does not fall back to it',
    resolved === null
  );
}

// 8. missing collection (settings pointer references an id not present at all)
{
  const resolved = resolveCurrentCollection({
    tenantId: 'tenant-a',
    currentCollectionId: 'coll-does-not-exist',
    collections: [makeCollection({ id: 'coll-1' })],
  });
  check('settings pointer -> missing collection -> no current open collection', resolved === null);
}

// 9. submissions for another collection do not count
{
  const collection = makeCollection({ id: 'coll-1' });
  const result = getSubmissionStatus({
    tenantId: 'tenant-a',
    workforceId: 'w1',
    currentCollectionId: 'coll-1',
    collections: [collection],
    submissions: [{ workforce_id: 'w1', collection_id: 'coll-other' }],
  });
  check('submission for a different collection does not count as submitted', result.status === 'open_not_submitted');
}

// 10. submissions for another member do not count
{
  const collection = makeCollection({ id: 'coll-1' });
  const result = getSubmissionStatus({
    tenantId: 'tenant-a',
    workforceId: 'w1',
    currentCollectionId: 'coll-1',
    collections: [collection],
    submissions: [{ workforce_id: 'w2', collection_id: 'coll-1' }],
  });
  check('submission for a different member does not count as submitted', result.status === 'open_not_submitted');
}

// 11. duplicate submissions do not alter the result
{
  const collection = makeCollection({ id: 'coll-1' });
  const result = getSubmissionStatus({
    tenantId: 'tenant-a',
    workforceId: 'w1',
    currentCollectionId: 'coll-1',
    collections: [collection],
    submissions: [
      { workforce_id: 'w1', collection_id: 'coll-1' },
      { workforce_id: 'w1', collection_id: 'coll-1' },
      { workforce_id: 'w1', collection_id: 'coll-1' },
    ],
  });
  check('duplicate submissions for the same member/collection do not change the result', result.status === 'open_submitted');
}

// 12. correct tenant/member submission is counted; a same-shaped submission
// against a collection resolved for a DIFFERENT tenant never counts either,
// because that collection is never resolved as current in the first place
// (case 6) — SubmissionRef itself carries no tenant_id (see
// submissionStatus.ts's own type), so cross-tenant protection lives
// entirely at the collection-resolution gate, not at the submission match.
{
  const correctTenantCollection = makeCollection({ id: 'coll-1', tenant_id: 'tenant-a' });
  const result = getSubmissionStatus({
    tenantId: 'tenant-a',
    workforceId: 'w1',
    currentCollectionId: 'coll-1',
    collections: [correctTenantCollection],
    submissions: [{ workforce_id: 'w1', collection_id: 'coll-1' }],
  });
  check('correct tenant/member submission is counted', result.status === 'open_submitted');

  const wrongTenantResult = getSubmissionStatus({
    tenantId: 'tenant-a',
    workforceId: 'w1',
    currentCollectionId: 'coll-1',
    collections: [makeCollection({ id: 'coll-1', tenant_id: 'tenant-b' })],
    submissions: [{ workforce_id: 'w1', collection_id: 'coll-1' }],
  });
  check(
    "another tenant's collection is never resolved as current, so its submissions never count",
    wrongTenantResult.status === 'no_current_collection'
  );
}

// ============================================================
// STATIC: prove both callers actually use the shared primitive
// ============================================================

function checkCallerUsesSharedPrimitive(relPath: string, importPattern: RegExp, usagePattern: RegExp) {
  const content = readFile(relPath);
  if (content === null) return;
  check(`${relPath} imports the shared submissionStatus primitive`, importPattern.test(content));
  check(`${relPath} actually calls the shared primitive`, usagePattern.test(content));
}

checkCallerUsesSharedPrimitive(
  'src/modules/org-admin/components/ComplianceNudgesView.tsx',
  /from ['"]\.\.\/\.\.\/shared\/lib\/submissionStatus['"]/,
  /getSubmissionStatus\(/
);

checkCallerUsesSharedPrimitive(
  'src/modules/shared/lib/submissionChaserAgent.ts',
  /from ['"]\.\/submissionStatus['"]/,
  /getSubmissionStatus\(/
);

// Compliance Nudges must no longer rely on the implicit DEFAULT_TENANT_ID
// fallback for the roster_pending signal: getSettings()/getCollections()
// must be called with an explicit argument, never bare empty-paren calls
// (which would silently fall back to the default parameter).
{
  const content = readFile('src/modules/org-admin/components/ComplianceNudgesView.tsx');
  if (content !== null) {
    const bareSettingsCall = /getSettings\(\s*\)/.test(content);
    const bareCollectionsCall = /getCollections\(\s*\)/.test(content);
    check(
      'ComplianceNudgesView.tsx no longer calls getSettings()/getCollections() with no tenantId argument',
      !bareSettingsCall && !bareCollectionsCall
    );
    check(
      'ComplianceNudgesView.tsx calls getSettings(tenantId)/getCollections(tenantId) explicitly',
      /getSettings\(tenantId\)/.test(content) && /getCollections\(tenantId\)/.test(content)
    );
  }
}

console.log('');
console.log(`${failures} failure(s).`);
process.exit(failures > 0 ? 1 : 0);
