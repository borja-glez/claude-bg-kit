import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderMarkdown } from '../src/lib/markdown.js';
import { buildDesignPageData } from '../src/design-page/build.js';

const fixture = readFileSync(new URL('./fixtures/design.md', import.meta.url), 'utf8');

describe('renderMarkdown', () => {
  it('renders headings with section slugs as ids', () => {
    const html = renderMarkdown('## Alcance\n\ntexto **fuerte**\n\n## Alcance\n\notro');
    expect(html).toContain('<h2 id="alcance">Alcance</h2>');
    expect(html).toContain('<h2 id="alcance-2">');
    expect(html).toContain('<strong>fuerte</strong>');
  });
  it('escapes raw html blocks and inline html', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\nhola <img src=x onerror=alert(1)> fin\n\n## T <b>x</b>');
    expect(html).not.toMatch(/<script|<img|<b>/i);
    expect(html).toContain('&lt;script&gt;');
  });
  it('only allows safe link and image protocols', () => {
    const html = renderMarkdown('[a](javascript:alert(1)) [b](https://ok.example) [c](#alcance) ![d](data:image/png;base64,xx) [e](mailto:a@b.c)');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('data:image');
    expect(html).toContain('href="https://ok.example"');
    expect(html).toContain('href="#alcance"');
    expect(html).toContain('href="mailto:a@b.c"');
  });
  it('renders tables and code', () => {
    const html = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst x = "<y>";\n```');
    expect(html).toContain('<table>');
    expect(html).toContain('&lt;y&gt;');
  });
  it('keeps ids aligned with sectionsOf around code fences and setext headings', () => {
    const html = renderMarkdown('Titulo\n------\n\n```\n## Falso\n```\n\n## Real\n\n### Sub **x**');
    expect(html).toContain('<h2 id="real">Real</h2>');
    expect(html).toContain('<h3 id="sub-x">');
    expect(html).not.toContain('id="falso"');
  });
  it('survives headings hidden in comments or html blocks', () => {
    const ids = (md: string) => [...renderMarkdown(md).matchAll(/<h[23] id="([^"]*)"/g)].map(m => m[1]);
    expect(ids('## A\n\n<!--\n## Draft\n-->\n\n## B\n\n## C')).toEqual(['a', 'b', 'c']);
    expect(ids('<div>\n## Ghost\n</div>\n\n## Real\n\n## Other')).toEqual(['real', 'other']);
  });
  it('gives ids only to top-level headings', () => {
    const ids = (md: string) => [...renderMarkdown(md).matchAll(/<h[23] id="([^"]*)"/g)].map(m => m[1]);
    expect(ids('- ## Real\n\n## Real')).toEqual(['real']);
    expect(ids('> ## Q\n\n## Q\n\n## R')).toEqual(['q', 'r']);
  });
  it('wraps escaped html blocks in a paragraph', () => {
    expect(renderMarkdown('<div>x</div>')).toContain('<p>&lt;div&gt;x&lt;/div&gt;</p>');
  });
  it('blocks url and attribute injection', () => {
    const md = [
      '[a](java&#x73;cript:alert(1))', '[b](JaVaScRiPt:alert(1))', '<javascript:alert(1)>',
      '[c][r]\n\n[r]: javascript:alert(1)', '[d](https://x.example "t\\"onmouseover=\\"y")',
      '[e](#"onmouseover=x)', '![f"><script>](https://x.example/i.png)',
    ].join('\n\n');
    const html = renderMarkdown(md);
    expect(html).not.toMatch(/(href|src)="[^"]*javascript:/i); // autolink text may remain as inert plain text
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/\sonmouseover=/i);
  });
});

describe('buildDesignPageData', () => {
  it('builds versions with html and toc, current last', () => {
    const v1 = fixture.replace('La versión 0.1 cubre', 'Primera versión:');
    const data = buildDesignPageData({
      current: fixture,
      history: { 1: v1, 2: fixture },
      changelog: [
        { version: 1, date: '2026-10-10', note: 'borrador', words: 40, round: 0 },
        { version: 2, date: '2026-10-11', note: 'ronda 1', words: 45, round: 1 },
      ],
      source: 'docs/waypoint/demo-shop/',
    });
    expect(data.current).toBe(2);
    expect(data.rounds).toBe(0); // K3-09: the number of valid critiques, and none was given
    expect(data.versions.map(v => v.version)).toEqual([1, 2]);
    expect(data.versions[0].html).toContain('Primera versión');
    expect(data.versions[1].toc.map(t => t.slug)).toEqual(['alcance', 'fuera-de-alcance', 'arquitectura', 'riesgos']);
    expect(data.meta.title).toBe('Tienda Demo');
  });
  it('works without history or changelog', () => {
    const data = buildDesignPageData({ current: fixture, history: {}, changelog: [], source: 'x' });
    expect(data.current).toBe(1);
    expect(data.versions).toHaveLength(1);
    expect(data.rounds).toBe(0);
  });
});
