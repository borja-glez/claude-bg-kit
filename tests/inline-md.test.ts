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
});
