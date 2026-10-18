import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { checkSpTask, markDone, parseSpPlan, renderSpBrief, sddComplete, SpPlanError } from '../src/lib/sp-plan.js';
import { run, type Io } from '../src/forge/cli/run.js';
import { useTempDirs } from './helpers/tmp.js';
const tmp = useTempDirs();

// LF here whatever git checked out; the CRLF case is built from it.
const PLAN = readFileSync(new URL('./fixtures/sp-plan.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const TDD = 'TDD: required. Read and follow `/sp/skills/test-driven-development/SKILL.md`. Report the failing run and then the passing run of the new tests.';

describe('parseSpPlan', () => {
  it('reads the header, the global constraints and every task with its files, steps and state', () => {
    expect(parseSpPlan(PLAN)).toEqual({
      plan: {
        title: 'Cart Totals', goal: 'Show the cart total with taxes on the checkout page.',
        architecture: '- `src/cart/total.ts` computes the total.\n- `src/ui/Checkout.tsx` shows it.',
        techStack: 'TypeScript, vitest', spec: 'docs/superpowers/specs/2026-10-01-cart-totals-design.md',
      },
      constraints: '- Amounts are integers in cents.\n- No new dependencies.',
      reviewFocus: null,
      tasks: [
        { n: 1, title: 'Total function', files: ['src/cart/total.ts', 'tests/cart/total.test.ts'], steps: 3, done: true },
        { n: 2, title: 'Taxes', files: ['src/cart/total.ts', 'tests/cart/total.test.ts'], steps: 3, done: false },
        { n: 3, title: 'Checkout shows the total', files: ['src/ui/Checkout.tsx'], steps: 2, done: false },
      ],
    });
  });
  it('a task without boxes is not done, and a plan without a title or header still parses', () => {
    expect(parseSpPlan('### Task 1: x\n\nno boxes\n')).toEqual({
      plan: { title: '', goal: '', architecture: '', techStack: '', spec: null }, constraints: null, reviewFocus: null,
      tasks: [{ n: 1, title: 'x', files: [], steps: 0, done: false }],
    });
  });
  it('ignores tasks, boxes and headings inside backtick fences of any length', () => {
    const text = '### Task 1: a\n\n````md\n```\n### Task 2: inside\n- [ ] inside\n```\n## inside\n````\n\n- [ ] real\n';
    expect(parseSpPlan(text).tasks).toEqual([{ n: 1, title: 'a', files: [], steps: 1, done: false }]);
  });
  it('reads the Review Focus, takes the spec path out of its paragraph, and explains a sub-numbered task', () => {
    const text = PLAN
      .replace('## Global Constraints', '## Review Focus\n\n1. Empty carts.\n\n## Global Constraints')
      .replace('**Spec:** `docs/superpowers/specs/2026-10-01-cart-totals-design.md`', '**Spec:** `docs/s.md`: §4 and §6');
    const p = parseSpPlan(text);
    expect(p.reviewFocus).toBe('1. Empty carts.');
    expect(p.plan.spec).toBe('docs/s.md');
    const md = renderSpBrief(text, 2, { planPath: 'p.md' });
    expect(md).toContain('## Review Focus\n\n1. Empty carts.');
    expect(md).toContain('Spec: docs/s.md\n');
    expect(() => parseSpPlan('### Task 1: a\n\n- [ ] x\n\n### Task 1.5: b\n\n- [ ] y\n')).toThrow(/"### Task 1\.5" has a sub-number/);
  });
  it('refuses a code fence left open, naming its line, instead of dropping the tasks after it', () => {
    const open = PLAN.replace('~~~ts\nexport function', '```ts\nexport function');
    expect(() => parseSpPlan(open)).toThrow(/unclosed code fence opened at line \d+/);
  });
  it('refuses a plan without tasks and a task number used twice', () => {
    expect(() => parseSpPlan('# Plan\n\n**Goal:** x\n\n```md\n### Task 1: in code\n```\n')).toThrow(SpPlanError);
    expect(() => parseSpPlan(`${PLAN}\n### Task 2: again\n\n- [ ] x\n`)).toThrow(/task 2 appears twice/);
  });
});

describe("superpowers' own progress ledger", () => {
  const LEDGER = '# SDD ledger — plan: docs/superpowers/plans/cart.md\n\nTask 2: complete (commits a1b2c3d..d4e5f6a, tests: npm test → 3/3 pass)\nTask 3: Ruling: x\n';
  it('reads the tasks a ledger of this plan marks complete', () => {
    expect(sddComplete(LEDGER, 'docs/superpowers/plans/cart.md')).toEqual([2]);
    expect(sddComplete(LEDGER.replace('\n', '\r\n'), 'docs/superpowers/plans/cart.md')).toEqual([2]);
    expect(sddComplete(LEDGER.replace('plan: docs', 'plan: E:/repo/docs'), 'docs/superpowers/plans/cart.md')).toEqual([2]);
  });
  it('ignores a ledger of another plan or without its first line', () => {
    expect(sddComplete(LEDGER, 'docs/superpowers/plans/other.md')).toEqual([]);
    expect(sddComplete('Task 2: complete\n', 'docs/superpowers/plans/cart.md')).toEqual([]);
  });
  it('markDone sets those tasks done', () => {
    expect(markDone(parseSpPlan(PLAN), [3]).tasks.map(t => t.done)).toEqual([true, false, true]);
  });
});

describe('checkSpTask', () => {
  it('ticks only the boxes of that task, outside code, and is idempotent', () => {
    const r = checkSpTask(PLAN, 2);
    expect(r.checked).toBe(2);
    expect(parseSpPlan(r.text).tasks.map(t => t.done)).toEqual([true, true, false]);
    const before = PLAN.split('\n');
    expect(r.text.split('\n').filter((l, i) => l !== before[i])).toEqual(['- [x] **Step 2: Implement**', '- [x] **Step 3: Commit**']);
    expect(r.text).toContain('- [ ] not a step');
    expect(r.text).toContain('- [ ] not part of task 3');
    expect(checkSpTask(r.text, 2)).toEqual({ text: r.text, checked: 0 });
  });
  it('keeps CRLF line endings', () => {
    const crlf = PLAN.replace(/\n/g, '\r\n');
    const r = checkSpTask(crlf, 3);
    expect(r.checked).toBe(2);
    expect(r.text).toBe(crlf.replace('- [ ] **Step 1: Render the total**', '- [x] **Step 1: Render the total**').replace('- [ ] **Step 2: Commit**', '- [x] **Step 2: Commit**'));
  });
  it('refuses a task that is not in the plan', () => {
    expect(() => checkSpTask(PLAN, 9)).toThrow(SpPlanError);
  });
});

describe('renderSpBrief', () => {
  it('carries the header, the global constraints, the literal task body and the rules', () => {
    const md = renderSpBrief(PLAN, 2, { planPath: 'docs/superpowers/plans/cart.md' });
    expect(md.startsWith('# Task 2 — Taxes\n')).toBe(true);
    for (const s of ['Plan: docs/superpowers/plans/cart.md', 'Spec: docs/superpowers/specs/2026-10-01-cart-totals-design.md',
      '**Goal:** Show the cart total', '**Tech Stack:** TypeScript, vitest', '## Global Constraints', '- Amounts are integers in cents.',
      'Work only in the files this task lists', "Commit as the task's last step says", 'forge ticks them when the task is accepted']) expect(md).toContain(s);
    const body = PLAN.slice(PLAN.indexOf('**Files:**\n- Modify'), PLAN.indexOf('### Task 3')).trimEnd();
    expect(md).toContain(body);
    expect(md).not.toContain('Checkout shows the total');
    expect(md).not.toContain('TDD: required');
  });
  it('adds the TDD line when given, and refuses an unknown task', () => {
    expect(renderSpBrief(PLAN, 2, { planPath: 'p.md', tdd: TDD })).toContain(`\n${TDD}\n`);
    expect(() => renderSpBrief(PLAN, 7, { planPath: 'p.md' })).toThrow(SpPlanError);
  });
});

describe('forge sp-plan, brief and triage with a superpowers plan', () => {
  const F = 'docs/superpowers/plans/cart.md';
  let root: string;
  let io: Io;
  beforeEach(() => {
    root = tmp('forge-sp-');
    mkdirSync(path.join(root, 'docs', 'superpowers', 'plans'), { recursive: true });
    writeFileSync(path.join(root, F), PLAN.replace(/\n/g, '\r\n'));
    io = { cwd: root, now: () => new Date('2026-10-13T10:00:00.000Z'), git: () => null };
  });
  it('tasks prints the plan and its tasks', () => {
    const r = JSON.parse(run(['sp-plan', 'tasks', F], io).stdout);
    expect(r.plan).toMatchObject({ title: 'Cart Totals', goal: 'Show the cart total with taxes on the checkout page.' });
    expect(r.tasks.map((t: { n: number; done: boolean }) => [t.n, t.done])).toEqual([[1, true], [2, false], [3, false]]);
  });
  it('check ticks one task in the file, keeping CRLF, and is idempotent', () => {
    expect(JSON.parse(run(['sp-plan', 'check', F, '--task', '2'], io).stdout)).toEqual({ task: 2, checked: 2 });
    const text = readFileSync(path.join(root, F), 'utf8');
    expect(text).toContain('- [x] **Step 3: Commit**\r\n');
    expect(text.replace(/\r\n/g, '')).not.toContain('\n');
    expect(JSON.parse(run(['sp-plan', 'check', F, '--task', '2'], io).stdout)).toEqual({ task: 2, checked: 0 });
  });
  it('refuses an unknown task, a missing --task, a plan without tasks and a missing file, leaving the plan as it was', () => {
    const before = readFileSync(path.join(root, F), 'utf8');
    for (const argv of [['sp-plan', 'check', F, '--task', '9'], ['sp-plan', 'check', F], ['sp-plan', 'check', F, '--task', 'x'], ['brief', '--superpowers-plan', F, '--task', '9'],
      ['brief', '--superpowers-plan', F], ['sp-plan', 'tasks', 'missing.md'], ['sp-plan', 'nope', F], ['sp-plan', 'tasks']]) {
      expect(run(argv, io).code).toBe(2);
    }
    expect(run(['sp-plan', 'check', F, '--task', '9'], io).stderr).toContain('task 9 is not in the plan');
    expect(run(['brief', '--superpowers-plan', F, '--task', '9'], io).stderr).toContain('task 9 is not in the plan');
    writeFileSync(path.join(root, 'empty.md'), '# Plan\n\nno tasks\n');
    expect(run(['sp-plan', 'tasks', 'empty.md'], io).code).toBe(2);
    expect(run(['brief', '--superpowers-plan', 'empty.md', '--task', '1'], io).code).toBe(2);
    expect(readFileSync(path.join(root, F), 'utf8')).toBe(before);
  });
  it("tasks and triage count the tasks superpowers' own ledger marks complete, and ignore another plan's ledger", () => {
    const ws = path.join(root, '.superpowers', 'sdd', 'cart');
    mkdirSync(ws, { recursive: true });
    writeFileSync(path.join(ws, 'progress.md'), `# SDD ledger — plan: ${F}\n\nTask 2: complete (commits a..b, tests: x → 1/1 pass)\n`);
    expect(JSON.parse(run(['sp-plan', 'tasks', F], io).stdout).tasks.map((t: { done: boolean }) => t.done)).toEqual([true, true, false]);
    const git = (a: string[]) => (a.includes('ls-files') ? 'src/cart/total.ts\nsrc/ui/Checkout.tsx\nsrc/a.ts\nsrc/b.ts\nsrc/c.ts\n' : a.includes('rev-list') ? '40\n' : null);
    expect(JSON.parse(run(['triage', '--task', 'cart', '--superpowers-plan', F], { ...io, git }).stdout).files).toEqual(['src/ui/Checkout.tsx']);
    // A workspace whose marker names another plan is not this plan's.
    writeFileSync(path.join(ws, 'plan-path'), 'docs/other/cart.md\n');
    expect(JSON.parse(run(['sp-plan', 'tasks', F], io).stdout).tasks.map((t: { done: boolean }) => t.done)).toEqual([true, false, false]);
  });
  it('brief prints the brief of one task', () => {
    const r = run(['brief', '--superpowers-plan', F, '--task', '2'], io);
    expect(r.code).toBe(0);
    expect(r.stdout.startsWith('# Task 2 — Taxes')).toBe(true);
    expect(r.stdout).toContain(`Plan: ${F}`);
  });
  it('triage takes the pending tasks and their files, and always takes the Medium path', () => {
    const tracked = ['src/cart/total.ts', 'src/ui/Checkout.tsx', 'src/a.ts', 'src/b.ts', 'src/c.ts', 'README.md'].join('\n');
    const git = (a: string[]) => (a.includes('ls-files') ? `${tracked}\n` : a.includes('rev-list') ? '40\n' : null);
    const r = JSON.parse(run(['triage', '--task', 'cart', '--superpowers-plan', F], { ...io, git }).stdout);
    expect(r.path).toBe('medium');
    expect(r.files).toEqual(expect.arrayContaining(['src/cart/total.ts', 'src/ui/Checkout.tsx']));
    expect(r.reasons).toContain('superpowers plan: the Medium path, its tasks in order');
    expect(r.implementer).toMatchObject({ role: 'impl' });
    expect(run(['triage', '--task', 'cart', '--superpowers-plan'], { ...io, git }).code).toBe(2);
  });
});
