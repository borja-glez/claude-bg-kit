import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { units, walk } from './helpers/files.js';

const repo = fileURLToPath(new URL('..', import.meta.url));
const sources = (dir: string) => walk(path.join(repo, dir)).filter(f => /\.tsx?$/.test(f)).map(f => readFileSync(f, 'utf8')).join('\n');

type Cli = 'forge' | 'waypoint';
interface Vocab { commands: Set<string>; subs: Map<string, Set<string>>; flags: Set<string> }
// How the CLIs read a flag: flag('x'), has('x') and the like (READERS), or `--x` itself given to the arguments' own
// includes() or indexOf(), to waypoint launch's val(), or compared with an argument (`arg !== '--ruling'`: ARGV). A `--x`
// that only an error, a usage text or the arguments of a git call name is read by nothing, so it is no flag. The flags
// are one pool per CLI, not a table per command: a flag of one command cited on another passes.
const READERS = [
  'flag', 'has', 'subFlag', 'lastOf', 'opt', 'num',
  'need', // waypoint heartbeat --register: need('name'), need('agent'), need('branch'), need('worktree'), need('track')
  'posInt', // waypoint: posInt('session-version') in heartbeat and release, posInt('state-version') in release --free
  'idsArg', // forge review-close: idsArg('out-of-model'), idsArg('defer')
];
const ARGV = /(?:\b(?:includes|indexOf|val)\(\s*|[!=]==\s*)['"`]--([a-z][a-z0-9-]*)['"`]/g;
// Flags a CLI reads in a way those two patterns do not see (a loop over names), each with where it is read.
const INDIRECT: Record<Cli, string[]> = {
  forge: [],
  waypoint: [
    'version', // critique-check: for (const name of ['round', 'version']) flag(name)
    'state-version', // claim, done and block: taskFlags(cmd, ['state-version', 'session-version']) reads each with posInt(name)
  ],
};
// Each command that dispatches on a subcommand, and where the code does it: its file and the two markers around the
// dispatcher, whose `case 'x':` labels and `sub === 'x'` tests are the subcommands. No waypoint command takes one (its
// `hook` is cited by no skill).
const DISPATCH: Record<Cli, Record<string, [file: string, from: string, to: string]>> = {
  forge: {
    swarm: ['src/forge/cli/swarm.ts', 'switch (sub) {', 'usage: forge swarm <'],
    proposals: ['src/forge/cli/run.ts', "case 'proposals': {", "case 'surfaces': {"],
    surfaces: ['src/forge/cli/run.ts', "case 'surfaces': {", "case 'setup': {"],
    local: ['src/forge/cli/run.ts', "case 'local': {", "case 'prefs': {"],
    shadow: ['src/forge/cli/shadow.ts', 'switch (sub) {', 'default:'],
    tree: ['src/forge/cli/run.ts', "case 'tree': {", "case 'config': {"],
    config: ['src/forge/cli/run.ts', "case 'config': {", "case 'infinite': {"],
    infinite: ['src/forge/cli/run.ts', "case 'infinite': {", "case 'cycle': {"],
    route: ['src/forge/cli/run.ts', "case 'route': {", "case 'tdd':"],
    'sp-plan': ['src/forge/cli/run.ts', "case 'sp-plan': {", "case 'agents': {"],
    decision: ['src/forge/cli/run.ts', "case 'decision': {", "case 'stats': {"],
  },
  waypoint: {},
};

/** I-10: the subcommands of a dispatcher: the `case 'x':` labels and the `sub === 'x'` tests between its two markers. */
function subsOf(text: string, from: string, to: string): Set<string> {
  const at = text.indexOf(from);
  const end = at < 0 ? -1 : text.indexOf(to, at + from.length);
  if (end < 0) return new Set();
  return new Set([...text.slice(at + from.length, end).matchAll(/\bcase '([a-z][a-z0-9-]*)':|\bsub [!=]== '([a-z][a-z0-9-]*)'/g)].map(m => m[1] ?? m[2]));
}

/** I-10: the table of a CLI, from its source: the commands of its USAGE line, the subcommands its dispatchers take and
 *  the flags it reads. */
function vocabOf(cli: Cli, text: string, read: (file: string) => string): Vocab {
  const usage = new RegExp(`usage: ${cli} <([a-z|-]+)>`).exec(text);
  const flags = new Set(INDIRECT[cli]);
  for (const m of text.matchAll(new RegExp(`\\b(?:${READERS.join('|')})\\(\\s*'([a-z][a-z0-9-]*)'`, 'g'))) flags.add(m[1]);
  for (const m of text.matchAll(ARGV)) flags.add(m[1]);
  const subs = new Map(Object.entries(DISPATCH[cli]).map(([cmd, [file, from, to]]) => [cmd, subsOf(read(file), from, to)]));
  return { commands: new Set(usage ? usage[1].split('|') : []), subs, flags };
}

const CITE: { cli: Cli; re: RegExp }[] = [
  { cli: 'forge', re: /\bFORGE ([a-z][a-z0-9-]*)/g },
  { cli: 'waypoint', re: /(?:waypoint\.cjs" |"<WP>" |^waypoint )([a-z][a-z0-9-]*)/g },
];

/** Each citation of a command, subcommand or flag its CLI does not know, as `file: cli command --flag`. */
function checkCitations(files: { file: string; text: string }[], vocab: Record<Cli, Vocab>): string[] {
  const bad: string[] = [];
  for (const { file, text } of files) {
    for (const u of units(text)) {
      const hits = CITE.flatMap(c => [...u.matchAll(c.re)].map(m => ({ cli: c.cli, cmd: m[1], at: m.index ?? 0, end: (m.index ?? 0) + m[0].length })))
        .sort((a, b) => a.at - b.at);
      hits.forEach((h, i) => {
        const v = vocab[h.cli];
        const stop = hits[i + 1]?.at ?? u.length;
        if (!v.commands.has(h.cmd)) bad.push(`${file}: ${h.cli} ${h.cmd} (no such command)`);
        // Its subcommand, when the command dispatches on one: the word right after it (a flag or a <placeholder> is none).
        const subs = v.subs.get(h.cmd);
        const sub = subs && /^ ([a-z][a-z0-9-]*)(?![\w-])/.exec(u.slice(h.end, stop))?.[1];
        if (subs && sub && !subs.has(sub)) bad.push(`${file}: ${h.cli} ${h.cmd} ${sub} (no such subcommand)`);
        const label = sub ? `${h.cmd} ${sub}` : h.cmd;
        // Its flags: up to the next citation, or to the next shell command (&&, ;, a spaced pipe, a redirection).
        const rest = u.slice(h.end, stop).split(/ && | ; | \| | > /)[0];
        for (const m of rest.matchAll(/(?<![\w-])--([a-z][a-z0-9-]*)/g)) if (!v.flags.has(m[1])) bad.push(`${file}: ${h.cli} ${label} --${m[1]}`);
      });
    }
  }
  return bad;
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
    expect([...vocab.forge.subs.keys()].sort()).toEqual(Object.keys(DISPATCH.forge).sort());
    for (const [cmd, subs] of vocab.forge.subs) {
      expect(vocab.forge.commands.has(cmd), cmd).toBe(true);
      expect(subs.size, cmd).toBeGreaterThan(0);
    }
    for (const [cmd, sub] of [['swarm', 'merge'], ['swarm', 'step'], ['swarm', 'task'], ['proposals', 'to-task'], ['decision', 'md'], ['infinite', 'status'], ['shadow', 'collect']]) {
      expect(vocab.forge.subs.get(cmd)?.has(sub), `forge ${cmd} ${sub}`).toBe(true);
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
  it('a --x the CLI only hands to git is no flag of it; one read by idsArg(), val() or a comparison is', () => {
    const fixture = [{
      file: 'fixture.md',
      text: '`FORGE swarm merge --no-ff`, `FORGE swarm step --ruling T1:fix`, `FORGE review-close --defer F3 --out-of-model F2` and `node "<WP>" launch <plan> <T> --run <runId> --coordinator <SID>`.\n',
    }];
    expect(checkCitations(fixture, vocab)).toEqual(['fixture.md: forge swarm merge --no-ff']);
  });
});
