import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../src/lib/markdown.js';
import { fencedBlocks, parseChart, parseSteps, visualIssues } from '../src/lib/visual-blocks.js';
import { leadOf, tocOf } from '../src/design-page/build.js';
import { sectionsOf } from '../src/lib/design.js';

const fence = (lang: string, body: string) => `\`\`\`${lang}\n${body}\n\`\`\``;

describe('the visual blocks of a design body', () => {
  it('a mermaid block becomes a diagram the viewer draws, its source escaped', () => {
    const html = renderMarkdown(fence('mermaid', 'flowchart LR\n  a["</pre><script>x</script>"] --> b'));
    expect(html).toContain('<figure class="vb dg"><pre class="mermaid">flowchart LR\n  a[&quot;&lt;/pre&gt;&lt;script&gt;x&lt;/script&gt;&quot;] --&gt; b</pre></figure>');
    expect(html).not.toMatch(/<script/i);
  });
  it('a chart block becomes bars scaled to the largest value, with its unit, title and note', () => {
    const html = renderMarkdown(fence('chart', 'title: Coste\nunit: $\nnote: El resto, aparte.\ndata:\n  - { label: Sesión, value: 254 }\n  - { label: "**impl**", value: 63.5 }'), { locale: 'es' });
    expect(html).toContain('<figure class="vb chart"><figcaption>Coste</figcaption>');
    expect(html).toContain('<span class="ch-l">Sesión</span><span class="ch-bars"><span class="ch-bar s1"><i style="--f:1.0000"></i><b>254 $</b></span>');
    expect(html).toContain('<span class="ch-l"><strong>impl</strong></span>');
    expect(html).toContain('<i style="--f:0.2500"></i><b>63,5 $</b>');
    expect(html).toContain('<p class="ch-note">El resto, aparte.</p>');
    expect(renderMarkdown(fence('chart', 'data:\n  - { label: a, value: 1234.5 }'))).toContain('<b>1,234.5</b>');
  });
  it('a chart with series has a legend and one bar per series', () => {
    const html = renderMarkdown(fence('chart', 'series: [Antes, Después]\ndata:\n  - { label: Large, values: [8, 4] }'));
    expect(html).toContain('<figure class="vb chart multi">');
    expect(html).toContain('<div class="ch-key"><span class="s1">Antes</span><span class="s2">Después</span></div>');
    expect(html).toContain('<span class="ch-bar s2"><i style="--f:0.5000"></i><b>4</b></span>');
  });
  it('a steps block becomes a numbered sequence with inline Markdown', () => {
    const html = renderMarkdown(fence('steps', '- title: Medir\n  text: Con `usage-report`.\n- Fijar'));
    expect(html).toContain('<ol class="vb steps" style="--n:2"><li><span class="st-k">1</span><b>Medir</b><span class="st-t">Con <code>usage-report</code>.</span></li><li><span class="st-k">2</span><b>Fijar</b></li></ol>');
  });
  it('a broken block shows its error and its source, escaped, instead of failing the page', () => {
    const html = renderMarkdown(fence('chart', 'data: nope <img>'));
    expect(html).toContain('<div class="vb vb-err"><p>chart: chart: `data` is a non-empty list</p>');
    expect(html).toContain('data: nope &lt;img&gt;');
    expect(renderMarkdown(fence('steps', 'title: [x'))).toContain('class="vb vb-err"');
  });
  it('texts in charts and steps are escaped: no element comes from them', () => {
    const html = renderMarkdown(fence('chart', 'title: "<img src=x onerror=1>"\ndata:\n  - { label: "<script>a</script>", value: 1 }') + '\n\n' + fence('steps', '- "<b onclick=1>x</b>"\n- y'));
    expect(html).not.toMatch(/<img|<script|<b onclick/i);
  });
  it('other code blocks carry their language as a label', () => {
    expect(renderMarkdown(fence('ts', 'const x = "<y>";'))).toBe('<pre data-lang="ts"><code>const x = &quot;&lt;y&gt;&quot;;</code></pre>\n');
    expect(renderMarkdown(fence('', 'plain'))).toBe('<pre><code>plain</code></pre>\n');
    expect(renderMarkdown(fence('"><x', 'z'))).toBe('<pre><code>z</code></pre>\n');
  });
});

describe('callouts', () => {
  it('> [!WARNING] and its kin become a labelled note in the design language', () => {
    expect(renderMarkdown('> [!WARNING]\n> No hay vuelta atrás.', { locale: 'es' })).toBe('<aside class="co co-warning" role="note"><p class="co-h">Atención</p><p>No hay vuelta atrás.</p>\n</aside>\n');
    expect(renderMarkdown('> [!tip] Short and sweet.')).toContain('<aside class="co co-tip" role="note"><p class="co-h">Tip</p><p>Short and sweet.</p>');
    expect(renderMarkdown('> A plain quote.')).toBe('<blockquote>\n<p>A plain quote.</p>\n</blockquote>\n');
    expect(renderMarkdown('> [!OTHER] x')).toContain('<blockquote>');
  });
});

