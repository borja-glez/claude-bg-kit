// The tests that read the repo's own files share these: every file under a directory, and where a Markdown text writes
// code (the units the skills' citations are read from).
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/** Every file under dir, recursively, as dir joined with its path. */
export const walk = (dir: string): string[] => readdirSync(dir).flatMap(n => {
  const p = path.join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

const FENCE = /^\s*(`{3,}|~{3,})(.*)$/;

/** The lines of a Markdown text, each with whether it is inside a fenced block (a fence line is neither), and whether the
 *  text ends inside one. A block closes only on a fence of its own character, at least as long, with nothing after it
 *  (CommonMark): a ``` inside a ```` block, or a fence with an info string, never turns the prose after it into code. */
export function fenced(text: string): { lines: { text: string; code: boolean }[]; open: boolean } {
  const lines: { text: string; code: boolean }[] = [];
  let fence: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const m = FENCE.exec(line);
    if (m && fence === null && !(m[1][0] === '`' && m[2].includes('`'))) { fence = m[1]; continue; }
    if (m && fence !== null && m[1][0] === fence[0] && m[1].length >= fence.length && !m[2].trim()) { fence = null; continue; }
    lines.push({ text: line, code: fence !== null });
  }
  return { lines, open: fence !== null };
}

/** Where a Markdown text writes code: its inline code spans and the lines of its fenced blocks (`block`), a line that
 *  ends in `\` joined with the next one (one shell command). */
export function codeUnits(text: string): { text: string; block: boolean }[] {
  const out: { text: string; block: boolean }[] = [];
  let pending = '';
  const flush = () => { if (pending) out.push({ text: pending, block: true }); pending = ''; };
  for (const { text: line, code } of fenced(text).lines) {
    if (code) {
      const joined = pending ? `${pending} ${line.trimStart()}` : line;
      if (/\\\s*$/.test(joined)) { pending = joined.replace(/\s*\\\s*$/, ''); continue; }
      pending = joined;
      flush();
      continue;
    }
    flush();
    for (const m of line.matchAll(/`([^`]+)`/g)) out.push({ text: m[1], block: false });
  }
  flush();
  return out;
}

/** The text of codeUnits. */
export const units = (text: string): string[] => codeUnits(text).map(u => u.text);
