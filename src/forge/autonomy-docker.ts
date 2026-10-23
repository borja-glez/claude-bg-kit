// Plan 6b-1, Task 6 (fix 1): the database rule's reading of containers, volumes and compose projects. A container, volume,
// pod or compose project the run acts on must be one it registered (FORGE resource add); prune and podman's system reset
// always deny; `run|create` mounts (T6-DOCKER-MOUNTS) need a registered named volume, or a bind path inside the run's roots
// unless it is read-only, and `run|create`, `exec` and compose `run|exec` never hand the container the host (final fix I2,
// 6b-2 Task 0, T6-PRIVILEGED: --privileged, --device, a host namespace, a host-reaching --cap-add, an unconfined --security-opt).
// 6b-2 Task 0 also denies `context use|create|rm|update` (it switches the daemon the run talks to). The commands a container runs are not read here: autonomy-shared.ts's containerSegments hands them
// to the rules (T6-CONTAINER-INNER). Pure; it returns what it finds and autonomy-db.ts words the verdict.
import path from 'node:path';
import type { GuardCtx } from './guard.js';
import type { ResourceKind } from './resources.js';
import type { Segment, Word } from './shell-words.js';
import { insideRoots, resolvePwd, segmentPath } from './autonomy-shared.js';
import { COMPOSE_CLIS, COMPOSE_EXEC, COMPOSE_GLOBAL, COMPOSE_RUN, DOCKER_GLOBAL, DOCKER_RUN, head, scan, type OptTable, type Scan } from './autonomy-tables.js';
import { COMPOSE_DESTROYERS, DESTROY_WORDS, DOCKER_ALIAS, DOCKER_ALWAYS, DOCKER_DESTROYERS, DOCKER_SUB } from './autonomy-db-tables.js';

/** What the docker reading found: a deny (`unknown` for an unknown target) with its words, and a hint for the `instead` text. */
export type DockerFinding = { what: string; unknown: boolean; hint?: 'volumes' | 'host' };
const den = (what: string): DockerFinding => ({ what, unknown: false });
const unk = (what: string, hint?: DockerFinding['hint']): DockerFinding => ({ what, unknown: true, hint });
const lower = (w: Word | undefined): string => w?.text.toLowerCase() ?? '';

/** A container or volume name of the run: registered as that kind, or under a registered compose project (`<project>-…`, `<project>_…`). */
const dockerOwned = (name: string, kind: ResourceKind, ctx: GuardCtx): boolean => (ctx.autonomous?.resources ?? []).some(r =>
  (r.kind === kind && r.name === name) || (r.kind === 'compose' && (name === r.name || name.startsWith(`${r.name}-`) || name.startsWith(`${r.name}_`))));

function names(ws: Word[], kind: ResourceKind, label: string, ctx: GuardCtx): DockerFinding | null {
  for (const w of ws) {
    if (w.dynamic) return unk(`${label} acts on a ${kind} only the shell names`);
    if (!dockerOwned(w.text, kind, ctx)) return den(`${kind} ${w.text} is not one the run registered`);
  }
  return null;
}

// ---- mounts (T6-DOCKER-MOUNTS) -----------------------------------------------------------------------------------------

/** A mount source: a named volume must be registered; a bind path must be inside the roots unless read-only (the docker socket never is). */
function source(src: string, ro: boolean, seg: Segment, ctx: GuardCtx): DockerFinding | null {
  if (!/^(?:[\\/.~]|[A-Za-z]:)/.test(src) && !/[\\/]/.test(src)) return dockerOwned(src, 'volume', ctx) ? null : den(`volume ${src} is not one the run registered`);
  if (/(?:docker|podman)\.sock$|^\\\\[.?]\\pipe\\/i.test(src)) return unk(`a mount of ${src} hands the container the docker daemon`);
  if (ro) return null;
  const p = segmentPath({ text: src, dynamic: false, glob: false }, seg);
  if (p === null) return unk(`a bind mount of ${src}`);
  return insideRoots(p, ctx) ? null : den(`${p} is outside the run's roots`);
}
/** `-v src:dst[:opts]` (a drive letter allowed in src); a single part is an anonymous volume. `$PWD` is the segment's cwd (T6-PWD). */
function volume(word: Word, seg: Segment, ctx: GuardCtx): DockerFinding | null {
  const w = resolvePwd(word, seg);
  if (w.dynamic) return unk('a mount only the shell names');
  const m = /^((?:[A-Za-z]:)?[^:]*)(?::([^:]*))?(?::([^:]*))?$/.exec(w.text);
  if (!m) return unk(`the mount ${w.text}`);
  return m[2] === undefined ? null : source(m[1], (m[3] ?? '').split(',').includes('ro'), seg, ctx);
}
/** `--mount type=…,source=…,target=…[,readonly]`; tmpfs, image and anonymous volumes reach nothing of the host. */
function mount(word: Word, seg: Segment, ctx: GuardCtx): DockerFinding | null {
  const w = resolvePwd(word, seg);
  if (w.dynamic) return unk('a mount only the shell names');
  const kv = new Map<string, string>();
  for (const part of w.text.split(',')) { const e = part.indexOf('='); kv.set((e < 0 ? part : part.slice(0, e)).trim().toLowerCase(), e < 0 ? 'true' : part.slice(e + 1)); }
  const type = kv.get('type') ?? 'volume', src = kv.get('source') ?? kv.get('src');
  if (type === 'tmpfs' || type === 'image' || !src) return null;
  const ro = ['readonly', 'ro'].some(k => kv.has(k) && !/^(?:false|0)$/i.test(kv.get(k)!));
  return source(src, ro && type !== 'volume', seg, ctx);
}

