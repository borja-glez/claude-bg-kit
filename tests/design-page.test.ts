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

// A design that went through two rounds, a rewrite, an approval and an amendment (K3-09).
const approved = fixture.replace('start_prompt: /waypoint:work backend', 'start_prompt: /waypoint:work backend\nstatus: approved');
const prop = (n: number, severity: 'critical' | 'major' | 'minor', section: string) => ({ n, category: 'gap' as const, severity, section, problem: `p${n}`, change: `c${n}` });
const richInput: Parameters<typeof buildDesignPageData>[0] = {
  current: approved.replace('Backend en Node y frontend web.', 'Backend en Node 22 y frontend web.'),
  history: { 1: fixture.replace('Riesgos', 'Peligros'), 2: fixture, 3: fixture, 4: approved },
  changelog: [
    { version: 1, date: '2026-10-10', note: 'borrador', words: 40, round: 0, kind: 'draft' },
    { version: 2, date: '2026-10-11', note: 'ronda 1', words: 45, round: 1, kind: 'apply', applied: { 1: [1] }, resolved: [{ round: 1, n: 2 }] },
    { version: 3, date: '2026-10-12', note: 'ronda 2', words: 45, round: 2, kind: 'rewrite', rewrite: true },
    { version: 4, date: '2026-10-13', note: 'aprobado', words: 45, round: 2, kind: 'approve' },
    { version: 5, date: '2026-10-14', note: 'enmienda', words: 46, round: 2, kind: 'amend' },
  ],
  source: 'docs/waypoint/demo-shop/',
  critiques: [
    { round: 2, critique: { round: 2, version: 2, scope: 'changed', proposals: [prop(1, 'major', 'riesgos')] } },
    { round: 1, critique: { round: 1, version: 1, scope: 'full', verdict: 'changes', proposals: [prop(1, 'critical', 'peligros'), prop(2, 'major', 'alcance'), prop(3, 'minor', '_intro'), prop(4, 'minor', 'arquitectura')] } },
    { round: 3, critique: null },
  ],
  dismissed: { 1: [{ n: 3, reason: 'fuera de alcance' }] },
};
const rich = buildDesignPageData(richInput);

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

