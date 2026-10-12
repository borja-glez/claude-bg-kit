import { describe, it, expect } from 'vitest';
import { launchRun, HERDR_TEMPLATE } from '../src/lib/launcher.js';

describe('launchRun', () => {
  const x = { name: 'wp-shop-T1', prompt: '/forge:run --plan p.yaml --task T1 — run member of S1: work only T1, then stop', worktree: "/r/it's/task-T1" };
  it('bg runs claude --bg inside the worktree without moving the caller', () => {
    expect(launchRun('bg', x)).toBe(`(cd '/r/it'\\''s/task-T1' && claude --bg --name wp-shop-T1 "${x.prompt}")`);
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
