import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { planLocale, replyIn } from '../src/lib/locale.js';

describe('replyIn', () => {
  it('names the plan language so a hook text does not drag the session into English', () => {
    expect(replyIn('es')).toBe(" Tell the user in Spanish (es), the plan's language.");
    expect(replyIn('pt-BR')).toContain('Portuguese (pt)');
    expect(replyIn('xx')).toContain('«xx»');
    expect(replyIn(null)).toBe(' Tell the user in their own language.');
  });
});

describe('planLocale', () => {
  const plan = (locale: string) => `project: demo\nlocale: ${locale}\nversion: "0.1"\nversions: [{ id: "0.1", phases: [F1] }]\ntracks: [{ id: a, name: A, color: blue }]\nphases: [{ id: F1, name: One, plan_status: committed }]\ntasks:\n  - { id: T001, title: x, track: a, phase: F1, done_when: y, zones: ["src/**"], estimate_min: 10 }\n`;
  it('reads the named project, else the only one, and is null without a plan', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'locale-'));
    expect(planLocale(root)).toBeNull();
    mkdirSync(path.join(root, 'docs', 'waypoint', 'demo'), { recursive: true });
    writeFileSync(path.join(root, 'docs', 'waypoint', 'demo', 'plan.yaml'), plan('es'));
    expect(planLocale(root, 'demo')).toBe('es');
    expect(planLocale(root)).toBe('es');
    expect(planLocale(root, 'other')).toBeNull();
  });
});
