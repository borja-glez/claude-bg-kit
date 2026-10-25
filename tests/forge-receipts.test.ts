import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { defaultGit } from '../src/forge/cli/run.js';
import { sameReviewedTree, taskReceipt } from '../src/forge/receipts.js';
import { gitRun, predictMerge } from '../src/forge/merge-predict.js';
import type { LedgerEvent } from '../src/forge/ledger.js';
import type { ExecutionState } from '../src/lib/execution-state.js';
import { useTempDirs } from './helpers/tmp.js';
const tmp = useTempDirs();

let root: string;
let init: string;
const g = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
/** Writes (or, with null, removes) the files, commits them all and gives the commit's tree. */
const commit = (files: Record<string, string | null>, msg: string) => {
  for (const [f, text] of Object.entries(files)) {
    const p = path.join(root, f);
    if (text === null) rmSync(p);
    else { mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, text); }
  }
  g('add', '-A'); g('commit', '-qm', msg);
  return g('rev-parse', 'HEAD^{tree}');
};

beforeEach(() => {
  root = tmp('forge-receipts-');
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 'a@b.c'); g('config', 'user.name', 't'); g('config', 'core.autocrlf', 'false');
  commit({ 'a.txt': 'a\n', '.forge/verify/web.md': '# Web\n', '.forge/verify/api.md': '# API\n' }, 'init');
  init = g('rev-parse', 'HEAD');
});

describe('the reviewed tree (A3)', () => {
  it('allows a change only in forge\'s notes, the .md files right in .forge/verify (Review Focus 4)', () => {
    const git = defaultGit(root);
    const reviewed = g('rev-parse', 'HEAD^{tree}');
    const from = (files: Record<string, string | null>) => { g('checkout', '-q', '--detach', init); return commit(files, 'next'); };
    expect(sameReviewedTree(git, reviewed, reviewed)).toEqual({ ok: true });
    expect(sameReviewedTree(git, reviewed, from({ '.forge/verify/web.md': '# Web\n- a note\n', '.forge/verify/new.md': '# New\n' }))).toEqual({ ok: true });
    expect(sameReviewedTree(git, reviewed, from({ '.forge/verify/api.md': null }))).toEqual({ ok: true });
    for (const f of ['.forge/verify/sub/x.md', '.forge/verify/web.txt', '.forge/config.yaml', 'src/a.ts']) {
      expect(sameReviewedTree(git, reviewed, from({ [f]: 'x\n' })), f).toEqual({ ok: false, changed: [f] });
    }
    expect(sameReviewedTree(git, reviewed, from({ '.forge/verify/web.md': '# Web\n- a note\n', 'a.txt': 'b\n' }))).toEqual({ ok: false, changed: ['a.txt'] });
  });
  it('a task\'s receipt is its accept\'s tree, else its round\'s head.txt in the main checkout or its worktree; none without an accept in this run', () => {
    const git = defaultGit(root);
    const head = g('rev-parse', 'HEAD'), tree = g('rev-parse', 'HEAD^{tree}');
    const e = { kind: 'plan', project: 'shop', startedAt: '2026-10-24T10:00:00.000Z' } as ExecutionState;
    const accept = (x: Partial<LedgerEvent> = {}): LedgerEvent => ({ ts: '2026-10-24T10:05:00.000Z', kind: 'verdict', task: 'T1-1', project: 'shop', action: 'accept',
      dir: '.forge/work/shop/T1/reviews-1-1', ...x });
    const wt = tmp('forge-receipts-wt-');
    const receipt = (events: LedgerEvent[]) => taskReceipt(events, e, 'T1', [root, wt], git);
    expect(receipt([])).toBe('none');
    expect(receipt([accept({ ts: '2026-10-24T09:00:00.000Z', tree })])).toBe('none');
    expect(receipt([accept({ action: 'fix', tree })])).toBe('none');
    expect(receipt([accept({ project: 'other', tree })])).toBe('none');
    expect(receipt([accept({ tree })])).toEqual({ tree });
    expect(receipt([accept()])).toBe('unknown');
    const round = path.join(wt, '.forge', 'work', 'shop', 'T1', 'reviews-1-1');
    mkdirSync(round, { recursive: true });
    writeFileSync(path.join(round, 'head.txt'), `${head}\n`);
    expect(receipt([accept()])).toEqual({ tree });
  });
});

describe('the merge prediction (A3)', () => {
  it('names the paths of a conflict as git writes them, says a clean merge, and is unverified when git cannot tell', () => {
    g('checkout', '-q', '-b', 'run'); commit({ 'dir with space/á.txt': 'run\n', 'b.txt': 'b\n' }, 'run');
    g('checkout', '-q', 'main'); commit({ 'dir with space/á.txt': 'main\n' }, 'main');
    g('checkout', '-q', '-b', 'clean', init); commit({ 'c.txt': 'c\n' }, 'clean');
    const run = gitRun(root);
    expect(predictMerge(run, 'main', 'run')).toEqual({ state: 'conflict', paths: ['dir with space/á.txt'] });
    expect(predictMerge(run, 'main', 'clean')).toEqual({ state: 'clean' });
    expect(predictMerge(run, 'main', 'no-such-branch')).toEqual({ state: 'unverified' });
    // A Git before 2.38 does not know --write-tree (exit 129); a git that did not start, or an answer that is not merge-tree's, is no prediction either.
    expect(predictMerge(() => ({ code: 129, stdout: '' }), 'main', 'run')).toEqual({ state: 'unverified' });
    expect(predictMerge(() => ({ code: null, stdout: '' }), 'main', 'run')).toEqual({ state: 'unverified' });
    expect(predictMerge(() => ({ code: 1, stdout: 'CONFLICT (content): Merge conflict in a.txt\n' }), 'main', 'run')).toEqual({ state: 'unverified' });
  });
});

describe('the texts name the receipts, the predicted conflicts and the unverified shadow (A3)', () => {
  const read = (f: string) => readFileSync(f, 'utf8');
  it('the run references and both forge READMEs', () => {
    const exec = read('plugins/forge/skills/run/references/execution.md');
    for (const w of ['`unreviewed`', 'tree changed since the final review', '`predicted: true`', 'docs/forge/decisions/']) expect(exec, w).toContain(w);
    expect(exec).not.toContain('judged by its time');
    for (const f of ['step', 'ephemeral']) expect(read(`plugins/forge/skills/run/references/${f}.md`), f).toContain('`unreviewed`');
    for (const f of ['plugins/forge/README.md', 'plugins/forge/README.es.md']) {
      const md = read(f);
      for (const w of ['`unreviewed`', 'tree changed since the final review', '`predicted`', 'git merge-tree', '.forge/verify/*.md', '`unverified`', '`tree`', 'docs/forge/decisions/']) expect(md, `${f}: ${w}`).toContain(w);
    }
    expect(read('plugins/forge/README.md')).not.toContain("by the verdict's time");
    expect(read('plugins/forge/README.es.md')).not.toContain('por la hora del veredicto');
  });
});
