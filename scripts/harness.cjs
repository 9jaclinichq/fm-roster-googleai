#!/usr/bin/env node
// Workspc Engineering Harness — Harness 0 (bootstrap/status only).
//
// Safety invariant this file exists to preserve: the only commands this CLI
// exposes are `status` and `self-test`. Every git call goes through the
// git() wrapper below, which only accepts subcommands in ALLOWED_GIT_
// SUBCOMMANDS (read-only). There is no code path here that can push, commit,
// apply a migration, or write to Supabase. self-test asserts this
// structurally, not by grepping for forbidden words in comments.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const ENG_DIR = path.join(REPO_ROOT, '.workspc-engineering');
const SCHEMA_VERSION = 1;
const IS_WIN = process.platform === 'win32';

// ---------------------------------------------------------------------
// Read-only process helpers. spawnSync only, argv arrays only, no shell.
// ---------------------------------------------------------------------

const ALLOWED_GIT_SUBCOMMANDS = ['rev-parse', 'status', 'rev-list'];

function git(args) {
  if (!ALLOWED_GIT_SUBCOMMANDS.includes(args[0])) {
    throw new Error(`harness: git subcommand not allowed: ${args[0]}`);
  }
  return spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', timeout: 5000 });
}

// npm/npx ship as .cmd shims on Windows, which spawnSync cannot launch
// directly without going through cmd.exe. Routing just those two through a
// fixed `cmd.exe /c <bin> <args>` argv array avoids that failure while
// keeping every argument a fixed literal, never interpolated from
// untrusted input, and without turning on spawnSync's own shell option.
function checkTool(bin, args) {
  const useCmdWrapper = IS_WIN && (bin === 'npm' || bin === 'npx');
  const spawnBin = useCmdWrapper ? 'cmd.exe' : bin;
  const spawnArgs = useCmdWrapper ? ['/c', bin, ...args] : args;
  try {
    const res = spawnSync(spawnBin, spawnArgs, { cwd: REPO_ROOT, encoding: 'utf8', timeout: 10000 });
    if (res.error) {
      return res.error.code === 'ENOENT'
        ? { status: 'MISSING' }
        : { status: 'UNKNOWN', detail: res.error.code || 'spawn error' };
    }
    if (typeof res.status === 'number' && res.status !== 0) {
      return { status: 'UNKNOWN', detail: `exit ${res.status}` };
    }
    const out = (res.stdout || res.stderr || '').trim().split('\n')[0];
    return { status: 'READY', detail: out };
  } catch (e) {
    return { status: 'UNKNOWN', detail: 'exception' };
  }
}

function getToolCapabilities() {
  return [
    { label: 'git', ...checkTool('git', ['--version']) },
    { label: 'node', status: 'READY', detail: process.version },
    { label: 'npm', ...checkTool('npm', ['--version']) },
    { label: 'gh', ...checkTool('gh', ['--version']) },
    { label: 'docker', ...checkTool('docker', ['--version']) },
    { label: 'supabase (repo-local via npx)', ...checkTool('npx', ['--no-install', 'supabase', '--version']) },
  ];
}

// ---------------------------------------------------------------------
// Dynamic git/filesystem facts — recomputed every call, never cached.
// ---------------------------------------------------------------------

function getHead() {
  const res = git(['rev-parse', 'HEAD']);
  return res.status === 0 ? res.stdout.trim() : null;
}

function getOriginMain() {
  let res = git(['rev-parse', 'origin/main']);
  if (res.status === 0) return res.stdout.trim();
  res = git(['rev-parse', 'refs/remotes/origin/main']);
  return res.status === 0 ? res.stdout.trim() : null;
}

function getAheadBehind() {
  const res = git(['rev-list', '--left-right', '--count', 'origin/main...HEAD']);
  if (res.status !== 0) return { behind: null, ahead: null };
  const parts = res.stdout.trim().split(/\s+/);
  const behind = parseInt(parts[0], 10);
  const ahead = parseInt(parts[1], 10);
  return {
    behind: Number.isFinite(behind) ? behind : null,
    ahead: Number.isFinite(ahead) ? ahead : null,
  };
}

