// Plan 6b-1, Tasks 4–6: the helpers the autonomy rules share. An autonomous run's guard reads a Bash or PowerShell
// command as its own shell reads it (Task 1), and judges every path it would write against the run's roots. Only inside
// the roots is allowed (confinedIn, B1: never isInside, which folds spellings toward «inside»); an unknown target is a
// deny. Pure: reads no file, starts no process. mcpWords lives here (Tasks 5 and 6 use it); the rules live in
// autonomy-rules.ts (self/files/install/git) and autonomy-net.ts (network/cloud/mcp-write), re-exported from the former.
import type { GuardCtx, GuardInput, GuardVerdict } from './guard.js';
import { confinedIn, shellCommand, SHELL_TOOLS } from './guard.js';
import { commandName, shellSegments, shellPath, type Dialect, type Segment, type Word } from './shell-words.js';
import { COMPOSE_CLIS, COMPOSE_EXEC, COMPOSE_GLOBAL, COMPOSE_RUN, CONTAINER_CLIS, DOCKER_CP, DOCKER_EXEC, DOCKER_GLOBAL, DOCKER_RUN, head, scan,
  type OptTable, type OptValue } from './autonomy-tables.js';

/** The dialect a shell call is read in: input.dialect when a caller set it, else bash for Bash and powershell for PowerShell. */
const dialectOf = (input: GuardInput): Dialect => input.dialect ?? (input.tool_name === 'PowerShell' ? 'powershell' : 'bash');

// The segments of each shell command, kept per input so the eight rules split a command once (never spread a lazy ctx).
const SEGMENTS = new WeakMap<GuardInput, Segment[] | null>();

/** The simple commands of a SHELL_TOOLS call in its dialect, run in input.cwd or the run's worktree; null when not a shell call. */
export function bashSegments(input: GuardInput, ctx: GuardCtx): Segment[] | null {
  if (SEGMENTS.has(input)) return SEGMENTS.get(input) ?? null;
  const command = SHELL_TOOLS.includes(input.tool_name) ? shellCommand(input) : null;
  const cwd = input.cwd ?? ctx.autonomous?.worktree ?? '';
  const segs = command === null ? null : shellSegments(command, cwd, dialectOf(input));
  SEGMENTS.set(input, segs);
  return segs;
}

