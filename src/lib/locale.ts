import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { isLocale } from './forge-run.js';

const NAMES: Record<string, string> = {
  es: 'Spanish', en: 'English', pt: 'Portuguese', fr: 'French', de: 'German', it: 'Italian', ca: 'Catalan', gl: 'Galician', eu: 'Basque',
};

/** Where a locale comes from: the person (the run or the execution recorded it) or the plan's `locale`. */
export type LocaleSource = 'person' | 'plan';

/**
 * The sentence a hook appends to the text it injects, so the session keeps talking to the person in their language:
 * hook texts are English and are the last thing the model reads on each tick, which otherwise drags it into English.
 */
export function replyIn(locale: string | null | undefined, source: LocaleSource = 'plan'): string {
  const code = (locale ?? '').toLowerCase().split(/[-_]/)[0];
  if (!code) return ' Tell the user in their own language.';
  const name = NAMES[code];
  if (source === 'person') return ` Tell the user in ${name ? `${name} (${code})` : `«${code}»`}, the language they write in.`;
  return ` Tell the user in ${name ? `${name} (${code})` : `the language «${code}»`}, the plan's language.`;
}

/**
 * The reminder of the language to answer in: the infinite run's locale, else the execution's (both the person's), else
 * the plan's (read only when needed); null when none is known.
 */
export function sessionReply(run: { locale?: string } | null | undefined, exec: { locale?: string } | null | undefined, plan: () => string | null): string | null {
  const person = run?.locale ?? exec?.locale;
  if (person) return replyIn(person, 'person');
  const fromPlan = plan();
  return fromPlan ? replyIn(fromPlan, 'plan') : null;
}

/**
 * The `locale` key of docs/waypoint/<project>/plan.yaml (the only project when none is given), as written: null when
 * the plan has none (the plan schema's `en` default says nothing about the person) or it is unknown.
 */
export function planLocale(root: string, project?: string | null): string | null {
  try {
    const docs = path.join(root, 'docs', 'waypoint');
    const projects = project ? [project] : readdirSync(docs, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
    for (const p of projects) {
      const file = path.join(docs, p, 'plan.yaml');
      if (!existsSync(file)) continue;
      const raw: unknown = parse(readFileSync(file, 'utf8'));
      const locale = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>).locale : null;
      // It reaches the model's context: only a language code.
      return isLocale(locale) ? locale : null;
    }
  } catch { /* unknown */ }
  return null;
}
