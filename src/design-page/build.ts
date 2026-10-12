import { parseDesign, sectionsOf, type DesignMeta } from '../lib/design.js';
import type { ChangelogEntry } from '../lib/history.js';
import { renderMarkdown } from '../lib/markdown.js';

export interface DesignPageData {
  meta: DesignMeta;
  words: number;
  rounds: number;
  source: string;
  current: number;
  versions: { version: number; date: string; note: string; words: number; html: string; toc: { level: 2 | 3; heading: string; slug: string }[] }[];
}

export function buildDesignPageData(input: { current: string; history: Record<number, string>; changelog: ChangelogEntry[]; source: string }): DesignPageData {
  const cur = parseDesign(input.current);
  const last = input.changelog[input.changelog.length - 1];
  const currentNo = last?.version ?? 1;
  const texts: Record<number, string> = { ...input.history, [currentNo]: input.current };
  const numbers = [...new Set([...Object.keys(texts).map(Number), ...input.changelog.map(c => c.version)])]
    .filter(n => texts[n] !== undefined)
    .sort((a, b) => a - b);
  const versions = numbers.map(n => {
    const d = parseDesign(texts[n]);
    const entry = input.changelog.find(c => c.version === n);
    return {
      version: n,
      date: entry?.date ?? '',
      note: entry?.note ?? '',
      words: d.words,
      html: renderMarkdown(d.body),
      toc: sectionsOf(d.body).map(({ level, heading, slug }) => ({ level, heading, slug })),
    };
  });
  return {
    meta: cur.meta,
    words: cur.words,
    rounds: last?.round ?? 0,
    source: input.source,
    current: currentNo,
    versions,
  };
}
