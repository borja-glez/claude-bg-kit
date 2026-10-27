// `waypoint handoff <project>`: the files behind the handoff question (src/lib/handoff.ts). The stage comes from the
// project's files (a plan.yaml, else an approved design.md), forge and superpowers from the session's skills
// (--skills) and from what Claude Code installed for this project, and a running forge execution from the main
// checkout's .forge/execution.json.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parsePlan } from '../lib/plan.js';
import { parseDesign } from '../lib/design.js';
import { mainCheckoutFrom } from '../lib/main-checkout.js';
import { parseExecution } from '../lib/execution-state.js';
import { claudeConfigDir, installedPlugins, type InstalledPlugin } from '../lib/plugins.js';
import { compareVersions } from '../lib/waypoint-version.js';
import { FORGE_HANDOFF_MIN, handoff, type Detected, type Handoff } from '../lib/handoff.js';
import type { TaskState } from '../lib/types.js';

/** The skill each plugin must give this session for its option. */
export const HANDOFF_SKILLS = { forge: 'forge:run', superpowers: 'superpowers:writing-plans' } as const;

const read = (f: string): string | null => { try { return readFileSync(f, 'utf8'); } catch { return null; } };
const STARTED = new Set<string>(['claimed', 'in_progress', 'blocked', 'done']);
const SEMVER = /^\d{1,6}\.\d{1,6}\.\d{1,6}/;

/** With `listed` (the session's skills), a plugin is on only when the session lists its skill: one installed after the
 *  session started is not loaded yet. Without it, installed and enabled is enough. The installed version, when there is
 *  one, says whether forge is too old. */
function detect(name: 'forge' | 'superpowers', listed: Set<string> | null, installed: InstalledPlugin[]): Detected {
  const session = listed?.has(HANDOFF_SKILLS[name]) ?? false;
  const mine = installed.filter(p => p.name === name).map(p => p.version).sort((a, b) => compareVersions(b, a));
  const version = mine[0] ?? null;
  const from = session && mine.length ? 'both' : session ? 'session' : mine.length ? 'installed' : null;
  const tooOld = name === 'forge' && version !== null && SEMVER.test(version) && compareVersions(version, FORGE_HANDOFF_MIN) < 0;
  return { on: (listed ? session : from !== null) && !tooOld, version, from, ...(tooOld ? { tooOld } : {}) };
}

export interface HandoffOpts {
  cwd: string;
  env: Record<string, string | undefined>;
  now: number;
  /** The skills this session lists, comma or space separated (--skills; `none` when it lists neither). */
  skills?: string;
  /** The person's language (--locale); else the plan's or the design's. */
  locale?: string;
  /** The roadmap's task states (--states), for a plan that already started. */
  states?: Record<string, TaskState>;
}

export function handoffFor(project: string, o: HandoffOpts): Handoff | { error: string } {
  const rel = (f: string) => `docs/waypoint/${project}/${f}`;
  const planText = read(path.join(o.cwd, rel('plan.yaml')));
  let stage: 'design' | 'plan';
  let locale: string;
  let tasks: number | null = null, tracks: number | null = null;
  if (planText !== null) {
    try {
      const p = parsePlan(planText);
      stage = 'plan'; locale = p.locale; tasks = p.tasks.length; tracks = p.tracks.length;
    } catch (e) { return { error: `handoff: ${rel('plan.yaml')} is not a plan: ${(e as Error).message}` }; }
  } else {
    const text = read(path.join(o.cwd, rel('design.md')));
    if (text === null) return { error: `handoff: ${project} has neither ${rel('plan.yaml')} nor ${rel('design.md')}` };
    let status: string, designLocale: string | undefined;
    try { const d = parseDesign(text); status = d.meta.status; designLocale = d.meta.locale; } catch (e) { return { error: `handoff: ${rel('design.md')} is not a design: ${(e as Error).message}` }; }
    if (status !== 'approved') return { error: `handoff: the design of ${project} is not approved (status: ${status})` };
    stage = 'design'; locale = designLocale ?? 'en';
  }
  const main = mainCheckoutFrom(o.cwd, read(path.join(o.cwd, '.git')));
  const listed = o.skills === undefined ? null : new Set(o.skills.split(/[\s,]+/).filter(Boolean));
  const installed = installedPlugins({ configDir: claudeConfigDir(o.env), projectDir: main }, n => n === 'forge' || n === 'superpowers');
  const exec = parseExecution(read(path.join(main, '.forge', 'execution.json')), o.now);
  return handoff({
    stage, project, es: /^es(?:$|[-_])/i.test(o.locale ?? locale),
    forge: detect('forge', listed, installed), superpowers: detect('superpowers', listed, installed),
    tasks, tracks,
    started: stage === 'plan' && Object.values(o.states ?? {}).some(s => STARTED.has(s.status)),
    running: !!exec && exec.active && exec.kind === 'plan' && exec.project === project,
  });
}
