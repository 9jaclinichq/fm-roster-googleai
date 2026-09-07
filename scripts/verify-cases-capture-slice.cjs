#!/usr/bin/env node
// Workspc Cases slice 1 (migration 81) — privacy/storage invariant
// verification. Matches the existing scripts/verify-*.cjs convention:
// dependency-free, no network call, no database, no writes. Everything
// below is asserted by reading the real files on disk.
//
// This slice introduces the first tables in this repo intended to hold real
// patient-identifiable source material, and the first non-public Storage
// bucket. The invariants that make that safe are structural, so they are
// checked structurally rather than trusted to review.
//
// Run: node scripts/verify-cases-capture-slice.cjs

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
let failures = 0;

function check(label, cond) {
  if (cond === true) {
    console.log(`OK:   ${label}`);
  } else {
    console.error(`FAIL: ${label}${typeof cond === 'string' ? ` — ${cond}` : ''}`);
    failures += 1;
  }
}

function read(relPath) {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
}

const MIGRATION_PATH = 'supabase/migrations/81_cases_capture_slice.sql';
const SERVICE_PATH = 'src/modules/cases/lib/caseCaptureService.ts';

// Pre-existing surfaces this slice must not have touched. Resolved by
// migration NUMBER rather than by hardcoded filename: the names are long,
// and a number is the stable identity a migration actually has.
const MIGRATIONS_DIR = 'supabase/migrations';

function migrationPath(number) {
  const entries = fs.readdirSync(path.join(REPO_ROOT, MIGRATIONS_DIR));
  const hit = entries.find((f) => new RegExp(`^0*${number}_`).test(f));
  if (!hit) throw new Error(`no migration file found for number ${number}`);
  return `${MIGRATIONS_DIR}/${hit}`;
}

const UNTOUCHED_MIGRATIONS = [4, 10, 11, 15].map(migrationPath);

for (const p of [MIGRATION_PATH, SERVICE_PATH, ...UNTOUCHED_MIGRATIONS]) {
  check(`${p} exists`, fs.existsSync(path.join(REPO_ROOT, p)));
}

const sql = read(MIGRATION_PATH);
const service = read(SERVICE_PATH);

// Comment-stripped SQL, so a policy name quoted in the header prose can
// never satisfy — or trip — a check about actual statements.
const sqlCode = sql
  .split('\n')
  .filter((line) => !/^\s*--/.test(line))
  .join('\n');

