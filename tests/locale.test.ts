import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { planLocale, replyIn, sessionReply } from '../src/lib/locale.js';
import { useTempDirs } from './helpers/tmp.js';
const tmp = useTempDirs();

describe('replyIn', () => {
  it('names the plan language so a hook text does not drag the session into English', () => {
    expect(replyIn('es')).toBe(" Tell the user in Spanish (es), the plan's language.");
    expect(replyIn('pt-BR')).toContain('Portuguese (pt)');
    expect(replyIn('xx')).toContain('«xx»');
    expect(replyIn(null)).toBe(' Tell the user in their own language.');
  });
  it('names the language the person writes in when it comes from the run or the execution', () => {
    expect(replyIn('es', 'person')).toBe(' Tell the user in Spanish (es), the language they write in.');
    expect(replyIn('en', 'person')).toBe(' Tell the user in English (en), the language they write in.');
    expect(replyIn('xx', 'person')).toBe(' Tell the user in «xx», the language they write in.');
    expect(replyIn(null, 'person')).toBe(' Tell the user in their own language.');
    expect(replyIn('es', 'plan')).toBe(" Tell the user in Spanish (es), the plan's language.");
  });
});

describe('sessionReply', () => {
  it('prefers the run, then the execution, then the plan; null when none is known', () => {
    expect(sessionReply({ locale: 'es' }, { locale: 'en' }, () => 'fr')).toBe(' Tell the user in Spanish (es), the language they write in.');
    expect(sessionReply(null, { locale: 'en' }, () => 'fr')).toBe(' Tell the user in English (en), the language they write in.');
    expect(sessionReply({}, null, () => 'fr')).toBe(" Tell the user in French (fr), the plan's language.");
    expect(sessionReply(null, null, () => null)).toBeNull();
  });
});

describe('planLocale', () => {
  const plan = (locale: string) => `project: demo\nlocale: ${locale}\nversion: "0.1"\nversions: [{ id: "0.1", phases: [F1] }]\ntracks: [{ id: a, name: A, color: blue }]\nphases: [{ id: F1, name: One, plan_status: committed }]\ntasks:\n  - { id: T001, title: x, track: a, phase: F1, done_when: y, zones: ["src/**"], estimate_min: 10 }\n`;
  it('reads the named project, else the only one, and is null without a plan', () => {
    const root = tmp('locale-');
    expect(planLocale(root)).toBeNull();
    mkdirSync(path.join(root, 'docs', 'waypoint', 'demo'), { recursive: true });
    writeFileSync(path.join(root, 'docs', 'waypoint', 'demo', 'plan.yaml'), plan('es'));
    expect(planLocale(root, 'demo')).toBe('es');
    expect(planLocale(root)).toBe('es');
    expect(planLocale(root, 'other')).toBeNull();
  });
  it('is null for a plan without locale (no English default)', () => {
    const root = tmp('locale-');
    mkdirSync(path.join(root, 'docs', 'waypoint', 'demo'), { recursive: true });
    writeFileSync(path.join(root, 'docs', 'waypoint', 'demo', 'plan.yaml'), plan('es').replace('locale: es\n', ''));
    expect(planLocale(root, 'demo')).toBeNull();
    expect(planLocale(root)).toBeNull();
  });
});
