// D9: forge's PreToolUse guard. Some records of forge stand for the person's own answer: the authorizations of
// .forge/execution/auth, the trust in the commands of .forge/config.yaml (<git common dir>/forge/trust.json) and the
// permissions and preferences of .forge/local.yaml. Only the person's answer records them (forge's hook takes it from
// AskUserQuestion, or FORGE local set after their yes), so these rules deny the model an Edit, Write or NotebookEdit of
// those files and a Bash or PowerShell call of forge's hook answer or local set commands.
// Its limit: it recognises patterns, it is no wall. An `echo >` or a script run through Bash still writes those files,
// and a quoted word (`hook "answer"`) or a node flag that takes a value gets a call past the shell rules.
// This module is the contract: pure (it reads and writes no file), run by FORGE hook guard. Plan 6b-1 adds its own rules
// to it, so GuardInput, GuardVerdict, GuardCtx, GuardRule, TRUST_RULES and evaluateGuard keep their names.
import path from 'node:path';
import { samePath } from '../lib/worktree.js';

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

/** The file a call names: file_path, else notebook_path, resolved against input.cwd ?? ctx.main. */
export function targetPath(input: GuardInput, ctx: GuardCtx): string | null {
  const { file_path: file, notebook_path: notebook } = input.tool_input;
  const p = typeof file === 'string' && file ? file : typeof notebook === 'string' && notebook ? notebook : null;
  return p === null ? null : path.resolve((input.cwd ?? ctx.main).replace(/\\/g, '/'), p.replace(/\\/g, '/'));
}

/** The command line of a SHELL_TOOLS call. */
export function shellCommand(input: GuardInput): string | null {
  const command = input.tool_input.command;
  return SHELL_TOOLS.includes(input.tool_name) && typeof command === 'string' ? command : null;
}

/** p is dir or under it, both normalized as samePath (`\` as `/`, resolved, without case on win32). */
export function isInside(p: string, dir: string): boolean {
  for (let q = path.resolve(p.replace(/\\/g, '/')); ; q = path.dirname(q)) {
    if (samePath(q, dir)) return true;
    if (path.dirname(q) === q) return false;
  }
}

// node or node.exe, its flags, the path of forge.cjs bare or quoted, and the arguments up to the end of that command.
const FORGE_CALL = /\bnode(?:\.exe)?\s+(?:-\S+\s+)*(?:"[^"\n]*forge\.cjs"|'[^'\n]*forge\.cjs'|[^\s"'`;|&<>]*forge\.cjs)(?=[\s"'`;|&<>]|$)([^\n;|&]*)/gi;

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

// File names compare as samePath compares paths: without case on win32.
const sameName = (a: string, b: string) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);

const fileRule = (id: string, reason: string, hits: (target: string, ctx: GuardCtx) => boolean): GuardRule => ({
  id,
  check(input, ctx) {
    if (!FILE_TOOLS.includes(input.tool_name)) return null;
    const target = targetPath(input, ctx);
    return target !== null && hits(target, ctx) ? { decision: 'deny', rule: id, reason } : null;
  },
});

const shellRule = (id: string, reason: string, args: RegExp): GuardRule => ({
  id,
  check(input) {
    const command = shellCommand(input);
    return command !== null && forgeCalls(command).some(a => args.test(a)) ? { decision: 'deny', rule: id, reason } : null;
  },
});

export const TRUST_RULES: readonly GuardRule[] = [
  fileRule('auth-records',
    "forge: .forge/execution/auth/ holds the person's authorizations. Only the person's answer to the question forge printed records one (forge's hook takes it from AskUserQuestion): do not write it.",
    (t, ctx) => isInside(t, path.join(ctx.main, '.forge', 'execution', 'auth'))),
  fileRule('trust-file',
    "forge: trust.json holds the person's trust in the commands of .forge/config.yaml. Only the person's answer to the question forge printed records it (forge's hook takes it from AskUserQuestion): do not write it.",
    (t, ctx) => ctx.gitCommonDir !== null && samePath(t, path.join(ctx.gitCommonDir, 'forge', 'trust.json'))),
  fileRule('local-yaml',
    "forge: .forge/local.yaml holds the person's permissions and preferences. Only the person's answer records them, through FORGE local set (a surface after their yes, workflow, autonomy): do not edit it.",
    t => sameName(path.basename(t), 'local.yaml') && sameName(path.basename(path.dirname(t)), '.forge')),
  shellRule('hook-answer',
    "forge: hook answer is forge's own hook, run by Claude Code after AskUserQuestion. Only the person's answer reaches it: do not run it.",
    /(?:^|\s)hook\s+answer(?:\s|$)/i),
  shellRule('local-set-commands',
    "forge: the trust in the commands of .forge/config.yaml is recorded only from the person's answer to the question forge printed (forge's hook takes it from AskUserQuestion): ask it and wait; do not run local set commands.",
    /(?:^|\s)local\s+set\s+commands(?:\s|$)/i),
];