/** The folder a glob is judged by: the part before its first wildcard; null when a `..` segment follows the wildcard (which match it climbs out of cannot be known). */
function globFolder(text: string, dialect: Dialect): string | null {
  const wc = text.search(/[*?[{]/);
  if (wc < 0) return text;
  const sep = dialect === 'bash' ? /\// : /[\\/]/;
  if (text.slice(wc).split(sep).some(s => s === '..')) return null;
  const head = text.slice(0, wc);
  for (let k = head.length - 1; k >= 0; k--) if (head[k] === '/' || (dialect !== 'bash' && head[k] === '\\')) return head.slice(0, k + 1);
  return '.';
}

/** Whether a path resolves without a cwd: a root-anchored one in its dialect and platform (bash MSYS `/x/`, `/tmp`, a drive, or POSIX `/…`). */
function absoluteish(text: string, dialect: Dialect, platform: NodeJS.Platform): boolean {
  const win = platform === 'win32';
  if (dialect === 'bash') {
    if (!win) return text.startsWith('/');
    return /^\/(?:cygdrive\/)?[A-Za-z](?:\/|$)/.test(text) || text === '/tmp' || text.startsWith('/tmp/') || /^[A-Za-z]:[\\/]/.test(text);
  }
  const t = text.replace(/\\/g, '/');
  return win ? /^[A-Za-z]:\//.test(t) : t.startsWith('/');
}

/**
 * T6-PWD: a word whose only part the shell holds is the segment's cwd (`$PWD`, `${PWD}`, `$(pwd)`, `` `pwd` ``; in
 * PowerShell `$PWD`, `${PWD}`, `$pwd`, `(Get-Location)`) is that literal path; any other word stays as it is. No other
 * variable is resolved, and a word that keeps a `$`, a backquote (or, in PowerShell, a parenthesis) stays only the shell's.
 */
export function resolvePwd(w: Word, seg: Segment): Word {
  if (!w.dynamic || seg.cwd === null || seg.dialect === 'cmd') return w;
  const ps = seg.dialect === 'powershell', cwd = ps ? seg.cwd : seg.cwd.split('\\').join('/');
  const re = ps ? /\$\{PWD\}|\$PWD\b|\$?\(Get-Location\)/gi : /\$\{PWD\}|\$PWD(?![A-Za-z0-9_])|\$\(pwd\)|`pwd`/g;
  const text = w.text.replace(re, () => cwd);
  return text === w.text || (ps ? /[$`()]/ : /[$`]/).test(text) ? w : { text, dynamic: false, glob: w.glob };
}

/** The absolute path a write target names, or null when it cannot be known (a variable, a `~`, an unknown cwd with a relative word, a spelling the shell hides). */
export function segmentPath(word: Word, seg: Segment, platform: NodeJS.Platform = process.platform): string | null {
  const w = resolvePwd(word, seg);
  if (w.dynamic) return null;
  const text = w.glob ? globFolder(w.text, seg.dialect) : w.text;
  if (text === null) return null;
  // Null cwd: only a root-anchored path is known; a relative word (any `..` included) is unknown.
  if (seg.cwd === null) return absoluteish(text, seg.dialect, platform) ? shellPath(text, platform === 'win32' ? 'Z:\\' : '/', seg.dialect, platform) : null;
  return shellPath(text, seg.cwd, seg.dialect, platform);
}

/** p is inside one of the run's roots, compared strictly (confinedIn, B1): never isInside, which would fold a spelling toward inside. */
export function insideRoots(p: string, ctx: GuardCtx): boolean {
  return (ctx.autonomous?.roots ?? []).some(r => confinedIn(p, r));
}

/** A deny verdict with the reason the rules share: `forge autonomy · <rule>: <what>. Instead: <instead>`. */
export function deny(rule: string, what: string, instead: string): GuardVerdict {
  return { decision: 'deny', rule, reason: `forge autonomy · ${rule}: ${what}. Instead: ${instead}` };
}

/**
 * The words of an MCP tool name (Tasks 5 and 6): the part after the last `__` (Claude Code names a tool
 * `mcp__<server>__<tool>`), split on `_`, `-` and an internal uppercase boundary, lower-cased —
 * `mcp__github__createIssue` → `['create', 'issue']`, `mcp__plugin_x_y__send-message` → `['send', 'message']`.
 */
export function mcpWords(toolName: string): string[] {
  const i = toolName.lastIndexOf('__');
  const tail = i >= 0 ? toolName.slice(i + 2) : toolName;
  return tail
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .split(/[_-]+/)
    .filter(Boolean)
    .map(s => s.toLowerCase());
}

// ---- the commands a container runs (Task 6, T6-CONTAINER-INNER) -----------------------------------------------------

// Segments whose environment holds values the hook cannot read: an env file (docker --env-file, dotenv, env-cmd, pipenv).
const ENV_UNKNOWN = new WeakSet<Segment>();
export const markEnvUnknown = (seg: Segment): Segment => { ENV_UNKNOWN.add(seg); return seg; };
export const envUnknown = (seg: Segment): boolean => ENV_UNKNOWN.has(seg);

const SHELL_NAMES = new Set(['sh', 'bash', 'ash', 'dash', 'zsh', 'ksh']);

/** The segments of words a container runs: one segment, or the lines of `sh -c '<script>'`; their cwd is the container's (unknown). */
function nested(words: Word[], env: Record<string, Word>, envUnk: boolean, outer: Segment): Segment[] {
  if (!words.length) return [];
  let segs: Segment[] = [{ argv: words, env, redirects: [], cwd: null, after: null, dialect: 'bash', dynamicArgs: outer.dynamicArgs }];
  if (!words[0].dynamic && SHELL_NAMES.has(commandName(words[0]))) {
    const c = words.findIndex((w, i) => i > 0 && /^-[A-Za-z]*c[A-Za-z]*$/.test(w.text));
    const script = c > 0 ? words[c + 1] : undefined;
    if (script && !script.dynamic) {
      segs = shellSegments(script.text, '/', 'bash').map(s => ({ ...s, cwd: null, env: { ...env, ...s.env }, dynamicArgs: s.dynamicArgs || outer.dynamicArgs }));
    }
  }
  return envUnk ? segs.map(markEnvUnknown) : segs;
}

/** Every later word read as where the command may start, when an option the hook does not know hides it. */
const everyStart = (words: Word[], outer: Segment): Segment[] => words.flatMap((_, i) => nested(words.slice(i), {}, true, outer));

/**
 * A container CLI call that runs something in a container: the words of its command (`inner`), the option values before
 * it (mounts, `-w`, `--tmpfs`, `-e`, `--cidfile`…), its `-e` environment; `unknown` when an option the hook does not know
 * hides where the command starts (`inner` is then every word).
 */
interface ContainerCall { inner: Word[]; opts: OptValue[]; env: Record<string, Word>; envUnk: boolean; unknown: boolean }
const unknownCall = (args: Word[]): ContainerCall => ({ inner: args, opts: [], env: {}, envUnk: true, unknown: true });

/** The command after the operand a container option table ends at (the image, the container, the service), with its `-e` environment. */
function after(args: Word[], table: OptTable, outer: Segment): ContainerCall {
  const h = head(args, table, outer.dialect);
  if (h.unknown) return unknownCall(args);
  const env: Record<string, Word> = {};
  for (const v of h.sc.vals.filter(x => x.key === '-e' || x.key === '--env')) {
    const m = /^([A-Za-z_]\w*)(=?)([\s\S]*)$/.exec(v.w.text);
    if (!m) continue;
    // `-e NAME` takes the host's value: one the hook cannot read
    Object.defineProperty(env, m[1], { value: m[2] ? { ...v.w, text: m[3] } : { text: '', dynamic: true, glob: false }, enumerable: true, writable: true, configurable: true });
  }
  const entry = h.sc.vals.filter(v => v.key === '--entrypoint').map(v => v.w).slice(-1);
  return { inner: [...entry, ...args.slice(h.at + 1)], opts: h.sc.vals, env, envUnk: h.sc.flags.has('--env-file'), unknown: false };
}

/**
 * The `[container] <sub>` a docker, podman or nerdctl call runs, after its global options; compose's `<sub>` after
 * compose's. `globals`: the values of those global options (compose's -f/--env-file and the like). Null when no container CLI.
 */
function containerSub(seg: Segment): { compose: boolean; sub: string; args: Word[]; globals: OptValue[] } | 'unknown' | null {
  if (!seg.argv.length || seg.argv[0].dynamic) return null;
  const name = commandName(seg.argv[0]), d = seg.dialect;
  let args = seg.argv.slice(1), compose = COMPOSE_CLIS.has(name);
  const globals: OptValue[] = [];
  if (!compose) {
    if (!CONTAINER_CLIS.has(name)) return null;
    const g = head(args, DOCKER_GLOBAL, d);
    if (g.unknown) return 'unknown';
    globals.push(...g.sc.vals);
    args = args.slice(g.at);
    if (args[0]?.text.toLowerCase() === 'container') args = args.slice(1);
    if (args[0]?.text.toLowerCase() !== 'compose') return { compose: false, sub: args[0]?.text.toLowerCase() ?? '', args: args.slice(1), globals };
    args = args.slice(1);
    compose = true;
  }
  const g = head(args, COMPOSE_GLOBAL, d);
  globals.push(...g.sc.vals);
  return g.unknown ? 'unknown' : { compose, sub: args[g.at]?.text.toLowerCase() ?? '', args: args.slice(g.at + 1), globals };
}

function containerCall(seg: Segment): ContainerCall | null {
  const c = containerSub(seg);
  if (c === null) return null;
  if (c === 'unknown') return unknownCall(seg.argv.slice(1));
  if (c.compose) return c.sub === 'run' ? after(c.args, COMPOSE_RUN, seg) : c.sub === 'exec' ? after(c.args, COMPOSE_EXEC, seg) : null;
  return c.sub === 'run' || c.sub === 'create' ? after(c.args, DOCKER_RUN, seg) : c.sub === 'exec' ? after(c.args, DOCKER_EXEC, seg) : null;
}

/**
 * T6-CONTAINER-INNER: the commands a container runs, as segments the database, network and cloud rules judge: the words
 * after the image of `docker|podman|nerdctl run|create` (behind `--entrypoint` when given), after the container of `exec`,
 * and after the service of `compose run|exec`. When an option the hook does not know hides where they start, every later
 * word is read as a start. The files rule never judges them: their paths are the container's (containerFiles).
 */
export function containerSegments(seg: Segment): Segment[] {
  const c = containerCall(seg);
  return !c ? [] : c.unknown ? everyStart(c.inner, seg) : nested(c.inner, c.env, c.envUnk, seg);
}

/** The host side of a mount option: `src` of `-v src:dst[:opts]` (a drive letter kept), `source=`/`src=` of `--mount`; null for an anonymous volume. */
function mountSource(v: OptValue): Word | null {
  const m = v.key === '--mount' ? /(?:^|,)\s*(?:source|src)=([^,]*)/i.exec(v.w.text) : v.key === '-v' || v.key === '--volume' ? /^((?:[A-Za-z]:)?[^:]*):/.exec(v.w.text) : null;
  return m && m[1] ? { ...v.w, text: m[1] } : null;
}

/**
 * T6-CONTAINER-FILES and N2: what the files rule reads of a container CLI call. `skip`: the words it leaves alone (the
 * command a container runs; every option value of `run|create|exec` and of compose's `run|exec`, since a mount source is
 * T6-DOCKER-MOUNTS' and `-w`, `--tmpfs`, `--name`, `-e` are no host paths, while `--env-file`/`--label-file` are reads; the
 * global options' values, compose's -f/--env-file being reads; for `cp`, every operand but a host destination, a host
 * source being only read). `writes`: the host files the call writes (`--cidfile`, in any spelling). `mounts`: the host
 * sources of its mounts (final fix I1: the self rule judges them, so a mount of the settings folder is denied). Null when
 * the call cannot be read, so the files rule judges every word.
 */
export function containerFiles(seg: Segment): { skip: Set<Word>; writes: Word[]; mounts: Word[] } | null {
  const c = containerSub(seg);
  if (c === null || c === 'unknown') return null;
  const skip = new Set<Word>(c.globals.map(v => v.w));
  if (!c.compose && c.sub === 'cp') {
    const sc = scan(c.args, DOCKER_CP, seg.dialect), dest = sc.ops[sc.ops.length - 1];
    if (sc.unknown) return null;
    // `<container>:<path>` (two letters or more: one is a drive) is the container's side
    for (const w of sc.ops) if (w !== dest || /^[^:/\\]{2,}:/.test(w.text)) skip.add(w);
    return { skip, writes: [], mounts: [] };
  }
  const call = containerCall(seg);
  if (!call) return c.compose ? { skip, writes: [], mounts: [] } : null;
  if (call.unknown) return null;
  const writes: Word[] = [], mounts: Word[] = [];
  for (const w of call.inner) skip.add(w);
  for (const v of call.opts) {
    if (v.key === '--cidfile') writes.push(v.w); else skip.add(v.w);
    const src = mountSource(v);
    if (src) mounts.push(src);
  }
  return { skip, writes, mounts };
}

/** A segment and the commands its containers run, nested up to three deep (`docker exec c docker run …`). */
export function withContainers(seg: Segment, depth = 0): Segment[] {
  return [seg, ...(depth < 3 ? containerSegments(seg).flatMap(s => withContainers(s, depth + 1)) : [])];
}