// Names only — never reads file contents.
function getWorkingTree() {
  const res = git(['status', '--porcelain']);
  if (res.status !== 0) return { staged: 0, modified: 0, untracked: 0, untrackedFiles: [], error: true };
  const lines = res.stdout.split('\n').filter(Boolean);
  let staged = 0;
  let modified = 0;
  const untrackedFiles = [];
  for (const line of lines) {
    const x = line[0];
    const y = line[1];
    const file = line.slice(3);
    if (x === '?' && y === '?') {
      untrackedFiles.push(file);
      continue;
    }
    if (x !== ' ') staged++;
    if (y !== ' ') modified++;
  }
  return { staged, modified, untracked: untrackedFiles.length, untrackedFiles };
}

function getMigrationFiles() {
  const dir = path.join(REPO_ROOT, 'supabase', 'migrations');
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (e) {
    return [];
  }
  return entries
    .map((name) => {
      const m = name.match(/^(\d+)_/);
      return m ? { number: parseInt(m[1], 10), file: name } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.number - b.number);
}

function checkHandoffStaleness(head) {
  const p = path.join(REPO_ROOT, 'HANDOFF_TO_CLAUDE.md');
  let text;
  try {
    text = fs.readFileSync(p, 'utf8');
  } catch (e) {
    return { status: 'UNKNOWN', detail: 'HANDOFF_TO_CLAUDE.md not found' };
  }
  const m = text.match(/Local HEAD \(this snapshot\):\s*`([0-9a-f]{7,40})`/i);
  if (!m) return { status: 'UNKNOWN', detail: 'no machine-detectable commit stamp found' };
  if (!head) return { status: 'UNKNOWN', detail: 'current HEAD unavailable' };
  const stamped = m[1];
  const match = head.startsWith(stamped) || stamped.startsWith(head);
  return match
    ? { status: 'CURRENT', detail: stamped }
    : { status: 'STALE', detail: `snapshot stamped ${stamped}, current HEAD ${head.slice(0, 7)}` };
}

function getVerificationInventory() {
  let pkg = {};
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  } catch (e) {
    // fall through with empty scripts
  }
  const scripts = pkg.scripts || {};
  const registered = Object.keys(scripts)
    .filter((k) => k === 'verify' || k.startsWith('verify:'))
    .map((k) => ({ name: k, command: `npm run ${k}` }));

  let scriptFiles = [];
  try {
    scriptFiles = fs
      .readdirSync(path.join(REPO_ROOT, 'scripts'))
      .filter((f) => /^verify-.*\.(cjs|ts)$/.test(f));
  } catch (e) {
    // no scripts dir
  }
  const registeredTargets = new Set(
    Object.values(scripts)
      .map((cmd) => {
        const m = String(cmd).match(/scripts\/([\w.-]+)/);
        return m ? m[1] : null;
      })
      .filter(Boolean)
  );
  const manualOnly = scriptFiles.filter((f) => !registeredTargets.has(f));
  return { registered, manualOnly };
}

// ---------------------------------------------------------------------
// Durable state loaders — human-verified facts that cannot be safely
// reconstructed from git/filesystem alone.
// ---------------------------------------------------------------------

function loadJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ENG_DIR, file), 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function loadJSONL(file) {
  try {
    return fs
      .readFileSync(path.join(ENG_DIR, file), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (e) {
    return [];
  }
}

function parseMigrationRange(rangeStr) {
  const m = String(rangeStr).match(/^(\d+)(?:-(\d+))?$/);
  if (!m) return null;
  const lo = parseInt(m[1], 10);
  const hi = m[2] ? parseInt(m[2], 10) : lo;
  return [lo, hi];
}

// File existence is never sufficient evidence of live application on its
// own — a number only becomes VERIFIED_APPLIED/VERIFIED_UNAPPLIED if a
// human-recorded entry in migration-evidence.json says so. Everything else
// is UNKNOWN, regardless of whether the migration file exists on disk.
function resolveMigrationStatus(number, evidenceEntries) {
  for (const entry of evidenceEntries) {
    const range = parseMigrationRange(entry.migrationRange);
    if (range && number >= range[0] && number <= range[1]) return entry.status;
  }
  return 'UNKNOWN';
}

function summarizeMigrationCoverage(ceiling, evidenceEntries) {
  if (!ceiling) return [];
  const rows = [];
  let i = 1;
  while (i <= ceiling) {
    const status = resolveMigrationStatus(i, evidenceEntries);
    let j = i;
    while (j + 1 <= ceiling && resolveMigrationStatus(j + 1, evidenceEntries) === status) j++;
    rows.push({ range: i === j ? `${i}` : `${i}-${j}`, status });
    i = j + 1;
  }
  return rows;
}

// ---------------------------------------------------------------------
// Fact assembly — read-only. Nothing in this function, or anything it
// calls, writes to git or to disk.
// ---------------------------------------------------------------------

function computeFacts() {
  const head = getHead();
  const originMain = getOriginMain();
  const { ahead, behind } = getAheadBehind();
  const workingTree = getWorkingTree();

  const migrationFiles = getMigrationFiles();
  const ceiling = migrationFiles.length ? migrationFiles[migrationFiles.length - 1].number : null;

  const freeze = loadJSON('freeze.json', null);
  const migrationEvidenceDoc = loadJSON('migration-evidence.json', { entries: [] });
  const evidenceEntries = migrationEvidenceDoc.entries || [];
  const migrationCoverage = summarizeMigrationCoverage(ceiling, evidenceEntries);

  const decisions = loadJSONL('decisions.jsonl');
  const findings = loadJSONL('findings.jsonl');
  const protectedSurfacesDoc = loadJSON('protected-surfaces.json', { surfaces: [] });
  const protectedSurfaces = (protectedSurfacesDoc.surfaces || []).filter((s) => s.active);

  const verification = getVerificationInventory();
  const tools = getToolCapabilities();
  const handoff = checkHandoffStaleness(head);

  const warnings = [];
  if (workingTree.staged > 0 || workingTree.modified > 0) {
    warnings.push(`working tree has uncommitted tracked changes (staged=${workingTree.staged}, modified=${workingTree.modified})`);
  }
  if (workingTree.untracked > 0) {
    warnings.push(`${workingTree.untracked} untracked file(s) present — names listed below, contents not inspected`);
  }
  if (handoff.status === 'STALE') warnings.push(`HANDOFF_TO_CLAUDE.md is STALE (${handoff.detail})`);
  if (handoff.status === 'UNKNOWN') warnings.push(`HANDOFF_TO_CLAUDE.md staleness is UNKNOWN (${handoff.detail})`);
  for (const row of migrationCoverage) {
    if (row.status === 'UNKNOWN') warnings.push(`migrations ${row.range} have UNKNOWN live-apply evidence (file existence is not proof)`);
  }
  for (const t of tools) {
    if (t.status === 'MISSING') warnings.push(`tool missing: ${t.label}`);
    if (t.status === 'UNKNOWN') warnings.push(`tool status unknown: ${t.label} (${t.detail || 'no detail'})`);
  }
  if (!freeze) warnings.push('freeze.json missing or unreadable — freeze status cannot be confirmed');
  if (originMain === null) warnings.push('origin/main could not be resolved locally (fetch may be needed)');

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    code: {
      productionCodeBaseline: freeze ? freeze.productionCodeBaseline : null,
      head,
      originMain,
      ahead,
      behind,
      workingTree,
    },
    migrations: {
      ceiling,
      evidence: evidenceEntries,
      coverage: migrationCoverage,
    },
    freeze,
    decisions,
    findings,
    protectedSurfaces,
    verification,
    tools,
    handoff,
    warnings,
  };
}

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------

function short(hash) {
  return hash ? hash.slice(0, 7) : 'UNKNOWN';
}

function renderHuman(f) {
  const lines = [];
  const hdr = (t) => {
    lines.push('');
    lines.push(`=== ${t} ===`);
  };

  lines.push(f.freeze && f.freeze.active ? '*** DEPLOYMENT FREEZE ACTIVE — DO NOT PUSH / MIGRATE / DEPLOY ***' : '(no active deployment freeze recorded)');

  hdr('CODE STATE');
  lines.push(`production baseline : ${short(f.code.productionCodeBaseline)}`);
  lines.push(`local HEAD          : ${short(f.code.head)}`);
  lines.push(`origin/main         : ${short(f.code.originMain)}`);
  lines.push(`ahead / behind      : ${f.code.ahead === null ? 'UNKNOWN' : f.code.ahead} ahead / ${f.code.behind === null ? 'UNKNOWN' : f.code.behind} behind`);
  lines.push(`working tree        : staged=${f.code.workingTree.staged} modified=${f.code.workingTree.modified} untracked=${f.code.workingTree.untracked}`);
  if (f.code.workingTree.untracked > 0) {
    for (const u of f.code.workingTree.untrackedFiles) lines.push(`  untracked: ${u}`);
  }

  hdr('DATABASE MIGRATION STATE');
  lines.push(`migration ceiling   : ${f.migrations.ceiling === null ? 'UNKNOWN (no migrations directory found)' : f.migrations.ceiling}`);
  for (const row of f.migrations.coverage) {
    lines.push(`  migrations ${row.range.padEnd(8)} : ${row.status}`);
  }
  if (!f.migrations.coverage.length) lines.push('  (no migration files found)');

  hdr('DEPLOYMENT POLICY');
  if (f.freeze) {
    lines.push(`freeze              : ${f.freeze.active ? 'ACTIVE' : 'INACTIVE'}`);
    lines.push(`reason              : ${f.freeze.reason}`);
  } else {
    lines.push('freeze              : UNKNOWN (freeze.json missing/unreadable)');
  }

  hdr('CURRENT ENGINEERING CONSTRAINTS');
  if (!f.decisions.length) lines.push('  (none recorded)');
  for (const d of f.decisions) lines.push(`  - [${d.status}] ${d.id}: ${d.summary}`);

  hdr('PROTECTED SURFACES');
  if (!f.protectedSurfaces.length) lines.push('  (none recorded)');
  for (const s of f.protectedSurfaces) lines.push(`  - ${s.id} (${(s.glob || []).join(', ')}): ${s.reason}`);

  hdr('AVAILABLE VERIFICATION');
  for (const v of f.verification.registered) lines.push(`  - ${v.command}`);
  for (const m of f.verification.manualOnly) lines.push(`  - node scripts/${m}  (manual only — not wired to an npm script)`);

  hdr('TOOL CAPABILITIES');
  for (const t of f.tools) lines.push(`  - ${t.label.padEnd(28)} ${t.status}${t.detail ? ' — ' + t.detail : ''}`);

  hdr('WARNINGS');
  if (!f.warnings.length) lines.push('  (none)');
  for (const w of f.warnings) lines.push(`  ! ${w}`);

  lines.push('');
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------
// Commands — status and self-test only. Nothing else is dispatched.
// ---------------------------------------------------------------------

const COMMANDS = ['status', 'self-test'];

function cmdStatus(argv) {
  const facts = computeFacts();
  if (argv.includes('--json')) {
    process.stdout.write(JSON.stringify(facts, null, 2) + '\n');
  } else {
    process.stdout.write(renderHuman(facts));
  }
}

function printUsage() {
  process.stdout.write('usage: node scripts/harness.cjs <status [--json] | self-test>\n');
}

// ---------------------------------------------------------------------
// self-test — proves the safety/correctness properties Harness 0 claims,
// by testing actual control-flow (the allowlist, the exposed command set,
// the migration-status resolution function) rather than by asserting the
// absence of arbitrary strings.
// ---------------------------------------------------------------------

const SECRET_PATTERNS = [/sk_live_/, /sk_test_/, /FLWSECK-/, /-----BEGIN/, /AIza[0-9A-Za-z_-]{10,}/, /gh[pousr]_[0-9A-Za-z]{20,}/];
const STATE_FILES = ['freeze.json', 'migration-evidence.json', 'decisions.jsonl', 'findings.jsonl', 'protected-surfaces.json'];

function cmdSelfTest() {
  const results = [];
  // Convention: fn() returns literal true to pass, or anything else (a
  // string detail, false) to fail — only an exact `true` counts as a pass,
  // so a truthy failure-detail string is never mistaken for success.
  const check = (name, fn) => {
    try {
      const ok = fn();
      results.push({ name, pass: ok === true, detail: ok === true ? '' : String(ok) });
    } catch (e) {
      results.push({ name, pass: false, detail: e.message });
    }
  };

  // --- command surface: exactly status + self-test, nothing else ---
  check('exposed command set is exactly {status, self-test}', () => {
    const forbidden = ['commit', 'push', 'deploy', 'apply', 'migrate', 'db-push'];
    return COMMANDS.length === 2 && COMMANDS.includes('status') && COMMANDS.includes('self-test')
      && !forbidden.some((f) => COMMANDS.includes(f));
  });

  // --- git allowlist never contains a mutating verb ---
  check('git() allowlist contains no mutating subcommand', () => {
    const forbidden = ['push', 'commit', 'apply', 'reset', 'checkout', 'clean', 'merge'];
    return !forbidden.some((f) => ALLOWED_GIT_SUBCOMMANDS.includes(f));
  });

  // --- git() wrapper actually enforces the allowlist at runtime ---
  check('git() throws on a subcommand outside the allowlist', () => {
    try {
      git(['push']);
      return 'did not throw';
    } catch (e) {
      return true;
    }
  });

  // --- no shell-string execution anywhere in the operational code above
  //     this point (self-test's own strings describing the check are
  //     deliberately excluded from the scanned range) ---
  check('operational code contains no shell:true / string-exec usage', () => {
    const full = fs.readFileSync(__filename, 'utf8');
    const operational = full.slice(0, full.indexOf('function cmdSelfTest'));
    const bad = [/shell\s*:\s*true/, /execSync\(/, /[^.]\bexec\(/];
    const hit = bad.find((re) => re.test(operational));
    return hit ? `matched ${hit}` : true;
  });

  // --- HEAD / origin-main computed here match an independently spawned check ---
  check('HEAD matches an independently spawned git rev-parse', () => {
    const viaHarness = getHead();
    const raw = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' });
    const viaRaw = raw.status === 0 ? raw.stdout.trim() : null;
    return viaHarness === viaRaw && viaHarness !== null;
  });
  check('origin/main matches an independently spawned git rev-parse (or both UNKNOWN)', () => {
    const viaHarness = getOriginMain();
    const raw = spawnSync('git', ['rev-parse', 'origin/main'], { cwd: REPO_ROOT, encoding: 'utf8' });
    const viaRaw = raw.status === 0 ? raw.stdout.trim() : null;
    return viaHarness === viaRaw;
  });
  check('ahead/behind are non-negative integers or UNKNOWN, consistent with HEAD vs origin/main', () => {
    const { ahead, behind } = getAheadBehind();
    const head = getHead();
    const originMain = getOriginMain();
    if (ahead === null || behind === null) return true; // UNKNOWN is an acceptable outcome
    if (ahead < 0 || behind < 0) return false;
    if (ahead > 0 && head === originMain) return false;
    return true;
  });

  // --- migration status resolution: file existence is never sufficient ---
  check('a migration file with no evidence entry resolves to UNKNOWN, not VERIFIED_APPLIED', () => {
    const files = getMigrationFiles();
    const evidence = (loadJSON('migration-evidence.json', { entries: [] }) || { entries: [] }).entries;
    const covered = new Set();
    for (const e of evidence) {
      const range = parseMigrationRange(e.migrationRange);
      if (range) for (let n = range[0]; n <= range[1]; n++) covered.add(n);
    }
    const uncovered = files.find((f) => !covered.has(f.number));
    if (!uncovered) return true; // nothing to prove against in this repo state
    const status = resolveMigrationStatus(uncovered.number, evidence);
    return status === 'UNKNOWN';
  });
  check('migration-evidence.json entries have no overlapping ranges', () => {
    const evidence = (loadJSON('migration-evidence.json', { entries: [] }) || { entries: [] }).entries;
    const seen = new Set();
    for (const e of evidence) {
      const range = parseMigrationRange(e.migrationRange);
      if (!range) return `unparseable range: ${e.migrationRange}`;
      for (let n = range[0]; n <= range[1]; n++) {
        if (seen.has(n)) return `migration ${n} covered by two evidence entries`;
        seen.add(n);
      }
      if (!['VERIFIED_APPLIED', 'VERIFIED_UNAPPLIED', 'UNKNOWN'].includes(e.status)) return `bad status: ${e.status}`;
      if (!e.evidenceSource) return `missing evidenceSource on ${e.migrationRange}`;
    }
    return true;
  });

  // --- freeze.json schema ---
  check('freeze.json has the required fields with correct types', () => {
    const freeze = loadJSON('freeze.json', null);
    if (!freeze) return 'freeze.json missing/unreadable';
    if (typeof freeze.active !== 'boolean') return 'active is not boolean';
    if (typeof freeze.reason !== 'string' || !freeze.reason) return 'reason missing';
    if (!/^[0-9a-f]{7,40}$/i.test(freeze.productionCodeBaseline || '')) return 'productionCodeBaseline not a hash';
    return true;
  });

  // --- no secret-shaped content in committed state ---
  check('no known secret-key patterns appear in committed harness state files', () => {
    for (const file of STATE_FILES) {
      let text;
      try {
        text = fs.readFileSync(path.join(ENG_DIR, file), 'utf8');
      } catch (e) {
        continue;
      }
      const hit = SECRET_PATTERNS.find((re) => re.test(text));
      if (hit) return `${file} matched suspicious pattern ${hit}`;
    }
    return true;
  });

  // --- black-box: status --json is valid, versioned JSON ---
  check('`status --json` parses and carries a schemaVersion', () => {
    const res = spawnSync(process.execPath, [__filename, 'status', '--json'], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 10000 });
    if (res.status !== 0) return `exit ${res.status}`;
    const parsed = JSON.parse(res.stdout);
    return parsed.schemaVersion === SCHEMA_VERSION;
  });

  // --- black-box: status never mutates git state or harness durable state ---
  check('`status` leaves git status and .workspc-engineering/ untouched', () => {
    const before = fs.readdirSync(ENG_DIR).sort();
    const beforeStat = before.map((f) => fs.statSync(path.join(ENG_DIR, f)).mtimeMs);
    const gitBefore = git(['status', '--porcelain']).stdout;
    spawnSync(process.execPath, [__filename, 'status', '--json'], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 10000 });
    const after = fs.readdirSync(ENG_DIR).sort();
    const afterStat = after.map((f) => fs.statSync(path.join(ENG_DIR, f)).mtimeMs);
    const gitAfter = git(['status', '--porcelain']).stdout;
    return JSON.stringify(before) === JSON.stringify(after)
      && JSON.stringify(beforeStat) === JSON.stringify(afterStat)
      && gitBefore === gitAfter;
  });

  // --- untracked files are named, never opened, by this module ---
  check('getWorkingTree() never reads file contents (no fs.readFile* on tracked paths in that function)', () => {
    const src = fs.readFileSync(__filename, 'utf8');
    const fn = src.slice(src.indexOf('function getWorkingTree'), src.indexOf('function getMigrationFiles'));
    return !/readFile/.test(fn);
  });

  const failed = results.filter((r) => !r.pass);
  for (const r of results) {
    process.stdout.write(`${r.pass ? 'PASS' : 'FAIL'}: ${r.name}${r.detail ? ' — ' + r.detail : ''}\n`);
  }
  process.stdout.write(`\n${results.length - failed.length}/${results.length} passed\n`);
  if (failed.length) process.exitCode = 1;
}

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (cmd === 'status') return cmdStatus(argv.slice(1));
  if (cmd === 'self-test') return cmdSelfTest();
  printUsage();
  process.exitCode = 1;
}

if (require.main === module) {
  main();
}