// ---- host access (final fix I2, T6-PRIVILEGED) ---------------------------------------------------------------------------

// What hands a container this machine past its mounts: a device, the capabilities that reach the host, a host namespace,
// an unconfined security profile. `--network host` stays: the network rules judge what goes through it.
const HOST_CAPS = new Set(['all', 'sys_admin', 'sys_ptrace', 'sys_module', 'sys_rawio', 'dac_read_search']);
const HOST_NAMESPACES = new Set(['--pid', '--ipc', '--uts', '--userns', '--cgroupns']);
const UNCONFINED = new Set(['seccomp=unconfined', 'apparmor=unconfined', 'label=disable', 'systempaths=unconfined']);

/** The options before what a `run|create` (or compose `run`) starts, read with its table, or with docker run's in every word when that table does not know one. */
function runOptions(args: Word[], table: OptTable, seg: Segment): Scan {
  const h = head(args, table, seg.dialect);
  return h.unknown ? scan(args, DOCKER_RUN, seg.dialect) : h.sc;
}

/** An option that gives the container the host (a deny, not an unknown target); a value only the shell names of one that could is unknown. */
function hostAccess(sc: Scan): DockerFinding | null {
  const host = (what: string): DockerFinding => ({ what: `${what} hands the container this machine past its mounts`, unknown: false, hint: 'host' });
  if (sc.flags.has('--privileged')) return host('--privileged');
  for (const { key, w } of sc.vals) {
    const v = w.text.trim().toLowerCase();
    if (key === '--device') return host(`--device ${w.text}`);
    if (w.dynamic && (key === '--cap-add' || key === '--security-opt' || HOST_NAMESPACES.has(key))) return unk(`a ${key} value only the shell names`, 'host');
    if ((key === '--cap-add' && v.split(',').some(c => HOST_CAPS.has(c.trim().replace(/^cap_/, '')))) || (HOST_NAMESPACES.has(key) && v === 'host')
      || (key === '--security-opt' && UNCONFINED.has(v.replace(':', '=')))) return host(`${key} ${w.text}`);
  }
  return null;
}

function mounts(args: Word[], seg: Segment, ctx: GuardCtx): DockerFinding | null {
  // with an option the table does not know, the mount options are looked for in every later word
  const sc = runOptions(args, DOCKER_RUN, seg);
  const host = hostAccess(sc);
  if (host) return host;
  for (const v of sc.vals) {
    const r = v.key === '-v' || v.key === '--volume' ? volume(v.w, seg, ctx) : v.key === '--mount' ? mount(v.w, seg, ctx)
      : v.key === '--volumes-from' ? names([{ ...v.w, text: v.w.text.replace(/:(?:ro|rw)$/, '') }], 'container', 'run --volumes-from', ctx) : null;
    if (r) return r;
  }
  return null;
}

// ---- compose ----------------------------------------------------------------------------------------------------------

