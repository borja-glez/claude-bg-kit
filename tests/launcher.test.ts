import { describe, it, expect } from 'vitest';
import { launchRun, herdrRun, HERDR_TEMPLATE, EFFORTS, MODELS } from '../src/lib/launcher.js';

describe('launchRun', () => {
  const x = { name: 'wp-shop-T1', prompt: '/forge:member --plan p.yaml --task T1 — run member of S1: work only T1, then stop', worktree: "/r/it's/task-T1" };
  it('bg runs claude --bg inside the worktree without moving the caller', () => {
    expect(launchRun('bg', x)).toBe(`(cd '/r/it'\\''s/task-T1' && claude --bg --name wp-shop-T1 "${x.prompt}")`);
  });
  it('bg puts --effort and --model before the quoted prompt, unquoted', () => {
    expect(launchRun('bg', { ...x, effort: 'medium' })).toBe(`(cd '/r/it'\\''s/task-T1' && claude --bg --name wp-shop-T1 --effort medium "${x.prompt}")`);
    expect(launchRun('bg', { ...x, effort: 'high', model: 'sonnet' })).toBe(`(cd '/r/it'\\''s/task-T1' && claude --bg --name wp-shop-T1 --effort high --model sonnet "${x.prompt}")`);
  });
  it('the herdr template gets the same flags in its command', () => {
    const r = herdrRun('herdr open --name {name} --cwd {cwd} -- {command}', { ...x, effort: 'medium', model: 'opus' });
    expect(r).toBe(`herdr open --name wp-shop-T1 --cwd '/r/it'\\''s/task-T1' -- claude --name wp-shop-T1 --effort medium --model opus "${x.prompt}"`);
  });
  it('the closed lists', () => {
    expect([...EFFORTS]).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect([...MODELS]).toEqual(['opus', 'sonnet', 'haiku']);
  });
  it('herdr follows the spike: a pane command with the name and worktree, or null', () => {
    const r = launchRun('herdr', x);
    if (HERDR_TEMPLATE === null) expect(r).toBeNull();
    else {
      expect(r).toContain('wp-shop-T1');
      expect(r).toContain("'/r/it'\\''s/task-T1'");
      expect(r).not.toContain('--bg');
    }
  });
});