describe('buildDesignPageData: the rounds, what became of each proposal and what each version changed (K3-09)', () => {
  it('counts the valid critiques as rounds, in order, with their verdict and the fate of every proposal', () => {
    expect(rich.rounds).toBe(2);
    expect(rich.critiques.map(c => [c.round, c.verdict])).toEqual([[1, 'changes'], [2, 'changes']]);
    expect(rich.critiques[0].proposals.map(p => [p.n, p.fate, p.appliedIn ?? null, p.reason ?? null])).toEqual([
      [1, 'applied', 2, null], [2, 'resolved', null, null], [3, 'dismissed', null, 'fuera de alcance'], [4, 'pending', null, null],
    ]);
    expect(rich.critiques[1].proposals[0].fate).toBe('rewritten');
  });
  it('says the status, and amended when an amendment came after the last approval', () => {
    expect(rich).toMatchObject({ status: 'approved', amended: true, current: 5 });
    const once = buildDesignPageData({ current: approved, history: {}, changelog: [{ version: 1, date: 'd', note: 'aprobado', words: 1, round: 0, kind: 'approve' }], source: 's/' });
    expect(once).toMatchObject({ status: 'approved', amended: false });
    expect(data).toMatchObject({ status: 'draft', amended: false, rounds: 0, critiques: [] });
  });
  it('gives a proposal one fate when the gate lists it in several: applied, then resolved, dismissed, rewritten, pending', () => {
    const all = buildDesignPageData({
      current: fixture, history: {}, source: 's/',
      changelog: [
        { version: 1, date: 'd', note: 'ronda 1: aplicadas 1', words: 1, round: 1 },
        { version: 2, date: 'd', note: 'x', words: 1, round: 1, resolved: [{ round: 1, n: 1 }, { round: 1, n: 2 }] },
      ],
      critiques: [{ round: 1, critique: { round: 1, version: 1, scope: 'full', proposals: [prop(1, 'minor', 'a'), prop(2, 'minor', 'a'), prop(3, 'minor', 'a')] } }],
      dismissed: { 1: [{ n: 1 }, { n: 2 }, { n: 3 }] },
    });
    expect(all.critiques[0].proposals.map(p => [p.n, p.fate, p.appliedIn ?? null])).toEqual([[1, 'applied', 1], [2, 'resolved', null], [3, 'dismissed', null]]);
  });
  it('bounds and cleans the critique texts it hands the page: 40 newest per list, 300 clean code points, the rest counted', () => {
    const bidi = String.fromCharCode(0x202e);
    const bell = String.fromCharCode(7);
    const hostile = (n: number) => ({ ...prop(n, 'minor', `sec${bell}\n${bidi}<script>`), problem: `${bidi}<script>${bell}\n${'x'.repeat(5000)}`, change: `<img onerror=1>${'y'.repeat(5000)}` });
    const big = buildDesignPageData({
      current: fixture, history: {}, source: 's/', changelog: [],
      critiques: [
        { round: 1, critique: { round: 1, version: 1, scope: 'full', proposals: Array.from({ length: 200 }, (_, i) => hostile(i + 1)) } },
        ...Array.from({ length: 49 }, (_, i) => ({ round: i + 2, critique: { round: i + 2, version: 1, scope: 'full' as const, proposals: [hostile(1)] } })),
      ],
    });
    expect(big.rounds).toBe(50);
    expect(big.critiques).toHaveLength(40);
    expect(big.critiquesMore).toBe(10);
    expect(big.critiques[0].round).toBe(11);
    const first = buildDesignPageData({ current: fixture, history: {}, source: 's/', changelog: [], critiques: [{ round: 1, critique: { round: 1, version: 1, scope: 'full', proposals: Array.from({ length: 200 }, (_, i) => hostile(i + 1)) } }] }).critiques[0];
    expect(first.proposals).toHaveLength(40);
    expect(first.proposals[0].n).toBe(161);
    expect(first.proposalsMore).toBe(160);
    for (const p of first.proposals) {
      for (const t of [p.section, p.problem, p.change]) {
        expect(Array.from(t).length).toBeLessThanOrEqual(300);
        expect(Array.from(t).filter(c => c.codePointAt(0)! < 32 || c.codePointAt(0)! === 127 || (c.codePointAt(0)! >= 0x202a && c.codePointAt(0)! <= 0x202e) || (c.codePointAt(0)! >= 0x2066 && c.codePointAt(0)! <= 0x2069))).toEqual([]);
      }
    }
    expect(JSON.stringify(big).length).toBeLessThan(40 * 40 * 1000);
    expect(buildDesignPageData({ current: fixture, history: {}, source: 's/', changelog: [], critiques: [{ round: 1, critique: { round: 1, version: 1, scope: 'full', proposals: [prop(1, 'minor', 'a')] } }] })).not.toHaveProperty('critiquesMore');
  });
  it('gives every version but the first what it changed, added and removed against the one before, by heading', () => {
    expect(rich.versions.map(v => v.diff)).toEqual([
      null,
      { changed: [], added: ['Riesgos'], removed: ['Peligros'] },
      { changed: [], added: [], removed: [] },
      { changed: [], added: [], removed: [] },
      { changed: ['Arquitectura'], added: [], removed: [] },
    ]);
  });
  it('across a gap in the history the diff is against the earlier version it has, and says which (carry 9)', () => {
    const gap = buildDesignPageData({ ...richInput, history: { 1: richInput.history[1], 4: richInput.history[4] } });
    expect(gap.versions.map(v => [v.version, v.diff?.against ?? null])).toEqual([[1, null], [4, 1], [5, null]]);
    expect(gap.versions[1].diff).toEqual({ changed: [], added: ['Riesgos'], removed: ['Peligros'], against: 1 });
  });
  it('marks a critique whose version the changelog does not have (carry 9)', () => {
    const odd = buildDesignPageData({ ...richInput, critiques: [{ round: 1, critique: { round: 1, version: 9, scope: 'full', proposals: [] } }, { round: 2, critique: { round: 2, version: 2, scope: 'full', proposals: [] } }] });
    expect(odd.critiques.map(c => [c.round, c.version, c.unknownVersion ?? false])).toEqual([[1, 9, true], [2, 2, false]]);
  });
  it('counts every pending proposal, also those beyond the 40 shown, as the gate does (carry 9)', () => {
    const minors = Array.from({ length: 60 }, (_, i) => prop(i + 1, 'minor', 'a'));
    const many = buildDesignPageData({ current: fixture, history: {}, source: 's/', changelog: [], critiques: [{ round: 1, critique: { round: 1, version: 1, scope: 'full', proposals: minors } }], dismissed: { 1: [{ n: 60 }] } });
    expect(many.critiques[0].proposals).toHaveLength(40);
    expect(many.pending).toBe(59);
    expect(rich.pending).toBe(1);
  });
});