function compose(args: Word[], seg: Segment, ctx: GuardCtx): DockerFinding | null {
  const h = head(args, COMPOSE_GLOBAL, seg.dialect), sub = lower(args[h.at]), rest = args.slice(h.at + 1);
  if (h.unknown) return args.some(w => COMPOSE_DESTROYERS.has(lower(w)) || lower(w) === 'up') ? unk('compose has an option the hook does not know') : null;
  // I2 and 6b-2 Task 0: run and exec never hand the container the host (--privileged and the like)
  if (sub === 'run' || sub === 'exec') { const host = hostAccess(runOptions(rest, sub === 'run' ? COMPOSE_RUN : COMPOSE_EXEC, seg)); if (host) return host; }
  // I3: `up -V` renews the project's anonymous volumes
  const renew = sub === 'up' && rest.some(w => w.text === '--renew-anon-volumes' || /^-[A-Za-z]*V[A-Za-z]*$/.test(w.text));
  if (!COMPOSE_DESTROYERS.has(sub) && !renew) return null;
  // T6-COMPOSE-VOLUMES: the compose file (which the hook does not read) may name a fixed volume the person's checkout shares
  if (sub === 'down' && rest.some(w => w.text === '-v' || /^--volumes(?:=(?!false$).*)?$/.test(w.text))) {
    return unk('compose down -v removes every volume the compose file names, and the hook does not read that file', 'volumes');
  }
  const flag = (...keys: string[]): Word[] => h.sc.vals.filter(v => keys.includes(v.key)).map(v => v.w);
  let projects = flag('-p', '--project-name');
  if (!projects.length && seg.env.COMPOSE_PROJECT_NAME) projects = [seg.env.COMPOSE_PROJECT_NAME];
  if (!projects.length) {
    // the folder names the project, unless a compose file, a project folder or an env file elsewhere does
    if (flag('-f', '--file', '--project-directory', '--env-file').length || seg.cwd === null) return unk(`compose ${sub} acts on a project the hook cannot name`);
    projects = [{ text: path.basename(seg.cwd).toLowerCase().replace(/[^a-z0-9_-]/g, '').replace(/^[-_]+/, ''), dynamic: false, glob: false }];
  }
  for (const p of projects) {
    if (p.dynamic) return unk(`compose ${sub} acts on a project only the shell names`);
    if (!(ctx.autonomous?.resources ?? []).some(r => r.kind === 'compose' && r.name === p.text)) return den(`compose project ${p.text} is not one the run registered`);
  }
  return null;
}

// ---- docker / podman / nerdctl ----------------------------------------------------------------------------------------

/** What a docker, podman, nerdctl or compose call does to containers, volumes, pods and projects; null when nothing of the person's is touched. */
export function dockerFinding(name: string, args: Word[], seg: Segment, ctx: GuardCtx): DockerFinding | null {
  if (COMPOSE_CLIS.has(name)) return compose(args, seg, ctx);
  const g = head(args, DOCKER_GLOBAL, seg.dialect), rest0 = args.slice(g.at);
  // an option the global table does not know hides which word is the subcommand
  if (g.unknown) return rest0.some(w => DESTROY_WORDS.has(lower(w))) ? unk(`${name} has a global option the hook does not know`) : null;
  let w0 = lower(rest0[0]), w1 = lower(rest0[1]), from = 1;
  if (w0 === 'compose') return compose(rest0.slice(1), seg, ctx);
  // 6b-2 Task 0: switching or editing the docker context changes which daemon the run talks to (context ls/inspect/show read)
  if (w0 === 'context' && ['use', 'create', 'rm', 'update'].includes(w1)) return den(`docker context ${w1} changes the daemon the run talks to`);
  if (w0 === 'container' && ['run', 'create', 'cp'].includes(w1)) { w0 = w1; w1 = lower(rest0[2]); from = 2; }
  const two = `${w0} ${w1}`;
  if (DOCKER_ALWAYS.has(two)) return den(`${name} ${two} deletes containers or volumes the run did not register`);
  if (w0 === 'run' || w0 === 'create') return mounts(rest0.slice(from), seg, ctx);
  if (w0 === 'cp') {
    // m7: a copy into a container (`<container>:<path>` last) needs that container registered
    const sc = scan(rest0.slice(from), DOCKER_SUB.get('cp')!, seg.dialect), dest = sc.ops[sc.ops.length - 1];
    if (sc.unknown) return unk(`${name} cp has an option the hook does not know`);
    if (!dest) return null;
    if (dest.dynamic) return unk(`${name} cp copies to a place only the shell names`);
    const c = /^([^:/\\]{2,}):/.exec(dest.text);
    return c ? names([{ ...dest, text: c[1] }], 'container', `${name} cp`, ctx) : null;
  }
  const key = DOCKER_DESTROYERS.includes(two) ? two : DOCKER_ALIAS.get(two) ?? (DOCKER_DESTROYERS.includes(w0) ? w0 : null);
  if (key === null) return null;
  const rest = rest0.slice(key === w0 ? 1 : 2), kind: ResourceKind = key === 'volume rm' ? 'volume' : 'container';
  const table = DOCKER_SUB.get(key === 'container rm' ? 'rm' : key)!;
  let ws: Word[];
  if (key === 'exec') {
    const h = head(rest, table, seg.dialect);
    if (h.unknown) return unk(`${name} exec has an option the hook does not know`);
    const host = hostAccess(h.sc); // 6b-2 Task 0: exec --privileged hands the container the host, like run --privileged
    if (host) return host;
    ws = rest.slice(h.at, h.at + 1);
  } else {
    const sc = scan(rest, table, seg.dialect);
    if (sc.unknown) return unk(`${name} ${key} has an option the hook does not know`);
    ws = sc.ops;
  }
  return names(ws, kind, `${name} ${key}`, ctx);
}
