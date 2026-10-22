// D9: forge's PreToolUse guard. Some records of forge stand for the person's own answer: the authorizations of
// .forge/execution/auth, the trust in the commands of .forge/config.yaml (<git common dir>/forge/trust.json) and the
// permissions and preferences of .forge/local.yaml. Only the person's answer records them (forge's hook takes it from
// AskUserQuestion, or FORGE local set after their yes), so these rules deny the model an Edit, Write or NotebookEdit of
// those files and a Bash or PowerShell call of forge's hook answer or local set commands.
// Its limit: it recognises patterns, it is no wall. An `echo >` or a script run through Bash still writes those files,
// a quoted word (`hook "answer"`) or a node flag that takes a value gets a call past the shell rules, and a path spelled
// through what only the disk knows (an 8.3 short name, a link or a junction) gets past the file rules.
// This module is the contract: pure (it reads and writes no file), run by FORGE hook guard. Plan 6b-1 adds its own rules
// to it, so GuardInput, GuardVerdict, GuardCtx, GuardRule, TRUST_RULES and evaluateGuard keep their names.
import path from 'node:path';

/** The fields of Claude Code's PreToolUse input the guard reads. */
export interface GuardInput { tool_name: string; tool_input: Record<string, unknown>; session_id?: string; cwd?: string }
export type GuardVerdict = { decision: 'allow' } | { decision: 'deny'; rule: string; reason: string };
/** Where the rules look: the main checkout, the git common dir (null outside git) and the autonomous run (null in 6a). */
export interface GuardCtx { main: string; gitCommonDir: string | null; autonomous: null | { runId: string; worktree: string } }
/** A rule: null when it does not apply to the call. */
export interface GuardRule { id: string; check(input: GuardInput, ctx: GuardCtx): GuardVerdict | null }

export const FILE_TOOLS: readonly string[] = ['Edit', 'Write', 'NotebookEdit'];
export const SHELL_TOOLS: readonly string[] = ['Bash', 'PowerShell'];

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** The input of the hook, keeping only the four fields; null without a string tool_name and an object tool_input. */
export function parseGuardInput(x: unknown): GuardInput | null {
  if (!isRecord(x) || typeof x.tool_name !== 'string' || !isRecord(x.tool_input)) return null;
  return {
    tool_name: x.tool_name, tool_input: x.tool_input,
    ...(typeof x.session_id === 'string' ? { session_id: x.session_id } : {}), ...(typeof x.cwd === 'string' ? { cwd: x.cwd } : {}),
  };
}

/** Every file a call names, resolved against input.cwd ?? ctx.main: the tool's own field first (notebook_path for
 *  NotebookEdit, file_path for the others), then the other one when present. */
export function targetPaths(input: GuardInput, ctx: GuardCtx): string[] {
  const fields = input.tool_name === 'NotebookEdit' ? ['notebook_path', 'file_path'] : ['file_path', 'notebook_path'];
  const base = (input.cwd ?? ctx.main).replace(/\\/g, '/');
  return fields.map(f => input.tool_input[f]).filter((p): p is string => typeof p === 'string' && p !== '')
    .map(p => path.resolve(base, p.replace(/\\/g, '/')));
}

/** The file a call names: its tool's own field (notebook_path for NotebookEdit, file_path for the others), else the other. */
export function targetPath(input: GuardInput, ctx: GuardCtx): string | null {
  return targetPaths(input, ctx)[0] ?? null;
}

/** The command line of a SHELL_TOOLS call. */
export function shellCommand(input: GuardInput): string | null {
  const command = input.tool_input.command;
  return SHELL_TOOLS.includes(input.tool_name) && typeof command === 'string' ? command : null;
}

/**
 * A path as the guard compares it, samePath's rules (`\` as `/`, resolved, without case on win32) plus the other spellings
 * of the same file: on win32 a `\\?\` or `\\.\` prefix, an NTFS stream (`::$DATA`, `:name`) and the trailing dots and
 * spaces Windows drops from a name; and without case on macOS too, whose file system ignores it by default.
 * `platform` is for tests.
 */