// Same treatment for the TypeScript service. These files document the
// boundary by naming exactly what they must not do ("no getPublicUrl()",
// "does not touch clinical_case_reports"), so a scanner that reads comments
// would flag the documentation as the violation. Every check below that
// asserts an absence runs against `serviceCode`; checks asserting a
// presence of real code run against it too.
const serviceCode = service
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((line) => {
    // Drop a trailing line comment, but never cut inside a string or regex
    // literal. A quote, backtick, or backslash earlier on the line means a
    // literal is in play — `/^https?:\/\//i` ends in an adjacent `//` pair
    // that is regex syntax, not a comment — so such lines are left intact.
    const i = line.indexOf('//');
    if (i === -1) return line;
    const before = line.slice(0, i);
    if (/['"`\\]/.test(before)) return line;
    return before;
  })
  .join('\n');

// ====================================================================
// 1. The new bucket is private in the migration definition
// ====================================================================

check('migration creates the case-source-restricted bucket', (() => {
  return /INSERT\s+INTO\s+storage\.buckets/i.test(sqlCode) && /'case-source-restricted'/.test(sqlCode);
})());

check("case-source-restricted is inserted with public = false", (() => {
  // Isolate the VALUES tuple of the bucket insert and assert the boolean
  // literal in it is `false`, rather than merely finding the word "false"
  // somewhere in the file.
  const m = sqlCode.match(/INSERT\s+INTO\s+storage\.buckets[\s\S]*?VALUES\s*\(([\s\S]*?)\)\s*ON\s+CONFLICT/i);
  if (!m) return 'no bucket INSERT ... VALUES ... ON CONFLICT block found';
  const tuple = m[1];
  if (!/'case-source-restricted'/.test(tuple)) return 'bucket insert tuple does not name case-source-restricted';
  if (/\btrue\b/i.test(tuple)) return 'bucket insert tuple contains a `true` literal — bucket may be public';
  return /\bfalse\b/i.test(tuple) ? true : 'bucket insert tuple has no `false` literal for the public column';
})());

// ====================================================================
// 2. No TO public raw-source policy
// ====================================================================

check('no storage policy in this migration grants TO public or TO anon', (() => {
  const policies = sqlCode.match(/CREATE\s+POLICY[\s\S]*?(?=CREATE\s+POLICY|DROP\s+POLICY|INSERT\s+INTO|ALTER\s+TABLE|REVOKE|$)/gi) || [];
  const offending = policies.filter((p) => /\bTO\s+(public|anon)\b/i.test(p));
  return offending.length === 0 ? true : `${offending.length} policy/policies grant TO public or anon`;
})());

check('every CREATE POLICY in this migration is scoped TO authenticated', (() => {
  const policies = sqlCode.match(/CREATE\s+POLICY[\s\S]*?(?=CREATE\s+POLICY|DROP\s+POLICY|INSERT\s+INTO|ALTER\s+TABLE|REVOKE|$)/gi) || [];
  if (policies.length === 0) return 'no CREATE POLICY statements found at all';
  const missing = policies.filter((p) => !/\bTO\s+authenticated\b/i.test(p));
  return missing.length === 0 ? true : `${missing.length} policy/policies are not scoped TO authenticated`;
})());

check('the four case-source-restricted storage policies all confine access to the caller\'s own folder', (() => {
  const verbs = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
  const missing = verbs.filter((v) => {
    const re = new RegExp(`CREATE\\s+POLICY\\s+"case_source_restricted_${v.toLowerCase()}"[\\s\\S]*?FOR\\s+${v}[\\s\\S]*?storage\\.foldername\\(name\\)\\)\\[1\\]\\s*=\\s*auth\\.uid\\(\\)::text`, 'i');
    return !re.test(sqlCode);
  });
  return missing.length === 0 ? true : `missing owner-folder predicate for: ${missing.join(', ')}`;
})());

// --- Owned-parent path invariant (Codex peer review, TURN 0005, P2) ---

// Returns the text of one CREATE POLICY statement, up to its closing ');'.
// Static regexes are then applied to that block, rather than building one
// giant RegExp from a template literal — escaping backslashes through a
// template literal is how this file previously grew a silent bug.
function policyBlock(policyName) {
  const start = sqlCode.indexOf(`CREATE POLICY "${policyName}"`);
  if (start === -1) return null;
  const end = sqlCode.indexOf('\n);', start);
  return end === -1 ? sqlCode.slice(start) : sqlCode.slice(start, end + 3);
}

const OWNED_PARENT_FROM = /FROM\s+case_capture_records\s+r/i;
const OWNED_PARENT_DOCTOR = /r\.doctor_id\s*=\s*auth\.uid\(\)/i;
const OWNED_PARENT_SEGMENT = /r\.id::text\s*=\s*\(storage\.foldername\(name\)\)\[2\]/i;

check('the SELECT/INSERT/UPDATE storage policies also require an OWNED PARENT capture record named by path segment 2', (() => {
  const missing = ['select', 'insert', 'update'].filter((v) => {
    const block = policyBlock(`case_source_restricted_${v}`);
    if (!block) return true;
    return !OWNED_PARENT_FROM.test(block)
      || !OWNED_PARENT_DOCTOR.test(block)
      || !OWNED_PARENT_SEGMENT.test(block);
  });
  return missing.length === 0 ? true : `missing owned-parent predicate for: ${missing.join(', ')}`;
})());

check('the UPDATE storage policy carries the owned-parent predicate in BOTH its USING and WITH CHECK halves', (() => {
  const m = sqlCode.match(/CREATE\s+POLICY\s+"case_source_restricted_update"[\s\S]*?\n\);/i);
  if (!m) return 'update policy not found';
  const occurrences = (m[0].match(/FROM\s+case_capture_records\s+r/gi) || []).length;
  return occurrences >= 2 ? true : `owned-parent predicate appears ${occurrences} time(s), expected 2 (USING and WITH CHECK)`;
})());

check('the parent lookup compares uuid-as-text, never casting a path segment to uuid (a malformed path must deny, not error)', (() => {
  if (/\(storage\.foldername\(name\)\)\[2\]\s*::\s*uuid/i.test(sqlCode)) return 'a path segment is cast to uuid';
  return /r\.id::text\s*=\s*\(storage\.foldername\(name\)\)\[2\]/i.test(sqlCode)
    ? true : 'expected r.id::text = (storage.foldername(name))[2]';
})());

check('the DELETE storage policy deliberately does NOT require an owned parent (so a deleted record cannot strand its objects)', (() => {
  const m = sqlCode.match(/CREATE\s+POLICY\s+"case_source_restricted_delete"[\s\S]*?\n\);/i);
  if (!m) return 'delete policy not found';
  if (/FROM\s+case_capture_records/i.test(m[0])) {
    return 'DELETE now requires an owned parent record - that strands raw PHI objects permanently once their record is deleted; see the migration header';
  }
  return /\(storage\.foldername\(name\)\)\[1\]\s*=\s*auth\.uid\(\)::text/i.test(m[0])
    ? true : 'DELETE lost its owner-prefix check';
})());