describe('renderDesignPage: badge, rounds, diff and the version buttons (K3-09, K3-11)', () => {
  const en = { ...rich, meta: { ...rich.meta, locale: 'en' } };
  it('shows the status badge in Spanish and English', () => {
    expect(renderDesignPage(rich, 5)).toContain('<span class="badge st-amended">aprobado · enmendado</span>');
    expect(renderDesignPage(en, 5)).toContain('<span class="badge st-amended">approved · amended</span>');
    expect(renderDesignPage({ ...rich, amended: false }, 5)).toContain('<span class="badge st-approved">aprobado</span>');
    expect(renderDesignPage(data, 2)).toContain('<span class="badge st-draft">borrador</span>');
    expect(renderDesignPage({ ...data, status: 'parked' }, 2)).toContain('<span class="badge st-parked">aparcado</span>');
  });
  it('tells every round with its verdict, its counts and what became of each proposal; the latest round is open', () => {
    const html = renderDesignPage(rich, 5);
    expect(html).toContain('<section class="rounds" aria-labelledby="wp-l-rounds"><h2 class="lbl" id="wp-l-rounds">Rondas</h2>');
    expect(html).toContain('<details class="rd" data-round="1"><summary><b>Ronda 1</b> · v1 · <span class="vd vd-changes">con cambios</span> · 1 C · 1 M · 2 m</summary>');
    expect(html).toContain('<details class="rd" data-round="2" open>');
    expect(html).toContain('[Hueco · crítica]</span> <b>Peligros</b> — p1 → c1 <span class="fate f-applied">aplicada en v2</span>');
    expect(html).toContain('<span class="fate f-resolved">resuelta en la entrevista</span>');
    expect(html).toContain('<b>Introducción</b> — p3 → c3 <span class="fate f-dismissed">descartada: fuera de alcance</span>');
    expect(html).toContain('<span class="fate f-pending">pendiente</span>');
    expect(html).toContain('<span class="fate f-rewritten">reescrita</span>');
    for (const s of ['applied in v2', 'resolved in the interview', 'dismissed: fuera de alcance', '<b>Round 1</b>', '[Gap · critical]']) expect(renderDesignPage(en, 5)).toContain(s);
    expect(renderDesignPage(data, 2)).not.toContain('class="rounds"');
  });
  it('a ready round with no proposals says so', () => {
    const ready = { ...rich, critiques: [{ round: 3, version: 4, scope: 'changed' as const, verdict: 'ready' as const, proposals: [] }] };
    expect(renderDesignPage(ready, 5)).toContain('<span class="vd vd-ready">lista</span> · 0 C · 0 M · 0 m</summary><p class="none">Sin propuestas: no queda nada crítico ni mayor.</p>');
  });
  it('says how many older rounds and proposals the data left out, so none is hidden silently', () => {
    const more = { ...rich, critiquesMore: 7, critiques: rich.critiques.map(c => ({ ...c, proposalsMore: 3 })) };
    const html = renderDesignPage(more, 5);
    expect(html).toContain('<p class="more">7 rondas anteriores no se muestran</p>');
    expect(html).toContain('<p class="more">3 propuestas anteriores no se muestran</p>');
    expect(renderDesignPage({ ...more, meta: { ...more.meta, locale: 'en' } }, 5)).toContain('<p class="more">7 older rounds not shown</p>');
    expect(renderDesignPage(rich, 5)).not.toContain('class="more"');
  });
  it('says under the versions what the shown version changed, added and removed', () => {
    expect(renderDesignPage(rich, 5)).toContain('<p class="diff">cambió §Arquitectura</p>');
    expect(renderDesignPage(rich, 2)).toContain('<p class="diff">nueva §Riesgos · quitada §Peligros</p>');
    expect(renderDesignPage(rich, 1)).not.toContain('class="diff"');
    expect(renderDesignPage(rich, 3)).not.toContain('class="diff"');
  });
  it('says when a version is compared across a gap in the history, also when nothing changed, in Spanish and English (carry 9)', () => {
    const gap = buildDesignPageData({ ...richInput, history: { 1: richInput.history[1], 3: richInput.history[3] } });
    expect(renderDesignPage(gap, 3)).toContain('<p class="diff">nueva §Riesgos · quitada §Peligros · frente a v1: faltan versiones en la historia</p>');
    expect(renderDesignPage({ ...gap, meta: { ...gap.meta, locale: 'en' } }, 3)).toContain('<p class="diff">new §Riesgos · removed §Peligros · against v1: versions missing from the history</p>');
    const same = buildDesignPageData({ ...richInput, history: { 2: richInput.history[2], 4: richInput.history[4] } });
    expect(renderDesignPage(same, 4)).toContain('<p class="diff">frente a v2: faltan versiones en la historia</p>');
  });
  it('marks a round whose critique names a version the changelog does not have (carry 9)', () => {
    const odd = { ...rich, critiques: [{ ...rich.critiques[0], version: 9, unknownVersion: true as const }] };
    expect(renderDesignPage(odd, 5)).toContain('<b>Ronda 1</b> · v9 (versión desconocida) · ');
    expect(renderDesignPage({ ...odd, meta: { ...odd.meta, locale: 'en' } }, 5)).toContain('<b>Round 1</b> · v9 (unknown version) · ');
    expect(renderDesignPage(rich, 5)).not.toContain('desconocida');
  });
  it('shows how many proposals are pending in all, as the gate counts them (carry 9)', () => {
    expect(renderDesignPage({ ...rich, pending: 47 }, 5)).toContain('<div><b>47</b>Pendientes</div>');
    expect(renderDesignPage({ ...rich, pending: 47, meta: { ...rich.meta, locale: 'en' } }, 5)).toContain('<div><b>47</b>Pending</div>');
  });
  it('marks the version buttons with aria-pressed', () => {
    const html = renderDesignPage(rich, 5);
    expect(html).toContain('<button type="button" class="v on" data-version="5" aria-pressed="true">v5 · actual</button>');
    expect(html).toContain('<button type="button" class="v" data-version="1" aria-pressed="false">v1</button>');
  });
  it('escapes what a critique or a reason says (Review Focus 4)', () => {
    const p = rich.critiques[0].proposals[2];
    const hostile = { ...rich, critiques: [{ ...rich.critiques[0], proposals: [{ ...p, problem: '<img src=x onerror=1>', change: '"><b>', reason: '"><script>alert(1)</script>' }] }] };
    const html = renderDesignPage(hostile, 5);
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;img src=x onerror=1&gt;');
  });
  it('a hostile problem text builds no element and shows literally once mounted', () => {
    const text = '</script><script>alert(1)</script><img src=x onerror=alert(2)>';
    const p = rich.critiques[0].proposals[0];
    const hostile = { ...rich, critiques: [{ ...rich.critiques[1], proposals: [{ ...p, fate: 'pending' as const, problem: text, change: text, section: text }] }] };
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountDesignPage(root, hostile);
    expect(root.querySelector('.rounds script, .rounds img')).toBeNull();
    expect(root.querySelector('.props li')?.textContent).toContain(text);
  });
});

