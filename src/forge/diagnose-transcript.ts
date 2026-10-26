// A6: the facts forge diagnose takes from one transcript: its calls to forge and to Agent, their results, the compactions and the usage once per message.
import { isSafeId } from '../lib/execution-state.js';
import { forgeCalls } from './guard.js';
import { scanLines, type ScanOpts, type ScanStats } from './transcript-file.js';

export interface ForgeInvocation { name: string; task: string | null; out: string | null; args: string }
export interface AgentDispatch { type: string; description: string; task: string | null; project: string | null }
export interface TCall { line: number; ts: string; id: string; tool: string; forge: ForgeInvocation[]; agent: AgentDispatch | null; background: boolean }
export interface TResult { line: number; ts: string; exit: number | null; error: boolean; launched: boolean; agentId: string | null }
export interface TCompaction { line: number; ts: string; trigger: string | null; preTokens: number | null }
export interface Tokens { input: number; output: number; cacheRead: number; cacheWrite: number; cacheWrite1h: number }
/** One message.id: `line` and `ts` of its last line, `lines` how many lines repeated its usage. `model` (when the line
 *  names one) and `cacheWrite5m` (the part of cacheWrite written to the 5-minute cache, when there is one) price it (FX2). */
export interface TMessage { id: string; line: number; lines: number; ts: string; tokens: Tokens; model?: string; cacheWrite5m?: number }
export interface TranscriptFacts {
  file: string; stats: ScanStats; calls: TCall[]; results: Map<string, TResult>; compactions: TCompaction[];
  messages: TMessage[]; usageLines: number; lastTs: string | null;
}

export const ZERO_TOKENS: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 };

export function addTokens(a: Tokens, b: Tokens): Tokens {
  return {
    input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite, cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
  };
}

// The dispatchers of forge (the DISPATCH of the skill contract test, plus hook and swarm): their second word is part of the name.
const DISPATCHERS = new Set(['authorize', 'blocked', 'config', 'decision', 'hook', 'infinite', 'local', 'market', 'proposals', 'resource', 'route', 'shadow', 'sp-plan', 'surfaces', 'swarm', 'tree']);
// The swarm subcommands that take the task id as their first argument.
const SWARM_TASK_SUBS = new Set(['worktree', 'task', 'relaunch', 'nudge', 'integrate', 'retry', 'report']);
const ARGS_MAX = 200;
const DESCRIPTION_MAX = 120;