// ====================================================================
// 3. No USING (true) on the capture tables
// ====================================================================

check('migration contains no USING (true) anywhere', (() => {
  return !/USING\s*\(\s*true\s*\)/i.test(sqlCode) ? true : 'a USING (true) predicate is present';
})());

check('migration contains no WITH CHECK (true) anywhere', (() => {
  return !/WITH\s+CHECK\s*\(\s*true\s*\)/i.test(sqlCode) ? true : 'a WITH CHECK (true) predicate is present';
})());

check('RLS is enabled on both capture tables', (() => {
  return /ALTER\s+TABLE\s+case_capture_records\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(sqlCode)
    && /ALTER\s+TABLE\s+case_capture_artifacts\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(sqlCode);
})());

check('anon is explicitly revoked on both capture tables', (() => {
  return /REVOKE\s+ALL\s+ON\s+case_capture_records\s+FROM\s+anon/i.test(sqlCode)
    && /REVOKE\s+ALL\s+ON\s+case_capture_artifacts\s+FROM\s+anon/i.test(sqlCode);
})());

check('case_capture_records.doctor_id is NOT NULL and references doctor_profiles', (() => {
  return /doctor_id\s+uuid\s+NOT\s+NULL\s+REFERENCES\s+doctor_profiles\(id\)/i.test(sqlCode);
})());

check('all four case_capture_records policies use the direct owner predicate doctor_id = auth.uid()', (() => {
  const verbs = ['select', 'insert', 'update', 'delete'];
  const missing = verbs.filter((v) => {
    const re = new RegExp(`CREATE\\s+POLICY\\s+"case_capture_records_${v}"[\\s\\S]*?doctor_id\\s*=\\s*auth\\.uid\\(\\)`, 'i');
    return !re.test(sqlCode);
  });
  return missing.length === 0 ? true : `missing owner predicate for: ${missing.join(', ')}`;
})());

// ====================================================================
// 4. Artifact RLS derives access through its parent
// ====================================================================