describe('mountDesignPage: language, focus and open rounds (K3-11)', () => {
  const mounted = (d: typeof rich) => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    mountDesignPage(root, d);
    return root;
  };
  it('sets the document language to the design locale', () => {
    mounted({ ...rich, meta: { ...rich.meta, locale: 'en' } });
    expect(document.documentElement.lang).toBe('en');
    mounted(rich);
    expect(document.documentElement.lang).toBe('es');
  });
  it('falls back to English when the design has no locale', () => {
    const nol = { ...rich, meta: { ...rich.meta, locale: undefined as unknown as string } };
    mounted(nol);
    expect(document.documentElement.lang).toBe('en');
  });
  it('has a banner, one main and named navigation and sections, in both languages; the labels are real headings (carry 10)', () => {
    for (const [d, names] of [[rich, ['Versiones', 'Pilares', 'Prompt de arranque', 'Rondas', 'Índice']], [{ ...rich, meta: { ...rich.meta, locale: 'en' } }, ['Versions', 'Pillars', 'Start prompt', 'Rounds', 'Contents']]] as const) {
      const root = mounted(d);
      // The accessible name of a region: the heading of the page it points at, else its aria-label.
      const nameOf = (el: Element) => {
        const by = el.getAttribute('aria-labelledby');
        return by ? root.querySelector(`[id="${by}"]`)?.textContent ?? null : el.getAttribute('aria-label');
      };
      expect(root.querySelectorAll('header').length).toBe(1);
      expect(root.querySelector('header')?.parentElement).toBe(root);
      expect(root.querySelectorAll('main').length).toBe(1);
      expect(nameOf(root.querySelector('main nav.toc')!)).toBe(names[4]);
      expect(Array.from(root.querySelectorAll('main section')).map(nameOf)).toEqual(names.slice(0, 4));
      expect(Array.from(root.querySelectorAll('.lbl')).map(l => [l.tagName, l.textContent])).toEqual([[ 'H2', names[0]], ['H2', names[2]], ['H2', names[3]], ['H2', names[4]]]);
      expect(root.querySelector('main .doc')).not.toBeNull();
      root.remove();
    }
  });
  it('announces the version a click shows in a live region outside the repainted page (carry 10)', () => {
    const root = mounted(rich);
    const live = root.nextElementSibling as HTMLElement;
    expect(live.getAttribute('role')).toBe('status');
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.className).toBe('sr');
    expect(live.textContent).toBe('');
    (root.querySelector('[data-version="2"]') as HTMLElement).click();
    expect(live.textContent).toBe('Mostrando v2');
    expect(root.nextElementSibling).toBe(live);
    const en = mounted({ ...rich, meta: { ...rich.meta, locale: 'en' } });
    (en.querySelector('[data-version="5"]') as HTMLElement).click();
    expect((en.nextElementSibling as HTMLElement).textContent).toBe('Showing v5 · current');
  });
  it('renders a full history (40 rounds of 40 proposals) in a bounded page', () => {
    const p = rich.critiques[0].proposals[0];
    const crits = Array.from({ length: 40 }, (_, i) => ({ ...rich.critiques[1], round: i + 1, proposals: Array.from({ length: 40 }, (_, j) => ({ ...p, n: j + 1 })) }));
    const html = renderDesignPage({ ...rich, critiques: crits, critiquesMore: 5 }, 5);
    expect(html.match(/<details /g)?.length).toBe(40);
    expect(html.match(/<li>/g)?.length).toBe(1600);
    expect(html.length).toBeLessThan(1_000_000);
  });
  it('a pressed version keeps the focus on its own button, now pressed', () => {
    const root = mounted(rich);
    (root.querySelector('[data-version="1"]') as HTMLElement).click();
    const btn = root.querySelector('[data-version="1"]');
    expect(document.activeElement).toBe(btn);
    expect(btn?.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('[data-version="5"]')?.getAttribute('aria-pressed')).toBe('false');
  });
  it('a round the person opened stays open when the version changes', () => {
    const root = mounted(rich);
    const first = root.querySelector('details[data-round="1"]') as HTMLElement;
    first.setAttribute('open', '');
    first.dispatchEvent(new Event('toggle'));
    (root.querySelector('[data-version="2"]') as HTMLElement).click();
    expect(root.querySelector('details[data-round="1"]')?.hasAttribute('open')).toBe(true);
    expect(root.querySelector('details[data-round="2"]')?.hasAttribute('open')).toBe(true);
  });
});

