import { describe, it, expect, beforeEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { diffSinks, sinkReason, SINKS_MAX } from '../src/forge/sinks.js';
import { announce } from '../src/forge/triage.js';
import { run, type Io } from '../src/forge/cli/run.js';
import { useTempDirs } from './helpers/tmp.js';
const tmp = useTempDirs();

/** A -U0 patch that adds `lines` to `file` from line `at`. */
const added = (file: string, lines: string[], at = 10) =>
  [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, `@@ -${at - 1},0 +${at},${lines.length} @@`, ...lines.map(l => `+${l}`)].join('\n');

describe('diffSinks (A7)', () => {
  it('finds the strict sinks on added lines, with their file and line', () => {
    const patch = [
      added('src/run.js', ['const f = eval(input);', 'const g = new Function("a", body);']),
      added('src/http.ts', ['const agent = new https.Agent({ rejectUnauthorized: false });'], 3),
      added('app/load.py', ['data = pickle.loads(blob)', 'cfg = yaml.load(fh)', 'ok = yaml.load(fh, Loader=yaml.SafeLoader)', 'r = requests.get(url, verify=False)'], 1),
      added('src/main/java/In.java', ['ObjectInputStream in = new ObjectInputStream(socket.getInputStream());'], 7),
    ].join('\n');
    expect(diffSinks(patch)).toEqual([
      { kind: 'eval', file: 'src/run.js', line: 10 }, { kind: 'new-function', file: 'src/run.js', line: 11 },
      { kind: 'tls-off', file: 'src/http.ts', line: 3 },
      { kind: 'pickle', file: 'app/load.py', line: 1 }, { kind: 'yaml-load', file: 'app/load.py', line: 2 }, { kind: 'tls-off', file: 'app/load.py', line: 4 },
      { kind: 'object-input-stream', file: 'src/main/java/In.java', line: 7 },
    ]);
  });
  it('launching git or a shell, a method called eval, js-yaml, a comment, a removed line, a test, a bundle or a doc is no sink', () => {
    const patch = [
      added('src/git.ts', ["execFileSync('git', ['status']);", "spawnSync('git', args, { shell: true });", "exec('git log -1');", 'model.eval();',
        'await page.evaluate(() => 1);', 'const doc = yaml.load(text);', '// never eval(input) here', ' * new Function is banned']),
      ['diff --git a/src/old.js b/src/old.js', '--- a/src/old.js', '+++ b/src/old.js', '@@ -4 +3,0 @@', '-eval(input);'].join('\n'),
      added('tests/run.test.ts', ['eval(input);']), added('src/run.test.js', ['eval(input);']), added('plugins/forge/dist/forge.cjs', ['new Function(body);']),
      added('docs/notes.md', ['eval(input)']), added('.forge/work/T1/brief-1.md', ['eval(input)']), added('app/test_load.py', ['pickle.loads(b)']),
    ].join('\n');
    expect(diffSinks(patch)).toEqual([]);
  });
  it('reads a body line that starts with ++ as code, never as a header, and caps the list', () => {
    expect(diffSinks(added('src/a.js', ['++x; eval(y);']))).toEqual([{ kind: 'eval', file: 'src/a.js', line: 10 }]);
    expect(diffSinks(added('src/a.js', Array(30).fill('eval(x);')))).toHaveLength(SINKS_MAX);
    expect(diffSinks('')).toEqual([]);
  });
  it('names the first three in its reason, in English and in Spanish', () => {
    const s = (line: number) => ({ kind: 'eval' as const, file: 'src/a.js', line });
    expect(sinkReason([s(1)])).toBe('diff adds a strict sink: eval (src/a.js:1)');
    expect(sinkReason([s(1), s(2), s(3), s(4), s(5)])).toBe('diff adds a strict sink: eval (src/a.js:1), eval (src/a.js:2), eval (src/a.js:3), +2');
    expect(announce({ path: 'medium', reasons: [sinkReason([s(1)])], implementer: { self: false, agent: 'a' }, fresh: [], catalog: [] }, 'es'))
      .toContain('el diff añade un sink estricto: eval (src/a.js:1)');
  });
});

describe('triage --base with a strict sink (A7)', () => {
  const PLAN = 'project: shop\nversion: "0.1"\ntracks: [{ id: ui, name: UI, color: blue }]\nphases: [{ id: F1, name: Base }]\ntasks:\n'
    + '  - id: T001\n    title: Add a footer link\n    track: ui\n    phase: F1\n    done_when: the footer shows the link\n    zones: ["src/ui/**"]\n';
  let root: string;
  let io: Io;
  beforeEach(() => {
    root = tmp('forge-sinks-');
    writeFileSync(path.join(root, 'plan.yaml'), PLAN);
    io = { cwd: root, now: () => new Date('2026-10-24T10:00:00.000Z'), env: {} };
  });
  const triage = (patch: string) => JSON.parse(run(['triage', '--plan', 'plan.yaml', '--task', 'T001', '--base', 'abc123'], { ...io, git: args =>
    args.includes('ls-files') ? 'src/ui/footer.ts\nsrc/app.ts\na\nb\nc\n' : args.includes('rev-list') ? '7\n'
      : args.includes('--numstat') ? '3\t0\tsrc/ui/footer.ts\n' : args.includes('-U0') ? patch : '' }).stdout);
  it('a small diff that adds eval goes to Medium with the security review and --sensitive, and says why', () => {
    const out = triage(added('src/ui/footer.ts', ['el.innerHTML = eval(params.get("x"));']));
    expect(out.path).toBe('medium');
    expect(out.sinks).toEqual([{ kind: 'eval', file: 'src/ui/footer.ts', line: 10 }]);
    expect(out.reasons).toContain('diff adds a strict sink: eval (src/ui/footer.ts:10)');
    expect(out.review.reviewers.map((r: { role: string; effort: string }) => [r.role, r.effort])).toEqual([['review-correctness', 'high'], ['review-security', 'high']]);
    expect(out.review.flags).toEqual(['--sensitive']);
  });
  it('the same diff launching git stays Small, with no sinks and the light review', () => {
    const out = triage(added('src/ui/footer.ts', ["execFileSync('git', ['log', '-1']);"]));
    expect(out.path).toBe('small');
    expect(out).not.toHaveProperty('sinks');
    expect(out.review.light).toBe(true);
  });
});
