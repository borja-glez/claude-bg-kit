// I-03: forge runs the commands .forge/config.yaml defines (each validator's cmd and affected_cmd, and swarm.setup) only
// once the person trusts them on this machine, as a surface of verify: the trust is tied to a hash of those commands, so
// a new or changed command asks again, also in a branch or a task's worktree. Every set of commands allowed stays allowed.
// The validators forge detects by itself and the install from a lockfile need no trust: they are what the person already
// runs by hand.
// The answer lives in the repository's git directory (<git common dir>/forge/trust.json), outside every working tree: no
// checkout, clone or archive of the repository writes it, so a repository cannot ship its own answer, and the worktrees of
// a clone share it. Outside a git repository forge keeps no answer and asks every time. A hand edit of that file (or the
// model answering for the person) still gets past it: it stops a command that changed unseen, not a forgery on this machine.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { samePath } from '../lib/worktree.js';
import { loadConfig, type ForgeConfig } from './config.js';
import { gitEnv, gitFailure } from './local.js';

export interface ConfigCommand { name: string; cmd: string }
export interface CommandChange { name: string; before: string | null; after: string | null }
export type TrustState = 'free' | 'allowed' | 'denied' | 'ask' | 'changed';
export interface Trust { state: TrustState; hash: string | null; commands: ConfigCommand[]; changed: CommandChange[] }
export interface TrustAsk { question: string; header: string; options: { label: string; description: string }[]; multiSelect: false }
export interface TrustOutput {
  state: 'ask' | 'changed'; hash: string; cwd: string; commands: ConfigCommand[]; changed?: CommandChange[]; ask: TrustAsk; note?: boolean;
}
/** The person's last answer with its hash and its commands (to show what changed next time), and every set allowed so far. */
export interface CommandsTrust { state: 'allowed' | 'denied'; hash: string; list: ConfigCommand[]; at: string; allowed: string[] }
/** trust.json: the answer, and the hashes already asked about (one question note per hash). */
export interface TrustRecord { commands?: CommandsTrust; commandsAsked?: string[] }

/** The label of the yes of the trust question. */
export const TRUST_YES = { es: 'Sí, confío', en: 'Yes, I trust them' } as const;
/** The last line of the trust question: hook answer looks for the question only in an AskUserQuestion that asks it. */
export const TRUST_QUESTION_END = { es: '¿Confías en ellos?', en: 'Do you trust them?' } as const;
const MAX_KEPT = 20;
const MAX_LINES = 12;
const MAX_SHOWN = 200;
const HASH = /^[0-9a-f]{64}$/;

let assumeTrusted = false;
/** Tests only (tests/setup/trust-commands.ts, a vitest setup file): every config command counts as trusted, so the suites
 *  that write a .forge/config.yaml with commands need no answer. tests/forge-trust.test.ts turns it off. */
export function assumeTrustedForTests(on: boolean): void { assumeTrusted = on; }

export class UntrustedCommandsError extends Error {
  readonly state: 'ask' | 'changed';
  constructor(state: 'ask' | 'changed') {
    super(`forge: the commands of .forge/config.yaml are not trusted on this machine (${state}); run FORGE triage to ask`);
    this.state = state;
  }
}

const byName = (a: { name: string }, b: { name: string }) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
// CRLF as LF (parseConfig folds it in what runs too). A lone CR stays: it is no line break to a shell.
const lf = (s: string) => s.replace(/\r\n/g, '\n');

/** The commands of a config forge would run: validators.<v>.cmd, validators.<v>.affected_cmd and swarm.setup. Every entry
 *  counts: parseConfig refuses two validators of one name, and the sort is stable (one name twice keeps file order). */
export function configCommands(config: Pick<ForgeConfig, 'validators' | 'swarm'>): ConfigCommand[] {
  const out: ConfigCommand[] = [];
  for (const v of [...(config.validators ?? [])].sort(byName)) {
    out.push({ name: `validators.${v.name}.cmd`, cmd: lf(v.cmd) });
    if (v.affected_cmd) out.push({ name: `validators.${v.name}.affected_cmd`, cmd: lf(v.affected_cmd) });
  }
  if (config.swarm.setup) out.push({ name: 'swarm.setup', cmd: lf(config.swarm.setup) });
  return out;
}

