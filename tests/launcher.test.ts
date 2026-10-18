import { describe, it, expect } from 'vitest';
import { launchCommand, launchRun, EFFORTS, MODELS } from '../src/lib/launcher.js';

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
  it('the closed lists', () => {
    expect([...EFFORTS]).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect([...MODELS]).toEqual(['opus', 'sonnet', 'haiku']);
  });
  it('herdr was removed: one launcher and no template (I-18)', async () => {
    expect(Object.keys(await import('../src/lib/launcher.js')).sort()).toEqual(['EFFORTS', 'MODELS', 'launchCommand', 'launchRun']);
  });
});
