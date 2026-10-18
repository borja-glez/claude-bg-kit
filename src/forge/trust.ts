// I-03: forge runs the commands .forge/config.yaml defines (each validator's cmd and affected_cmd, and swarm.setup) only
// once the person trusts them on this machine, as a surface of verify: the trust is tied to a hash of those commands, so
// a new or changed command asks again, also in a branch or a task's worktree. The answer lives in .forge/local.yaml of
// the main checkout (`commands`), and every set of commands allowed stays allowed. The validators forge detects by itself
// and the install from a lockfile need no trust: they are what the person already runs by hand. A local.yaml that git
// tracks came with the repository, not from the person: its record is no answer. Like a surface's permission, a hand
// edit of local.yaml gets past it: it stops a command that changed unseen, not a deliberate forgery on this machine.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { loadConfig, type ForgeConfig } from './config.js';
import { mainCheckout, readLocal, updateLocal, type CommandsTrust, type LocalState } from './local.js';

export interface ConfigCommand { name: string; cmd: string }
export interface CommandChange { name: string; before: string | null; after: string | null }
export type TrustState = 'free' | 'allowed' | 'denied' | 'ask' | 'changed';
export interface Trust { state: TrustState; hash: string | null; commands: ConfigCommand[]; changed: CommandChange[] }
export interface TrustAsk { question: string; header: string; options: { label: string; description: string }[]; multiSelect: false }
export interface TrustOutput {
  state: 'ask' | 'changed'; hash: string; cwd: string; commands: ConfigCommand[]; changed?: CommandChange[]; ask: TrustAsk; note?: boolean;
}

/** The label of the yes of the trust question. */
export const TRUST_YES = { es: 'Sí, confío', en: 'Yes, I trust them' } as const;
const MAX_KEPT = 20;
const MAX_LINES = 12;
const MAX_SHOWN = 200;

let assumeTrusted = false;
/** Tests only (tests/setup/trust-commands.ts, a vitest setup file): every config command counts as trusted, so the suites
 *  that write a .forge/config.yaml with commands need no local.yaml. tests/forge-trust.test.ts turns it off. */
export function assumeTrustedForTests(on: boolean): void { assumeTrusted = on; }

export class UntrustedCommandsError extends Error {
  readonly state: 'ask' | 'changed';
  constructor(state: 'ask' | 'changed') {
    super(`forge: the commands of .forge/config.yaml are not trusted on this machine (${state}); run FORGE triage to ask`);
    this.state = state;
  }
}

const byName = (a: { name: string }, b: { name: string }) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
// CRLF as LF: a config saved on Windows hashes as the same one. A lone CR stays: it is no line break to a shell.
const lf = (s: string) => s.replace(/\r\n/g, '\n');

/** The commands of a config forge would run: validators.<v>.cmd, validators.<v>.affected_cmd and swarm.setup. */
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

function diff(before: ConfigCommand[], after: ConfigCommand[]): CommandChange[] {
  const names = [...new Set([...before.map(c => c.name), ...after.map(c => c.name)])].sort();
  const of = (l: ConfigCommand[], n: string) => l.find(c => c.name === n)?.cmd ?? null;
  return names.map(n => ({ name: n, before: of(before, n), after: of(after, n) })).filter(c => c.before !== c.after);
}

/** The person's trust in the commands of a config: free (none), allowed, denied, ask (never answered) or changed. */
export function trustOf(config: Pick<ForgeConfig, 'validators' | 'swarm'>, local: Pick<LocalState, 'commands'>): Trust {
  const commands = configCommands(config);
  if (!commands.length) return { state: 'free', hash: null, commands, changed: [] };
  const hash = commandsHash(commands);
  const rec = local.commands;
  let state: TrustState = !rec ? 'ask' : rec.allowed.includes(hash) ? 'allowed' : rec.state === 'denied' && rec.hash === hash ? 'denied' : 'changed';
  if (assumeTrusted && (state === 'ask' || state === 'changed')) state = 'allowed';
  return { state, hash, commands, changed: state === 'changed' && rec ? diff(rec.list, commands) : [] };
}

// What the person trusts is what they read: a line break separates two commands, and a character they cannot see (a C0
// or C1 control, a zero-width or bidi character, a tag character) can hide or reorder what a command does. Both are shown
// for what they are, never folded away. Built from code points, so this file holds no invisible character.
const cp = (n: number) => String.fromCodePoint(n);
const span = (a: number, b: number) => `${cp(a)}-${cp(b)}`;
const BREAK = new RegExp(`\\r\\n|[\\r\\n${cp(0x2028)}${cp(0x2029)}]`, 'g');
const HIDDEN = new RegExp(`[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f-\\x9f${cp(0xad)}${cp(0x61c)}${cp(0x180e)}${span(0x200b, 0x200f)}${span(0x202a, 0x202e)}`
  + `${span(0x2060, 0x206f)}${cp(0xfeff)}${span(0xfff9, 0xfffb)}${span(0xe0000, 0xe007f)}]`, 'gu');
const codeOf = (c: string) => `<U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}>`;