/** sha256 of the list [[name, command]…]: affects, when or kind never change it; a command does. */
export const commandsHash = (list: ConfigCommand[]): string =>
  createHash('sha256').update(JSON.stringify(list.map(c => [c.name, c.cmd]))).digest('hex');

const uniqueNames = (l: ConfigCommand[]) => new Set(l.map(c => c.name)).size === l.length;

/** What changed from a list the person allowed; none when a name repeats in either list (no pair can be trusted). */
function diff(before: ConfigCommand[], after: ConfigCommand[]): CommandChange[] {
  if (!uniqueNames(before) || !uniqueNames(after)) return [];
  const names = [...new Set([...before.map(c => c.name), ...after.map(c => c.name)])].sort();
  const of = (l: ConfigCommand[], n: string) => l.find(c => c.name === n)?.cmd ?? null;
  return names.map(n => ({ name: n, before: of(before, n), after: of(after, n) })).filter(c => c.before !== c.after);
}

/**
 * The person's trust in the commands of a config: free (none), allowed, denied, ask (never answered) or changed. A hash
 * the last answer denied is never allowed, whatever `allowed` holds. `changed` lists what changed only from a set the
 * person allowed: after a No there is nothing to compare with, and the question lists every command.
 */
export function trustOf(config: Pick<ForgeConfig, 'validators' | 'swarm'>, record: Pick<TrustRecord, 'commands'>): Trust {
  const commands = configCommands(config);
  if (!commands.length) return { state: 'free', hash: null, commands, changed: [] };
  const hash = commandsHash(commands);
  const rec = record.commands;
  let state: TrustState = !rec ? 'ask' : rec.state === 'denied' && rec.hash === hash ? 'denied' : rec.allowed.includes(hash) ? 'allowed' : 'changed';
  if (assumeTrusted && (state === 'ask' || state === 'changed')) state = 'allowed';
  return { state, hash, commands, changed: state === 'changed' && rec?.state === 'allowed' ? diff(rec.list, commands) : [] };
}

// What the person trusts is what they read. A command shows every character outside printable ASCII as <U+XXXX> (a
// control, a zero-width or bidi character, a look-alike letter, a space a shell does not split on), and a line break,
// which separates two commands, as ⏎; only runs of plain spaces fold.
const codeOf = (c: string) => `<U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}>`;

/** A command on one line of the question, cut at 200 characters (`cut`). */
function shown(cmd: string): { text: string; cut: boolean } {
  const text = Array.from(cmd, c => (c === '\n' ? ' ⏎ ' : c >= ' ' && c <= '~' ? c : codeOf(c))).join('').replace(/ +/g, ' ').trim();
  const one = Array.from(text);
  return one.length > MAX_SHOWN ? { text: `${one.slice(0, MAX_SHOWN - 1).join('')}…`, cut: true } : { text, cut: false };
}

/** The question for the person: every command of the set they are asked to trust, what changed since the set they last
 *  allowed first (before → after); and whether they trust them, the yes first. When the question cannot show every
 *  command whole, it says where to read them. Its line before the last shows the set's whole hash: two sets that read
 *  the same up to a cut never ask the same question, so an answer is to the set that was shown (answerTrust). */
