import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parsePlan } from './plan.js';

const NAMES: Record<string, string> = {
  es: 'Spanish', en: 'English', pt: 'Portuguese', fr: 'French', de: 'German', it: 'Italian', ca: 'Catalan', gl: 'Galician', eu: 'Basque',
};

/**
 * The sentence a hook appends to the text it injects, so the session keeps talking to the person in the plan's language:
 * hook texts are English and are the last thing the model reads on each tick, which otherwise drags it into English.
 */
export function replyIn(locale: string | null | undefined): string {
  const code = (locale ?? '').toLowerCase().split(/[-_]/)[0];
  if (!code) return ' Tell the user in their own language.';
  const name = NAMES[code];
  return ` Tell the user in ${name ? `${name} (${code})` : `the language «${code}»`}, the plan's language.`;
}

/** The `locale` of docs/waypoint/<project>/plan.yaml (the only project when none is given); null when unknown. */
export function planLocale(root: string, project?: string | null): string | null {
  try {
    const docs = path.join(root, 'docs', 'waypoint');
    const projects = project ? [project] : readdirSync(docs, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
    for (const p of projects) {
      const file = path.join(docs, p, 'plan.yaml');
      if (existsSync(file)) return parsePlan(readFileSync(file, 'utf8')).locale ?? null;
    }
  } catch { /* unknown */ }
  return null;
}
