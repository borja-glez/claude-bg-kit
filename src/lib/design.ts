import { parse } from 'yaml';
import { z } from 'zod';

const ID = /^[A-Za-z0-9_.-]{1,64}$/;

const MetaSchema = z.object({
  title: z.string().min(1),
  project: z.string().regex(ID, 'invalid id (allowed: letters, digits, _ . -; max 64)').refine(s => s !== '.' && s !== '..', 'invalid id'),
  locale: z.string().min(1).default('en'),
  summary: z.string().min(1),
  pillars: z.array(z.object({ title: z.string().min(1), text: z.string().min(1) })).max(8).default([]),
  start_prompt: z.string().min(1).default('/waypoint:work <track>'),
  status: z.enum(['draft', 'approved', 'parked']).default('draft'),
  artifact: z.string().url().optional(),
  source: z.string().min(1).max(300).optional(),
});

export type DesignMeta = z.infer<typeof MetaSchema>;
export interface Section { level: 2 | 3; heading: string; slug: string; text: string }
export interface Design { meta: DesignMeta; body: string; sections: Section[]; words: number }

export class DesignError extends Error {
  constructor(public issues: string[]) {
    super(`Invalid design:\n- ${issues.join('\n- ')}`);
    this.name = 'DesignError';
  }
}

const FM = /^---\r?\n(?:([\s\S]*?)\r?\n)?---\r?\n?([\s\S]*)$/;
// A byte order mark some editors put first, from its code point so the source never holds the invisible character.
const BOM = String.fromCharCode(0xfeff);

export function parseDesign(text: string): Design {
  const m = FM.exec(text.startsWith(BOM) ? text.slice(1) : text);
  if (!m) throw new DesignError(['missing front matter block (--- ... ---) at the top of design.md']);
  let raw: unknown;
  try { raw = parse(m[1] ?? ''); } catch (e) { throw new DesignError([`YAML: ${(e as Error).message}`]); }
  const r = MetaSchema.safeParse(raw ?? {});
  if (!r.success) throw new DesignError(r.error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`));
  const body = m[2];
  return { meta: r.data, body, sections: sectionsOf(body), words: wordCount(body) };
}

/**
 * K3-13: the design text with its front matter's `status` set: the `status:` line replaced, or added before the closing
 * `---`. The body, the line endings and a leading BOM stay as they are.
 */
export function setDesignStatus(text: string, status: DesignMeta['status']): string {
  const bom = text.startsWith(BOM) ? BOM : '';
  const rest = bom ? text.slice(1) : text;
  const m = /^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/.exec(rest);
  if (!m) throw new DesignError(['missing front matter block (--- ... ---) at the top of design.md']);
  const eol = m[1].endsWith('\r\n') ? '\r\n' : '\n';
  const lines = m[2].split(/\r?\n/);
  const at = lines.findIndex(l => /^status\s*:/.test(l));
  if (at >= 0) lines[at] = `status: ${status}`; else lines.push(`status: ${status}`);
  return `${bom}${m[1]}${lines.join(eol)}${m[3]}${rest.slice(m[0].length)}`;
}

/** Carry 8: the longest slug, the limit of a plan task's `design_ref`, so a task can name any section. */
export const SLUG_MAX = 80;
/** `slug` cut to `max` characters, without a dash left at its end. */
const cutSlug = (slug: string, max: number): string => slug.slice(0, max).replace(/-+$/, '');

export function slugify(heading: string): string {
  const slug = heading.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return cutSlug(slug, SLUG_MAX) || 'section';
}

/** The `n`-th section with slug `base` (n ≥ 2): its `-n` added after the cut, so it stays at most SLUG_MAX. */
const nthSlug = (base: string, n: number): string => `${cutSlug(base, SLUG_MAX - `-${n}`.length)}-${n}`;

/**
 * Splits a markdown body into sections. Only ATX headings `##` and `###` open a
 * section; setext headings and `#` H1 lines are plain text. Headings inside
 * fenced code blocks are ignored.
 */
export function sectionsOf(body: string): Section[] {
  return parseSections(body).sections;
}

function parseSections(body: string): { intro: string; sections: Section[] } {
  const out: Section[] = [];
  const seen = new Set<string>();
  let fence: string | null = null;
  let cur: Section | null = null;
  const lines: string[] = [];
  const introLines: string[] = [];
  const flush = () => { if (cur) { cur.text = lines.join('\n').trim(); out.push(cur); } lines.length = 0; };
  for (const line of body.split(/\r?\n/)) {
    const isHeading = !fence && /^(#{2,3})\s+(.+?)(?:\s+#+)?\s*$/.exec(line);
    if (fence) {
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(line);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
    } else {
      const open = /^\s*(`{3,}|~{3,})/.exec(line);
      if (open) fence = open[1];
    }
    if (isHeading) {
      flush();
      const base = slugify(isHeading[2]);
      let slug = base;
      for (let n = 2; seen.has(slug); n++) slug = nthSlug(base, n);
      seen.add(slug);
      cur = { level: isHeading[1].length as 2 | 3, heading: isHeading[2], slug, text: '' };
    } else if (cur) {
      lines.push(line);
    } else {
      introLines.push(line);
    }
  }
  flush();
  return { intro: introLines.join('\n').trim(), sections: out };
}

export function wordCount(body: string): number {
  return body.replace(/[#>*_`~\-|[\]()]/g, ' ').split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

export function changedSections(prev: string, next: string): string[] {
  const p = parseSections(prev);
  const n = parseSections(next);
  const before = new Map<string, string>([['_intro', norm(p.intro)], ...p.sections.map(s => [s.slug, norm(s.text)] as [string, string])]);
  const after: [string, string][] = [['_intro', norm(n.intro)], ...n.sections.map(s => [s.slug, norm(s.text)] as [string, string])];
  const changed: string[] = [];
  for (const [slug, text] of after) {
    const old = before.get(slug);
    if (slug === '_intro' ? (old ?? '') !== text : old !== text) changed.push(slug);
  }
  return changed;
}
