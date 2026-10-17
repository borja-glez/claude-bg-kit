import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { changedSections, DesignError, designBody, designStatus, parseDesign, sectionsOf, setDesignStatus, slugify, wordCount } from '../src/lib/design.js';

const fixture = readFileSync(new URL('./fixtures/design.md', import.meta.url), 'utf8');
const issuesOf = (t: string) => { try { parseDesign(t); } catch (e) { if (e instanceof DesignError) return e.issues; throw e; } throw new Error('expected DesignError'); };

describe('parseDesign', () => {
  it('parses front matter with defaults and sections', () => {
    const d = parseDesign(fixture);
    expect(d.meta).toMatchObject({ title: 'Tienda Demo', project: 'demo-shop', locale: 'es', status: 'draft', start_prompt: '/waypoint:work backend' });
    expect(d.meta.pillars).toHaveLength(2);
    expect(d.sections.map(s => [s.level, s.slug])).toEqual([[2, 'alcance'], [3, 'fuera-de-alcance'], [2, 'arquitectura'], [2, 'riesgos']]);
    expect(d.sections[0].text).toContain('pedidos, carrito');
    expect(d.sections[0].text).not.toContain('Multi-divisa');
    expect(d.words).toBeGreaterThan(20);
  });

  it('defaults locale, start_prompt and pillars', () => {
    const d = parseDesign('---\ntitle: X\nproject: p\nsummary: S\n---\n\n## A\n\nb\n');
    expect(d.meta).toMatchObject({ locale: 'en', start_prompt: '/waypoint:work <track>', pillars: [], status: 'draft' });
  });

  it('reports every front matter problem at once', () => {
    const issues = issuesOf('---\nproject: "bad id!"\nsummary: 5\nstatus: done\npillars: [{title: ""}]\n---\nbody');
    expect(issues.some(i => i.startsWith('title:'))).toBe(true);
    expect(issues.some(i => i.startsWith('project:'))).toBe(true);
    expect(issues.some(i => i.startsWith('summary:'))).toBe(true);
    expect(issues.some(i => i.startsWith('status:'))).toBe(true);
    expect(issues.some(i => i.startsWith('pillars.0'))).toBe(true);
  });

  it('rejects a missing or broken front matter block', () => {
    expect(issuesOf('## Just a body')[0]).toMatch(/front matter/);
    expect(issuesOf('---\ntitle: [unclosed\n---\nx')[0]).toMatch(/^YAML: /);
  });

  it('accepts status parked, and setDesignStatus changes only the front matter (K3-13)', () => {
    expect(parseDesign('---\ntitle: X\nproject: p\nsummary: S\nstatus: parked\n---\nbody\n').meta.status).toBe('parked');
    const parked = setDesignStatus(fixture, 'parked');
    expect(parseDesign(parked).meta.status).toBe('parked');
    expect(parked.slice(parked.indexOf('\n---\n'))).toBe(fixture.slice(fixture.indexOf('\n---\n')));
    const back = setDesignStatus(parked, 'draft');
    expect(parseDesign(back).meta.status).toBe('draft');
    expect(back.match(/^status:/gm)).toHaveLength(1);
    const crlf = setDesignStatus('---\r\ntitle: X\r\nproject: p\r\nsummary: S\r\nstatus: draft\r\n---\r\nbody\r\n', 'parked');
    expect(crlf).toBe('---\r\ntitle: X\r\nproject: p\r\nsummary: S\r\nstatus: parked\r\n---\r\nbody\r\n');
    const bom = String.fromCharCode(0xfeff);
    expect(setDesignStatus(`${bom}${fixture}`, 'parked').startsWith(`${bom}---`)).toBe(true);
  });

  it('setDesignStatus leaves a status line in the body alone', () => {
    const t = '---\ntitle: X\nproject: p\nsummary: S\n---\nbody\nstatus: approved\n';
    expect(setDesignStatus(t, 'parked')).toBe('---\ntitle: X\nproject: p\nsummary: S\nstatus: parked\n---\nbody\nstatus: approved\n');
  });
});

describe('sections and words', () => {
  it('slugifies accents, punctuation and spaces', () => {
    expect(slugify('Fuera de alcance (v0.1)!')).toBe('fuera-de-alcance-v0-1');
    expect(slugify('Diseño técnico')).toBe('diseno-tecnico');
  });
  it('disambiguates duplicate headings', () => {
    expect(sectionsOf('## A\n\nx\n\n## A\n\ny\n').map(s => s.slug)).toEqual(['a', 'a-2']);
  });
  it('carry 8: a long heading gives a slug of at most 80 characters, its -2 added after the cut, so a design_ref can name it', () => {
    const heading = `${'Una sección con un título muy largo '.repeat(4)}y más`;
    const slug = slugify(heading);
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug).not.toMatch(/-$/);
    const slugs = sectionsOf(`## ${heading}\n\nx\n\n## ${heading}\n\ny\n\n## ${heading}\n\nz\n`).map(s => s.slug);
    expect(slugs).toHaveLength(3);
    expect(new Set(slugs).size).toBe(3);
    for (const s of slugs) expect(s, s).toMatch(/^[a-z0-9-]{1,80}$/);
    expect(slugs[1].endsWith('-2')).toBe(true);
    expect(slugs[2].endsWith('-3')).toBe(true);
  });
  it('ignores headings inside fenced code', () => {
    expect(sectionsOf('## A\n\n```md\n## not a heading\n```\n').map(s => s.slug)).toEqual(['a']);
  });
  it('counts words of the body only', () => {
    expect(wordCount('uno dos\n\n## tres\n\n`cuatro` cinco')).toBe(5);
  });
});