check('all four case_capture_artifacts policies derive access through case_capture_records via EXISTS', (() => {
  const verbs = ['select', 'insert', 'update', 'delete'];
  const missing = verbs.filter((v) => {
    const re = new RegExp(
      `CREATE\\s+POLICY\\s+"case_capture_artifacts_${v}"[\\s\\S]*?EXISTS\\s*\\([\\s\\S]*?FROM\\s+case_capture_records\\s+r[\\s\\S]*?r\\.id\\s*=\\s*case_capture_artifacts\\.record_id[\\s\\S]*?r\\.doctor_id\\s*=\\s*auth\\.uid\\(\\)`,
      'i'
    );
    return !re.test(sqlCode);
  });
  return missing.length === 0 ? true : `missing parent-derived predicate for: ${missing.join(', ')}`;
})());

check('case_capture_artifacts carries no owner column of its own (ownership cannot drift from the parent)', (() => {
  const m = sqlCode.match(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+case_capture_artifacts\s*\(([\s\S]*?)\n\);/i);
  if (!m) return 'case_capture_artifacts CREATE TABLE block not found';
  return !/\bdoctor_id\b/i.test(m[1]) ? true : 'artifact table declares its own doctor_id';
})());

// ====================================================================
// 5. Deterministic ordering invariant
// ====================================================================

check('UNIQUE (record_id, sequence) ordering invariant is present', (() => {
  return /UNIQUE\s*\(\s*record_id\s*,\s*sequence\s*\)/i.test(sqlCode);
})());

check('sequence is NOT NULL and constrained >= 1', (() => {
  return /sequence\s+integer\s+NOT\s+NULL\s+CHECK\s*\(\s*sequence\s*>=\s*1\s*\)/i.test(sqlCode);
})());

// ====================================================================
// 6. Paths, not URLs, in the database
// ====================================================================

check('storage_path carries a CHECK constraint rejecting http(s) URLs', (() => {
  return /storage_path\s+text\s+NOT\s+NULL[\s\S]{0,200}?CHECK\s*\([\s\S]*?storage_path\s*!~\*\s*'\^https\?:\/\/'/i.test(sqlCode);
})());

// ====================================================================
// 7. Provenance enum excludes the AI value while no AI path exists
// ====================================================================

check("source_provenance CHECK admits exactly source_observed / patient_reported / clinician_stated", (() => {
  const m = sqlCode.match(/source_provenance[\s\S]*?CHECK\s*\(\s*source_provenance\s+IN\s*\(([^)]*)\)/i);
  if (!m) return 'source_provenance CHECK not found';
  const values = m[1].split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean).sort();
  const expected = ['clinician_stated', 'patient_reported', 'source_observed'];
  return JSON.stringify(values) === JSON.stringify(expected) ? true : `got: ${values.join(', ')}`;
})());

check('ai_inferred_unconfirmed appears nowhere in the migration statements', (() => {
  return !/ai_inferred_unconfirmed/i.test(sqlCode) ? true : 'the AI provenance value is present';
})());

// ====================================================================
// 8. No forced portfolio assignment
// ====================================================================

check('portfolio_ref is nullable free text — no NOT NULL, no 1..15 slot constraint', (() => {
  const m = sqlCode.match(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+case_capture_records\s*\(([\s\S]*?)\n\);/i);
  if (!m) return 'case_capture_records CREATE TABLE block not found';
  const body = m[1];
  if (!/portfolio_ref\s+text/i.test(body)) return 'portfolio_ref column not found';
  if (/portfolio_ref\s+text\s+NOT\s+NULL/i.test(body)) return 'portfolio_ref is NOT NULL — capture would be forced into a slot';
  if (/case_number/i.test(body)) return 'a case_number column leaked into the capture table';
  return true;
})());

// ====================================================================
// 9. No existing surface changed by this migration
// ====================================================================

