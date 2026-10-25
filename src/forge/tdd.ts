import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { LOCKFILES } from './validate-cache.js';
import { isBookkeeping } from './triage.js';
import {
  failingTests, isPytestModule, isTestFile, NO_TESTS, resolveAffected, runsPytest,
  type RepoReader, type Validator, type ValidatorResult,
} from './validators.js';

export const TDD_ROW = 'tdd';
export const TDD_MAX_FILES = 30;
export const TDD_TIMEOUT_MAX = 300;
/** Why a check ran nothing; `timeout`: it ran and judged nothing. */
export type TddSkip = 'no-tests' | 'no-command' | 'same-package' | 'too-many' | 'unsafe-path' | 'lockfile' | 'linked-code' | 'no-checkout' | 'timeout';
const SKIPS: readonly string[] = ['no-tests', 'no-command', 'same-package', 'too-many', 'unsafe-path', 'lockfile', 'linked-code', 'no-checkout', 'timeout'];
/** What a check would run, and the key of its result, without running anything. */
export interface TddPlan {
  key: string; base: string; validator: string | null; kind: string | null; cmd: string | null;
  /** The changed test files (helpers, fixtures, conftest.py included) written over BASE, as HEAD has them. */
  overlay: string[];
  /** The test modules the command runs. */
  files: string[];
  skipped: TddSkip | null; note: string | null;
}
/** tdd-<n>.json: a check's result. red, passedOnBase and alreadyFailing are `<file> > <test>`; unjudged are files. */
export interface TddCheck {
  v: 1; key: string; base: string; validator: string | null; cmd: string | null; files: string[];
  red: string[]; passedOnBase: string[]; alreadyFailing: string[]; unjudged: string[];
  skipped: TddSkip | null; note: string | null; durationMs: number;
}
export type TddRow = ValidatorResult & { tdd: TddCheck & { bug?: { rootCause: string | null } } };
export interface BaseRun { code: number; output: string; timedOut: boolean }
export interface PlanAt { git: (args: string[]) => string | null; repo: RepoReader; platform: NodeJS.Platform; repoDir: string }

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const slash = (s: string) => s.replace(/\\/g, '/');

