import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeUnits, fenced, units, walk } from './helpers/files.js';
import { SUBCOMMANDS } from '../src/forge/cli/swarm.js';

const repo = fileURLToPath(new URL('..', import.meta.url));
const sources = (dir: string) => walk(path.join(repo, dir)).filter(f => /\.tsx?$/.test(f)).map(f => readFileSync(f, 'utf8')).join('\n');

type Cli = 'forge' | 'waypoint';
interface Keys { exact: Set<string>; prefixes: Set<string> }
interface Vocab { commands: Set<string>; subs: Map<string, Set<string>>; keys: Map<string, Keys>; flags: Set<string> }
// How the CLIs read a flag: flag('x'), has('x') and the like (READERS), or `--x` itself given to the arguments' own
// includes() or indexOf(), or compared with an argument (`arg !== '--ruling'`: ARGV). A `--x`
// that only an error, a usage text or the arguments of a git call name is read by nothing, so it is no flag. The flags
// are one pool per CLI, not a table per command: a flag of one command cited on another passes.
const READERS = [
  'flag', 'has', 'subFlag', 'lastOf', 'opt', 'num',
  'need', // waypoint heartbeat --register: need('name'), need('agent'), need('branch'), need('worktree'), need('track')
  'posInt', // waypoint: posInt('session-version') in heartbeat and release, posInt('state-version') in release --free
  'idsArg', // forge review-close: idsArg('out-of-model'), idsArg('defer')
];
const ARGV = /(?:\b(?:includes|indexOf)\(\s*|[!=]==\s*)['"`]--([a-z][a-z0-9-]*)['"`]/g;
// Flags a CLI reads in a way those two patterns do not see (a loop over names), each with the source text that reads it
// (a test checks it is still there).
const INDIRECT: Record<Cli, [flag: string, site: string][]> = {
  forge: [],
  waypoint: [
    ['version', "for (const name of ['round', 'version']"], // critique-check: flag(name) for each
    ['state-version', "taskFlags('claim', ['state-version', 'session-version'])"], // claim, done and block: posInt(name) for each
    ['resolved', "for (const name of ['applied', 'resolved']"], // design-snapshot: the value of --applied and --resolved
    ['messages', "docs('messages', normalizeMessage)"], // inbox and escalations: --messages through docs()
  ],
};
// Each command that dispatches on a subcommand, and where the code does it: its file and the two markers around the
// dispatcher (in its module of src/forge/cli/commands/, from its `export const command` to the end of the file: its
// helpers sit above it), whose `case 'x':` labels and `sub === 'x'` or `args[0] !== 'x'` tests are the subcommands.
// forge swarm's are the names of its SUBCOMMANDS (I-12). No waypoint command takes one (its `hook` is cited by no skill).
const DISPATCH: Record<Cli, Record<string, [file: string, from: string, to: string]>> = {
  forge: {
    authorize: ['src/forge/cli/commands/authorize.ts', 'export const command', ''],
    proposals: ['src/forge/cli/commands/proposals.ts', 'export const command', ''],
    surfaces: ['src/forge/cli/commands/surfaces.ts', 'export const command', ''],
    local: ['src/forge/cli/commands/local.ts', 'export const command', ''],
    shadow: ['src/forge/cli/shadow.ts', 'switch (sub) {', 'default:'],
    tree: ['src/forge/cli/commands/tree.ts', 'export const command', ''],
    config: ['src/forge/cli/commands/config.ts', 'export const command', ''],
    infinite: ['src/forge/cli/commands/infinite.ts', 'export const command', ''],
    route: ['src/forge/cli/commands/route.ts', 'export const command', ''],
    'sp-plan': ['src/forge/cli/commands/sp-plan.ts', 'export const command', ''],
    decision: ['src/forge/cli/commands/decision.ts', 'export const command', ''],
    resource: ['src/forge/cli/commands/resource.ts', 'export const command', ''],
    blocked: ['src/forge/cli/commands/blocked.ts', 'export const command', ''],
    market: ['src/forge/cli/commands/market.ts', 'export const command', ''],
  },
  waypoint: {},
};

// Each command whose subcommands take a key (`local get|set <key>`), and the dispatcher it is read in: its `key === 'x'`
// tests are the keys, and a `/^x\.(.+)$/` pattern a key with a name after it (surfaces.<name>).
const KEYED: Record<Cli, Record<string, [file: string, from: string, to: string]>> = {
  forge: { local: ['src/forge/cli/commands/local.ts', 'export const command', ''] },
  waypoint: {},
};

/** The text of a dispatcher between its two markers (an empty `to` is the end of the file); empty when a marker is gone. */
function between(text: string, from: string, to: string): string {
  const at = text.indexOf(from);
  const end = at < 0 ? -1 : to === '' ? text.length : text.indexOf(to, at + from.length);
  return end < 0 ? '' : text.slice(at + from.length, end);
}

/** I-10: the subcommands of a dispatcher: its `case 'x':` labels and its `sub === 'x'` and `args[0] !== 'x'` tests. */
function subsOf(text: string, from: string, to: string): Set<string> {
  return new Set([...between(text, from, to).matchAll(/\bcase '([a-z][a-z0-9-]*)':|\b(?:sub|args\[0\]) [!=]== '([a-z][a-z0-9-]*)'/g)].map(m => m[1] ?? m[2]));
}

/** The keys a dispatcher reads after its subcommand. */
function keysOf(text: string, from: string, to: string): Keys {
  const body = between(text, from, to);
  return {
    exact: new Set([...body.matchAll(/\bkey === '([a-z][a-z0-9-]*)'/g)].map(m => m[1])),
    prefixes: new Set([...body.matchAll(/\/\^([a-z]+)\\\.\(\.\+\)\$\//g)].map(m => m[1])),
  };
}

/** I-10: the table of a CLI, from its source: the commands of its USAGE line, the subcommands its dispatchers take, the
 *  keys of its keyed subcommands and the flags it reads. */
function vocabOf(cli: Cli, text: string, read: (file: string) => string): Vocab {
  const usage = new RegExp(`usage: ${cli} <([a-z|-]+)>`).exec(text);
  const flags = new Set(INDIRECT[cli].map(([f]) => f));
  for (const f of readFlags(text)) flags.add(f);
  const subs = new Map(Object.entries(DISPATCH[cli]).map(([cmd, [file, from, to]]) => [cmd, subsOf(read(file), from, to)]));
  if (cli === 'forge') subs.set('swarm', new Set(Object.keys(SUBCOMMANDS)));
  const keys = new Map(Object.entries(KEYED[cli]).map(([cmd, [file, from, to]]) => [cmd, keysOf(read(file), from, to)]));
  return { commands: new Set(usage ? usage[1].split('|') : []), subs, keys, flags };
}

/** The flags a source reads through READERS or ARGV (INDIRECT aside). */
function readFlags(text: string): Set<string> {
  const flags = new Set<string>();
  for (const m of text.matchAll(new RegExp(`\\b(?:${READERS.join('|')})\\(\\s*'([a-z][a-z0-9-]*)'`, 'g'))) flags.add(m[1]);
  for (const m of text.matchAll(ARGV)) flags.add(m[1]);
  return flags;
}

/** The part of a shell line that is one command: up to the first `&&`, `&`, `;`, spaced `|` or `||` outside quotes, or
 *  the `)` that closes the $(…) it is in, with what a $(…) or a quote holds left out (another command's flags, or text).
 *  A redirection (`> f`, `2>&1`) does not end it, nor an unspaced `|` (the skills' a|b alternatives). An unmatched quote
 *  counts as a plain character. */
function commandPart(s: string, quotes = true): string {
  let out = '';
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (depth > 0) { if (c === '(') depth++; else if (c === ')') depth--; continue; }
    if (quotes && (c === '"' || c === "'")) { quote = c; continue; }
    if (c === '$' && s[i + 1] === '(') { depth = 1; i++; continue; }
    if (c === ')' || c === ';') break;
    if (c === '|' && s[i - 1] === ' ' && (s[i + 1] === ' ' || s[i + 1] === '|')) break;
    if (c === '&' && s[i - 1] !== '>' && s[i + 1] !== '>') break;
    out += c;
  }
  return quote ? commandPart(s, false) : out;
}

/** The problems of one citation of `cli`: its command, its subcommand when the command dispatches on one, the key after
 *  it when it takes one, and its flags. `rest` is what follows the command, up to where the citation ends. */
function checkOne(v: Vocab, file: string, cli: Cli, cmd: string, rest: string): string[] {
  const bad: string[] = [];
  if (!v.commands.has(cmd)) bad.push(`${file}: ${cli} ${cmd} (no such command)`);
  // Its subcommand, when the command dispatches on one: the word right after it (a flag or a <placeholder> is none).
  const subs = v.subs.get(cmd);
  const sub = subs && /^ ([a-z][a-z0-9-]*)(?![\w-])/.exec(rest)?.[1];
  if (subs && sub && !subs.has(sub)) bad.push(`${file}: ${cli} ${cmd} ${sub} (no such subcommand)`);
  const label = sub ? `${cmd} ${sub}` : cmd;
  // Its key, when its subcommand takes one: the word after the subcommand (a [key], a flag or a <placeholder> is none).
  const keys = sub ? v.keys.get(cmd) : undefined;
  const key = keys && /^ [a-z][a-z0-9-]* ([a-z][^\s|`\]]*)/.exec(rest)?.[1];
  if (keys && key && !keys.exact.has(key) && ![...keys.prefixes].some(p => key.startsWith(`${p}.`) && key.length > p.length + 1)) {
    bad.push(`${file}: ${cli} ${label} ${key} (no such key)`);
  }
  for (const m of rest.matchAll(/(?<![\w-])--([a-z][a-z0-9-]*)/g)) if (!v.flags.has(m[1])) bad.push(`${file}: ${cli} ${label} --${m[1]}`);
  return bad;
}

// A citation: `FORGE <command>`, the CLI's path (`…forge.cjs" <command>`, `"<WP>" <command>`), or the CLI's own name in
// lower case where a shell command starts: after &&, ||, ;, | or $(, and at the start of a line of a fenced block (an
// inline `forge …` that starts a span is a message the skills quote, such as `forge execution is active`).
const cite = (start: string): { cli: Cli; re: RegExp }[] => [
  { cli: 'forge', re: new RegExp(`(?:\\bFORGE |forge\\.cjs"? |${start}forge )([a-z][a-z0-9-]*)`, 'g') },
  { cli: 'waypoint', re: new RegExp(`(?:waypoint\\.cjs"? |"?<WP>"? |${start}waypoint )([a-z][a-z0-9-]*)`, 'g') },
];
const CITE = cite('(?:[;&|]\\s*|\\$\\()');
const CITE_BLOCK = cite('(?:^\\s*|[;&|]\\s*|\\$\\()');

/** Each citation of a command, subcommand, key or flag its CLI does not know, as `file: cli command --flag`. */
function checkCitations(files: { file: string; text: string }[], vocab: Record<Cli, Vocab>): string[] {
  const bad: string[] = [];
  for (const { file, text } of files) {
    for (const { text: u, block } of codeUnits(text)) {
      const hits = (block ? CITE_BLOCK : CITE).flatMap(c => [...u.matchAll(c.re)].map(m => ({ cli: c.cli, cmd: m[1], at: m.index ?? 0, end: (m.index ?? 0) + m[0].length })))
        .sort((a, b) => a.at - b.at);
      hits.forEach((h, i) => {
        // What follows it: up to the next citation, and to the end of this shell command (commandPart).
        bad.push(...checkOne(vocab[h.cli], file, h.cli, h.cmd, commandPart(u.slice(h.end, hits[i + 1]?.at ?? u.length))));
      });
    }
  }
  return bad;
}

/** The entries of a README's CLI reference (`## CLI reference` or `## Referencia de la CLI`): the code that starts each
 *  bullet (`lead`) and every other code span of that bullet whose first word `isCommand` says is one of the CLI's (a span
 *  such as `affects` or `.forge/loose.json` names a field or a file); in a table, the code of each row's last cell outside
 *  parentheses (an aside such as `(with \`removed\`)` names a field). Only an entry that starts with a lowercase word is a
 *  command. */
function referenceEntries(text: string, isCommand: (word: string) => boolean = () => true): { entry: string; lead: boolean }[] {
  const at = text.search(/^## (?:CLI reference|Referencia de la CLI)\s*$/m);
  if (at < 0) return [];
  const next = text.slice(at + 3).search(/^## /m);
  const section = next < 0 ? text.slice(at) : text.slice(at, at + 3 + next);
  const out: { entry: string; lead: boolean }[] = [];
  const first = (e: string) => /^[a-z][a-z0-9-]*/.exec(e)?.[0];
  for (const { text: line, code } of fenced(section).lines) {
    if (code) continue;
    if (/^\s*- `[^`]+`/.test(line)) {
      [...line.matchAll(/`([^`]+)`/g)].forEach((m, i) => {
        const w = first(m[1]);
        if (w && (i === 0 || isCommand(w))) out.push({ entry: m[1], lead: i === 0 });
      });
      continue;
    }
    if (!line.startsWith('|') || /^\|\s*-/.test(line)) continue;
    const cells = line.split(/(?<!\\)\|/).map(c => c.trim()).filter(Boolean);
    let depth = 0;
    for (const part of (cells.at(-1) ?? '').split(/(`[^`]*`)/)) {
      if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
        const e = part.slice(1, -1).replace(/\\\|/g, '|');
        if (depth === 0 && first(e)) out.push({ entry: e, lead: true });
        continue;
      }
      for (const ch of part) depth += ch === '(' ? 1 : ch === ')' && depth > 0 ? -1 : 0;
    }
  }
  return out;
}

/** Each entry of a README CLI reference that names a command, subcommand, key or flag its CLI does not know. Within an
 *  entry `|` separates alternatives, so all of it is checked. */
function checkReference(file: string, cli: Cli, text: string, v: Vocab): string[] {
  return referenceEntries(text, w => v.commands.has(w)).flatMap(({ entry: e }) => {
    const cmd = /^[a-z][a-z0-9-]*/.exec(e)![0];
    return checkOne(v, file, cli, cmd, e.slice(cmd.length));
  });
}

const readSrc = (file: string) => readFileSync(path.join(repo, file), 'utf8');
const vocab: Record<Cli, Vocab> = { forge: vocabOf('forge', sources('src/forge'), readSrc), waypoint: vocabOf('waypoint', sources('src/cli'), readSrc) };
const skills = ['plugins/forge/skills', 'plugins/waypoint/skills'].flatMap(d => walk(path.join(repo, d))).filter(f => f.endsWith('.md'))
  .map(f => ({ file: path.relative(repo, f).split(path.sep).join('/'), text: readFileSync(f, 'utf8') }));

describe('the skills cite only what the CLIs accept (I-10)', () => {
  it('each CLI has its usage line and reads its flags', () => {
    for (const c of ['forge', 'waypoint'] as const) {
      expect(vocab[c].commands.size, c).toBeGreaterThan(20);
      expect(vocab[c].flags.size, c).toBeGreaterThan(20);
    }
    expect(vocab.forge.commands.has('swarm')).toBe(true);
    expect(vocab.waypoint.commands.has('design-snapshot')).toBe(true);
  });
  it('each dispatcher of forge has its subcommands, and it is a command of the usage line', () => {
    expect([...vocab.forge.subs.keys()].sort()).toEqual([...Object.keys(DISPATCH.forge), 'swarm'].sort());
    for (const [cmd, subs] of vocab.forge.subs) {
      expect(vocab.forge.commands.has(cmd), cmd).toBe(true);
      expect(subs.size, cmd).toBeGreaterThan(0);
    }
    for (const [cmd, sub] of [['swarm', 'merge'], ['swarm', 'step'], ['swarm', 'task'], ['proposals', 'to-task'], ['decision', 'md'], ['infinite', 'status'], ['shadow', 'collect'],
      ['authorize', 'merge-on-finish'], ['local', 'get'], ['local', 'set']]) {
      expect(vocab.forge.subs.get(cmd)?.has(sub), `forge ${cmd} ${sub}`).toBe(true);
    }
  });
  it('forge local get|set takes the keys its dispatcher reads: commands, workflow, autonomy and surfaces.<name>', () => {
    const keys = vocab.forge.keys.get('local')!;
    expect([...keys.exact].sort()).toEqual(['autonomy', 'commands', 'workflow']);
    expect([...keys.prefixes]).toEqual(['surfaces']);
  });
  it('each INDIRECT flag is still read where its entry says', () => {
    for (const [cli, dir] of [['forge', 'src/forge'], ['waypoint', 'src/cli']] as const) {
      const text = sources(dir);
      for (const [flag, site] of INDIRECT[cli]) {
        expect(text, `${cli} --${flag}`).toContain(site);
        expect(site, `${cli} --${flag}`).toContain(`'${flag}'`);
      }
    }
  });
  it('every FORGE <command> [<subcommand>] --flag and waypoint <command> --flag of plugins/*/skills is a command, subcommand and flag of that CLI', () => {
    const cited = skills.reduce((n, f) => n + units(f.text).filter(u => CITE.some(c => new RegExp(c.re.source).test(u))).length, 0);
    expect(cited).toBeGreaterThan(100);
    expect(checkCitations(skills, vocab)).toEqual([]);
  });
  it('a skill that cites a flag or a command its CLI does not have fails', () => {
    const fixture = [{
      file: 'fixture.md',
      text: 'Run `FORGE validate --all --no-such-flag` and `node "<WP>" design-snapshot DESIGN --note-x n`, then `FORGE frobnicate`.\n\n```bash\nFORGE swarm merge --yes > out.json && git log --oneline\n```\n',
    }];
    expect(checkCitations(fixture, vocab)).toEqual([
      'fixture.md: forge validate --no-such-flag', 'fixture.md: waypoint design-snapshot --note-x', 'fixture.md: forge frobnicate (no such command)',
    ]);
  });
  it('a skill that cites a subcommand its command does not dispatch on fails; a real one passes', () => {
    const fixture = [{
      file: 'fixture.md',
      text: 'Run `FORGE swarm nonexistent --plan p`, then `FORGE swarm merge --yes`, `FORGE decision md --scope s` and `FORGE proposals to-task <id>`.\n',
    }];
    expect(checkCitations(fixture, vocab)).toEqual(['fixture.md: forge swarm nonexistent (no such subcommand)']);
  });
  it('a --x the CLI only hands to git is no flag of it; one read by idsArg(), indexOf() or a comparison is', () => {
    const fixture = [{
      file: 'fixture.md',
      text: '`FORGE swarm merge --no-ff`, `FORGE swarm step --ruling T1:fix`, `FORGE review-close --defer F3 --out-of-model F2` and `node "<WP>" launch <plan> <track> --base <b> --launcher bg`.\n',
    }];
    expect(checkCitations(fixture, vocab)).toEqual(['fixture.md: forge swarm merge --no-ff']);
  });
  it('a typo in the subcommand of authorize or in the key of local get|set fails; the real ones pass', () => {
    const fixture = [{
      file: 'fixture.md',
      text: '`FORGE authorize merge-on-finsh --run R`, `FORGE local set comands allowed --expect H` and `FORGE local get surfaces`; '
        + '`FORGE authorize merge-on-finish --branch main --run R`, `FORGE local set commands allowed --expect H`, `FORGE local set surfaces.<name> denied`, '
        + '`FORGE local set autonomy auto`, `FORGE local get commands` and `FORGE local get`.\n',
    }];
    expect(checkCitations(fixture, vocab)).toEqual([
      'fixture.md: forge authorize merge-on-finsh (no such subcommand)', 'fixture.md: forge local set comands (no such key)', 'fixture.md: forge local get surfaces (no such key)',
    ]);
  });
  it('a citation in lower case where a command starts, after a pipe, a redirection, a $(…) or on a continued line is checked', () => {
    const fixture = [{
      file: 'fixture.md',
      text: '`cd x && forge swarm merj` and `node "${CLAUDE_PLUGIN_ROOT}/dist/forge.cjs" frobnicate`; `forge execution is active` and `a waypoint now --b` are no commands.\n\n'
        + '```bash\nwaypoint now --bogus-a\nFORGE validate --all > out.json --bogus-b 2>&1 | tail --lines 5\nFORGE validate --task "$(cat id | head -1)" --bogus-c\nX=$(FORGE swarm status --bogus-d) && echo --e\n'
        + 'FORGE validate --all \\\n  --bogus-f\n```\n',
    }];
    expect(checkCitations(fixture, vocab)).toEqual([
      'fixture.md: forge swarm merj (no such subcommand)', 'fixture.md: forge frobnicate (no such command)', 'fixture.md: waypoint now --bogus-a',
      'fixture.md: forge validate --bogus-b', 'fixture.md: forge validate --bogus-c', 'fixture.md: forge swarm status --bogus-d', 'fixture.md: forge validate --bogus-f',
    ]);
  });
  it('a fence closes only on its own kind and length, so prose after a fence inside a longer one stays prose; every skill closes its fences', () => {
    const text = 'a `FORGE x`\n````md\n```bash\nFORGE in-code\n```\nstill code\n````\nprose `FORGE y`\n~~~\ntilde code\n```\n~~~\n';
    expect(fenced(text).open).toBe(false);
    expect(units(text)).toEqual(['FORGE x', '```bash', 'FORGE in-code', '```', 'still code', 'FORGE y', 'tilde code', '```']);
    expect(fenced('```\nopen\n').open).toBe(true);
    const docs = [...skills, ...['forge', 'waypoint'].flatMap(p => ['README.md', 'README.es.md'].map(r => `plugins/${p}/${r}`)).map(f => ({ file: f, text: readSrc(f) }))];
    for (const { file, text: t } of docs) expect(fenced(t).open, file).toBe(false);
  });
});

describe('the README CLI references name only what the CLIs accept (I-10)', () => {
  const READMES: [file: string, cli: Cli][] = [
    ['plugins/forge/README.md', 'forge'], ['plugins/forge/README.es.md', 'forge'], ['plugins/waypoint/README.md', 'waypoint'], ['plugins/waypoint/README.es.md', 'waypoint'],
  ];
  it('every entry of the forge and waypoint CLI references, English and Spanish, is a command of its CLI with its subcommands, keys and flags', () => {
    for (const [file, cli] of READMES) {
      const entries = referenceEntries(readSrc(file), w => vocab[cli].commands.has(w));
      expect(entries.filter(e => e.lead).length, file).toBeGreaterThan(cli === 'forge' ? 60 : 30);
      expect(checkReference(file, cli, readSrc(file), vocab[cli])).toEqual([]);
    }
    // re-review N3: a bullet's later spans that cite a command are read too.
    const later = referenceEntries(readSrc('plugins/forge/README.md'), w => vocab.forge.commands.has(w)).filter(e => !e.lead).map(e => e.entry);
    expect(later).toEqual(expect.arrayContaining(['swarm nudge <task> [--plan p]', 'tree check --task id --base sha [--cwd d]']));
    expect(later.length).toBeGreaterThan(40);
    const leads = (f: string) => referenceEntries(readSrc(f)).filter(e => e.lead).map(e => e.entry.split(' ')[0]);
    for (const cli of ['forge', 'waypoint']) expect(leads(`plugins/${cli}/README.es.md`), cli).toEqual(leads(`plugins/${cli}/README.md`));
  });
  it('an entry that names a subcommand, a command or a flag the CLI does not have fails', () => {
    const md = '# x\n\n## CLI reference\n\n- `swarm frobnicate [--plan p]` - x\n- `swarm merge [--yes]` - y\n- `frobnicate` - z\n- `.forge/loose.json` - a file\n- `validate --no-such`\n'
      + '- `swarm sleep <s>` - then `swarm nudj <task>` and `tree check --bogus`; `affects` and `--out <file>` are no commands\n\n## Next\n\n- `swarm nope`\n';
    expect(checkReference('fixture.md', 'forge', md, vocab.forge)).toEqual([
      'fixture.md: forge swarm frobnicate (no such subcommand)', 'fixture.md: forge frobnicate (no such command)', 'fixture.md: forge validate --no-such',
      'fixture.md: forge swarm nudj (no such subcommand)', 'fixture.md: forge tree check --bogus',
    ]);
    const table = '## Referencia de la CLI\n\n| Grupo | Comandos |\n| --- | --- |\n| Trabajo | `next [--base <b>]` (con `waiting_on`), `frobnicate`, `design-gate <d>` |\n';
    expect(checkReference('fixture.md', 'waypoint', table, vocab.waypoint)).toEqual(['fixture.md: waypoint frobnicate (no such command)']);
  });
});
