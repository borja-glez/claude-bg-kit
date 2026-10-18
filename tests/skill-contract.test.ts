import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { units, walk } from './helpers/files.js';

const repo = fileURLToPath(new URL('..', import.meta.url));
const sources = (dir: string) => walk(path.join(repo, dir)).filter(f => /\.tsx?$/.test(f)).map(f => readFileSync(f, 'utf8')).join('\n');

type Cli = 'forge' | 'waypoint';
interface Vocab { commands: Set<string>; flags: Set<string> }
// How the CLIs read a flag: flag('x'), has('x') and the like, or `--x` written right after a quote.
const READERS = [
  'flag', 'has', 'subFlag', 'lastOf', 'opt', 'num',
  'need', // waypoint heartbeat --register: need('name'), need('agent'), need('branch'), need('worktree'), need('track')
  'posInt', // waypoint: posInt('session-version') in heartbeat and release, posInt('state-version') in release --free
];
// Flags a CLI reads in a way those two patterns do not see (a loop over names), each with where it is read.
const INDIRECT: Record<Cli, string[]> = {
  forge: [],
  waypoint: [
    'version', // critique-check: for (const name of ['round', 'version']) flag(name)
    'state-version', // claim, done and block: taskFlags(cmd, ['state-version', 'session-version']) reads each with posInt(name)
  ],
};

/** I-10: the table of a CLI, from its source: the commands of its USAGE line and the flags it reads. */
function vocabOf(cli: Cli, text: string): Vocab {
  const usage = new RegExp(`usage: ${cli} <([a-z|-]+)>`).exec(text);
  const flags = new Set(INDIRECT[cli]);
  for (const m of text.matchAll(new RegExp(`\\b(?:${READERS.join('|')})\\(\\s*'([a-z][a-z0-9-]*)'`, 'g'))) flags.add(m[1]);
  for (const m of text.matchAll(/['"`]--([a-z][a-z0-9-]*)/g)) flags.add(m[1]);
  return { commands: new Set(usage ? usage[1].split('|') : []), flags };
}

const CITE: { cli: Cli; re: RegExp }[] = [
  { cli: 'forge', re: /\bFORGE ([a-z][a-z0-9-]*)/g },
  { cli: 'waypoint', re: /(?:waypoint\.cjs" |"<WP>" |^waypoint )([a-z][a-z0-9-]*)/g },
];

/** Each citation of a command or flag its CLI does not know, as `file: cli command --flag`. */
function checkCitations(files: { file: string; text: string }[], vocab: Record<Cli, Vocab>): string[] {
  const bad: string[] = [];
  for (const { file, text } of files) {
    for (const u of units(text)) {
      const hits = CITE.flatMap(c => [...u.matchAll(c.re)].map(m => ({ cli: c.cli, cmd: m[1], at: m.index ?? 0, end: (m.index ?? 0) + m[0].length })))
        .sort((a, b) => a.at - b.at);
      hits.forEach((h, i) => {
        const v = vocab[h.cli];
        if (!v.commands.has(h.cmd)) bad.push(`${file}: ${h.cli} ${h.cmd} (no such command)`);
        // Its flags: up to the next citation, or to the next shell command (&&, ;, a spaced pipe, a redirection).
        const rest = u.slice(h.end, hits[i + 1]?.at ?? u.length).split(/ && | ; | \| | > /)[0];
        for (const m of rest.matchAll(/(?<![\w-])--([a-z][a-z0-9-]*)/g)) if (!v.flags.has(m[1])) bad.push(`${file}: ${h.cli} ${h.cmd} --${m[1]}`);
      });
    }
  }
  return bad;
}

const vocab: Record<Cli, Vocab> = { forge: vocabOf('forge', sources('src/forge')), waypoint: vocabOf('waypoint', sources('src/cli')) };
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
  it('every FORGE <command> --flag and waypoint <command> --flag of plugins/*/skills is a command and a flag of that CLI', () => {
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
});
