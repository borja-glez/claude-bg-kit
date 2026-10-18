// I-01: counts, and with --apply deletes, the temp entries old test runs left in the system's temp directory: the
// directories mkdtemp made with the prefixes the tests used before tests/helpers/tmp.ts (the families below, each
// followed by -word parts: forge-cli-, wp-else-, sp-proj-…), the helper's own bgkit-<prefix>, and the
// bgkit-vitest-<pid>-<stamp> root of a run that was cut short. An entry counts only when its name is one of those
// prefixes plus mkdtemp's 6 characters (or a run root) and it is older than --older-than-hours (24 by default).
// Without --apply nothing is deleted. Usage: node scripts/clean-temp.mjs [--apply] [--older-than-hours N] [--root <dir>]
// (--root: another directory than the system's temp, for the tests).
import { lstatSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// band-disk, seat-of and page-mark are full prefixes on purpose: a bare band, seat or page would match foreign names.
export const FAMILIES = ['forge', 'wp', 'sp', 'mcp', 'locale', 'mod-types', 'route-eval', 'usage-report', 'roadmap-contract', 'band-disk', 'seat-of', 'page-mark', 'bgkit'];
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ENTRY = new RegExp(`^((?:${FAMILIES.map(esc).join('|')})(?:-[a-z0-9]+)*-?)[A-Za-z0-9]{6}$`);
const RUN_ROOT = /^bgkit-vitest-\d+-\d{14}$/;
const USAGE = 'usage: node scripts/clean-temp.mjs [--apply] [--older-than-hours N] [--root <dir>]';

/** The prefix an entry was made with (`forge-cli`, `wp`, `bgkit-vitest`), or null when it is not one of the tests'. */
export function prefixOf(name) {
  if (RUN_ROOT.test(name)) return 'bgkit-vitest';
  const m = ENTRY.exec(name);
  return m ? m[1].replace(/-$/, '') : null;
}

/** The test entries of `root` by prefix (most first) and the names of those older than `hours`. A missing root is empty. */
export function scan(root, nowMs, hours) {
  const cut = nowMs - hours * 3600_000;
  const groups = new Map();
  const old = [];
  let names = [];
  try { names = readdirSync(root); } catch { names = []; }
  for (const name of names) {
    const prefix = prefixOf(name);
    if (!prefix) continue;
    let mtime;
    try { mtime = lstatSync(path.join(root, name)).mtimeMs; } catch { continue; }
    const g = groups.get(prefix) ?? { prefix, count: 0, old: 0 };
    g.count++;
    if (mtime < cut) { g.old++; old.push(name); }
    groups.set(prefix, g);
  }
  const sorted = [...groups.values()].sort((a, b) => b.count - a.count || (a.prefix < b.prefix ? -1 : a.prefix > b.prefix ? 1 : 0));
  return { groups: sorted, old };
}

export function report(r, hours) {
  const total = r.groups.reduce((n, g) => n + g.count, 0);
  return [...r.groups.map(g => `${g.prefix}: ${g.count} (${g.old} older than ${hours}h)`), `total: ${total} (${r.old.length} older than ${hours}h)`];
}

const rmTree = p => rmSync(p, { recursive: true, force: true, maxRetries: 3 });

/** Deletes those entries (a symlink is removed, never followed); a failure is warned about and counted, and the rest go on. */
export function removeOld(root, names, warn = () => {}, rm = rmTree) {
  let deleted = 0;
  let errors = 0;
  for (const name of names) {
    try { rm(path.join(root, name)); deleted++; } catch (e) {
      errors++;
      warn(`could not delete ${name}: ${e && e.code ? e.code : e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { deleted, errors };
}

function main(argv) {
  const known = new Set(['--apply', '--older-than-hours', '--root']);
  const bad = argv.find(a => a.startsWith('--') && !known.has(a));
  if (bad !== undefined) { process.stderr.write(`clean-temp: unknown option ${bad}\n${USAGE}\n`); return 2; }
  const valueOf = f => { const i = argv.indexOf(f); return i < 0 ? undefined : argv[i + 1] ?? null; };
  const hoursArg = valueOf('--older-than-hours');
  const hours = hoursArg === undefined ? 24 : Number(hoursArg);
  if (hoursArg === null || !Number.isFinite(hours) || hours < 0) { process.stderr.write(`clean-temp: --older-than-hours takes a number of hours, 0 or more\n${USAGE}\n`); return 2; }
  const rootArg = valueOf('--root');
  if (rootArg === null || (rootArg !== undefined && rootArg.startsWith('--'))) { process.stderr.write(`clean-temp: --root takes a directory\n${USAGE}\n`); return 2; }
  const root = rootArg === undefined ? tmpdir() : path.resolve(rootArg);
  const r = scan(root, Date.now(), hours);
  for (const line of report(r, hours)) process.stdout.write(`${line}\n`);
  if (!argv.includes('--apply')) {
    process.stdout.write(`dry run: nothing deleted (--apply deletes the ${r.old.length} older than ${hours}h)\n`);
    return 0;
  }
  const done = removeOld(root, r.old, w => process.stderr.write(`clean-temp: ${w}\n`));
  process.stdout.write(`deleted: ${done.deleted}, errors: ${done.errors}\n`);
  return done.errors ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
