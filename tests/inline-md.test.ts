import { describe, it, expect } from 'vitest';
import { inlineMd } from '../src/lib/inline-md.js';
import { esc } from '../src/page/render.js';

const md = (text: string) => inlineMd(esc(text));

describe('inlineMd (G-16)', () => {
  it('code, bold and http(s) links over escaped text', () => {
    expect(md('Run `npm test` and **then** see https://example.com/a?b=1&c=2.')).toBe(
      'Run <code>npm test</code> and <strong>then</strong> see <a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">https://example.com/a?b=1&amp;c=2</a>.');
  });
  it('leaves code as it is: no bold and no link inside it', () => {
    expect(md('`a **b** https://x.io`')).toBe('<code>a **b** https://x.io</code>');
  });
  it('a link stops before an escaped quote or angle bracket, and before closing punctuation', () => {
    expect(md('"https://x.io/p" (http://y.io/q)')).toBe(
      '&quot;<a href="https://x.io/p" target="_blank" rel="noopener noreferrer">https://x.io/p</a>&quot; (<a href="http://y.io/q" target="_blank" rel="noopener noreferrer">http://y.io/q</a>)');
  });
  it('never turns escaped HTML or javascript: into anything that runs (Review Focus 5)', () => {
    const out = md('<img src=x onerror=alert(1)> javascript:alert(1) [x](javascript:alert(1)) **<script>x</script>**');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('href="javascript');
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(out).toContain('<strong>&lt;script&gt;x&lt;/script&gt;</strong>');
  });
  it('plain text and unclosed marks stay as they are', () => {
    expect(md('sin marcas')).toBe('sin marcas');
    expect(md('a `b y **c')).toBe('a `b y **c');
  });

  const a = (url: string) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  it('a ) that closes a ( of the link stays in it; one that closes the sentence does not (carry 2)', () => {
    expect(md('https://es.wikipedia.org/wiki/Rust_(lenguaje)')).toBe(a('https://es.wikipedia.org/wiki/Rust_(lenguaje)'));
    expect(md('(ver https://x.io/a_(b)).')).toBe(`(ver ${a('https://x.io/a_(b)')}).`);
    expect(md('(https://x.io/q)')).toBe(`(${a('https://x.io/q')})`);
  });
  it('a ** inside a link does not cut it, and a link inside bold stays a link (carry 2)', () => {
    expect(md('https://x.io/**b**/c')).toBe(a('https://x.io/**b**/c'));
    expect(md('**https://x.io/a**')).toBe(`<strong>${a('https://x.io/a')}</strong>`);
    expect(md('**mira https://x.io/a**')).toBe(`<strong>mira ${a('https://x.io/a')}</strong>`);
    expect(md('**a `c` b**')).toBe('**a <code>c</code> b**');
  });
  it('a quote in the middle of a link ends it; javascript in any case or as entities is never a link (carry 2)', () => {
    expect(md('https://x.io/a"onmouseover="alert(1)')).toBe(`${a('https://x.io/a')}&quot;onmouseover=&quot;alert(1)`);
    expect(md("https://x.io/a'b")).toBe(`${a('https://x.io/a')}&#39;b`);
    for (const s of ['JaVaScRiPt:alert(1)', 'java&#x73;cript:alert(1)', 'jav&#97;script:alert(1)', 'HTTPS://x.io']) expect(md(s)).not.toContain('<a ');
  });
  it('a long run of punctuation after a link takes linear time (carry 2)', () => {
    const t0 = performance.now();
    const out = md(`https://a${'.'.repeat(100_000)}x y https://b${'.'.repeat(100_000)}`);
    expect(performance.now() - t0).toBeLessThan(250);
    expect(out.endsWith(`${'.'.repeat(100_000)}`)).toBe(true);
    expect(out).toContain(a('https://b'));
  });
});