export function trustAsk(t: Trust, es: boolean): TrustAsk {
  let cut = false;
  const show = (cmd: string | null) => { if (cmd === null) return '—'; const s = shown(cmd); cut ||= s.cut; return s.text; };
  const moved = new Set(t.changed.map(c => c.name));
  const lines = [
    ...t.changed.map(c => `${c.name}: ${show(c.before)} → ${show(c.after)}`),
    ...t.commands.filter(c => !moved.has(c.name)).map(c => `${c.name}: ${show(c.cmd)}`),
  ];
  const head = t.state === 'changed'
    ? (es ? 'Han cambiado los comandos de .forge/config.yaml que forge ejecuta en esta máquina:' : 'The commands of .forge/config.yaml that forge runs on this machine changed:')
    : (es ? '.forge/config.yaml define comandos que forge ejecutará en esta máquina:' : '.forge/config.yaml defines commands forge will run on this machine:');
  const more = lines.length > MAX_LINES ? [es ? `(y ${lines.length - MAX_LINES} más)` : `(and ${lines.length - MAX_LINES} more)`] : [];
  const partial = cut || more.length
    ? [es ? 'Aquí no se ven enteros todos los comandos: léelos en .forge/config.yaml antes de responder.' : 'Not every command is shown whole here: read them in .forge/config.yaml before you answer.']
    : [];
  const hash = t.hash ? [`${es ? 'Hash de estos comandos' : 'Hash of these commands'}: ${t.hash}`] : [];
  return {
    question: [head, ...lines.slice(0, MAX_LINES), ...more, ...partial, ...hash, TRUST_QUESTION_END[es ? 'es' : 'en']].join('\n'),
    header: es ? 'Comandos' : 'Commands',
    options: es
      ? [{ label: TRUST_YES.es, description: 'forge los ejecuta mientras no cambien' }, { label: 'No', description: 'forge solo ejecuta los validadores que detecta por su cuenta' }]
      : [{ label: TRUST_YES.en, description: 'forge runs them while they stay the same' }, { label: 'No', description: 'forge runs only the validators it detects by itself' }],
    multiSelect: false,
  };
}

/** What triage, swarm start and swarm tick print as `trust` when the commands of `cwd`'s config are not trusted. */
export function trustOutput(t: Trust, es: boolean, cwd: string, note?: boolean): TrustOutput {
  return {
    state: t.state === 'changed' ? 'changed' : 'ask', hash: t.hash ?? '', cwd, commands: t.commands, ...(t.changed.length ? { changed: t.changed } : {}),
    ask: trustAsk(t, es), ...(note === undefined ? {} : { note }),
  };
}

/** A config whose commands may run, by its trust: as it is when trusted (or without commands), without them when denied;
 *  else it throws. */
function withTrust(config: ForgeConfig, t: Trust): ForgeConfig {
  if (t.state === 'ask' || t.state === 'changed') throw new UntrustedCommandsError(t.state);
  if (t.state !== 'denied') return config;
  const { validators: _dropped, ...rest } = config;
  const { setup: _setup, ...swarm } = config.swarm;
  return { ...rest, swarm };
}

/** A config whose commands may run: as it is when trusted (or without commands), without them when denied; else it throws. */
export const trustedConfig = (config: ForgeConfig, record: Pick<TrustRecord, 'commands'>): ForgeConfig => withTrust(config, trustOf(config, record));

/** Where the answer for `dir` is kept, or why nothing is: `no-repo` when git says `dir` is in no repository, `git-failed`
 *  when git could not tell (it refused to run there, timed out, or is missing). */
export type TrustPlace = { file: string } | { file: null; why: 'no-repo' | 'git-failed' };

/**
 * The file that keeps the answer for the repository `dir` is in: <git common dir>/forge/trust.json, one for the main
 * checkout and its worktrees. Git keeps its own directory out of every checkout (also through the aliases of `.git`), so
 * no clone or pull writes it. None outside a git repository, or when git cannot say (then nothing is kept), and why.
 * git speaks English here (LC_ALL=C), so its «not a git repository» can be told from a refusal.
 */
export function trustPlace(dir: string): TrustPlace {
  let common: string;
  try {
    common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: dir, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: gitEnv(),
    }).trim();
  } catch (e) {
    return { file: null, why: gitFailure(e) };
  }
  return common ? { file: path.join(path.resolve(dir, common), 'forge', 'trust.json') } : { file: null, why: 'git-failed' };
}

/** trustPlace's file: null outside a git repository or when git cannot say. */
export const trustFile = (dir: string): string | null => trustPlace(dir).file;

/** A commands record as written; anything malformed counts as no answer (forge asks again). A denied hash is never in
 *  `allowed`; an allowed one always is. */
