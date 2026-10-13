// A superpowers spec (superpowers:brainstorming) as a waypoint design.md, mechanically and without rewriting it: the
// H1 becomes the title, what sits between the H1 and the first `##` stays as the body's introduction, and every
// section is copied as written. Pure (no node:*, no zod).
import { stringify } from 'yaml';

export class SpecImportError extends Error {}
export const SUMMARY_MAX = 400;
// A byte order mark some editors put first, from its code point so the source never holds the invisible character.
const BOM = String.fromCharCode(0xfeff);
const PURPOSE = /prop[oó]sito|purpose|overview|resumen|summary|objetivo|goal/i;

interface Line { text: string; fenced: boolean }

// The same split as the body below (one piece per line, its end of line kept apart), so indexes match.
function linesOf(text: string): Line[] {
  const out: Line[] = [];
  let fence: string | null = null;
  for (const piece of text.split(/(?<=\n)/)) {
    const t = piece.replace(/\r?\n$/, '');
    if (fence) {
      out.push({ text: t, fenced: true });
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(t);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
      continue;
    }
    const open = /^\s*(`{3,}|~{3,})/.exec(t);
    if (open) fence = open[1];
    out.push({ text: t, fenced: !!open });
  }
  return out;
}

/** The H1 without a trailing «— diseño», «- design» or «: design». */
export function specTitle(h1: string): string {
  return h1.replace(/\s*(?:[—–-]|:)\s*(?:diseño|design)\s*$/i, '').trim() || h1.trim();
}

/** The title of a spec: its first `# ` heading outside code, without a design suffix; null without one. */
export function specH1(text: string): string | null {
  const h1 = linesOf(text).find(l => !l.fenced && /^#\s+\S/.test(l.text));
  return h1 ? specTitle(h1.text.replace(/^#\s+/, '').replace(/\s+#*\s*$/, '')) : null;
}

/** The first paragraph (not a heading, list, table, quote, comment, rule or code) of these lines, collapsed and clipped. */
function firstParagraph(lines: Line[]): string | null {
  const para: string[] = [];
  for (const l of lines) {
    const t = l.text.trim();
    const plain = !l.fenced && !!t && !/^(#{1,6}\s|[-*+]\s|\d+[.)]\s|\||>|<!--)/.test(t) && !/^(-{3,}|\*{3,}|_{3,})$/.test(t);
    if (plain) { para.push(t); continue; }
    if (para.length) break;
  }
  if (!para.length) return null;
  return para.join(' ').replace(/\s+/g, ' ').trim().slice(0, SUMMARY_MAX).trimEnd();
}

export function importSpec(text: string, opts: { project: string; locale: string; source: string }): string {
  const src = text.startsWith(BOM) ? text.slice(1) : text;
  const lines = linesOf(src);
  const h1 = lines.findIndex(l => !l.fenced && /^#\s+\S/.test(l.text));
  if (h1 < 0) throw new SpecImportError('the spec has no "# " title');
  const after = lines.slice(h1 + 1);
  if (!after.some(l => !l.fenced && /^##\s+\S/.test(l.text))) throw new SpecImportError('the spec has no "## " section');
  const title = specTitle(lines[h1].text.replace(/^#\s+/, '').replace(/\s+#*\s*$/, ''));
  // The summary: the first paragraph of the first purpose-like section, else of the body, else the title.
  let summary: string | null = null;
  for (let i = 0; i < after.length && summary === null; i++) {
    const m = after[i].fenced ? null : /^#{2,3}\s+(.+)$/.exec(after[i].text);
    if (!m || !PURPOSE.test(m[1])) continue;
    const next = after.findIndex((x, j) => j > i && !x.fenced && /^#{2,3}\s/.test(x.text));
    summary = firstParagraph(after.slice(i + 1, next < 0 ? after.length : next));
  }
  summary ??= firstParagraph(after) ?? title;
  const meta = { title, project: opts.project, locale: opts.locale, summary, pillars: [], start_prompt: '/waypoint:work <track>', status: 'draft', source: opts.source };
  // The body is the spec after its H1, byte for byte (its line endings included), without the leading blank lines.
  const body = src.split(/(?<=\n)/).slice(h1 + 1).join('').replace(/^(?:[ \t]*\r?\n)+/, '');
  return `---\n${stringify(meta, { lineWidth: 0 })}---\n\n${body}`;
}
