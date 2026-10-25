// What waits for the person, as the band carries it (w7 A5): bandNeeds feeds needsYou (src/lib/needs-you.ts) from the
// band's files. The two helpers the notice and the design band share with it live here too, so it never needs more than
// the types of model.ts (no cycle at run time).
import { parse as parseYaml } from 'yaml';
import { parseBound, type BoundDoc } from '../lib/bound.js';
import { verdictOf, type Critique } from '../lib/critique.js';
import { changelogLite, critiqueLite, designMetaLite } from '../lib/design-lite.js';
import { parseDismissed, pendingProposals, unionDismissed, type GateCritique, type Pending } from '../lib/design-gate.js';
import type { DesignMeta } from '../lib/design.js';
import { coordinatorLiveness } from '../lib/execution-view.js';
import { normalizeLive, parseExecution, type ExecutionState, type LiveDoc } from '../lib/execution-state.js';
import { needsYou, type NeedsInput, type NeedsRun } from '../lib/needs-you.js';
import type { BandFiles, BandModel } from './model.js';

/** How many items a band carries: the oldest ones; `total` counts them all. */
export const NEEDS_KEPT = 10;

function json(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  try { return JSON.parse(text); } catch { return undefined; }
}

/**
 * Whether the run's coordinator has an open conversation, judged as `swarm status` and `/forge:run --resume` do: the
 * execution as if it were still active.
 */
export function coordinatorOpen(e: ExecutionState, signal: LiveDoc | null, now: number, bindings: readonly BoundDoc[]): boolean {
  return coordinatorLiveness({ ...e, active: true }, signal, now, { bindings }) !== 'stopped';
}

/** The coordinator's own signal and bindings, as the hooks read them: what coordinatorGone and coordinatorLiveness judge. */
export function coordinatorSignals(f: BandFiles, now: number): { signal: LiveDoc | null; bindings: BoundDoc[] } {
  const bindings = Object.values(f.coordinatorBindings ?? {}).flatMap(text => { const b = parseBound(text, now); return b ? [b] : []; });
  return { signal: normalizeLive(json(f.coordinatorLive)), bindings };
}

/** What the design band and the approval wait read of a design: null without a design or when its meta does not read. */
export function designReview(f: BandFiles): { meta: DesignMeta; version: number; round: number; latest: Critique | null; pending: Pending[]; since: string | null } | null {
  if (f.design === undefined) return null;
  const meta = designMetaLite(f.design);
  if (!meta) return null;
  const changelog = changelogLite(f.changelog ?? null) ?? [];
  const critiques = Object.entries(f.critiques)
    .map(([name, text]) => ({ n: Number(/^critique-r(\d+)\.json$/.exec(name)?.[1] ?? NaN), text }))
    .filter(c => Number.isFinite(c.n))
    .sort((a, b) => b.n - a.n);
  const valid: GateCritique[] = critiques.map(c => ({ round: c.n, critique: critiqueLite(c.text) }));
  // The highest round with a valid critique; invalid ones are skipped.
  const top = valid.find(c => c.critique !== null);
  // Carry 8: the dismissals of both places, merged as the CLI's readDismissedOf merges them.
  const pending = pendingProposals(changelog, valid, unionDismissed(parseDismissed(f.dismissedLegacy), parseDismissed(f.dismissed)));
  const date = changelog.at(-1)?.date;
  return { meta, version: changelog.at(-1)?.version ?? 0, round: top?.round ?? 0, latest: top?.critique ?? null, pending, since: typeof date === 'string' ? date : null };
}

/** The surfaces local.yaml decided (allowed or denied); one that does not read decides none. */
function decidedSurfaces(local: string | undefined): string[] {
  if (local === undefined) return [];
  try {
    const doc: unknown = parseYaml(local);
    const surfaces = doc && typeof doc === 'object' ? (doc as { surfaces?: unknown }).surfaces : undefined;
    if (!surfaces || typeof surfaces !== 'object' || Array.isArray(surfaces)) return [];
    return Object.entries(surfaces as Record<string, unknown>)
      .filter(([, v]) => v && typeof v === 'object' && ['allowed', 'denied'].includes((v as { state?: unknown }).state as string))
      .map(([k]) => k);
  } catch { return []; }
}

/**
 * The first NEEDS_KEPT items of what waits for the person and how many in all, from the band's files; undefined when
 * nothing does. `project` is the waypoint project (null without one: any run of the checkout counts).
 */
export function bandNeeds(project: string | null, f: BandFiles, now0?: number): NonNullable<BandModel['needs']> | undefined {
  const now = now0 ?? f.now ?? Date.now();
  const input: NeedsInput = { now };
  let run: NeedsRun | null | undefined;
  let e: ExecutionState | null = null;
  if (f.execution !== undefined) {
    e = parseExecution(f.execution, now);
    if (!e) run = null;
    else if (project === null || e.kind === 'ephemeral' || e.project === project) {
      const { signal, bindings } = coordinatorSignals(f, now);
      run = {
        runId: e.runId, active: e.active, stopReason: e.stopReason, stallReason: e.stallReason, startedAt: e.startedAt,
        lastStepAt: e.lastStepAt, closedAt: e.closedAt ?? null, coordinatorOpen: coordinatorOpen(e, signal, now, bindings),
      };
    }
  }
  if (run !== undefined) input.run = run;
  if (f.asked) input.asked = Object.fromEntries(Object.entries(f.asked).map(([task, a]) => [task, { file: a.file, doc: a.text }]));
  if (f.auth) input.auth = f.auth;
  // Decided: allowed or denied in local.yaml, or declined for this run («No, esta vez», which forge records in the
  // run's verifySkip); the asked note itself stays until another run starts.
  if (run && f.surfacesAsked) input.surfaces = { docs: f.surfacesAsked, decided: [...decidedSurfaces(f.local), ...(e?.verifySkip ?? [])] };
  if (f.notes) input.notes = f.notes;
  if (f.proposals) input.proposals = f.proposals;
  if (project !== null && f.design !== undefined) {
    const d = designReview(f);
    if (!d) input.design = { project, read: null };
    else if (d.meta.status === 'draft') {
      const ready = d.latest !== null && (d.latest.verdict ?? verdictOf(d.latest)) === 'ready' && !d.pending.some(p => p.severity === 'critical' || p.severity === 'major');
      input.design = { project, read: { version: d.version, ready, since: d.since } };
    }
  }
  const items = needsYou(input);
  return items.length ? { total: items.length, items: items.slice(0, NEEDS_KEPT) } : undefined;
}
