// Plan 6b-1, Tasks 4–6: the helpers the autonomy rules share. An autonomous run's guard reads a Bash or PowerShell
// command as its own shell reads it (Task 1), and judges every path it would write against the run's roots. Only inside
// the roots is allowed (confinedIn, B1: never isInside, which folds spellings toward «inside»); an unknown target is a
// deny. Pure: reads no file, starts no process. Tasks 5 and 6 add mcpWords here; the rules live in autonomy-rules.ts.
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
  const cwd = input.cwd ?? ctx.autonomous?.worktree ?? ctx.main;
  const segs = command === null ? null : shellSegments(command, cwd, dialectOf(input));
  SEGMENTS.set(input, segs);
  return segs;
}

/** The folder before the first wildcard of a glob, so a pattern is judged by where it would match (`../../*.log` → `../../`). */
function globFolder(text: string, dialect: Dialect): string {
  const wc = text.search(/[*?[{]/);
  const head = wc < 0 ? text : text.slice(0, wc);
  for (let k = head.length - 1; k >= 0; k--) {
    if (head[k] === '/' || (dialect !== 'bash' && head[k] === '\\')) return head.slice(0, k + 1);
  }
  return '.';
}

// A cwd that cannot be known is resolved only for an already-absolute path; a relative one keeps this marker, so it reads as unknown.
const NOCWD = (platform: NodeJS.Platform): string => (platform === 'win32' ? 'Z:\\__forge_nocwd__' : '/__forge_nocwd__');

/** The absolute path a write target names, or null when it cannot be known (a variable, a `~`, an unknown cwd, a spelling the shell hides). */
export function segmentPath(w: Word, seg: Segment, platform: NodeJS.Platform = process.platform): string | null {
  if (w.dynamic) return null;
  const text = w.glob ? globFolder(w.text, seg.dialect) : w.text;
  if (seg.cwd === null) {
    const marker = NOCWD(platform);
    const r = shellPath(text, marker, seg.dialect, platform);
    return r !== null && !r.startsWith(marker) ? r : null;
  }
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
