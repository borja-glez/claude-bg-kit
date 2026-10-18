// The tests that read the repo's own files share these: every file under a directory, and where a Markdown text writes
// code (the units the skills' citations are read from).
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/** Every file under dir, recursively, as dir joined with its path. */
export const walk = (dir: string): string[] => readdirSync(dir).flatMap(n => {
  const p = path.join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

/** Where a Markdown text writes code: its inline code spans and the lines of its fenced blocks. */
export function units(text: string): string[] {
  const out: string[] = [];
  let fence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) { fence = !fence; continue; }
    if (fence) { out.push(line); continue; }
    for (const m of line.matchAll(/`([^`]+)`/g)) out.push(m[1]);
  }
  return out;
}
