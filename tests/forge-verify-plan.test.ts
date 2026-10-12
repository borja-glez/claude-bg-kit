import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { verifyPlan } from '../src/forge/verify.js';
import type { Surface, Draft } from '../src/forge/surfaces.js';
import { run, type Io } from '../src/forge/cli/run.js';
import { readEvents } from '../src/forge/ledger.js';

const surf = (name: string, affects: string[] | null, tools: string[] = []): Surface => ({ name, file: `.forge/verify/${name}.md`, title: name, affects, tools, hash: `h-${name}` });
// An allowance made for the surface as surf() builds it (same hash).
const local = (states: Record<string, 'allowed' | 'denied'> = {}, proposed: string[] = []) => ({
  surfaces: Object.fromEntries(Object.entries(states).map(([k, v]) => [k, v === 'allowed' ? { state: 'allowed' as const, hash: `h-${k}` } : { state: 'denied' as const, hash: null }])),
  known: [], proposed,
});
const base = { asked: false, changed: ['src/ui/Cart.tsx'], drafts: [] as Draft[], missing: () => [] as string[] };

describe('verifyPlan', () => {
  it('trivial and small never, unless asked', () => {
    for (const p of ['trivial', 'small']) {
      expect(verifyPlan({ ...base, path: p, surfaces: [surf('web', null)], local: local({ web: 'allowed' }) }).eligible).toBe(false);
    }
    expect(verifyPlan({ ...base, path: 'small', asked: true, surfaces: [surf('web', null)], local: local({ web: 'allowed' }) }).eligible).toBe(true);
  });
  it('medium and large: by affects; no affects is always a candidate', () => {
    const r = verifyPlan({ ...base, path: 'medium', surfaces: [surf('web', ['src/ui/**']), surf('api', ['src/api/**']), surf('free', null)], local: local({ web: 'allowed', api: 'allowed', free: 'allowed' }) });
    expect(r.surfaces).toEqual([
      { name: 'web', permission: 'allowed', match: 'src/ui/Cart.tsx', missing: [] },
      { name: 'free', permission: 'allowed', match: null, missing: [] },
    ]);
    expect(r.eligible).toBe(true);
  });
  it('denied drops the surface, unknown asks, ask alone is not eligible', () => {
    const r = verifyPlan({ ...base, path: 'large', surfaces: [surf('web', null), surf('app', null)], local: local({ web: 'denied' }) });
    expect(r.surfaces).toEqual([{ name: 'app', permission: 'ask', match: null, missing: [] }]);
    expect(r.eligible).toBe(false);
  });
  it('an allowed surface whose content changed asks again (changed), and is not eligible on its own', () => {
    const r = verifyPlan({ ...base, path: 'medium', surfaces: [{ ...surf('web', null), hash: 'h-new' }], local: local({ web: 'allowed' }) });
    expect(r.surfaces).toEqual([{ name: 'web', permission: 'changed', match: null, missing: [] }]);
    expect(r.eligible).toBe(false);
  });
  it('missing tools are passed through, not dropped', () => {
    const r = verifyPlan({ ...base, path: 'medium', surfaces: [surf('app', null, ['adb'])], local: local({ app: 'allowed' }), missing: s => s.tools });
    expect(r.surfaces[0].missing).toEqual(['adb']);
    expect(r.eligible).toBe(true);
  });
  it('drafts whose affects match, not yet existing or proposed', () => {
    const drafts: Draft[] = [{ name: 'web', affects: ['**/*.tsx'], tools: [], body: '' }, { name: 'android', affects: ['android/**'], tools: [], body: '' }, { name: 'ios', affects: ['**/*.tsx'], tools: [], body: '' }];
    const r = verifyPlan({ ...base, path: 'medium', drafts, surfaces: [], local: local({}, ['ios']) });
    expect(r.drafts).toEqual([{ name: 'web', match: 'src/ui/Cart.tsx' }]);
  });
  it('an unknown diff (changed null) matches nothing but keeps surfaces without affects', () => {
    const r = verifyPlan({ ...base, path: 'medium', changed: null, surfaces: [surf('web', ['src/**']), surf('free', null)], local: local({ web: 'allowed', free: 'allowed' }) });
    expect(r.surfaces.map(s => s.name)).toEqual(['free']);
    expect(r.reason).toMatch(/diff/);
  });
});

describe('forge verify-plan', () => {
  let root: string; let io: Io;
  beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), 'forge-vp-')); io = { cwd: root, now: () => new Date('2026-10-12T10:00:00Z') }; });
  it('reads surfaces, permissions and the diff, logs a verify event', () => {
    mkdirSync(path.join(root, '.forge', 'verify'), { recursive: true });
    writeFileSync(path.join(root, '.forge', 'verify', 'web.md'), '---\naffects: ["src/**"]\n---\n# Web\n');
    expect(run(['local', 'set', 'surfaces.web', 'allowed'], io).code).toBe(0);
    const git = (args: string[]) => (args[0] === 'diff' ? 'src/a.tsx\n' : null);
    const r = run(['verify-plan', '--task', 't-1', '--path', 'medium', '--base', 'abc'], { ...io, git });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ eligible: true, surfaces: [{ name: 'web', permission: 'allowed', match: 'src/a.tsx' }] });
    expect(readEvents(root).at(-1)).toMatchObject({ kind: 'verify', task: 't-1', planned: true, surfaces: ['web'] });
  });
  it('git diff failing gives changed null, not a crash', () => {
    const r = run(['verify-plan', '--task', 't-1', '--path', 'medium', '--base', 'abc'], { ...io, git: () => null });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).eligible).toBe(false);
  });
  it('needs --task, --path and --base', () => {
    expect(run(['verify-plan', '--path', 'medium', '--base', 'a'], io).code).toBe(2);
    expect(run(['verify-plan', '--task', 't', '--base', 'a'], io).code).toBe(2);
    expect(run(['verify-plan', '--task', 't', '--path', 'medium'], io).code).toBe(2);
  });
  it('verify-skip is a ledger kind', () => {
    expect(run(['log', '--kind', 'verify-skip', '--task', 't-1', '--data', '{"surface":"web","reason":"text only"}'], io).code).toBe(0);
  });
});
