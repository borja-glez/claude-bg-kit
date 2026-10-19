import { describe, it, expect } from 'vitest';
import { launchCommand, launchRun, EFFORTS, MODELS, PLAN_PATH } from '../src/lib/launcher.js';

describe('launchRun', () => {
  const x = { name: 'wp-shop-T1', prompt: '/forge:member --plan p.yaml --task T1 — run member of S1: work only T1, then stop', worktree: "/r/it's/task-T1" };
  it('runs claude --bg inside the worktree without moving the caller', () => {
    expect(launchRun(x)).toBe(`(cd '/r/it'\\''s/task-T1' && claude --bg --name wp-shop-T1 "${x.prompt}")`);
  });
  it('puts --effort and --model before the quoted prompt, unquoted; launchCommand is the same command without the cd', () => {
    expect(launchRun({ ...x, effort: 'medium' })).toBe(`(cd '/r/it'\\''s/task-T1' && claude --bg --name wp-shop-T1 --effort medium "${x.prompt}")`);
    expect(launchRun({ ...x, effort: 'high', model: 'sonnet' })).toBe(`(cd '/r/it'\\''s/task-T1' && claude --bg --name wp-shop-T1 --effort high --model sonnet "${x.prompt}")`);
    expect(launchCommand({ name: x.name, prompt: x.prompt, effort: 'high', model: 'sonnet' })).toBe(`claude --bg --name wp-shop-T1 --effort high --model sonnet "${x.prompt}"`);
  });
  it('launchRun ends with launchCommand, so waypoint and forge compose the same command (I-18)', () => {
    for (const spec of [x, { ...x, effort: 'high' as const }, { ...x, effort: 'low' as const, model: 'haiku' as const }]) {
      expect(launchRun(spec).endsWith(`${launchCommand(spec)})`), JSON.stringify(spec)).toBe(true);
    }
  });
  it('the closed lists', () => {
    expect([...EFFORTS]).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect([...MODELS]).toEqual(['opus', 'sonnet', 'haiku']);
  });
  it('herdr was removed: one launcher and no template (I-18)', async () => {
    expect(Object.keys(await import('../src/lib/launcher.js')).sort()).toEqual(['EFFORTS', 'MODELS', 'PLAN_PATH', 'launchCommand', 'launchRun']);
  });
  it('PLAN_PATH, the one rule forge and waypoint share for a plan path in a launch: no quote, $, backtick or ; (A-19)', () => {
    for (const ok of ['docs/waypoint/p/plan.yaml', 'C:\\w\\plan.yaml', 'my plans/plan.yaml']) expect(PLAN_PATH.test(ok), ok).toBe(true);
    for (const bad of ['plan$(x).yaml', 'a;b.yaml', 'plan`x`.yaml', 'plan".yaml']) expect(PLAN_PATH.test(bad), bad).toBe(false);
  });
});