/** A command on one line of the question: its line breaks as ⏎, hidden characters as <U+XXXX>, cut at 200 (`cut`). */
function shown(cmd: string): { text: string; cut: boolean } {
  const one = Array.from(cmd.replace(BREAK, ' ⏎ ').replace(HIDDEN, codeOf).replace(/\s+/g, ' ').trim());
  return one.length > MAX_SHOWN ? { text: `${one.slice(0, MAX_SHOWN - 1).join('')}…`, cut: true } : { text: one.join(''), cut: false };
}

/** The question for the person: the commands (or what changed) and whether they trust them; the yes first. When the
 *  question cannot show every command whole, it says where to read them. */
export function trustAsk(t: Trust, es: boolean): TrustAsk {
  let cut = false;
  const show = (cmd: string | null) => { if (cmd === null) return '—'; const s = shown(cmd); cut ||= s.cut; return s.text; };
  const lines = t.state === 'changed' && t.changed.length
    ? t.changed.map(c => `${c.name}: ${show(c.before)} → ${show(c.after)}`)
    : t.commands.map(c => `${c.name}: ${show(c.cmd)}`);
  const head = t.state === 'changed'
    ? (es ? 'Han cambiado los comandos de .forge/config.yaml que forge ejecuta en esta máquina:' : 'The commands of .forge/config.yaml that forge runs on this machine changed:')
    : (es ? '.forge/config.yaml define comandos que forge ejecutará en esta máquina:' : '.forge/config.yaml defines commands forge will run on this machine:');
  const more = lines.length > MAX_LINES ? [es ? `(y ${lines.length - MAX_LINES} más)` : `(and ${lines.length - MAX_LINES} more)`] : [];
  const partial = cut || more.length
    ? [es ? 'Aquí no se ven enteros todos los comandos: léelos en .forge/config.yaml antes de responder.' : 'Not every command is shown whole here: read them in .forge/config.yaml before you answer.']
    : [];
  return {
    question: [head, ...lines.slice(0, MAX_LINES), ...more, ...partial, es ? '¿Confías en ellos?' : 'Do you trust them?'].join('\n'),
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
export const trustedConfig = (config: ForgeConfig, local: Pick<LocalState, 'commands'>): ForgeConfig => withTrust(config, trustOf(config, local));

/**
 * Whether git tracks the .forge/local.yaml forge reads for `dir` (in its main checkout), or .forge itself as a link or a
 * submodule: then it came with the repository, and a record in it is none of this machine's. False when git cannot say
 * (no repository, no git).
 */
export function localTracked(dir: string): boolean {
  let listed: string;
  try {
    listed = execFileSync('git', ['ls-files', '-z', '--', ':(top,icase).forge'], { cwd: mainCheckout(dir), encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  } catch { return false; }
  return listed.split('\0').some(p => ['.forge', '.forge/local.yaml'].includes(p.toLowerCase()));
}

/** The person's answer about the commands as forge counts it for `dir`: the record of .forge/local.yaml in its main
 *  checkout, unless git tracks that file (localTracked). */
export function commandsAnswer(dir: string): Pick<LocalState, 'commands'> {
  const { commands } = readLocal(dir);
  return commands && !localTracked(dir) ? { commands } : {};
}

/** The trust in a config of `dir`; the answer is read only when the config has commands. */
export const trustIn = (dir: string, config: ForgeConfig): Trust => trustOf(config, configCommands(config).length ? commandsAnswer(dir) : {});

/** loadConfig for a command that runs the config's commands: the config of `dir` as it may run (withTrust), and its state. */
export function loadTrusted(dir: string): { config: ForgeConfig; state: TrustState } {
  const config = loadConfig(dir);
  const t = trustIn(dir, config);
  return { config: withTrust(config, t), state: t.state };
}

/** loadConfig for a command that runs the config's commands: the config of `dir`, checked against local.yaml. */
export const loadTrustedConfig = (dir: string): ForgeConfig => loadTrusted(dir).config;

/** The first of `dirs` whose config has commands without the person's trust (a config that does not parse is skipped:
 *  nothing runs with it). `dirs` are a main checkout and worktrees of it, which share one answer (that of `dirs[0]`). */
export function untrustedFor(dirs: string[]): { dir: string; trust: Trust } | null {
  let answer: Pick<LocalState, 'commands'> | undefined;
  for (const dir of dirs) {
    let config: ForgeConfig;
    try { config = loadConfig(dir); } catch { continue; }
    if (!configCommands(config).length) continue;
    answer ??= commandsAnswer(dirs[0]);
    const t = trustOf(config, answer);
    if (t.state === 'ask' || t.state === 'changed') return { dir, trust: t };
  }
  return null;
}

/** True the first time forge asks about these commands (with nobody to answer: one question note per hash). */
export function noteOnce(root: string, hash: string): boolean {
  let first = false;
  updateLocal(root, s => {
    const asked = s.commandsAsked ?? [];
    if (asked.includes(hash)) return s;
    first = true;
    return { ...s, commandsAsked: [...asked, hash].slice(-MAX_KEPT) };
  });
  return first;
}

/** The local.yaml record of the person's answer; allowed adds the hash to every set allowed so far. */
export function recordTrust(prev: CommandsTrust | undefined, state: 'allowed' | 'denied', list: ConfigCommand[], hash: string, at: string): CommandsTrust {
  const allowed = (prev?.allowed ?? []).filter(h => h !== hash);
  return { state, hash, list, at, allowed: state === 'allowed' ? [...allowed, hash].slice(-MAX_KEPT) : allowed };
}
