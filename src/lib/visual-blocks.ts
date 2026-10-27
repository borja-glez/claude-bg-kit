import { parse } from 'yaml';

/**
 * The visual blocks a design body can hold, as fenced code blocks: ```mermaid (a diagram the page draws), ```chart (bars
 * from a few numbers) and ```steps (a sequence of phases). The page renders them; design-validate checks them first, so a
 * broken block is fixed before it is published.
 */
export const VISUAL_LANGS = ['mermaid', 'chart', 'steps'] as const;
export type VisualLang = (typeof VISUAL_LANGS)[number];

export const CHART_ROWS_MAX = 24;
export const CHART_SERIES_MAX = 4;
export const STEPS_MIN = 2;
export const STEPS_MAX = 8;

export interface ChartRow { label: string; values: number[] }
export interface ChartSpec { title?: string; unit?: string; note?: string; series: string[]; rows: ChartRow[] }
export interface Step { title: string; text?: string }

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : undefined);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

function yamlOf(text: string): Parsed<unknown> {
  try { return { ok: true, value: parse(text) }; } catch (e) { return { ok: false, error: `YAML: ${(e as Error).message.split('\n')[0]}` }; }
}

/**
 * A ```chart block: `title`, `unit`, `note` (all optional), `data` as a list of `{label, value}`, or with `series`
 * (2-4 names) a list of `{label, values: [...]}` with one number per series. Numbers are finite and not negative.
 */
export function parseChart(text: string): Parsed<ChartSpec> {
  const y = yamlOf(text);
  if (!y.ok) return y;
  const doc = y.value;
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, error: 'chart: expected keys `data` (and optionally `title`, `unit`, `series`, `note`)' };
  const o = doc as Record<string, unknown>;
  const series = o.series === undefined ? [] : Array.isArray(o.series) ? o.series.map(str) : null;
  if (!series || series.some(s => s === undefined)) return { ok: false, error: 'chart: `series` is a list of names' };
  if (series.length > CHART_SERIES_MAX || series.length === 1) return { ok: false, error: `chart: \`series\` names 2 to ${CHART_SERIES_MAX} series (leave it out for one)` };
  if (!Array.isArray(o.data) || !o.data.length) return { ok: false, error: 'chart: `data` is a non-empty list' };
  if (o.data.length > CHART_ROWS_MAX) return { ok: false, error: `chart: at most ${CHART_ROWS_MAX} rows in \`data\`` };
  const rows: ChartRow[] = [];
  for (const [i, item] of o.data.entries()) {
    const r = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const label = str(r.label);
    if (!label) return { ok: false, error: `chart: data[${i}] has no \`label\`` };
    if (series.length) {
      const values = Array.isArray(r.values) ? r.values.map(num) : [];
      if (values.length !== series.length || values.some(v => v === null)) return { ok: false, error: `chart: data[${i}] needs \`values\` with ${series.length} numbers ≥ 0, one per series` };
      rows.push({ label, values: values as number[] });
    } else {
      const value = num(r.value);
      if (value === null) return { ok: false, error: `chart: data[${i}] needs a \`value\`, a number ≥ 0` };
      rows.push({ label, values: [value] });
    }
  }
  return { ok: true, value: { title: str(o.title), unit: str(o.unit), note: str(o.note), series: series as string[], rows } };
}

/** A ```steps block: a list of 2-8 steps, each `{title, text}` or just a title. */
export function parseSteps(text: string): Parsed<Step[]> {
  const y = yamlOf(text);
  if (!y.ok) return y;
  const list = y.value;
  if (!Array.isArray(list)) return { ok: false, error: 'steps: expected a list of `{title, text}`' };
  if (list.length < STEPS_MIN || list.length > STEPS_MAX) return { ok: false, error: `steps: ${STEPS_MIN} to ${STEPS_MAX} steps` };
  const steps: Step[] = [];
  for (const [i, item] of list.entries()) {
    if (typeof item === 'string' && item.trim()) { steps.push({ title: item.trim() }); continue; }
    const r = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const title = str(r.title);
    if (!title) return { ok: false, error: `steps: step ${i + 1} has no \`title\`` };
    steps.push({ title, ...(str(r.text) ? { text: str(r.text) } : {}) });
  }
  return { ok: true, value: steps };
}

/** The fenced blocks of a Markdown body: their language (first word of the info string, lower case), text and line. */
export function fencedBlocks(body: string): { lang: string; text: string; line: number }[] {
  const out: { lang: string; text: string; line: number }[] = [];
  let open: { fence: string; lang: string; line: number; lines: string[] } | null = null;
  body.split(/\r?\n/).forEach((l, i) => {
    if (open) {
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(l);
      if (close && close[1][0] === open.fence[0] && close[1].length >= open.fence.length) {
        out.push({ lang: open.lang, text: open.lines.join('\n'), line: open.line });
        open = null;
      } else open.lines.push(l);
      return;
    }
    const m = /^\s*(`{3,}|~{3,})\s*([^\s`]*)/.exec(l);
    if (m) open = { fence: m[1], lang: m[2].toLowerCase(), line: i + 1, lines: [] };
  });
  return out;
}

/** What is wrong with the visual blocks of a body, one line each («line 12: chart: …»); empty when all are fine. */
export function visualIssues(body: string): string[] {
  const issues: string[] = [];
  for (const b of fencedBlocks(body)) {
    if (b.lang === 'mermaid' && !b.text.trim()) issues.push(`line ${b.line}: mermaid: the diagram is empty`);
    if (b.lang === 'chart') { const r = parseChart(b.text); if (!r.ok) issues.push(`line ${b.line}: ${r.error}`); }
    if (b.lang === 'steps') { const r = parseSteps(b.text); if (!r.ok) issues.push(`line ${b.line}: ${r.error}`); }
  }
  return issues;
}
