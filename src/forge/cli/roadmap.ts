// C7 (wave 4): the roadmap documents the CLI builds: FORGE roadmap-doc (and roadmap-run, Task 5 of plan 4a).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Io } from './run.js';
import { generateRoadmapDoc, RoadmapDocError } from '../roadmap-sources.js';
import { roadmapRun, RoadmapRunError } from '../roadmap-run.js';
import { parsePlan, PlanError } from '../../lib/plan.js';

type Result = { code: number; stdout: string; stderr: string };
const fail = (code: number, msg: string): Result => ({ code, stdout: '', stderr: `${msg}\n` });
const json = (v: unknown): Result => ({ code: 0, stdout: JSON.stringify(v, null, 2) + '\n', stderr: '' });
const DOC_USAGE = 'usage: forge roadmap-doc <T> [--project p] [--plan plan.yaml] [--assets uploads.json] [--cwd dir] [--out file]';

export function roadmapCommand(cmd: string, args: string[], io: Io): Result {
  const flag = (name: string) => {
    const i = args.indexOf(`--${name}`);
    const v = i >= 0 ? args[i + 1] : undefined;
    return v === undefined || v.startsWith('--') ? undefined : v;
  };
  for (const name of ['project', 'plan', 'assets', 'out', 'run', 'task', 'session']) {
    if (args.includes(`--${name}`) && flag(name) === undefined) return fail(2, `${cmd}: --${name} needs a value`);
  }
  if (cmd === 'roadmap-doc') {
    const task = args[0];
    if (!task || task.startsWith('--')) return fail(2, DOC_USAGE);
    let project = flag('project') ?? null;
    const planArg = flag('plan');
    if (planArg) {
      let plan;
      try { plan = parsePlan(readFileSync(path.resolve(io.cwd, planArg), 'utf8')); }
      catch (e) { return fail(2, `roadmap-doc: ${e instanceof PlanError ? e.issues.join('; ') : `cannot read ${planArg}`}`); }
      if (!plan.tasks.some(t => t.id === task)) return fail(2, `roadmap-doc: ${task} is not a task of ${planArg}`);
      project ??= plan.project;
    }
    try {
      const r = generateRoadmapDoc(io, task, { project, assets: flag('assets') ?? null, out: flag('out') ?? null });
      return json({ task: r.task, project: r.project, bytes: r.bytes, file: r.file, write: r.write, dropped: r.dropped });
    } catch (e) {
      if (e instanceof RoadmapDocError) return fail(e.code, e.message);
      throw e;
    }
  }
  if (cmd === 'roadmap-run') {
    try {
      const r = roadmapRun(io, { run: flag('run'), task: flag('task'), project: flag('project') ?? null, session: flag('session'), out: flag('out') });
      return json({ write: r.write, cleanup: r.cleanup, bytes: r.bytes, dropped: r.dropped });
    } catch (e) {
      if (e instanceof RoadmapRunError) return fail(e.code, e.message);
      throw e;
    }
  }
  return fail(2, DOC_USAGE);
}
