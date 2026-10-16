import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
// Invisible characters in source text hide what the code says: the bidi controls (U+202A to U+202E, U+2066 to U+2069),
// the BOM (U+FEFF) and the zero-width ones (U+200B to U+200F). Built from code points, so this file never holds them.
const cp = (n: number) => String.fromCharCode(n);
const INVISIBLE = new RegExp(`[${cp(0x202a)}-${cp(0x202e)}${cp(0x2066)}-${cp(0x2069)}${cp(0xfeff)}${cp(0x200b)}-${cp(0x200f)}]`);
function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('source text', () => {
  it('has no raw invisible characters (bidi controls, BOM, zero-width)', () => {
    const hits = ['src', 'tests', 'plugins/lens/tests', 'plugins/waypoint/tests']
      .flatMap(d => files(path.join(ROOT, d)))
      .filter(f => INVISIBLE.test(readFileSync(f, 'utf8')))
      .map(f => path.relative(ROOT, f).split(path.sep).join('/'));
    expect(hits).toEqual([]);
  });
});

function mdFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...mdFiles(p));
    else if (name.endsWith('.md')) out.push(p);
  }
  return out;
}

// The sentence that defines <WORK> names the folders it stands for (`.forge/work/<T>` for a loose task, `.forge/work/<id>`
// on the Medium path): it is the definition, not an old folder, so each file is read without it.
const WORK_DEFINITION = /`<WORK>` (?:is|=) [^\n]*?[.;](?=\s|$)/g;

describe('work folders in the skills of forge (D-08)', () => {
  it('forge:run and forge:member name a task folder <WORK>, never .forge/work/T or .forge/work/<T>', () => {
    const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join('/');
    const docs = [...mdFiles(path.join(ROOT, 'plugins', 'forge', 'skills', 'run')), path.join(ROOT, 'plugins', 'forge', 'skills', 'member', 'SKILL.md')];
    const hits = docs.flatMap(f => {
      const text = readFileSync(f, 'utf8').replace(WORK_DEFINITION, '');
      const out: string[] = [];
      if (/\.forge\/work\/(?:T|<T>)(?=[/\s`])/.test(text)) out.push(rel(f));
      // A reference names a task's folder <WORK>. A loose task's .forge/work/<id> stays in forge:run's own body and in a
      // superpowers plan, and task.txt is written before any triage.
      if (rel(f).includes('/references/') && !rel(f).endsWith('superpowers-plan.md') && /\.forge\/work\/<id>(?!\/task\.txt)(?=[/\s`])/.test(text)) out.push(`${rel(f)} (<id>)`);
      return out;
    });
    expect(hits).toEqual([]);
    for (const f of ['run/references/task-steps.md', 'run/references/execution.md', 'run/references/ephemeral.md', 'member/SKILL.md']) {
      expect(readFileSync(path.join(ROOT, 'plugins', 'forge', 'skills', f), 'utf8'), f).toContain('<WORK>');
    }
  });
  it('the sentence that defines <WORK> is not taken for an old folder', () => {
    const defined = 'x. `<WORK>` is a loose task\'s work folder, `.forge/work/<T>` (the `work` that `FORGE swarm worktree` prints). `<WORK>` is the task\'s work folder: `.forge/work/<id>` on the Medium path; in an execution, the `work`.';
    expect(defined.replace(WORK_DEFINITION, '')).not.toMatch(/\.forge\/work\//);
    // Only the definition goes: an old folder in the next sentence is still found.
    expect('`<WORK>` = a task\'s folder; then `mkdir -p .forge/work/T`.'.replace(WORK_DEFINITION, '')).toMatch(/\.forge\/work\/T(?=[/\s`])/);
  });
});
