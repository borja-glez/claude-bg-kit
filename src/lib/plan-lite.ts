import { parse } from 'yaml';
import { TRACK_COLORS, type Plan, type PlanPhase, type PlanTask, type PlanTrack, type PlanVersion } from './types.js';

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const strs = (x: unknown): string[] => (Array.isArray(x) ? x.filter(isStr) : []);
const objs = (x: unknown): Obj[] => (Array.isArray(x) ? x.filter(isObj) : []);

/**
 * I-13: plan.yaml as the band reads it, without zod: yaml.parse and, by hand, the defaults and the optional fields of the
 * schema of src/lib/plan.ts. A valid plan reads the same as with parsePlan (tests/plan-lite.test.ts); an invalid one may
 * still read, and the band shows it: the CLI is the one that validates. Null when it is not a plan at all (no project,
 * or no track, phase or task with its id). Pure and without Node imports: the mods use it.
 */
export function planLite(text: string): Plan | null {
  let raw: unknown;
  try { raw = parse(text); } catch { return null; }
  if (!isObj(raw) || !isStr(raw.project)) return null;
  const tracks: PlanTrack[] = objs(raw.tracks).filter(t => isStr(t.id)).map(t => ({
    id: t.id as string,
    name: isStr(t.name) ? t.name : '',
    color: (TRACK_COLORS as readonly unknown[]).includes(t.color) ? (t.color as PlanTrack['color']) : TRACK_COLORS[0],
  }));
  const phases: PlanPhase[] = objs(raw.phases).filter(p => isStr(p.id)).map(p => ({
    id: p.id as string,
    name: isStr(p.name) ? p.name : '',
    plan_status: p.plan_status === 'provisional' ? 'provisional' : 'committed',
    ...(isStr(p.goal) ? { goal: p.goal } : {}),
  }));
  const tasks: PlanTask[] = objs(raw.tasks).filter(t => isStr(t.id) && isStr(t.title) && isStr(t.track) && isStr(t.phase)).map(t => ({
    id: t.id as string,
    title: t.title as string,
    track: t.track as string,
    phase: t.phase as string,
    ...(isStr(t.category) ? { category: t.category } : {}),
    ...(isStr(t.includes) ? { includes: t.includes } : {}),
    done_when: isStr(t.done_when) ? t.done_when : '',
    ...(isStr(t.verification) ? { verification: t.verification } : {}),
    depends_on: strs(t.depends_on),
    zones: strs(t.zones),
    ...(typeof t.estimate_min === 'number' && t.estimate_min > 0 ? { estimate_min: t.estimate_min } : {}),
    ...(typeof t.delicate === 'boolean' ? { delicate: t.delicate } : {}),
    ...(isStr(t.design_ref) ? { design_ref: t.design_ref } : {}),
  }));
  if (!tracks.length || !phases.length || !tasks.length) return null;
  const a = isObj(raw.artifacts) ? raw.artifacts : {};
  const versions: PlanVersion[] = objs(raw.versions).filter(v => isStr(v.id)).map(v => ({
    id: v.id as string, phases: strs(v.phases), ...(isStr(v.target) ? { target: v.target } : {}),
  }));
  const dv = raw.design_version;
  return {
    project: raw.project,
    locale: isStr(raw.locale) && raw.locale ? raw.locale : 'en',
    version: isStr(raw.version) ? raw.version : '',
    ...(typeof dv === 'number' && Number.isInteger(dv) && dv > 0 ? { design_version: dv } : {}),
    artifacts: { ...(isStr(a.roadmap) ? { roadmap: a.roadmap } : {}), ...(isStr(a.design) ? { design: a.design } : {}) },
    versions, tracks, phases, tasks,
  };
}
