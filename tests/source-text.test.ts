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

// The mods' JSX factory is a global called `h`: a local or a parameter with that name shadows it and a render falls back
// silently. src/mod and src/lens never name one so, and src/page neither (final review M3), so the habit never gets there.
const H_NAMES = [
  /\b(?:const|let|var|function|class)\s+h\b/,
  /(?<![\w$.])h\s*=>/,
  /[(,]\s*(?:\.\.\.)?h\s*[,:)=?]/,
];
const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

describe('no local or parameter named h (final review M3)', () => {
  it('src/page, src/mod and src/lens name none', () => {
    const hits = ['src/page', 'src/mod', 'src/lens']
      .flatMap(d => files(path.join(ROOT, d)))
      .flatMap(f => code(readFileSync(f, 'utf8')).split('\n').map((line, i) => [f, i + 1, line] as const))
      .filter(([, , line]) => H_NAMES.some(re => re.test(line)))
      .map(([f, n, line]) => `${path.relative(ROOT, f).split(path.sep).join('/')}:${n}: ${line.trim()}`);
    expect(hits).toEqual([]);
  });
  it('finds each way of naming one', () => {
    for (const line of ['const h = 1;', 'let h;', 'xs.map(h => h.id)', 'xs.find((h) => h)', 'f(a, h: number) {', 'function f(h = 2) {', '(...h) => h', 'function h() {}']) {
      expect(H_NAMES.some(re => re.test(code(line))), line).toBe(true);
    }
    for (const line of ['const hh = 1;', 'x.h => 1', 'h(App, null)', '// const h = 1', 'const height = 2;', 'return `${n} h`;']) {
      expect(H_NAMES.some(re => re.test(code(line))), line).toBe(false);
    }
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

describe('git compatibility (6a N1)', () => {
  it('no git call of src/ needs git 2.24: no --end-of-options', () => {
    const hits = files(path.join(ROOT, 'src')).filter(f => readFileSync(f, 'utf8').includes('--end-of-options')).map(f => path.relative(ROOT, f));
    expect(hits).toEqual([]);
  });
});
