// Which checkout and project this conversation belongs to. The session root is where `claude` started, not where the work
// is: a person who starts it in a folder of repositories works in one of them, so lens and the band look in the root, the
// checkout they held, and the marked folders one level below it. Shared by lens and the band.
import { mainCheckoutFrom } from '../lib/main-checkout.js';
import { MAX_PROJECTS } from '../lib/bound.js';
import { isSafeId, parseExecution } from '../lib/execution-state.js';
import { isVisibleRun, lastMovedAt } from '../lib/execution-view.js';
import { memberOfHook } from '../lib/forge-activity.js';
import { newestMemberFiles, normalizeMember, type MemberDoc } from '../lib/member-doc.js';
import { normalizeStatus } from '../lib/forge-status.js';
import { join, mtime, readOpt, seatFiles, type Engine } from './files.js';
import { seatsOf } from './model.js';

export type AnchorKind = 'coordinator' | 'member' | 'binding' | 'forge-task' | 'sdd-ledger' | 'sp-plan';
/** join: every card reads the checkout as today; own: only this conversation's own work. */
export type AnchorScope = 'join' | 'own';
export interface Anchor { kind: AnchorKind; scope: AnchorScope; checkout: string; project: string | null; at: number }
export interface Refusal { path: string; reason: string }
/** What lens heard this session do: forge tasks it ran, and the superpowers ledger or plan paths it wrote. */
export interface OwnWork { tasks: readonly string[]; paths: readonly { path: string; at: number }[] }
export interface AnchorSearch { anchor: Anchor | null; refused: Refusal | null }

/** The first kind found wins. */
export const ANCHOR_ORDER: readonly AnchorKind[] = ['coordinator', 'member', 'binding', 'forge-task', 'sdd-ledger', 'sp-plan'];

export const scopeOf = (kind: AnchorKind): AnchorScope => (ANCHOR_ORDER.indexOf(kind) < 3 ? 'join' : 'own');

/** The first kind of ANCHOR_ORDER among the hits, then the newest; null without hits. */
export function chooseAnchor(hits: readonly Anchor[]): Anchor | null {
  let best: Anchor | null = null;
  for (const a of hits) {
    if (!best) { best = a; continue; }
    const d = ANCHOR_ORDER.indexOf(a.kind) - ANCHOR_ORDER.indexOf(best.kind);
    if (d < 0 || (d === 0 && a.at > best.at)) best = a;
  }
  return best;
}

/** A missing path (ENOENT, ENOTDIR) says nothing; any other failure is a refusal the person should hear of. */
export function fsFailure(err: unknown): 'missing' | 'refused' {
  const code = err && typeof err === 'object' ? String((err as { code?: unknown }).code ?? '') : '';
  const text = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return /^(ENOENT|ENOTDIR)$/.test(code) || /\b(ENOENT|ENOTDIR)\b/.test(text) ? 'missing' : 'refused';
}

export function refusalReason(err: unknown): string {
  const text = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const code = err && typeof err === 'object' ? String((err as { code?: unknown }).code ?? '') : '';
  return (text || code || 'unreadable').replace(/\s+/g, ' ').trim().slice(0, 120);
}

const norm = (p: string): string => {
  const s = p.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[A-Za-z]:/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
};
export const samePath = (a: string, b: string): boolean => norm(a) === norm(b);
export const under = (path: string, dir: string): boolean => {
  const p = norm(path), d = norm(dir);
  return p === d || p.startsWith(`${d}/`);
};

const byName = (a: { name: string }, b: { name: string }) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const STATUS_MAX_BYTES = 64 * 1024;
const STATUS_KEEP = 20;
const STATUS_WINDOW_MS = 24 * 3_600_000;
const EXEC_MAX_BYTES = 64 * 1024;
const MARKERS = ['.waypoint', '.forge', '.superpowers'];

const debug = ($: Engine, message: string) => { try { $.ui.log(message, { to: 'debug' }); } catch { /* only a log */ } };

/**
 * The checkouts to look in, the held one first, then the session root, then its first-level folders (the first
 * MAX_PROJECTS by name) that hold .waypoint, .forge, .superpowers, docs/waypoint or docs/superpowers/plans; each once.
 * A refused root is reported; a refused folder below it is skipped and only logged.
 */
export async function anchorCandidates($: Engine, root: string, held: string | null): Promise<{ dirs: string[]; refused: Refusal | null }> {
  const dirs: string[] = [];
  const add = (d: string) => { if (!dirs.some(x => samePath(x, d))) dirs.push(d); };
  if (held) add(held);
  add(root);
  let refused: Refusal | null = null;
  let top: Awaited<ReturnType<Engine['fs']['list']>> = [];
  try { top = await $.fs.list(root); } catch (err) { if (fsFailure(err) === 'refused') refused = { path: root, reason: refusalReason(err) }; }
  const children = top.filter(d => d.kind === 'dir').sort(byName).slice(0, MAX_PROJECTS);
  for (const c of children) {
    const dir = join(root, c.name);
    try {
      const names = new Map((await $.fs.list(dir)).map(e => [e.name, e.kind] as const));
      let marked = MARKERS.some(m => names.has(m));
      if (!marked && names.get('docs') === 'dir') {
        const docs = await $.fs.list(join(dir, 'docs'));
        marked = docs.some(e => e.kind === 'dir' && e.name === 'waypoint');
        if (!marked && docs.some(e => e.kind === 'dir' && e.name === 'superpowers')) {
          marked = (await $.fs.list(join(dir, 'docs', 'superpowers'))).some(e => e.kind === 'dir' && e.name === 'plans');
        }
      }
      if (marked) add(dir);
    } catch (err) {
      if (fsFailure(err) === 'refused') debug($, `lens: ${dir} not read while looking for the project: ${refusalReason(err)}`);
    }
  }
  return { dirs, refused };
}

