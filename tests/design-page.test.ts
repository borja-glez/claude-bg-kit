// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildDesignPageData } from '../src/design-page/build.js';
import { mountDesignPage, renderDesignPage } from '../src/design-page/client.js';

const fixture = readFileSync(path.join(process.cwd(), 'tests/fixtures/design.md'), 'utf8');
const data = buildDesignPageData({
  current: fixture,
  history: { 1: fixture.replace('Riesgos', 'Peligros') },
  changelog: [
    { version: 1, date: '2026-10-10', note: 'borrador inicial', words: 40, round: 0 },
    { version: 2, date: '2026-10-11', note: 'ronda 1: <b>rollback</b>', words: 45, round: 1 },
  ],
  source: 'docs/waypoint/demo-shop/',
});

describe('renderDesignPage', () => {
  it('renders the editorial header, metrics, pillars, prompt and toc in Spanish', () => {
    const html = renderDesignPage(data, 2);
    expect(html).toContain('DOCUMENTO DE DISEÑO');
    expect(html).toContain('Tienda Demo<span class="dot">.</span>');
    expect(html).toContain('Pagos idempotentes');
    expect(html).toContain('/waypoint:work backend');
    expect(html).toContain('data-action="copy"');
    expect(html).toContain('href="#riesgos"');
    expect(html).toContain('docs/waypoint/demo-shop/');
  });
  it('shows a version selector with the changelog, escaped', () => {
    const html = renderDesignPage(data, 2);
    expect(html).toContain('data-version="1"');
    expect(html).toContain('data-version="2"');
    expect(html).toContain('ronda 1: &lt;b&gt;rollback&lt;/b&gt;');
  });
  it('names the spec a design was imported from, escaped, in Spanish and English', () => {
    const imported = { ...data, meta: { ...data.meta, source: 'docs/superpowers/specs/<x>.md' } };
    expect(renderDesignPage(imported, 2)).toContain('<p class="imp">Importado de <code>docs/superpowers/specs/&lt;x&gt;.md</code></p>');
    expect(renderDesignPage({ ...imported, meta: { ...imported.meta, locale: 'en' } }, 2)).toContain('<p class="imp">Imported from <code>');
    expect(renderDesignPage(data, 2)).not.toContain('class="imp"');
  });
  it('renders an older version body', () => {
    expect(renderDesignPage(data, 1)).toContain('id="peligros"');
  });
  it('escapes untrusted metadata', () => {
    const evil = { ...data, meta: { ...data.meta, title: '<img src=x onerror=1>', start_prompt: '"><script>' } };
    const html = renderDesignPage(evil, 2);
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('"><script>');
  });
});

describe('mountDesignPage', () => {
  it('switches versions on click and copies the prompt', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    let copied = '';
    mountDesignPage(root, data, { copy: async (t: string) => { copied = t; } });
    expect(root.innerHTML).toContain('id="riesgos"');
    (root.querySelector('[data-version="1"]') as HTMLElement).click();
    expect(root.innerHTML).toContain('id="peligros"');
    (root.querySelector('[data-action="copy"]') as HTMLElement).click();
    await Promise.resolve();
    expect(copied).toBe('/waypoint:work backend');
  });
});

describe('mountDesignPage copy fallback', () => {
  it('survives a synchronously throwing copy and selects the prompt', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountDesignPage(root, data, { copy: () => { throw new TypeError('no clipboard'); } });
    (root.querySelector('[data-action="copy"]') as HTMLElement).click();
    await new Promise(r => setTimeout(r, 0));
    expect(root.querySelector('[data-action="copy"]')!.textContent).toBe('Copiar prompt');
    expect(String(getSelection())).toContain('/waypoint:work backend');
  });
});

describe('page root', () => {
  it('uses #wp-design-root, so a "## App" heading cannot clash', () => {
    const src = readFileSync(path.join(process.cwd(), 'src/design-page/template.html'), 'utf8');
    expect(src).toContain('id="wp-design-root"');
    expect(src).not.toContain('id="app"');
    expect(readFileSync(path.join(process.cwd(), 'src/design-page/theme.css'), 'utf8')).not.toContain('#app');
    expect(readFileSync(path.join(process.cwd(), 'src/design-page/client.ts'), 'utf8')).toContain("getElementById('wp-design-root')");
    const doc = fixture.replace('## Riesgos', '## App\n\nTexto.\n\n## Riesgos');
    const d2 = buildDesignPageData({ current: doc, history: {}, changelog: [{ version: 1, date: '2026-10-11', note: 'x', words: 1, round: 0 }], source: 's/' });
    const root = document.createElement('div');
    root.id = 'wp-design-root';
    document.body.appendChild(root);
    mountDesignPage(root, d2);
    expect(root.innerHTML).toContain('id="app"');
    expect(document.getElementById('wp-design-root')).toBe(root);
  });
});

describe('built template', () => {
  it('has no stray closing script tags inside the bundle', () => {
    const html = readFileSync(path.join(process.cwd(), 'plugins/waypoint/assets/design.template.html'), 'utf8');
    expect((html.match(/<\/script/gi) ?? []).length).toBe((html.match(/<script/gi) ?? []).length);
  });
});