export function guardPath(p: string, platform: NodeJS.Platform = process.platform): string {
  let s = p.replace(/\\/g, '/');
  if (platform === 'win32') {
    s = s.replace(/^\/\/[?.]\/UNC\//i, '//').replace(/^\/\/[?.]\//, '');
    const drive = /^[A-Za-z]:/.exec(s)?.[0] ?? '';
    s = drive + s.slice(drive.length).split('/')
      .map(name => (name === '.' || name === '..' ? name : name.replace(/:.*$/, '').replace(/[. ]+$/, ''))).join('/');
  }
  const resolved = path.resolve(s);
  return platform === 'win32' || platform === 'darwin' ? resolved.toLowerCase() : resolved;
}

/** p is dir or under it, both read as guardPath reads them. */
export function isInside(p: string, dir: string): boolean {
  const at = guardPath(dir);
  for (let q = guardPath(p); ; q = path.dirname(q)) {
    if (q === at) return true;
    if (path.dirname(q) === q) return false;
  }
}

/** p is dir or under it, for a rule that allows only inside: unlike isInside (which folds spellings toward «same file», right to deny) it never folds toward inside. */
export function confinedIn(p: string, dir: string, platform: NodeJS.Platform = process.platform): boolean {
  const win = platform === 'win32';
  const api = win ? path.win32 : path.posix;
  let s = p;
  if (win) {
    s = s.replace(/\//g, '\\');
    if (/^\\\\[?.]\\/.test(s)) return false;
    if (/:/.test(s.replace(/^[A-Za-z]:/, ''))) return false;
    if (s.split('\\').some(name => name !== '.' && name !== '..' && /[. ]$/.test(name))) return false;
  } else if (s.includes('\\')) return false;
  if (!api.isAbsolute(s)) return false;
  const fold = (x: string) => (win ? x.toLowerCase() : x);
  const rel = api.relative(fold(api.resolve(dir)), fold(api.resolve(s)));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${api.sep}`) && !api.isAbsolute(rel));
}

// node or node.exe, its flags, the path of forge.cjs bare or quoted, and the arguments up to the end of that command.
const FORGE_CALL = /\bnode(?:\.exe)?["']?\s+(?:-\S+\s+)*(?:"[^"\n]*forge\.cjs"|'[^'\n]*forge\.cjs'|[^\s"'`;|&<>]*forge\.cjs)(?=[\s"'`;|&<>]|$)([^\n;|&]*)/gi;

/** The arguments of each `node … forge.cjs` call of a command line, trimmed. */
export function forgeCalls(command: string): string[] {
  return [...command.matchAll(FORGE_CALL)].map(m => m[1].trim());
}

/** Claude Code's PreToolUse deny, with its newline; nothing on allow. */
export function guardOutput(v: GuardVerdict): string {
  if (v.decision === 'allow') return '';
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: v.reason } }) + '\n';
}

/** The first rule that denies wins; a rule's allow stops nothing; with no deny, the call goes through. */
export function evaluateGuard(input: GuardInput, ctx: GuardCtx, rules: readonly GuardRule[]): GuardVerdict {
  for (const rule of rules) {
    const v = rule.check(input, ctx);
    if (v?.decision === 'deny') return v;
  }
  return { decision: 'allow' };
}

// The names (as guardPath spells them) a protected file's path holds: each file rule checks them before it reads ctx,
// whose fields may ask git (H4), so a call on any other file costs no git process.
const AUTH_DIR = ['.forge', 'execution', 'auth'];
const holds = (g: string, names: readonly string[]): boolean => {
  const parts = g.split(/[\\/]/);
  return parts.some((_, i) => names.every((n, j) => parts[i + j] === n));
};
const isTrustFile = (g: string): boolean => path.basename(g) === 'trust.json' && path.basename(path.dirname(g)) === 'forge';

// Denies when any file the call names is protected, so a harmless path in one field hides none in the other.
const fileRule = (id: string, reason: string, hits: (target: string, ctx: GuardCtx) => boolean): GuardRule => ({
  id,
  check(input, ctx) {
    if (!FILE_TOOLS.includes(input.tool_name)) return null;
    return targetPaths(input, ctx).some(t => hits(t, ctx)) ? { decision: 'deny', rule: id, reason } : null;
  },
});

// forge's parser takes `--cwd <dir>` out wherever it sits before it reads the command's words (runCommand), so do the rules.
const CWD_FLAG = /(?:^|\s)--cwd\s+(?:"[^"]*"|'[^']*'|\S+)/gi;

const shellRule = (id: string, reason: string, args: RegExp): GuardRule => ({
  id,
  check(input) {
    const command = shellCommand(input);
    return command !== null && forgeCalls(command).some(a => args.test(a.replace(CWD_FLAG, ' '))) ? { decision: 'deny', rule: id, reason } : null;
  },
});

export const TRUST_RULES: readonly GuardRule[] = [
  fileRule('auth-records',
    "forge: .forge/execution/auth/ holds the person's authorizations. Only the person's answer to the question forge printed records one (forge's hook takes it from AskUserQuestion): do not write it.",
    (t, ctx) => holds(guardPath(t), AUTH_DIR) && isInside(t, path.join(ctx.main, ...AUTH_DIR))),
  fileRule('trust-file',
    "forge: trust.json holds the person's trust in the commands of .forge/config.yaml. Only the person's answer to the question forge printed records it (forge's hook takes it from AskUserQuestion): do not write it.",
    (t, ctx) => {
      const g = guardPath(t);
      return isTrustFile(g) && ctx.gitCommonDir !== null && g === guardPath(path.join(ctx.gitCommonDir, 'forge', 'trust.json'));
    }),
  fileRule('local-yaml',
    "forge: .forge/local.yaml holds the person's permissions and preferences. Only the person's answer records them, through FORGE local set (a surface after their yes, workflow, autonomy): do not edit it.",
    t => { const g = guardPath(t); return path.basename(g) === 'local.yaml' && path.basename(path.dirname(g)) === '.forge'; }),
  // The last word ends at a space, a redirection, a parenthesis or a backquote, but not at `"`: words inside a quoted
  // text (`git commit -m "… hook answer"`) are no call.
  shellRule('hook-answer',
    "forge: hook answer is forge's own hook, run by Claude Code after AskUserQuestion. Only the person's answer reaches it: do not run it.",
    /(?:^|\s)hook\s+answer(?=[\s<>()`]|$)/i),
  shellRule('local-set-commands',
    "forge: the trust in the commands of .forge/config.yaml is recorded only from the person's answer to the question forge printed (forge's hook takes it from AskUserQuestion): ask it and wait; do not run local set commands.",
    /(?:^|\s)local\s+set\s+commands(?=[\s<>()`]|$)/i),
];