check('migration references no pre-existing case/casebook table in a DDL statement', (() => {
  const forbidden = ['case_reports', 'clinical_case_reports', 'casebook_templates', 'casebook_workspaces', 'clinical_logbooks', 'admin_logbook_parsing_queue'];
  const ddl = sqlCode.match(/^\s*(ALTER|DROP|CREATE|INSERT|UPDATE|DELETE)\b.*$/gim) || [];
  const hits = [];
  for (const stmt of ddl) {
    for (const t of forbidden) {
      // case_capture_records must not be mistaken for case_reports.
      if (new RegExp(`\\b${t}\\b`).test(stmt)) hits.push(`${t} in: ${stmt.trim().slice(0, 60)}`);
    }
  }
  return hits.length === 0 ? true : hits.join(' | ');
})());

check('migration touches no pre-existing bucket', (() => {
  const forbidden = ['academic-documents', 'roster-documents', 'guest-signatures'];
  const hits = forbidden.filter((b) => new RegExp(`'${b}'`).test(sqlCode));
  return hits.length === 0 ? true : `references ${hits.join(', ')}`;
})());

check('the four pre-existing migrations that define public buckets are unchanged (still public = true)', (() => {
  // Guards against this slice "fixing" HD-0001 as a drive-by. The existing
  // public buckets are deliberately left exactly as they were; remediation
  // is its own reviewed slice.
  const stillPublic = [
    [migrationPath(4), 'academic-documents'],
    [migrationPath(10), 'roster-documents'],
    [migrationPath(11), 'guest-signatures'],
  ];
  const broken = stillPublic.filter(([file, bucket]) => {
    const body = read(file);
    return !new RegExp(`'${bucket}'[\\s\\S]{0,120}?\\btrue\\b`, 'i').test(body);
  });
  return broken.length === 0 ? true : `unexpectedly modified: ${broken.map((b) => b[0]).join(', ')}`;
})());

// ====================================================================
// 10. Service boundary invariants
// ====================================================================

check('no getPublicUrl() anywhere in the new Cases service', (() => {
  return !/getPublicUrl/.test(serviceCode) ? true : 'getPublicUrl is referenced';
})());