describe('theme of the design page (K3-11)', () => {
  const css = readFileSync(path.join(process.cwd(), 'src/design-page/theme.css'), 'utf8');
  it('labels, the eyebrow, the import line and the links use the text tokens; no fill color is used as text', () => {
    expect(css).toMatch(/\.lbl\{[^}]*color:var\(--mute\)/);
    expect(css).toMatch(/\.eb\{[^}]*color:var\(--t-peach\)/);
    expect(css).toMatch(/\.imp\{[^}]*color:var\(--mute\)/);
    expect(css).toMatch(/\.body a\{[^}]*color:var\(--t-blue\)/);
    expect(css).not.toMatch(/(^|[{;\s])color:var\(--(o0|o1|sub0|peach|lavender|blue)\)/m);
  });
  it('makes the version buttons and the copy button 44 px tall on a touch screen', () => {
    const coarse = /@media \(pointer: coarse\)\{([^{}]*)\{([^}]*)\}/.exec(css);
    expect(coarse?.[1]).toContain('.vers .v');
    expect(coarse?.[1]).toContain('.cp');
    expect(coarse?.[2]).toContain('min-height:44px');
  });
});

describe('the versions before the embedded ones (A-24)', () => {
  const summary = (locale: string) => (locale.startsWith('es') ? 'Versiones anteriores' : 'Earlier versions');
  it('are listed under the versions, folded, with their date and note escaped', () => {
    const html = renderDesignPage({ ...data, earlier: [{ version: 1, date: '2026-10-01', note: 'nota <1>' }] }, data.current);
    expect(html).toContain('<details class="earlier">');
    expect(html).toContain(`<summary>${summary(data.meta.locale)}</summary>`);
    expect(html).toContain('nota &lt;1&gt;');
  });
  it('without them there is no list', () => {
    expect(renderDesignPage({ ...data, earlier: [] }, data.current)).not.toContain('class="earlier"');
    expect(renderDesignPage(data, data.current)).not.toContain('class="earlier"');
  });
  it('five versions are all embedded with none earlier; at six the first is earlier; they are listed by version (M9)', () => {
    const entry = (version: number) => ({ version, date: `2026-10-${String(version).padStart(2, '0')}`, note: `nota ${version}`, words: 40, round: 0 });
    const build = (n: number, changelog = Array.from({ length: n }, (_, i) => entry(i + 1))) => buildDesignPageData({
      current: fixture, history: Object.fromEntries(Array.from({ length: n - 1 }, (_, i) => [i + 1, fixture])), changelog, source: 's/',
    });
    const five = build(5);
    expect(five.versions.map(v => v.version)).toEqual([1, 2, 3, 4, 5]);
    expect(five.earlier).toEqual([]);
    const six = build(6);
    expect(six.versions.map(v => v.version)).toEqual([2, 3, 4, 5, 6]);
    expect(six.earlier).toEqual([{ version: 1, date: '2026-10-01', note: 'nota 1' }]);
    // A changelog out of order still lists the earlier versions by version.
    expect(build(7, [entry(2), entry(1), ...[3, 4, 5, 6, 7].map(entry)]).earlier?.map(e => e.version)).toEqual([1, 2]);
  });
  it('their summary gets the focus ring and the 44 px touch target a round\'s has (M9)', () => {
    const css = readFileSync(path.join(process.cwd(), 'src/design-page/theme.css'), 'utf8');
    expect(css).toMatch(/\.earlier>summary:focus-visible[^{}]*\{outline:2px solid var\(--t-blue\)/);
    expect(/@media \(pointer: coarse\)\{([^{}]*)\{([^}]*)\}/.exec(css)?.[1]).toContain('.earlier>summary');
  });
});
