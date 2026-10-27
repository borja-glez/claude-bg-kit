import { Marked, type Tokens } from 'marked';
import { sectionsOf } from './design.js';
import { parseChart, parseSteps, type ChartSpec, type Step } from './visual-blocks.js';

const ENT: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string) => s.replace(/[&<>"']/g, c => ENT[c]);
const SAFE = /^(https?:|mailto:|#)/i;

/** GitHub's alert kinds (`> [!NOTE]`), each with its label in the page's languages. */
const CALLOUTS: Record<string, { en: string; es: string }> = {
  note: { en: 'Note', es: 'Nota' },
  tip: { en: 'Tip', es: 'Consejo' },
  important: { en: 'Important', es: 'Importante' },
  warning: { en: 'Warning', es: 'Atención' },
  caution: { en: 'Caution', es: 'Cuidado' },
};
const CALLOUT = /^<p>\[!(note|tip|important|warning|caution)\][ \t]*(?:<br>)?\s*/i;

/** A table cell that holds a quantity: a number, perhaps with a sign, a range, a unit or a currency. */
const NUMERIC = /^[~≈<>≤≥±+−-]?\s*\d[\d.,\s–-]*\s*(?:%|\$|€|[kKM]|ms|s|min|h|d|x|×|[KMG]B|tokens?)?$/u;
const EMPTY = /^(?:|—|–|-)$/;
const plain = (s: string) => s.replace(/[*_`]/g, '').trim();

export interface RenderOptions { locale?: string }

export function renderMarkdown(md: string, opts: RenderOptions = {}): string {
  const lang = (opts.locale ?? 'en').toLowerCase().startsWith('es') ? 'es' : 'en';
  const fmt = new Intl.NumberFormat(lang === 'es' ? 'es-ES' : 'en-US', { maximumFractionDigits: 2 });
  const sections = sectionsOf(md);
  let next = 0;
  const topLevel = new Set<object>();
  const marked = new Marked({ gfm: true, async: false });
  const inline = (s: string) => marked.parseInline(s) as string;

  const chart = (c: ChartSpec): string => {
    const max = Math.max(...c.rows.flatMap(r => r.values), 0) || 1;
    const value = (v: number) => `${fmt.format(v)}${c.unit ? ` ${esc(c.unit)}` : ''}`;
    const legend = c.series.length
      ? `<div class="ch-key">${c.series.map((s, i) => `<span class="s${i + 1}">${esc(s)}</span>`).join('')}</div>`
      : '';
    const rows = c.rows.map(r => `<div class="ch-row"><span class="ch-l">${inline(r.label)}</span><span class="ch-bars">${r.values.map((v, i) =>
      `<span class="ch-bar s${i + 1}"><i style="--f:${(v / max).toFixed(4)}"></i><b>${value(v)}</b></span>`).join('')}</span></div>`).join('');
    return `<figure class="vb chart${c.series.length ? ' multi' : ''}">${c.title ? `<figcaption>${inline(c.title)}</figcaption>` : ''}${legend}<div class="ch">${rows}</div>${c.note ? `<p class="ch-note">${inline(c.note)}</p>` : ''}</figure>\n`;
  };
  const steps = (list: Step[]): string =>
    `<ol class="vb steps" style="--n:${list.length}">${list.map((s, i) => `<li><span class="st-k">${i + 1}</span><b>${inline(s.title)}</b>${s.text ? `<span class="st-t">${inline(s.text)}</span>` : ''}</li>`).join('')}</ol>\n`;
  const broken = (kind: string, error: string, text: string) =>
    `<div class="vb vb-err"><p>${esc(kind)}: ${esc(error)}</p><pre><code>${esc(text)}</code></pre></div>\n`;

  marked.use({
    renderer: {
      html({ text, block }) { return block ? `<p>${esc(text)}</p>
` : esc(text); },
      heading(token) {
        const { tokens, depth } = token;
        const inner = this.parser.parseInline(tokens);
        // Only top-level ATX headings that sectionsOf also counted get an id: scan forward for the
        // first section with the same level and text (skipping ones marked missed, e.g. inside comments).
        if ((depth === 2 || depth === 3) && topLevel.has(token) && /^#{2,3}\s/.test(token.raw)) {
          const i = sections.findIndex((s, k) => k >= next && s.level === depth && s.heading === token.text);
          if (i >= 0) {
            next = i + 1;
            return `<h${depth} id="${esc(sections[i].slug)}">${inner}</h${depth}>
`;
          }
        }
        return `<h${depth}>${inner}</h${depth}>\n`;
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        if (!SAFE.test(href.trim())) return text;
        return `<a href="${esc(href)}"${title ? ` title="${esc(title)}"` : ''} rel="noopener noreferrer">${text}</a>`;
      },
      image({ href, text }) {
        if (!/^https?:/i.test(href.trim())) return esc(text);
        return `<img src="${esc(href)}" alt="${esc(text)}" loading="lazy">`;
      },
      // Diagrams, charts and steps; any other block is code with its language as a label.
      code({ text, lang: info }) {
        const kind = (info ?? '').trim().split(/\s+/)[0].toLowerCase();
        if (kind === 'mermaid') return `<figure class="vb dg"><pre class="mermaid">${esc(text)}</pre></figure>\n`;
        if (kind === 'chart') { const r = parseChart(text); return r.ok ? chart(r.value) : broken(kind, r.error, text); }
        if (kind === 'steps') { const r = parseSteps(text); return r.ok ? steps(r.value) : broken(kind, r.error, text); }
        const tag = /^[\w+#.-]{1,24}$/.test(kind) ? kind : '';
        return `<pre${tag ? ` data-lang="${esc(tag)}"` : ''}><code>${esc(text)}</code></pre>\n`;
      },
      // `> [!NOTE]` and its kin become a labelled callout; any other quote stays a quote.
      blockquote({ tokens }) {
        const body = this.parser.parse(tokens);
        const m = CALLOUT.exec(body);
        if (!m) return `<blockquote>\n${body}</blockquote>\n`;
        const kind = m[1].toLowerCase();
        const rest = `<p>${body.slice(m[0].length)}`.replace(/^<p><\/p>\n?/, '');
        return `<aside class="co co-${kind}" role="note"><p class="co-h">${CALLOUTS[kind][lang]}</p>${rest}</aside>\n`;
      },
      // A table scrolls in its own box; a column of quantities is right-aligned; four columns or more take the wide band.
      table(token) {
        const cols = token.header.length;
        const numeric = token.header.map((_, i) => {
          const cells = token.rows.map(r => plain(r[i]?.text ?? '')).filter(t => !EMPTY.test(t));
          return cells.length > 0 && cells.every(t => NUMERIC.test(t));
        });
        const cell = (tag: 'th' | 'td', c: Tokens.TableCell, i: number) => {
          const align = c.align ?? (numeric[i] ? 'right' : null);
          const cls = [numeric[i] ? 'num' : '', align && align !== 'left' ? `a-${align}` : ''].filter(Boolean).join(' ');
          return `<${tag}${cls ? ` class="${cls}"` : ''}>${this.parser.parseInline(c.tokens)}</${tag}>`;
        };
        const head = `<thead><tr>${token.header.map((c, i) => cell('th', c, i)).join('')}</tr></thead>`;
        const rows = token.rows.length ? `<tbody>${token.rows.map(r => `<tr>${r.map((c, i) => cell('td', c, i)).join('')}</tr>`).join('')}</tbody>` : '';
        return `<div class="tbl${cols >= 4 ? ' wide' : ''}" style="--cols:${cols}" tabindex="0"><table>${head}${rows}</table></div>\n`;
      },
    },
  });
  const tokens = marked.lexer(md);
  for (const t of tokens) if (t.type === 'heading') topLevel.add(t);
  return marked.parser(tokens);
}
