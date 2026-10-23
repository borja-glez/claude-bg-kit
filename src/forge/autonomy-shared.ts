// Plan 6b-1, Tasks 4–6: the helpers the autonomy rules share. An autonomous run's guard reads a Bash or PowerShell
// command as its own shell reads it (Task 1), and judges every path it would write against the run's roots. Only inside
// the roots is allowed (confinedIn, B1: never isInside, which folds spellings toward «inside»); an unknown target is a
// deny. Pure: reads no file, starts no process. mcpWords lives here (Tasks 5 and 6 use it); the rules live in
// autonomy-rules.ts (self/files/install/git) and autonomy-net.ts (network/cloud/mcp-write), re-exported from the former.
import type { GuardCtx, GuardInput, GuardVerdict } from './guard.js';
import { confinedIn, shellCommand, SHELL_TOOLS } from './guard.js';
import { shellSegments, shellPath, type Dialect, type Segment, type Word } from './shell-words.js';

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

/** The absolute path a write target names, or null when it cannot be known (a variable, a `~`, an unknown cwd with a relative word, a spelling the shell hides). */
export function segmentPath(w: Word, seg: Segment, platform: NodeJS.Platform = process.platform): string | null {
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