function commandsTrustOf(x: unknown): CommandsTrust | undefined {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const o = x as Record<string, unknown>;
  if ((o.state !== 'allowed' && o.state !== 'denied') || typeof o.hash !== 'string' || !HASH.test(o.hash)) return undefined;
  const list = (Array.isArray(o.list) ? o.list : [])
    .filter((c): c is ConfigCommand => !!c && typeof c === 'object' && typeof (c as { name?: unknown }).name === 'string' && typeof (c as { cmd?: unknown }).cmd === 'string')
    .slice(0, 100).map(c => ({ name: c.name.slice(0, 200), cmd: c.cmd.slice(0, 4000) }));
  const allowed = [...new Set((Array.isArray(o.allowed) ? o.allowed : []).filter((h): h is string => typeof h === 'string' && HASH.test(h) && (o.state === 'allowed' || h !== o.hash)))];
  if (o.state === 'allowed' && !allowed.includes(o.hash)) allowed.push(o.hash);
  return { state: o.state, hash: o.hash, list, at: typeof o.at === 'string' ? o.at : '', allowed: allowed.slice(-MAX_KEPT) };
}

function readAt(file: string | null): TrustRecord {
  if (!file) return {};
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch { return {}; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const commands = commandsTrustOf(o.commands);
  const asked = Array.isArray(o.commandsAsked) ? o.commandsAsked.filter((h): h is string => typeof h === 'string' && HASH.test(h)).slice(-MAX_KEPT) : [];
  return { ...(commands ? { commands } : {}), ...(asked.length ? { commandsAsked: asked } : {}) };
}

/** The answer kept for the repository `dir` is in (trustFile); nothing outside a git repository. */
export const readTrust = (dir: string): TrustRecord => readAt(trustFile(dir));

/** Changes the record of the repository `dir` is in, written atomically; outside a git repository, or when git cannot
 *  say where it is, nothing is kept and it says why. */
export function updateTrust(dir: string, fn: (r: TrustRecord) => TrustRecord): { ok: true } | { ok: false; why: 'no-repo' | 'git-failed' } {
  const place = trustPlace(dir);
  if (place.file === null) return { ok: false, why: place.why };
  const file = place.file;
  const next = fn(readAt(file));
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(tmp, file);
  return { ok: true };
}

/** The trust in a config of `dir`; the answer is read only when the config has commands. */
export const trustIn = (dir: string, config: ForgeConfig): Trust => trustOf(config, configCommands(config).length ? readTrust(dir) : {});

/** loadConfig for a command that runs the config's commands: the config of `dir` as it may run (withTrust), and its state. */
export function loadTrusted(dir: string): { config: ForgeConfig; state: TrustState } {
  const config = loadConfig(dir);
  const t = trustIn(dir, config);
  return { config: withTrust(config, t), state: t.state };
}

/** loadConfig for a command that runs the config's commands: the config of `dir`, checked against the answer. */
export const loadTrustedConfig = (dir: string): ForgeConfig => loadTrusted(dir).config;

/** The first of `dirs` whose config has commands without the person's trust (a config that does not parse is skipped:
 *  nothing runs with it). `dirs` are a main checkout and worktrees of it, which share one answer (that of `dirs[0]`). */
export function untrustedFor(dirs: string[]): { dir: string; trust: Trust } | null {
  let record: TrustRecord | undefined;
  for (const dir of dirs) {
    let config: ForgeConfig;
    try { config = loadConfig(dir); } catch { continue; }
    if (!configCommands(config).length) continue;
    record ??= readTrust(dirs[0]);
    const t = trustOf(config, record);
    if (t.state === 'ask' || t.state === 'changed') return { dir, trust: t };
  }
  return null;
}

/** True the first time forge asks about these commands (with nobody to answer: one question note per hash); always true
 *  outside a git repository, where nothing is kept. */
export function noteOnce(dir: string, hash: string): boolean {
  let first = true;
  updateTrust(dir, r => {
    const asked = r.commandsAsked ?? [];
    if (asked.includes(hash)) { first = false; return r; }
    return { ...r, commandsAsked: [...asked, hash].slice(-MAX_KEPT) };
  });
  return first;
}

/** The record of the person's answer; allowed adds the hash to every set allowed so far, denied takes it out. */
export function recordTrust(prev: CommandsTrust | undefined, state: 'allowed' | 'denied', list: ConfigCommand[], hash: string, at: string): CommandsTrust {
  const allowed = (prev?.allowed ?? []).filter(h => h !== hash);
  return { state, hash, list, at, allowed: state === 'allowed' ? [...allowed, hash].slice(-MAX_KEPT) : allowed };
}

/** A question of an AskUserQuestion call as its tool_input carries it (answerTrust compares it whole with forge's). */
export interface AskedQuestion { question: string; header?: unknown; options?: unknown; multiSelect?: unknown }

/** `q` asks `ask` as forge printed it (L3): the same header, single choice, and the same options in order, each a label
 *  and a description and nothing more (no `preview` beside them). */
function asPrinted(q: AskedQuestion, ask: TrustAsk): boolean {
  const options = q.options;
  return q.header === ask.header && (q.multiSelect ?? false) === ask.multiSelect && Array.isArray(options) && options.length === ask.options.length
    && ask.options.every((want, i) => {
      const o: unknown = options[i];
      return !!o && typeof o === 'object' && Object.keys(o).length === 2
        && (o as { label?: unknown }).label === want.label && (o as { description?: unknown }).description === want.description;
    });
}

/** The checkouts one answer may record: all of them when they share one hash, none when they do not (8-FIX2). The
 *  person cannot tell apart two sets whose questions read the same, so neither is recorded; the person's own `!` line,
 *  with the whole hash after --expect, then records the set they answered. */
export function oneHashOnly<M extends { hash: string }>(matches: readonly M[]): readonly M[] {
  return new Set(matches.map(m => m.hash)).size > 1 ? [] : matches;
}

/**
 * D9: the person's answer to the trust question, from an AskUserQuestion (forge's hook answer). For each checkout of
 * `dirs` whose commands are not trusted (`ask` or `changed`), the question forge prints now, in either locale, which
 * shows the whole hash of those commands (Q1, P1): when it was asked, and every question of the call with its text
 * asks it as forge printed it (asPrinted), its yes with no note of theirs allows those commands and «No» denies them;
 * any other answer records nothing. Every checkout is matched before anything is written, and the answer records only
 * when all of them have one hash (oneHashOnly). It writes once per trust file: a worktree of a clone already written
 * adds nothing, and another clone with the same commands records them in its own (P2). Returns what it recorded.
 */
export function answerTrust(dirs: readonly string[], asked: readonly AskedQuestion[],
  submitted: { answers: ReadonlyMap<string, string>; notes: ReadonlyMap<string, string> }, at: string): { dir: string; hash: string; state: 'allowed' | 'denied' }[] {
  const matches: { dir: string; hash: string; state: 'allowed' | 'denied'; commands: ConfigCommand[] }[] = [];
  for (const dir of dirs) {
    let config: ForgeConfig;
    // fail-open: a config that does not parse runs nothing, so nothing of it is trusted.
    try { config = loadConfig(dir); } catch { continue; }
    const t = trustIn(dir, config);
    const hash = t.hash;
    if ((t.state !== 'ask' && t.state !== 'changed') || !hash) continue;
    for (const es of [true, false]) {
      const ask = trustAsk(t, es);
      const same = asked.filter(q => q.question === ask.question);
      if (!same.length) continue;
      if (!same.every(q => asPrinted(q, ask))) break;
      const a = submitted.answers.get(ask.question);
      const state = a === TRUST_YES[es ? 'es' : 'en'] && !submitted.notes.has(ask.question) ? 'allowed' : a === 'No' ? 'denied' : null;
      if (state) matches.push({ dir, hash, state, commands: t.commands });
      break;
    }
  }
  const recorded: { dir: string; hash: string; state: 'allowed' | 'denied' }[] = [];
  const written: string[] = [];
  for (const { dir, hash, state, commands } of oneHashOnly(matches)) {
    const file = trustFile(dir);
    if (!file || written.some(f => samePath(f, file))) continue;
    if (updateTrust(dir, r => ({ ...r, commands: recordTrust(r.commands, state, commands, hash, at) })).ok) {
      written.push(file);
      recorded.push({ dir, hash, state });
    }
  }
  return recorded;
}
