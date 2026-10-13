// superpowers next to forge (spec §4.1): whether it is installed for this repository and where (fail-open: anything
// missing or unreadable means not installed), the path of one of its skills, and the specs and plans it wrote here that
// forge has not taken yet. Reads only; never touches superpowers' cache.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { parseDesign } from '../lib/design.js';
import { specTitle } from '../lib/design-import.js';
import { markDone, parseSpPlan, sddComplete } from '../lib/sp-plan.js';

export interface Superpowers { installed: boolean; version: string | null; installPath: string | null }
export interface SpSpec { path: string; title: string; modified: string }
export interface SpPlanEntry { path: string; title: string; tasks: number; done: number }

/** sp-specs and sp-plans look this far back, and list at most SP_MAX, newest first. */
export const SP_WINDOW_MS = 14 * 24 * 3600_000;
const SP_MAX = 3;
const NONE: Superpowers = { installed: false, version: null, installPath: null };

/** Claude Code's configuration directory: CLAUDE_CONFIG_DIR, else ~/.claude. */
export function claudeConfigDir(env: Record<string, string | undefined> = process.env): string {
  return env.CLAUDE_CONFIG_DIR?.trim() || path.join(homedir(), '.claude');
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const readJson = (file: string): unknown => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
const samePath = (a: string, b: string): boolean => {
  const x = path.resolve(a);
  const y = path.resolve(b);
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
};
// "6.4.1" > "6.4.0" > "unknown" (a hash or a word counts as 0).
const versionKey = (v: string) => v.split(/[.+-]/).map(n => (/^\d+$/.test(n) ? Number(n) : 0));
function newer(a: string, b: string): boolean {
  const x = versionKey(a);
  const y = versionKey(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d > 0;
  }
  return false;
}

/** enabledPlugins[key] from the most specific settings file that names it: the project's local, the project's, the user's. */
function enabled(key: string, configDir: string, projectDir: string): boolean {
  for (const f of [path.join(projectDir, '.claude', 'settings.local.json'), path.join(projectDir, '.claude', 'settings.json'), path.join(configDir, 'settings.json')]) {
    const s = readJson(f);
    const ep = isObj(s) && isObj(s.enabledPlugins) ? s.enabledPlugins : null;
    if (ep && typeof ep[key] === 'boolean') return ep[key] as boolean;
  }
  return true;
}

/**
 * superpowers as installed for this project: an entry `superpowers@<marketplace>` of installed_plugins.json whose
 * installPath exists, installed for the user (or for this project: scope project/local with this projectPath) and not
 * turned off in enabledPlugins. The highest version wins.
 */
export function locateSuperpowers(opts: { configDir: string; projectDir: string }): Superpowers {
  try {
    const file = readJson(path.join(opts.configDir, 'plugins', 'installed_plugins.json'));
    const plugins = isObj(file) && isObj(file.plugins) ? file.plugins : null;
    if (!plugins) return NONE;
    let best = NONE;
    for (const [key, value] of Object.entries(plugins)) {
      if (!/^superpowers@[^@\s]+$/.test(key) || !enabled(key, opts.configDir, opts.projectDir)) continue;
      for (const e of Array.isArray(value) ? value : [value]) {
        if (!isObj(e) || typeof e.installPath !== 'string' || !existsSync(e.installPath)) continue;
        const scope = typeof e.scope === 'string' ? e.scope : 'user';
        if (scope !== 'user' && scope !== 'managed' && !(typeof e.projectPath === 'string' && samePath(e.projectPath, opts.projectDir))) continue;
        const version = typeof e.version === 'string' && e.version ? e.version : 'unknown';
        if (!best.installed || newer(version, best.version ?? '')) best = { installed: true, version, installPath: e.installPath };
      }
    }
    return best;
  } catch { return NONE; }
}

/** The SKILL.md of one superpowers skill, or null (not installed, no such skill, or a name that is not a plain id). */
export function spSkillPath(sp: Superpowers, skill: string): string | null {
  if (!sp.installed || !sp.installPath || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(skill)) return null;
  const f = path.join(sp.installPath, 'skills', skill, 'SKILL.md');
  return existsSync(f) ? f : null;
}

/**
 * The tasks of a superpowers plan its own executors recorded as complete, from `<root>/.superpowers/sdd/<slug>[-…]/
 * progress.md` under each root (the repository and its main checkout), where superpowers keeps one workspace per plan.
 * A workspace whose `plan-path` marker names another plan is skipped. Fail-open: nothing readable means none.
 */
export function spLedgerDone(roots: string[], planAbs: string): number[] {
  const done = new Set<number>();
  const slug = path.basename(planAbs).replace(/\.md$/i, '');
  for (const root of [...new Set(roots.map(r => path.resolve(r)))]) {
    const rel = path.relative(root, planAbs).split(path.sep).join('/');
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
    const base = path.join(root, '.superpowers', 'sdd');
    let names: string[] = [];
    try { names = readdirSync(base); } catch { continue; }
    for (const name of names) {
      if (name !== slug && !name.startsWith(`${slug}-`)) continue;
      const dir = path.join(base, name);
      let marker: string | null = null;
      try { marker = readFileSync(path.join(dir, 'plan-path'), 'utf8').trim().replace(/\\/g, '/'); } catch { /* a workspace without a marker */ }
      if (marker !== null && marker !== rel) continue;
      try { for (const n of sddComplete(readFileSync(path.join(dir, 'progress.md'), 'utf8'), rel)) done.add(n); } catch { /* no ledger */ }
    }
  }
  return [...done].sort((a, b) => a - b);
}

// The .md files of a directory changed within the window, newest first.
function recentMarkdown(dir: string, now: number): { name: string; abs: string; mtime: number }[] {
  let names: string[];
  try { names = readdirSync(dir); } catch { return []; }
  const out: { name: string; abs: string; mtime: number }[] = [];
  for (const name of names) {
    if (!name.endsWith('.md')) continue;
    const abs = path.join(dir, name);
    try {
      const st = statSync(abs);
      if (st.isFile() && now - st.mtimeMs <= SP_WINDOW_MS) out.push({ name, abs, mtime: st.mtimeMs });
    } catch { /* gone meanwhile */ }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

function titleOf(file: string): string | null {
  try {
    const m = /^#\s+(.+?)\s*#*\s*$/m.exec(readFileSync(file, 'utf8'));
    return m ? specTitle(m[1]) : null;
  } catch { return null; }
}

/** The specs superpowers wrote in the last 14 days that no docs/waypoint/<project>/design.md names as its `source`. */
export function spSpecs(root: string, now: number): SpSpec[] {
  const cited = new Set<string>();
  let projects: string[] = [];
  try { projects = readdirSync(path.join(root, 'docs', 'waypoint')); } catch { /* no waypoint project */ }
  for (const p of projects) {
    try {
      const s = parseDesign(readFileSync(path.join(root, 'docs', 'waypoint', p, 'design.md'), 'utf8')).meta.source;
      if (s) cited.add(s.replace(/\\/g, '/').replace(/^\.\//, ''));
    } catch { /* no design, or not a valid one */ }
  }
  const out: SpSpec[] = [];
  for (const f of recentMarkdown(path.join(root, 'docs', 'superpowers', 'specs'), now)) {
    const rel = `docs/superpowers/specs/${f.name}`;
    if (cited.has(rel)) continue;
    out.push({ path: rel, title: titleOf(f.abs) ?? f.name.replace(/\.md$/, ''), modified: new Date(f.mtime).toISOString() });
    if (out.length === SP_MAX) break;
  }
  return out;
}

/** The plans superpowers wrote in the last 14 days that still have a task to do; a file that is not a plan is skipped. */
export function spPlans(root: string, now: number): SpPlanEntry[] {
  const out: SpPlanEntry[] = [];
  for (const f of recentMarkdown(path.join(root, 'docs', 'superpowers', 'plans'), now)) {
    let plan;
    try { plan = markDone(parseSpPlan(readFileSync(f.abs, 'utf8')), spLedgerDone([root], f.abs)); } catch { continue; }
    const done = plan.tasks.filter(t => t.done).length;
    if (done === plan.tasks.length) continue;
    out.push({ path: `docs/superpowers/plans/${f.name}`, title: plan.plan.title || f.name.replace(/\.md$/, ''), tasks: plan.tasks.length, done });
    if (out.length === SP_MAX) break;
  }
  return out;
}