const ALIAS_ASSIGN = /(?:^|[\s;&|(])([A-Za-z_][A-Za-z0-9_]*)=(["']?)node(?:\.exe)?\s[^\n;&|]*?forge\.cjs\2(?=[\s;&|]|$)/g;

function wordsOf(args: string): string[] {
  return (args.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(w => (w.length >= 2 && (w[0] === '"' || w[0] === "'") && w.endsWith(w[0]) ? w.slice(1, -1) : w));
}

function invocation(args: string): ForgeInvocation | null {
  let words = wordsOf(args);
  while (words[0] === '--cwd') words = words.slice(2);
  const first = words[0];
  if (first === undefined || !/^[a-z][a-z0-9-]*$/.test(first)) return null;
  const second = words[1];
  const sub = DISPATCHERS.has(first) && second !== undefined && /^[a-z][a-z-]*$/.test(second) ? second : null;
  // A flag's value is the next word, unless that word is another flag.
  const valueOf = (flag: string): string | null => {
    const i = words.indexOf(flag);
    return i >= 0 && i + 1 < words.length && !words[i + 1].startsWith('-') ? words[i + 1] : null;
  };
  let task = valueOf('--task');
  if (task === null && first === 'swarm' && sub !== null && SWARM_TASK_SUBS.has(sub)) {
    const next = words[2];
    if (next !== undefined && !next.startsWith('-')) task = next;
  }
  return {
    name: sub === null ? first : `${first} ${sub}`,
    task: isSafeId(task) ? task : null,
    out: valueOf('--out'),
    args: args.trim().slice(0, ARGS_MAX),
  };
}

/** Each call of forge.cjs in a Bash or PowerShell command, in the order the command runs them. */
export function forgeInvocations(command: string): ForgeInvocation[] {
  const found: { at: number; args: string }[] = [];
  let from = 0;
  for (const args of forgeCalls(command)) {
    const at = command.indexOf(args, from);
    found.push({ at: at < 0 ? from : at, args });
    if (at >= 0) from = at + args.length;
  }
  // Each alias once, however many times the command assigns it.
  for (const name of new Set(Array.from(command.matchAll(ALIAS_ASSIGN), m => m[1]))) {
    const use = new RegExp(`\\$(?:${name}|\\{${name}\\})(?=[\\s;|&]|$)([^\\n;|&]*)`, 'g');
    for (const u of command.matchAll(use)) found.push({ at: u.index ?? 0, args: u[1].trim() });
  }
  found.sort((a, b) => a.at - b.at);
  const out: ForgeInvocation[] = [];
  for (const f of found) {
    const inv = invocation(f.args);
    if (inv) out.push(inv);
  }
  return out;
}

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0);

function tokensOf(usage: Rec): Tokens {
  const created = isRec(usage.cache_creation) ? usage.cache_creation : {};
  return {
    input: num(usage.input_tokens), output: num(usage.output_tokens), cacheRead: num(usage.cache_read_input_tokens),
    cacheWrite: num(usage.cache_creation_input_tokens), cacheWrite1h: num(created.ephemeral_1h_input_tokens),
  };
}

function firstText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    for (const c of content) if (isRec(c) && typeof c.text === 'string') return c.text;
  }
  return '';
}

function dispatchOf(input: Rec): AgentDispatch {
  const prompt = typeof input.prompt === 'string' ? input.prompt : '';
  const m = /^forge-task: (\S+)(?: @(\S+))?\s*$/.exec(prompt.split('\n')[0]);
  return {
    type: String(input.subagent_type ?? ''),
    description: String(input.description ?? '').slice(0, DESCRIPTION_MAX),
    task: m && isSafeId(m[1]) ? m[1] : null,
    project: m && isSafeId(m[2]) ? m[2] : null,
  };
}

/** The facts of one transcript; null when measureJsonl refuses the file. */
export function readTranscript(file: string, opts: ScanOpts = {}): TranscriptFacts | null {
  const calls: TCall[] = [];
  const results = new Map<string, TResult>();
  const compactions: TCompaction[] = [];
  const messages = new Map<string, TMessage>();
  let usageLines = 0;
  let lastTs: string | null = null;

  const stats = scanLines(file, (text, n) => {
    if (!text.includes('"tool_use"') && !text.includes('"tool_result"') && !text.includes('compact_boundary') && !text.includes('"usage"')) return;
    let rec: unknown;
    try { rec = JSON.parse(text); } catch { return; }
    if (!isRec(rec)) return;
    const ts = typeof rec.timestamp === 'string' ? rec.timestamp : '';
    if (ts) lastTs = ts;
    const message = isRec(rec.message) ? rec.message : null;

    if (rec.type === 'assistant' && message) {
      for (const block of Array.isArray(message.content) ? message.content : []) {
        if (!isRec(block) || block.type !== 'tool_use') continue;
        const tool = String(block.name ?? '');
        const input = isRec(block.input) ? block.input : {};
        calls.push({
          line: n, ts, id: String(block.id ?? ''), tool,
          forge: tool === 'Bash' || tool === 'PowerShell' ? forgeInvocations(String(input.command ?? '')) : [],
          agent: tool === 'Agent' || tool === 'Task' ? dispatchOf(input) : null,
          background: input.run_in_background === true,
        });
      }
      if (isRec(message.usage)) {
        usageLines++;
        const id = typeof message.id === 'string' && message.id ? message.id : `line:${n}`;
        const before = messages.get(id);
        const created = isRec(message.usage.cache_creation) ? message.usage.cache_creation : {};
        const w5 = num(created.ephemeral_5m_input_tokens);
        messages.set(id, { id, line: n, lines: (before?.lines ?? 0) + 1, ts, tokens: tokensOf(message.usage),
          ...(typeof message.model === 'string' && message.model ? { model: message.model } : {}), ...(w5 > 0 ? { cacheWrite5m: w5 } : {}) });
      }
    } else if (rec.type === 'user' && message) {
      const extra = isRec(rec.toolUseResult) ? rec.toolUseResult : {};
      for (const block of Array.isArray(message.content) ? message.content : []) {
        if (!isRec(block) || block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue;
        const error = block.is_error === true;
        const launched = !error && (typeof extra.backgroundTaskId === 'string' || extra.status === 'async_launched');
        const code = error ? /^Exit code (\d+)/.exec(firstText(block.content)) : null;
        results.set(block.tool_use_id, {
          line: n, ts, error, launched,
          exit: error ? (code ? Number(code[1]) : null) : launched ? null : 0,
          agentId: isSafeId(extra.agentId) ? extra.agentId : null,
        });
      }
    } else if (rec.type === 'system' && rec.subtype === 'compact_boundary') {
      const meta = isRec(rec.compactMetadata) ? rec.compactMetadata : {};
      compactions.push({
        line: n, ts, trigger: typeof meta.trigger === 'string' ? meta.trigger : null,
        preTokens: typeof meta.preTokens === 'number' ? meta.preTokens : null,
      });
    }
  }, opts);
  if (!stats) return null;
  return { file, stats, calls, results, compactions, messages: [...messages.values()], usageLines, lastTs };
}
