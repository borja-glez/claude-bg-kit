import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkSpTask, parseSpPlan, renderSpBrief, SpPlanError } from '../src/lib/sp-plan.js';

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
      tasks: [
        { n: 1, title: 'Total function', files: ['src/cart/total.ts', 'tests/cart/total.test.ts'], steps: 3, done: true },
        { n: 2, title: 'Taxes', files: ['src/cart/total.ts', 'tests/cart/total.test.ts'], steps: 3, done: false },
        { n: 3, title: 'Checkout shows the total', files: ['src/ui/Checkout.tsx'], steps: 2, done: false },
      ],
    });
  });
  it('a task without boxes is not done, and a plan without a title or header still parses', () => {
    expect(parseSpPlan('### Task 1: x\n\nno boxes\n')).toEqual({
      plan: { title: '', goal: '', architecture: '', techStack: '', spec: null }, constraints: null,
      tasks: [{ n: 1, title: 'x', files: [], steps: 0, done: false }],
    });
  });
  it('ignores tasks, boxes and headings inside backtick fences of any length', () => {
    const text = '### Task 1: a\n\n````md\n```\n### Task 2: inside\n- [ ] inside\n```\n## inside\n````\n\n- [ ] real\n';
    expect(parseSpPlan(text).tasks).toEqual([{ n: 1, title: 'a', files: [], steps: 1, done: false }]);
  });
  it('refuses a plan without tasks and a task number used twice', () => {
    expect(() => parseSpPlan('# Plan\n\n**Goal:** x\n\n```md\n### Task 1: in code\n```\n')).toThrow(SpPlanError);
    expect(() => parseSpPlan(`${PLAN}\n### Task 2: again\n\n- [ ] x\n`)).toThrow(/task 2 appears twice/);
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
