import { describe, it, expect } from 'vitest';
import { buildPanelModel, planFileOf, type Activity } from '../src/lens/model.js';
import { buildCards, type CardTexts } from '../src/lens/cards.js';
import { headline } from '../src/lens/view.js';
import { noneBand } from '../src/mod/model.js';

// w8 M4: superpowers 7.0.0's SDD writes the plan's path absolute, in the ledger's header and in its plan-path file, in the
// forms this repository's own ledgers hold: `X:/…`, `X:\…` (a worktree's too) and msys `/x/…`; plan-path also relative.
describe('the plan a superpowers ledger names (w8 M4)', () => {
  const WIN = 'C:\\repo';
  const MAIN_OF_WT = 'C:/repo';
  it('a relative .md path is read under the root; one that climbs out, or is no .md, is not', () => {
    expect(planFileOf('docs/superpowers/plans/x.md', ['/repo'])).toBe('/repo/docs/superpowers/plans/x.md');
    expect(planFileOf('docs\\superpowers\\plans\\x.md', ['/repo'])).toBe('/repo/docs/superpowers/plans/x.md');
    expect(planFileOf('../other/x.md', ['/repo'])).toBeNull();
    expect(planFileOf('docs/x.txt', ['/repo'])).toBeNull();
    expect(planFileOf('', ['/repo'])).toBeNull();
  });
  it('an absolute path inside the root, whatever its spelling, is read there', () => {
    for (const p of ['C:/repo/docs/superpowers/plans/x.md', 'C:\\repo\\docs\\superpowers\\plans\\x.md', '/c/repo/docs/superpowers/plans/x.md', 'c:/Repo/docs/superpowers/plans/x.md']) {
      expect(planFileOf(p, [WIN]), p).toBe('C:\\repo/docs/superpowers/plans/x.md');
    }
    // A worktree of the root, under .claude/worktrees, is inside it.
    expect(planFileOf('C:\\repo\\.claude\\worktrees\\w1\\docs\\superpowers\\plans\\y.md', [WIN])).toBe('C:\\repo/.claude/worktrees/w1/docs/superpowers/plans/y.md');
    expect(planFileOf('/c/repo/.claude/worktrees/w1/docs/superpowers/plans/y.md', ['/c/repo'])).toBe('/c/repo/.claude/worktrees/w1/docs/superpowers/plans/y.md');
  });
  it("from a worktree, a plan in its main checkout is read there; one outside both is not", () => {
    const bases = ['C:/repo/.claude/worktrees/w1', MAIN_OF_WT];
    expect(planFileOf('/c/repo/docs/superpowers/plans/x.md', bases)).toBe('C:/repo/docs/superpowers/plans/x.md');
    expect(planFileOf('C:/repo/.claude/worktrees/w1/docs/p.md', bases)).toBe('C:/repo/.claude/worktrees/w1/docs/p.md');
    expect(planFileOf('C:/elsewhere/docs/x.md', bases)).toBeNull();
    expect(planFileOf('D:/repo/docs/x.md', bases)).toBeNull();
    expect(planFileOf('C:/repo-other/docs/x.md', [MAIN_OF_WT])).toBeNull();
    expect(planFileOf('C:/repo/docs/../../x.md', [MAIN_OF_WT])).toBeNull();
  });
  it('a header that names a section after the path still names the path', () => {
    expect(planFileOf('docs/superpowers/specs/design.md §M', ['/repo'])).toBe('/repo/docs/superpowers/specs/design.md');
  });
});

describe('a superpowers card with no plan to count against (w8 M4)', () => {
  const act = (): Activity => ({ tool: null, turnSince: null, todos: undefined, subagents: [], ccTasks: [] });
  const LEDGER = '# SDD ledger — plan: C:/elsewhere/plan.md\n\n## Progress\nTask 1: complete (a)\nTask 2: complete (b)\nTask 3: complete (c)\n';
  const T = new Proxy({}, { get: (_t, k) => (k === 'stage' || k === 'needKind' ? {} : String(k)) }) as unknown as CardTexts;
  it('has no total: the done count alone, never the highest task done as 100 %', () => {
    const m = buildPanelModel({ band: noneBand(), activity: act(), now: 1000, ledger: LEDGER });
    expect(m.superpowers).toMatchObject({ tasks: null, done: 3 });
    const card = buildCards(m, T, 0).find(c => c.id === 'superpowers')!;
    expect(card.chip?.text).toBe('3 done');
    expect(JSON.stringify(card)).not.toMatch(/%/);
    expect(m.activities.find(a => a.kind === 'superpowers')).toMatchObject({ done: false });
    expect(headline(m)).toMatchObject({ section: 'superpowers', cells: { total: 0 } });
  });
  it('one unchanged for a day with no fix round open is history, as a finished one is', () => {
    const day = 24 * 3600_000;
    const at = (ledger: string) => buildPanelModel({ band: noneBand(), activity: act(), now: 10 * day, ledger, ledgerMtimeMs: 10 * day - day - 1 }).superpowers;
    expect(at(LEDGER)).toBeNull();
    expect(at(`${LEDGER}Task 4: fix round 1/3 (x)\n`)).toMatchObject({ tasks: null, stale: true, current: { task: '4' } });
  });
  it('the plan read names the card, relative, whatever the header spelled', () => {
    const PLAN = '# Plan\n\n### Task 1: A\n- [ ] a\n### Task 2: B\n- [ ] b\n';
    const m = buildPanelModel({ band: noneBand(), activity: act(), now: 1000, ledger: LEDGER, ledgerPlan: PLAN, ledgerPlanPath: 'docs/superpowers/plans/x.md' });
    expect(m.superpowers).toMatchObject({ plan: 'docs/superpowers/plans/x.md', tasks: 2, done: 2 });
  });
});