/** Whether a forge status belongs to this conversation: its session when it names one, else the tasks it ran (T1-2 is of T1). */
const isOwnStatus = (st: { task: string; session: string | null }, sessionId: string, tasks: readonly string[]): boolean =>
  st.session !== null ? st.session === sessionId
    : tasks.some(t => t === st.task || (t.startsWith(`${st.task}-`) && /^\d{1,4}$/.test(t.slice(st.task.length + 1))));

const LEDGER = /^\.superpowers\/sdd\/[^/]+\/progress\.md$/;
const PLAN = /^docs\/superpowers\/plans\/[^/]+\.md$/;

/**
 * This conversation's anchor among the candidates: the first kind of ANCHOR_ORDER found, the most recent within it.
 * `kinds: 'join'` looks only for what the person joined (a run, a binding); 'all' adds the conversation's own work. A
 * refusal on the root or the held checkout is returned beside the anchor.
 */
export async function findAnchor($: Engine, o: { root: string; sessionId: string | null; held: string | null; kinds: 'join' | 'all'; own?: OwnWork; now: number }): Promise<AnchorSearch> {
  const { dirs, refused: rootRefused } = await anchorCandidates($, o.root, o.held);
  if (!o.sessionId) return { anchor: null, refused: rootRefused };
  const sid = o.sessionId;
  let refused = rootRefused;
  const hits: Anchor[] = [];
  for (const dir of dirs) {
    const watched = samePath(dir, o.root) || (o.held !== null && samePath(dir, o.held));
    const list = async (path: string) => {
      try { return await $.fs.list(path); } catch (err) {
        if (watched && !refused && fsFailure(err) === 'refused') refused = { path, reason: refusalReason(err) };
        return [];
      }
    };
    const read = async (path: string) => {
      try { return await $.fs.read(path); } catch (err) {
        if (watched && !refused && fsFailure(err) === 'refused') refused = { path, reason: refusalReason(err) };
        return undefined;
      }
    };
    const main = mainCheckoutFrom(dir, (await readOpt($, join(dir, '.git'))) ?? null);
    const forge = join(main, '.forge');
    const entries = await list(forge);

    const exec = entries.find(f => f.kind === 'file' && f.name === 'execution.json' && f.size <= EXEC_MAX_BYTES);
    const run = exec ? parseExecution(await read(join(forge, 'execution.json')), o.now) : null;
    if (run && isVisibleRun(run, o.now, 'owner')) {
      const at = Date.parse(lastMovedAt(run));
      if (run.hookSession === sid) hits.push({ kind: 'coordinator', scope: 'join', checkout: dir, project: run.project, at });
      else if (entries.some(f => f.kind === 'dir' && f.name === 'members')) {
        const members: MemberDoc[] = [];
        const dirMembers = join(forge, 'members');
        for (const f of newestMemberFiles((await list(dirMembers)).filter(e => e.kind === 'file'))) {
          try {
            const m = normalizeMember(JSON.parse((await read(join(dirMembers, f.name))) ?? ''));
            if (m) members.push(m);
          } catch { /* not a member document */ }
        }
        if (memberOfHook(members, sid, run.runId)) hits.push({ kind: 'member', scope: 'join', checkout: dir, project: run.project, at });
      }
    }

    // A binding of this conversation that has not ended, in a project that has a plan or a design here.
    for (const p of (await list(join(dir, '.waypoint'))).filter(d => d.kind === 'dir' && isSafeId(d.name)).sort(byName).slice(0, MAX_PROJECTS)) {
      const docs = join(dir, 'docs', 'waypoint', p.name);
      if ((await mtime($, join(docs, 'plan.yaml'))) === null && (await mtime($, join(docs, 'design.md'))) === null) continue;
      for (const s of seatsOf(await seatFiles($, join(dir, '.waypoint', p.name), o.now), o.now)) {
        if (s.bound?.claude !== sid || s.bound.endedAt !== null) continue;
        hits.push({ kind: 'binding', scope: 'join', checkout: dir, project: p.name, at: Date.parse(s.bound.seenAt) });
      }
    }

    if (o.kinds !== 'all') continue;
    const recent = (await list(join(forge, 'status')))
      .filter(f => f.kind === 'file' && f.name.endsWith('.json') && f.size <= STATUS_MAX_BYTES && o.now - f.mtimeMs <= STATUS_WINDOW_MS)
      .sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, STATUS_KEEP);
    for (const f of recent) {
      let st;
      try { st = normalizeStatus(JSON.parse((await read(join(forge, 'status', f.name))) ?? '')); } catch { continue; }
      if (!st || !isOwnStatus(st, sid, o.own?.tasks ?? [])) continue;
      const last = Date.parse(st.lastAt ?? '');
      hits.push({ kind: 'forge-task', scope: 'own', checkout: dir, project: null, at: Number.isFinite(last) ? last : f.mtimeMs });
    }
  }

  if (o.kinds === 'all') {
    for (const p of o.own?.paths ?? []) {
      // The checkout that holds the path, the deepest when the root holds the others.
      const dir = dirs.filter(d => under(p.path, d)).sort((a, b) => norm(b).length - norm(a).length)[0];
      if (!dir) continue;
      const rel = norm(p.path).slice(norm(dir).length + 1);
      const kind: AnchorKind | null = LEDGER.test(rel) ? 'sdd-ledger' : PLAN.test(rel) ? 'sp-plan' : null;
      if (kind) hits.push({ kind, scope: 'own', checkout: dir, project: null, at: p.at });
    }
  }
  return { anchor: chooseAnchor(hits), refused };
}
