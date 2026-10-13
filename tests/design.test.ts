import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { changedSections, DesignError, parseDesign, sectionsOf, slugify, wordCount } from '../src/lib/design.js';

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
});

describe('sections and words', () => {
  it('slugifies accents, punctuation and spaces', () => {
    expect(slugify('Fuera de alcance (v0.1)!')).toBe('fuera-de-alcance-v0-1');
    expect(slugify('Diseño técnico')).toBe('diseno-tecnico');
  });
  it('disambiguates duplicate headings', () => {
    expect(sectionsOf('## A\n\nx\n\n## A\n\ny\n').map(s => s.slug)).toEqual(['a', 'a-2']);
  });
  it('ignores headings inside fenced code', () => {
    expect(sectionsOf('## A\n\n```md\n## not a heading\n```\n').map(s => s.slug)).toEqual(['a']);
  });
  it('counts words of the body only', () => {
    expect(wordCount('uno dos\n\n## tres\n\n`cuatro` cinco')).toBe(5);
  });
});

describe('changedSections', () => {
  it('reports new and modified sections by slug', () => {
    const prev = '## A\n\nuno\n\n## B\n\ndos\n';
    const next = '## A\n\nuno\n\n## B\n\ndos cambiado\n\n## C\n\ntres\n';
    expect(changedSections(prev, next)).toEqual(['b', 'c']);
  });
  it('a renamed section counts as new', () => {
    expect(changedSections('## A\n\nx\n', '## A2\n\nx\n')).toEqual(['a2']);
  });
  it('whitespace-only edits are not changes', () => {
    expect(changedSections('## A\n\nx  y\n', '## A\n\nx y\n\n')).toEqual([]);
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
    expect(changedSections('Intro antes.\n\n## A\n\nx\n', 'Intro cambiada.\n\n## A\n\nx\n')).toEqual(['_intro']);
  });
  it('the intro is not part of sectionsOf', () => {
    expect(sectionsOf('Intro.\n\n## A\n\nx\n').map(s => s.slug)).toEqual(['a']);
  });
  it('duplicate slugs stay unique even when a later heading collides', () => {
    const slugs = sectionsOf('## A\n\nx\n\n## A\n\ny\n\n## A 2\n\nz\n').map(s => s.slug);
    expect(new Set(slugs).size).toBe(3);
  });
});