const JS_TITLE = /^\s*(?:it|test)(?:\.(?:only|concurrent|sequential|fails))?\s*\(\s*(['"`])((?:\\.|(?!\1).)+)\1/;
const PY_TEST = /^\s*(?:async\s+)?def\s+(test\w*)\s*\(/;

/**
 * The tests a diff adds, file by file: the titles of the it/test calls and the def test_* of its `+` lines. A comment, a
 * dynamic title (`${`), a `.skip` or `.todo` and a title that only moved (the same trimmed line is removed anywhere in
 * the patch) give none. A file without names is not in the map.
 */
export function newTestNames(patch: string): Map<string, string[]> {
  const lines = patch.split(/\r?\n/);
  const removed = new Map<string, number>();
  lines.forEach((l, i) => {
    if (!l.startsWith('-')) return;
    if (l.startsWith('---') && lines[i + 1]?.startsWith('+++')) return;
    const t = l.slice(1).trim();
    if (t) removed.set(t, (removed.get(t) ?? 0) + 1);
  });
  const out = new Map<string, string[]>();
  let file: string | null = null;
  for (const l of lines) {
    if (l.startsWith('+++')) {
      const m = /^\+\+\+ b\/(.+?)(?:\t.*)?$/.exec(l);
      file = m ? m[1] : null;
      continue;
    }
    if (!l.startsWith('+') || file === null) continue;
    const text = l.slice(1);
    const trimmed = text.trim();
    if (/^(?:\/\/|#|\*)/.test(trimmed)) continue;
    const name = JS_TITLE.exec(text)?.[2] ?? PY_TEST.exec(text)?.[1];
    if (!name || name.includes('${')) continue;
    const left = removed.get(trimmed) ?? 0;
    if (left > 0) { removed.set(trimmed, left - 1); continue; }
    const list = out.get(file) ?? [];
    if (!list.includes(name)) list.push(name);
    out.set(file, list);
  }
  return out;
}

const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;]*[A-Za-z]`, 'g');
const SEP = String.raw`(?: > | › |::)`;
const SEP_AT = new RegExp(`^${SEP}`);

/** A failing entry as classifyTdd reads it: `/` for `\`, and without a vitest workspace's `|project| ` label. */
function cleanEntry(entry: string, files: string[]): string {
  const e = slash(entry);
  const label = /^\|[^|]*\|\s+/.exec(e);
  if (label) return e.slice(label[0].length);
  const word = /^(\S+)\s+(.+)$/.exec(e);
  if (word && !files.some(f => word[1].startsWith(f)) && files.some(f => word[2].startsWith(f))) return word[2];
  return e;
}

/**
 * Splits the new tests of `files` by what running them on BASE showed: red (they fail there by name, or their file does
 * not load), passed on BASE (proving nothing), already failing (in `baseFailing`) and unjudged (the run cannot tell).
 */
export function classifyTdd(files: string[], names: ReadonlyMap<string, string[]>, run: BaseRun, kind: string, baseFailing: ReadonlySet<string>): Pick<TddCheck, 'red' | 'passedOnBase' | 'alreadyFailing' | 'unjudged'> {
  const out = { red: [] as string[], passedOnBase: [] as string[], alreadyFailing: [] as string[], unjudged: [] as string[] };
  if (run.timedOut || NO_TESTS.test(run.output)) { out.unjudged.push(...files); return out; }
  const { names: raw, known } = failingTests(run.output, kind);
  const entries = raw.map(r => ({ raw: r, text: cleanEntry(r, files) }));
  const text = slash(run.output.replace(ANSI, ''));
  // The module an entry names (the longest of `files` it starts with, followed by a separator), or null.
  const owner = (e: string): string | null => {
    let best: string | null = null;
    for (const f of files) if (e.startsWith(f) && SEP_AT.test(e.slice(f.length)) && (best === null || f.length > best.length)) best = f;
    return best;
  };
  for (const f of files) {
    const list = names.get(f);
    if (!list?.length) { out.unjudged.push(f); continue; }
    const loads = !(
      entries.some(e => e.text.startsWith(`${f} [ `) && e.text.trimEnd().endsWith(']'))
      || (!known && entries.some(e => e.text === f))
      || (!known && run.code !== 0 && text.includes(f) && !entries.some(e => e.text.startsWith(f) && SEP_AT.test(e.text.slice(f.length))))
    );
    let unread = false;
    for (const x of list) {
      const re = new RegExp(`(?:^|${SEP})${esc(x)}(?:\\[[^\\]]*\\])?$`);
      const hit = entries.find(e => {
        const o = owner(e.text);
        if (o !== null && o !== f) return false;
        return re.test(o === null ? e.text : e.text.slice(o.length));
      });
      const label = `${f} > ${x}`;
      if (hit && (baseFailing.has(hit.raw) || baseFailing.has(hit.text) || baseFailing.has(label))) out.alreadyFailing.push(label);
      else if (hit || !loads) out.red.push(label);
      else if (known || run.code === 0) out.passedOnBase.push(label);
      else if (!unread) { unread = true; out.unjudged.push(f); }
    }
  }
  return out;
}

const CONFTEST = /(^|\/)conftest\.py$/;
const TEST_MODULE = /\.(test|spec)\.[^/]+$/;
const LINKED_DEP = /^(?:file|link|workspace):/;
const SITE_DIRS = (repo: RepoReader): string[] => {
  const dirs: string[] = [];
  for (const venv of ['.venv', 'venv']) {
    dirs.push(`${venv}/Lib/site-packages`);
    for (const n of repo.list(`${venv}/lib`)) if (/^python/i.test(n)) dirs.push(`${venv}/lib/${n}/site-packages`);
  }
  return dirs;
};

/** Whether the task's folder links code of its own into what the tests import: workspaces, file: deps, an editable install. */
function linkedCode(at: PlanAt): boolean {
  const { repo } = at;
  const pkg = repo.read('package.json');
  if (pkg !== null) {
    try {
      const p = JSON.parse(pkg) as Record<string, unknown>;
      if (p.workspaces) return true;
      for (const k of ['dependencies', 'devDependencies', 'optionalDependencies']) {
        const deps = p[k];
        if (deps && typeof deps === 'object' && Object.values(deps as Record<string, unknown>).some(v => typeof v === 'string' && LINKED_DEP.test(v))) return true;
      }
    } catch { /* not JSON: the runner will say so */ }
  }
  if (repo.exists('pnpm-workspace.yaml')) return true;
  const norm = (s: string) => { const n = s.replace(/\\+/g, '/'); return at.platform === 'win32' ? n.toLowerCase() : n; };
  const dir = norm(at.repoDir);
  const names = (text: string | null) => {
    if (text === null) return false;
    let decoded = text;
    try { decoded = decodeURIComponent(text); } catch { /* keep the text as it is */ }
    return norm(text).includes(dir) || norm(decoded).includes(dir);
  };
  for (const site of SITE_DIRS(repo)) {
    for (const entry of repo.list(site)) {
      if (entry.startsWith('__editable__') || entry.endsWith('.egg-link')) return true;
      if (entry.endsWith('.pth') && names(repo.read(`${site}/${entry}`))) return true;
      if (entry.endsWith('.dist-info') && names(repo.read(`${site}/${entry}/direct_url.json`))) return true;
    }
  }
  return false;
}

/**
 * What a check would run for the files `touched` (HEAD against `base`), without running anything: the test validator and
 * its command over the changed test modules, the files written over BASE, or the reason it runs nothing. The key covers
 * BASE, the command, the content of the overlay and the lockfiles, so a result is reused only for the same question.
 */
export function tddPlan(validators: Validator[], touched: string[], base: string, at: PlanAt): TddPlan {
  const live = [...new Set(touched.map(f => slash(f).replace(/^\.\//, '')))].filter(f => f && !isBookkeeping(f));
  const overlay = live.filter(f => at.repo.exists(f) && (isTestFile(f) || CONFTEST.test(f)));
  const modules = overlay.filter(f => TEST_MODULE.test(f) || isPytestModule(f));
  const lockBase = at.git(['ls-tree', base, '--', ...LOCKFILES]) ?? '';
  const lockHead = at.git(['ls-tree', 'HEAD', '--', ...LOCKFILES]) ?? '';
  const overlayBlobs = overlay.length ? at.git(['ls-tree', 'HEAD', '--', ...overlay]) ?? '' : '';
  const plan: TddPlan = { key: '', base, validator: null, kind: null, cmd: null, overlay, files: [], skipped: null, note: null };
  const done = (skipped: TddSkip | null): TddPlan => {
    plan.skipped = skipped;
    plan.key = createHash('sha256').update(JSON.stringify([1, base, plan.validator, plan.cmd, overlayBlobs, lockBase, lockHead, skipped])).digest('hex');
    return plan;
  };

  const fits = validators.flatMap(v => {
    if (v.kind !== 'test' || !v.affectedCmd || !/\{(files|tests)\}/.test(v.affectedCmd)) return [];
    const list = modules.filter(f => (f.endsWith('.py') ? runsPytest(v.affectedCmd as string) : !runsPytest(v.affectedCmd as string)));
    return list.length ? [{ v, list }] : [];
  });
  if (!fits.length) {
    if (live.some(f => f.endsWith('_test.go') || f.endsWith('.rs'))) return done('same-package');
    return done(modules.length ? 'no-command' : 'no-tests');
  }
  const { v, list } = fits[0];
  plan.validator = v.name;
  plan.kind = v.kind;
  plan.files = list;
  if (fits.length > 1) plan.note = `only ${v.name} ran, not ${fits.slice(1).map(o => o.v.name).join(', ')}`;
  if (list.length > TDD_MAX_FILES) return done('too-many');
  const a = resolveAffected(v, list, at.platform, at.repo.exists);
  if (a.mode === 'full') return done('unsafe-path');
  if (a.mode === 'skip') return done('no-tests');
  plan.cmd = runsPytest(v.affectedCmd as string) ? `${a.cmd} --continue-on-collection-errors` : a.cmd;
  if (lockBase !== lockHead) return done('lockfile');
  if (linkedCode(at)) return done('linked-code');
  return done(null);
}

/** The text of a report's `Root cause:` line (backticks, `*`, `-` and `>` around it allowed), cut to 300 characters. */
export function rootCauseOf(report: string | null): string | null {
  if (!report) return null;
  const m = /^([\s>*\-`]*)root cause[*`]*:[*`]*[ \t]*(\S.*)$/im.exec(report);
  if (!m) return null;
  const marks = new Set(m[1]);
  let text = m[2].trimEnd();
  while (text.length && marks.has(text[text.length - 1]) && /[*`]/.test(text[text.length - 1])) text = text.slice(0, -1).trimEnd();
  return text ? text.slice(0, 300) : null;
}

/** The check as a validator row: it never turns the validators red (ok: true), and the file carries the verdict. */
export function tddRow(check: TddCheck, bug: { rootCause: string | null } | null): TddRow {
  const failures = [
    ...check.passedOnBase.map(l => `passes on BASE (proves nothing): ${l}`),
    ...check.alreadyFailing.map(l => `already failing on BASE (not yours): ${l}`),
    ...(check.skipped ? [`not checked: ${check.skipped}`] : []),
    ...check.unjudged.map(f => `not judged: ${f}`),
  ].slice(0, 20);
  return {
    validator: TDD_ROW, ok: true, flaky: false, durationMs: check.durationMs, failing: [], failingKnown: true, failures,
    tdd: { ...check, ...(bug ? { bug } : {}) },
  };
}

export const tddFile = (dir: string, n: string): string => path.join(dir, `tdd-${n}.json`);

const strings = (x: unknown): x is string[] => Array.isArray(x) && x.every(s => typeof s === 'string');
const orNull = (x: unknown) => x === null || typeof x === 'string';

export function readTdd(file: string): TddCheck | null {
  let x: unknown;
  try { x = JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const r = x as Record<string, unknown>;
  if (r.v !== 1 || typeof r.key !== 'string' || typeof r.base !== 'string' || !orNull(r.validator) || !orNull(r.cmd) || !orNull(r.note)
    || !strings(r.files) || !strings(r.red) || !strings(r.passedOnBase) || !strings(r.alreadyFailing) || !strings(r.unjudged)
    || (r.skipped !== null && (typeof r.skipped !== 'string' || !SKIPS.includes(r.skipped))) || typeof r.durationMs !== 'number') return null;
  return r as unknown as TddCheck;
}

/** Writes the check through a temporary file and a rename; any failure is ignored (a missing file only costs a run). */
export function writeTdd(file: string, check: TddCheck): void {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(tmp, JSON.stringify(check) + '\n');
    renameSync(tmp, file);
  } catch {
    try { rmSync(tmp, { force: true }); } catch { /* ignore */ }
  }
}

/** The check in a sentence for whoever reads the `say` line. */
export function sayTdd(check: TddCheck, locale: 'es' | 'en'): string {
  const es = locale === 'es';
  if (check.skipped) return es ? `sin comprobar (${check.skipped})` : `not checked (${check.skipped})`;
  const some = (l: string[]) => l.slice(0, 3).map(s => s.replace(/^.* > /, '')).join(', ') + (l.length > 3 ? '…' : '');
  const parts = es
    ? [`${check.red.length} en rojo sobre BASE`, `${check.passedOnBase.length} pasan en BASE${check.passedOnBase.length ? ` (${some(check.passedOnBase)})` : ''}`]
    : [`${check.red.length} red on BASE`, `${check.passedOnBase.length} pass on BASE${check.passedOnBase.length ? ` (${some(check.passedOnBase)})` : ''}`];
  if (check.alreadyFailing.length) parts.push(es ? `${check.alreadyFailing.length} ya fallaban` : `${check.alreadyFailing.length} already failing`);
  if (check.unjudged.length) parts.push(es ? `${check.unjudged.length} sin juzgar` : `${check.unjudged.length} not judged`);
  return `TDD: ${parts.join(', ')}`;
}

/** A brief of the bug route. */
export const BUG_BRIEF = /^Bug:/m;
