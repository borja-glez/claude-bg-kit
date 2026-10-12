import { Marked } from 'marked';
import { sectionsOf } from './design.js';

const ENT: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string) => s.replace(/[&<>"']/g, c => ENT[c]);
const SAFE = /^(https?:|mailto:|#)/i;

export function renderMarkdown(md: string): string {
  const sections = sectionsOf(md);
  let next = 0;
  const topLevel = new Set<object>();
  const marked = new Marked({ gfm: true, async: false });
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
    },
  });
  const tokens = marked.lexer(md);
  for (const t of tokens) if (t.type === 'heading') topLevel.add(t);
  return marked.parser(tokens);
}