check('the service reads artifacts through createSignedUrl instead', (() => {
  return /createSignedUrl\(/.test(serviceCode);
})());

check('no Edge Function invocation in the new Cases service', (() => {
  return !/functions\s*\.\s*invoke/.test(serviceCode) ? true : 'supabase.functions.invoke is called';
})());

check('no AI/copilot import in the new Cases service', (() => {
  const imports = serviceCode.match(/^import[\s\S]*?from\s+'[^']+';/gm) || [];
  const offending = imports.filter((i) => /copilot|casebook|openai|gemini|ai[A-Z]/i.test(i));
  return offending.length === 0 ? true : `offending import(s): ${offending.join(' | ')}`;
})());

check('the new Cases service reads/writes no pre-existing case table', (() => {
  const forbidden = ['case_reports', 'clinical_case_reports', 'casebook_templates', 'casebook_workspaces', 'clinical_logbooks', 'ai_action_logs'];
  const hits = forbidden.filter((t) => new RegExp(`['"\`]${t}['"\`]`).test(serviceCode));
  return hits.length === 0 ? true : `references ${hits.join(', ')}`;
})());

check('the new Cases service uses only the private case-source-restricted bucket', (() => {
  const buckets = [...serviceCode.matchAll(/\.from\(\s*(?:CASE_SOURCE_BUCKET|'([^']+)')\s*\)/g)]
    .map((m) => m[1])
    .filter(Boolean);
  const forbidden = buckets.filter((b) => ['academic-documents', 'roster-documents', 'guest-signatures'].includes(b));
  return forbidden.length === 0 && /CASE_SOURCE_BUCKET\s*=\s*'case-source-restricted'/.test(serviceCode)
    ? true
    : `bucket usage: ${buckets.join(', ') || '(none literal)'}`;
})());

check('the service rejects a URL passed where an object path is expected', (() => {
  return /\^https\?:\\\/\\\//.test(serviceCode) || /https\?:\\\/\\\//.test(serviceCode)
    ? true
    : 'no URL guard found in the service';
})());

check('appendArtifact handles the unique-violation race rather than assuming max(sequence) is stable', (() => {
  return /23505/.test(serviceCode) && /APPEND_MAX_ATTEMPTS/.test(serviceCode);
})());

check('the new Cases module does not modify src/lib/databaseService.ts (protected surface)', (() => {
  // The service may IMPORT the shared supabase client — that is the house
  // pattern every module service follows — but this slice adds no code to
  // that file. Asserted here as a reminder of the boundary; the Harness
  // scope check is the enforcing mechanism.
  return /^import \{ supabase \} from '\.\.\/\.\.\/\.\.\/lib\/databaseService';$/m.test(serviceCode);
})());

// ====================================================================
// 11. Service fixes from Codex peer review (relay TURN 0005)
// ====================================================================

check('P1 - deleteArtifact takes an artifact id only, never a caller-supplied (id, storage_path) pair', (() => {
  const m = serviceCode.match(/async\s+deleteArtifact\s*\(([^)]*)\)/);
  if (!m) return 'deleteArtifact not found';
  const params = m[1];
  if (/storage_path/.test(params)) return `still accepts a caller-supplied path: ${params.trim()}`;
  return /artifactId\s*:\s*string/.test(params) ? true : `unexpected signature: ${params.trim()}`;
})());

check('P1 - deleteArtifact re-reads the row under RLS before removing anything', (() => {
  const m = serviceCode.match(/async\s+deleteArtifact[\s\S]*?\n  \},/);
  if (!m) return 'deleteArtifact body not found';
  const body = m[0];
  const selectsFirst = body.indexOf('.select(');
  const removesLater = body.indexOf('.remove(');
  return selectsFirst !== -1 && removesLater !== -1 && selectsFirst < removesLater
    ? true : 'expected a select() of the artifact row before the storage remove()';
})());

check('P2 - signed-URL lifetime is clamped to a maximum the caller cannot exceed', (() => {
  if (!/MAX_SIGNED_URL_SECONDS\s*=\s*\d+/.test(serviceCode)) return 'no MAX_SIGNED_URL_SECONDS constant';
  const m = serviceCode.match(/async\s+createArtifactSignedUrl[\s\S]*?\n  \},/);
  if (!m) return 'createArtifactSignedUrl body not found';
  const body = m[0];
  // The clamp itself, and proof the CLAMPED value is what reaches Supabase —
  // a body that computes a ceiling and then signs with the raw request would
  // otherwise pass.
  const clamps = /Math\.min\(/.test(body) && /MAX_SIGNED_URL_SECONDS/.test(body);
  const signsClamped = /createSignedUrl\(\s*storagePath\s*,\s*ttlSeconds\s*\)/.test(body);
  return clamps && signsClamped
    ? true : `clamp=${clamps} signsClampedValue=${signsClamped}`;
})());

check('P2 - a combined capture helper rolls back the uploaded object when the artifact row insert fails', (() => {
  const m = serviceCode.match(/async\s+captureArtifact[\s\S]*?\n  \},/);
  if (!m) return 'captureArtifact not found - upload and row insert are still separate with no rollback';
  const body = m[0];
  const hasCatch = /catch\s*\(/.test(body);
  const removesOnFailure = /\.remove\(\[\s*storagePath\s*\]\)/.test(body);
  const rethrows = /throw\s+insertError/.test(body);
  return hasCatch && removesOnFailure && rethrows
    ? true : `catch=${hasCatch} remove=${removesOnFailure} rethrow=${rethrows}`;
})());

// ====================================================================
// 12. Capture UI boundary (relay TURN 0027 authorised scope)
// ====================================================================
// TURN 0027 authorised exactly four capabilities: create a capture, add
// ordered artifacts, move lifecycle status, and retrieve securely. The
// absences below are the boundary, so they are asserted rather than trusted.

const UI_PATH = 'src/modules/cases/components/CaseCaptureView.tsx';
const APP_PATH = 'src/App.tsx';

check(`${UI_PATH} exists`, fs.existsSync(path.join(REPO_ROOT, UI_PATH)));

const uiCode = read(UI_PATH)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((line) => {
    const i = line.indexOf('//');
    if (i === -1) return line;
    const before = line.slice(0, i);
    if (/['"`\\]/.test(before)) return line;
    return before;
  })
  .join('\n');

check('the capture UI never calls getPublicUrl', (() => {
  return !/getPublicUrl/.test(uiCode) ? true : 'getPublicUrl is referenced';
})());

check('the capture UI retrieves artifacts through a signed URL', (() => {
  return /createArtifactSignedUrl\(/.test(uiCode);
})());

check('the capture UI imports no AI/copilot module', (() => {
  const imports = uiCode.match(/^import[\s\S]*?from\s+'[^']+';/gm) || [];
  const bad = imports.filter((i) => /copilot|openai|gemini|casebook/i.test(i));
  return bad.length === 0 ? true : `offending import(s): ${bad.join(' | ')}`;
})());

check('the capture UI exposes no delete — outside the authorised scope', (() => {
  return !/deleteArtifact/.test(uiCode) ? true : 'deleteArtifact is reachable from the UI';
})());

check('the capture UI performs no portfolio assignment — capture must not need a Fellowship slot', (() => {
  return !/assignPortfolioRef|clearPortfolioRef/.test(uiCode)
    ? true : 'the UI mutates portfolio_ref';
})());

check('the capture UI refuses to operate without a doctor identity', (() => {
  return /if\s*\(!doctor\)/.test(uiCode);
})());

check('the /doctor/cases route is doctor-gated with no anon fallthrough', (() => {
  const app = read(APP_PATH);
  // A fixed window, not a lazy match up to the first `/>`: the element's own
  // self-closing tag comes before the fallback branch, so a lazy match would
  // stop early and miss the Navigate — and would then "fail" a correct route.
  const at = app.indexOf('path="/doctor/cases"');
  if (at === -1) return 'the /doctor/cases route was not found';
  const block = app.slice(at, at + 600);
  return /currentDoctor\s*\?/.test(block) && /Navigate to="\/login"/.test(block)
    ? true : 'the route does not gate on currentDoctor with a login fallback';
})());

check('the capture UI is reachable from the doctor home screen', (() => {
  // A built feature with no entry point is not utility. The route existed for
  // a commit before anything linked to it, so this guards the entry point
  // rather than the route.
  const home = read('src/modules/doctors/components/DoctorHomeView.tsx');
  return /navigate\('\/doctor\/cases'\)/.test(home)
    ? true : 'DoctorHomeView has no navigation entry for /doctor/cases';
})());

check('adding that entry did not displace the existing doctor tools', (() => {
  const home = read('src/modules/doctors/components/DoctorHomeView.tsx');
  const expected = ['/doctor/research', '/doctor/casebook-logbook', '/doctor/my-record'];
  const missing = expected.filter((r) => !home.includes(`navigate('${r}')`));
  return missing.length === 0 ? true : `missing entry for: ${missing.join(', ')}`;
})());

check('wiring the capture route did not drop the other /doctor routes', (() => {
  const app = read(APP_PATH);
  const expected = ['/doctor/research', '/doctor/casebook-logbook', '/doctor/my-record', '/doctor/home'];
  const missing = expected.filter((r) => !app.includes(`path="${r}"`));
  return missing.length === 0 ? true : `missing: ${missing.join(', ')}`;
})());

// ====================================================================

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED.`);
  process.exit(1);
} else {
  console.log('\nAll Cases capture-slice privacy/storage invariant checks passed.');
  process.exit(0);
}