describe('tables', () => {
  it('scroll in their own box; four columns or more take the wide band', () => {
    expect(renderMarkdown('| a | b |\n|---|---|\n| x | y |')).toContain('<div class="tbl" style="--cols:2" tabindex="0"><table><thead><tr><th>a</th><th>b</th></tr></thead>');
    // The column count sets the table's least width: on a phone it scrolls instead of squeezing its columns.
    expect(renderMarkdown('| a | b | c | d |\n|---|---|---|---|\n| 1 | 2 | 3 | 4 |')).toContain('<div class="tbl wide" style="--cols:4" tabindex="0">');
  });
  it('a column of quantities is right-aligned; an alignment the table gives wins', () => {
    const html = renderMarkdown('| Bloque | Coste | Nota |\n|---|---|:-:|\n| a | 254 $ | sí |\n| b | — | no |\n| c | 3,59 $ | x |');
    expect(html).toContain('<th class="num a-right">Coste</th>');
    expect(html).toContain('<td class="num a-right">254 $</td>');
    expect(html).toContain('<td class="num a-right">—</td>');
    expect(html).toContain('<td class="a-center">sí</td>');
    expect(html).toContain('<td>a</td>');
    expect(renderMarkdown('| a |\n|---|\n| — |')).not.toContain('class="num');
  });
});

describe('parsing and checking the blocks', () => {
  it('parseChart reads one series or several and refuses what it cannot draw', () => {
    expect(parseChart('data:\n  - { label: a, value: 2 }')).toEqual({ ok: true, value: { title: undefined, unit: undefined, note: undefined, series: [], rows: [{ label: 'a', values: [2] }] } });
    for (const [text, error] of [
      ['data: []', '`data` is a non-empty list'],
      ['series: [solo]\ndata:\n  - { label: a, values: [1] }', '2 to 4 series'],
      ['series: [a, b]\ndata:\n  - { label: x, values: [1] }', 'needs `values` with 2 numbers'],
      ['data:\n  - { value: 1 }', 'has no `label`'],
      ['data:\n  - { label: a, value: .nan }', 'needs a `value`'],
      [`data:\n${Array.from({ length: 25 }, (_, i) => `  - { label: r${i}, value: 1 }`).join('\n')}`, 'at most 24 rows'],
      ['[1, 2]', 'expected keys'],
      ['a: [', 'YAML'],
    ] as const) {
      const r = parseChart(text);
      expect(r.ok, text).toBe(false);
      if (!r.ok) expect(r.error).toContain(error);
    }
  });
  it('parseSteps takes 2 to 8 steps, each a title or {title, text}', () => {
    expect(parseSteps('- a\n- { title: b, text: c }')).toEqual({ ok: true, value: [{ title: 'a' }, { title: 'b', text: 'c' }] });
    expect(parseSteps('- a')).toMatchObject({ ok: false });
    expect(parseSteps(Array.from({ length: 9 }, (_, i) => `- s${i}`).join('\n'))).toMatchObject({ ok: false });
    expect(parseSteps('- { text: sin título }\n- b')).toMatchObject({ ok: false, error: 'steps: step 1 has no `title`' });
  });
  it('fencedBlocks and visualIssues find the blocks by their line, with ~~~ and longer fences', () => {
    const body = ['intro', '````md', '```chart', 'nope', '```', '````', '', '~~~chart', 'data: 1', '~~~', '```steps', '- a', '- b', '```'].join('\n');
    expect(fencedBlocks(body).map(b => [b.lang, b.line])).toEqual([['md', 2], ['chart', 8], ['steps', 11]]);
    expect(visualIssues(body)).toEqual(['line 8: chart: `data` is a non-empty list']);
  });
});

describe('the map of a version: words, lead and change of each heading', () => {
  it('leadOf takes the first sentence of the prose, follows a colon into its list and skips code, tables and callouts', () => {
    expect(leadOf('Primera frase. Segunda.')).toBe('Primera frase.');
    expect(leadOf('| a | b |\n|---|---|\n\n```ts\nx\n```\n\n> [!NOTE]\n> nota\n\n- **Antes:** el informe de `x`.')).toBe('Antes: el informe de x.');
    expect(leadOf('La escalera pasa a cinco peldaños:\n\n- mech\n- impl.')).toBe('La escalera pasa a cinco peldaños: mech impl.');
    expect(leadOf('Las fases:\n\n```steps\n- a\n```\n\nCierre.')).toBe('Las fases:');
    expect(leadOf('Versión 0.14.0 de forge y [enlace](https://x.example) sin punto final')).toBe('Versión 0.14.0 de forge y enlace sin punto final');
    expect(Array.from(leadOf('x'.repeat(400)))).toHaveLength(180);
    expect(leadOf('```\nsolo código\n```')).toBe('');
  });
  it('tocOf counts a ## with its ###, gives only a ## its lead, and marks what changed', () => {
    const body = '## Uno\n\nTexto del uno.\n\n### Sub\n\ntres palabras más\n\n## Dos\n\nOtra cosa.';
    const toc = tocOf(sectionsOf(body), new Map([['sub', 'changed'], ['dos', 'added']]));
    expect(toc).toEqual([
      { level: 2, heading: 'Uno', slug: 'uno', words: 6, lead: 'Texto del uno.' },
      { level: 3, heading: 'Sub', slug: 'sub', words: 3, change: 'changed' },
      { level: 2, heading: 'Dos', slug: 'dos', words: 2, lead: 'Otra cosa.', change: 'added' },
    ]);
  });
});
