import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseDesign } from '../src/lib/design.js';
import { parseChangelog } from '../src/lib/history.js';
import { parseCritique } from '../src/lib/critique.js';
import { changelogLite, critiqueLite, designMetaLite } from '../src/lib/design-lite.js';

const DESIGN = readFileSync(new URL('./fixtures/design.md', import.meta.url), 'utf8');
const START = 'start_prompt: /waypoint:work backend';
const orNull = <T>(f: () => T): T | null => { try { return f(); } catch { return null; } };
// The schema's defaults: the fixture without locale, pillars and start_prompt (and, as every variant, without status).
const DEFAULTS = DESIGN.replace('locale: es\n', '').replace(/^pillars:\n(?: {2}.*\n)+/m, '').replace(`${START}\n`, '');

describe('the readers of the design band, without zod (I-13)', () => {
  it('designMetaLite reads the front matter of a valid design as parseDesign does', () => {
    const variants = [
      DESIGN,
      DESIGN.replace(START, `${START}\nstatus: approved\nartifact: https://claude.ai/artifact/d1`),
      DESIGN.replace(START, `${START}\nstatus: parked\nsource: docs/spec.md`),
      String.fromCharCode(0xfeff) + DESIGN,
      DEFAULTS,
    ];
    for (const t of variants) expect(designMetaLite(t)).toEqual(parseDesign(t).meta);
  });
  it('designMetaLite fills in the defaults of the schema as parseDesign does', () => {
    expect(DEFAULTS).not.toMatch(/^(?:locale|pillars|start_prompt|status):/m);
    expect(designMetaLite(DEFAULTS)).toMatchObject({ locale: 'en', pillars: [], start_prompt: '/waypoint:work <track>', status: 'draft' });
  });
  it('designMetaLite is null without front matter, without a project or with a status the schema does not know', () => {
    expect(designMetaLite('no front matter')).toBeNull();
    expect(designMetaLite('---\ntitle: x\n---\nbody')).toBeNull();
    expect(designMetaLite(DESIGN.replace(START, `${START}\nstatus: frozen`))).toBeNull();
  });
  it('changelogLite reads design/changelog.json as parseChangelog does, and is null where it throws', () => {
    const entry = { version: 1, date: '2026-10-10', note: 'borrador', words: 40, round: 0 };
    const texts = [
      null, '', '  ', '[]', JSON.stringify([entry]),
      JSON.stringify([entry, { ...entry, version: 2, applied: { 1: [2, 1, 2], x: [3] }, rewrite: true, resolved: [{ round: 1, n: 2 }, { round: 1, n: 2 }], kind: 'apply', extra: 'dropped' }]),
      JSON.stringify([{ ...entry, kind: 'unknown' }]), '{oops', '{"a":1}', JSON.stringify([{ ...entry, words: '40' }]), JSON.stringify([null]),
    ];
    for (const t of texts) expect(changelogLite(t), String(t)).toEqual(orNull(() => parseChangelog(t)));
  });
  it('critiqueLite reads a critique as parseCritique does (checks, numbering and verdict), and is null where it throws', () => {
    const p = (n: number, severity = 'major') => ({ n, category: 'gap', severity, section: 'alcance', problem: 'p', change: 'c' });
    const c = (over: object) => JSON.stringify({ round: 1, version: 1, scope: 'full', proposals: [p(1), p(2, 'minor')], ...over });
    const texts = [
      c({}), c({ verdict: 'changes' }), c({ proposals: [p(1, 'minor')], verdict: 'ready' }), c({ proposals: [] }), c({ verdict: 'ready' }),
      c({ proposals: [p(2)] }), c({ round: 0 }), c({ scope: 'all' }), c({ proposals: [{ ...p(1), severity: 'huge' }] }),
      c({ proposals: [{ ...p(1), change: '' }] }), c({ verdict: 'maybe' }), '{oops', '[]',
    ];
    // w7 A2: the threads a proposal takes up read alike in the band and in the CLI (Review Focus 4).
    const t = (threads: unknown) => c({ proposals: [{ ...p(1), threads }, p(2, 'minor')] });
    texts.push(t(['t-1', 'c:42']), t(['a b']), t(['a,b']), t(['']), t([7]), t(null), t('t1'), t(Array.from({ length: 21 }, (_, i) => `t${i}`)));
    for (const t of texts) expect(critiqueLite(t), t).toEqual(orNull(() => parseCritique(t)));
  });
});
