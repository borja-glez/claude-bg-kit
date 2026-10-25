import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { importSpec, specH1, specTitle, SpecImportError, SUMMARY_MAX } from '../src/lib/design-import.js';
import { parseDesign, sectionsOf } from '../src/lib/design.js';

const SPEC = readFileSync(new URL('./fixtures/sp-spec.md', import.meta.url), 'utf8');
const OPTS = { project: 'forge-route', locale: 'es', source: 'docs/superpowers/specs/2026-10-12-forge-route-design.md' };

describe('importSpec', () => {
  it('turns a real superpowers spec into a design that validates, with the same sections and its source', () => {
    const d = parseDesign(importSpec(SPEC, OPTS));
    expect(d.meta).toMatchObject({
      title: 'forge: enrutado, mezcla con superpowers y modo autónomo', project: 'forge-route', locale: 'es', pillars: [],
      status: 'draft', start_prompt: '/waypoint:work <track>', source: OPTS.source,
    });
    expect(d.meta.summary.startsWith('En la campaña Reparto (E10.0), una petición grande')).toBe(true);
    expect(d.sections).toEqual(sectionsOf(SPEC.slice(SPEC.indexOf('\n') + 1)));
    expect(d.sections.map(s => s.slug)).toEqual(['1-proposito', 'criterios-de-exito', 'fuera-de-alcance', '2-decisiones-tomadas']);
    expect(d.body).toContain('**Fecha:** 2026-10-12');
    expect(d.body).not.toContain('# forge: enrutado');
  });
  it('specH1 is the first title outside code, without its design suffix', () => {
    expect(specH1('```md\n# No\n```\n\n# Yes — diseño\n\n## A\n')).toBe('Yes');
    expect(specH1('no title\n')).toBeNull();
  });
  it('strips a design suffix from the title', () => {
    expect(specTitle('Cart totals — diseño')).toBe('Cart totals');
    expect(specTitle('Cart totals - Design')).toBe('Cart totals');
    expect(specTitle('Cart totals: design')).toBe('Cart totals');
    expect(specTitle('Design system')).toBe('Design system');
  });
  it('takes the summary from the purpose section, else from the first paragraph, collapsed and clipped', () => {
    const long = `# T\n\nintro line\n\n## Goal\n\n- a list\n\n${'word '.repeat(120)}\n\n## Other\n\ntext\n`;
    const s = parseDesign(importSpec(long, OPTS)).meta.summary;
    expect(s.length).toBeLessThanOrEqual(SUMMARY_MAX);
    expect(s.length).toBeGreaterThan(SUMMARY_MAX - 5);
    expect(s).toBe(s.trim());
    expect(s.startsWith('word word')).toBe(true);
    expect(parseDesign(importSpec('# T\n\nfirst\nparagraph   here\n\n## A\n\nx\n', OPTS)).meta.summary).toBe('first paragraph here');
    expect(parseDesign(importSpec('# T\n\n## A\n\n| a | b |\n|---|---|\n', OPTS)).meta.summary).toBe('T');
  });
  it('refuses a spec without a title, with nothing after it, or whose only title is inside code', () => {
    expect(() => importSpec('no title\n\n## A\n', OPTS)).toThrow(SpecImportError);
    expect(() => importSpec('```md\n# Not a title\n```\n\n## A\n', OPTS)).toThrow(SpecImportError);
    for (const bare of ['# T\n', '# T', '# T\n\n  \n\n']) expect(() => importSpec(bare, OPTS), JSON.stringify(bare)).toThrow('nothing after its "# " title');
  });
  it('a spec without "## " sections is one section named after its title (A1)', () => {
    const short = parseDesign(importSpec('# Coupon field — design\n\nLet a shopper type a coupon at checkout.\n\n### Testing\n\nOne unit test.\n', OPTS));
    expect(short.meta).toMatchObject({ title: 'Coupon field', summary: 'Let a shopper type a coupon at checkout.' });
    expect(short.sections.map(s => [s.level, s.slug])).toEqual([[2, 'coupon-field'], [3, 'testing']]);
    expect(short.body).toContain('## Coupon field\n\nLet a shopper');
    // A "## " inside code is no section.
    expect(parseDesign(importSpec('# T\n\n```md\n## Not a section\n```\n', OPTS)).sections.map(s => s.slug)).toEqual(['t']);
    // The spec's own line endings, and a byte order mark dropped.
    const bom = String.fromCharCode(0xfeff);
    expect(importSpec(`${bom}# T\r\n\r\njust text\r\n`, OPTS).endsWith('---\n\n## T\r\n\r\njust text\r\n')).toBe(true);
  });
  it("keeps the spec's own line endings in the body", () => {
    expect(importSpec('# T\r\n\r\n## A\r\n\r\ntext\r\n', OPTS).endsWith('## A\r\n\r\ntext\r\n')).toBe(true);
  });
});