describe('changedSections', () => {
  it('reports new and modified sections by slug, and nothing removed', () => {
    const prev = '## A\n\nuno\n\n## B\n\ndos\n';
    const next = '## A\n\nuno\n\n## B\n\ndos cambiado\n\n## C\n\ntres\n';
    expect(changedSections(prev, next)).toEqual({ changed: ['b', 'c'], removed: [] });
  });
  it('a renamed section counts as new, and the old one as removed (K3-14)', () => {
    expect(changedSections('## A\n\nx\n', '## A2\n\nx\n')).toEqual({ changed: ['a2'], removed: ['a'] });
  });
  it('whitespace-only edits are not changes', () => {
    expect(changedSections('## A\n\nx  y\n', '## A\n\nx y\n\n')).toEqual({ changed: [], removed: [] });
  });
  it('removed sections are listed in the order of the older text (K3-14)', () => {
    expect(changedSections('## A\n\nx\n\n## B\n\ny\n\n## C\n\nz\n', '## B\n\ny\n')).toEqual({ changed: [], removed: ['a', 'c'] });
  });
});

describe('fix round 1: fences, headings, BOM, intro, slugs', () => {
  it('a ~~~ line inside a backtick fence does not close it', () => {
    expect(sectionsOf('## A\n\n```\n~~~\n## H\n```\n').map(s => s.slug)).toEqual(['a']);
  });
  it('a shorter fence line does not close a longer fence', () => {
    expect(sectionsOf('## A\n\n````md\n```\n## H\n````\n').map(s => s.slug)).toEqual(['a']);
  });
  it('keeps # inside heading text and strips a closing sequence', () => {
    expect(sectionsOf('## C#\n\nx\n')[0].heading).toBe('C#');
    expect(sectionsOf('## Title ##\n\nx\n')[0].heading).toBe('Title');
    expect(sectionsOf('## Title ##\n\nx\n')[0].slug).toBe('title');
  });
  it('parses a BOM-prefixed CRLF file', () => {
    const d = parseDesign(`${String.fromCharCode(0xfeff)}---\r\ntitle: X\r\nproject: p\r\nsummary: S\r\n---\r\n\r\n## A\r\n\r\nb\r\n`);
    expect(d.meta.title).toBe('X');
    expect(d.sections[0].slug).toBe('a');
  });
  it('empty front matter reaches schema and reports missing fields', () => {
    expect(issuesOf('---\n---\nbody').some(i => i.startsWith('title:'))).toBe(true);
  });
  it('editing the intro before the first heading is a change', () => {
    expect(changedSections('Intro antes.\n\n## A\n\nx\n', 'Intro cambiada.\n\n## A\n\nx\n')).toEqual({ changed: ['_intro'], removed: [] });
  });
  it('the intro is not part of sectionsOf', () => {
    expect(sectionsOf('Intro.\n\n## A\n\nx\n').map(s => s.slug)).toEqual(['a']);
  });
  it('duplicate slugs stay unique even when a later heading collides', () => {
    const slugs = sectionsOf('## A\n\nx\n\n## A\n\ny\n\n## A 2\n\nz\n').map(s => s.slug);
    expect(new Set(slugs).size).toBe(3);
  });
});

describe('designBody (K3-03)', () => {
  it('is the text after the front matter, without validating it, and the whole text without one', () => {
    expect(designBody(fixture)).toBe(parseDesign(fixture).body);
    expect(designBody('---\nstatus: done\n---\n## A\n\nx\n')).toBe('## A\n\nx\n');
    expect(designBody('## A\n\nx\n')).toBe('## A\n\nx\n');
    expect(designBody(`${String.fromCharCode(0xfeff)}---\ntitle: X\n---\nbody\n`)).toBe('body\n');
  });
  it('a front matter change is no change of the body, while the whole files would put it in _intro', () => {
    const approved = fixture.replace('start_prompt: /waypoint:work backend', 'start_prompt: /waypoint:work backend\nstatus: approved');
    expect(changedSections(designBody(fixture), designBody(approved))).toEqual({ changed: [], removed: [] });
    expect(changedSections(fixture, approved).changed).toEqual(['_intro']);
  });
});

describe('designStatus (final review M3)', () => {
  it('reads the status of any front matter without validating it; none, junk or no front matter is null', () => {
    expect(designStatus(fixture)).toBeNull();
    expect(designStatus(fixture.replace('start_prompt: /waypoint:work backend', 'start_prompt: /waypoint:work backend\nstatus: approved'))).toBe('approved');
    expect(designStatus('---\nstatus: approved\n---\nan old version that no longer passes the schema\n')).toBe('approved');
    expect(designStatus(`${String.fromCharCode(0xfeff)}---\r\nstatus: draft\r\n---\r\nx`)).toBe('draft');
    for (const t of ['---\nstatus: [\n---\nx', '---\nstatus: 3\n---\nx', '---\n- a\n---\nx', '## no front matter\n']) expect(designStatus(t), t).toBeNull();
  });
});
