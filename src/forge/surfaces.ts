// Surfaces: things of the project that can be checked by using them, described in free text in .forge/verify/<name>.md.
// A YAML header (affects, tools) is optional; the body is for forge-verify; "## Learned"/"## Aprendido" collects notes.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { NAME } from './config.js';
import type { RepoReader } from './validators.js';

export interface Surface { name: string; file: string; title: string; affects: string[] | null; tools: string[]; hash: string; error?: string }
export interface Draft { name: string; affects: string[]; tools: string[]; body: string }

/** The sha256 (64 hex) of the whole file, line endings normalised. A permission is tied to permissionHash, which is
 *  this one unless `surfaces learn` recorded lines it appended. */
export function surfaceHash(text: string): string {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
}

/** Whether a stored permission hash covers the surface's hash now: the same, or a 16-hex hash of forge ≤ 0.12 (the
 *  first 16 hex of the same sha256), so the allowances people already have stay valid. */
export function hashMatches(stored: string | null | undefined, current: string): boolean {
  if (!stored) return false;
  return stored === current || (/^[0-9a-f]{16}$/.test(stored) && current.startsWith(stored));
}

/** What `surfaces learn` records for each line it appends: the sha256 (64 hex) of the line, trimmed. */
export function lineDigest(line: string): string {
  return createHash('sha256').update(line.replace(/\r\n?/g, '\n').trim()).digest('hex');
}

/** The headings of the section where `surfaces learn` writes its notes. */
export const LEARNED_HEADINGS = ['Learned', 'Aprendido'] as const;

/**
 * What a permission is tied to: surfaceHash of the file without the lines forge appended to its Learned/Aprendido
 * sections (`learned`: the digests `surfaces learn` recorded for this surface), so notes learned by parallel tasks never
 * ask again. Anything else stays in the hash: a line added by hand, even in forge's format, or a recorded line moved out
 * of a Learned section or into a code fence. With nothing recorded it is surfaceHash itself.
 */
export function permissionHash(text: string, learned?: ReadonlySet<string>): string {
  return surfaceHash(learned?.size ? withoutLearned(text.replace(/\r\n/g, '\n'), learned) : text);
}

const strs = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string' && s.trim() !== '') : []);
export const surfaceFile = (name: string) => `.forge/verify/${name}.md`;

/** `learned`: the digests `surfaces learn` recorded for this surface (see permissionHash). */
export function parseSurface(name: string, text: string, learned?: ReadonlySet<string>): Surface {
  const t = text.replace(/\r\n/g, '\n');
  const out: Surface = { name, file: surfaceFile(name), title: name, affects: null, tools: [], hash: permissionHash(text, learned) };
  let body = t;
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(t);
  if (m) {
    body = t.slice(m[0].length);
    try {
      const h = parse(m[1]);
      if (h && typeof h === 'object' && !Array.isArray(h)) {
        const o = h as Record<string, unknown>;
        if (Array.isArray(o.affects)) out.affects = strs(o.affects);
        out.tools = strs(o.tools);
      } else if (h !== null) out.error = 'header is not a mapping';
    } catch (e) { out.error = `header: ${(e as Error).message.split('\n')[0]}`; }
  }
  const title = /^#\s+(.+)$/m.exec(body);
  if (title) out.title = title[1].trim();
  return out;
}

export function readSurfaces(root: string, learned?: ReadonlyMap<string, ReadonlySet<string>>): Surface[] {
  let names: string[] = [];
  try { names = readdirSync(path.join(root, '.forge', 'verify')); } catch { return []; }
  return names.filter(f => f.endsWith('.md') && NAME.test(f.slice(0, -3))).sort().map(f => {
    const name = f.slice(0, -3);
    let text = '';
    try { text = readFileSync(path.join(root, '.forge', 'verify', f), 'utf8'); } catch { /* unreadable: empty */ }
    return parseSurface(name, text, learned?.get(name));
  });
}

const WEB_DEPS = ['vite', 'next', 'react-scripts', '@angular/core', 'svelte', 'vue', 'astro'];
const WEB_AFFECTS = ['**/*.tsx', '**/*.jsx', '**/*.vue', '**/*.svelte', '**/*.html', '**/*.css', '**/*.scss', '**/pages/**', '**/routes/**', '**/components/**', '**/views/**', '**/app/**'];

export function detectDrafts(repo: RepoReader): Draft[] {
  const out: Draft[] = [];
  let pkg: Record<string, unknown> = {};
  try { pkg = JSON.parse(repo.read('package.json') ?? '{}') ?? {}; } catch { pkg = {}; }
  const deps = { ...(pkg.dependencies as object ?? {}), ...(pkg.devDependencies as object ?? {}) } as Record<string, unknown>;
  const scripts = (pkg.scripts ?? {}) as Record<string, unknown>;
  const script = ['dev', 'start'].find(s => typeof scripts[s] === 'string');
  if (script && WEB_DEPS.some(d => d in deps)) {
    out.push({ name: 'web', affects: WEB_AFFECTS, tools: ['chrome-mcp'], body:
      `# Web\n\nStart the app with \`npm run ${script}\` and open the URL it prints. Check it with the browser MCP (Chrome or Playwright), or the Playwright CLI.\n` });
  }
  const android = ['capacitor.config.ts', 'capacitor.config.js', 'capacitor.config.json'].some(f => repo.exists(f))
    || ['android/app/build.gradle', 'android/app/build.gradle.kts', 'app/build.gradle', 'app/build.gradle.kts'].some(f => /com\.android\.application/.test(repo.read(f) ?? ''));
  if (android) {
    const capacitor = ['capacitor.config.ts', 'capacitor.config.js', 'capacitor.config.json'].some(f => repo.exists(f));
    out.push({ name: 'android', affects: capacitor ? ['android/**', ...WEB_AFFECTS] : ['android/**', '**/res/**', '**/*.kt', '**/*.java'], tools: ['adb'], body:
      `# Android\n\nBuild the debug app${capacitor ? ' (`npx cap sync android` first)' : ''}, install it on a running emulator or device with \`adb install -r\`, launch it and check the screens the change touches with screenshots (\`adb exec-out screencap -p\`).\n` });
  }
  if (repo.list('ios').some(f => /\.(xcodeproj|xcworkspace)$/.test(f))) {
    out.push({ name: 'ios', affects: ['ios/**'], tools: ['xcrun'], body: '# iOS\n\nBuild the app for a simulator and launch it with `xcrun simctl`; check the screens the change touches with `xcrun simctl io booted screenshot`.\n' });
  }
  if (repo.exists('pubspec.yaml')) {
    out.push({ name: 'flutter', affects: ['lib/**'], tools: ['flutter'], body: '# Flutter\n\nRun the app with `flutter run` on an emulator or device and check the screens the change touches with screenshots.\n' });
  }
  if ('electron' in deps || '@tauri-apps/api' in deps) {
    out.push({ name: 'desktop', affects: ['src/**'], tools: [], body: '# Desktop\n\nStart the desktop app in development mode and check the windows the change touches with screenshots.\n' });
  }
  return out;
}

const HEADING = new RegExp(`^##\\s+(${LEARNED_HEADINGS.join('|')})\\s*$`);

/** Lines of the body (`i`: index in t.split('\n'), `at`: offset): after a leading YAML header, outside ``` fences. */
function bodyLines(t: string): { text: string; at: number; i: number }[] {
  const out: { text: string; at: number; i: number }[] = [];
  let pos = 0;
  let i = 0;
  const hdr = /^---\n[\s\S]*?\n---[ \t]*(\n|$)/.exec(t);
  if (hdr) { pos = hdr[0].length; i = (hdr[0].match(/\n/g) ?? []).length; }
  let fence = false;
  for (const text of t.slice(pos).split('\n')) {
    if (/^\s*(```|~~~)/.test(text)) fence = !fence;
    else if (!fence) out.push({ text, at: pos, i });
    pos += text.length + 1;
    i++;
  }
  return out;
}

/** The Learned/Aprendido sections of the body: the heading's line index and the end (the next "## " heading or the end). */
function learnedSections(t: string, lineCount: number): { head: number; end: number; body: { text: string; i: number }[] }[] {
  const bl = bodyLines(t);
  return bl.flatMap((h, k) => {
    if (!HEADING.test(h.text)) return [];
    const next = bl.slice(k + 1).find(l => /^## /.test(l.text));
    const end = next ? next.i : lineCount;
    return [{ head: h.i, end, body: bl.slice(k + 1).filter(l => l.i < end) }];
  });
}

// t (line endings normalised) without the recorded lines of its Learned sections. A section left with only blank lines
// whose heading forge recorded (it created it) goes too, with the blank line appendLearned put before it, so the text
// is the one before the first note. Lines inside code fences always stay.
function withoutLearned(t: string, learned: ReadonlySet<string>): string {
  const lines = t.split('\n');
  const drop = new Set<number>();
  for (const s of learnedSections(t, lines.length)) {
    for (const l of s.body) if (l.text.trim() && learned.has(lineDigest(l.text))) drop.add(l.i);
    if (!learned.has(lineDigest(lines[s.head]))) continue;
    let empty = true;
    for (let i = s.head + 1; i < s.end; i++) if (!drop.has(i) && lines[i].trim()) empty = false;
    if (!empty) continue;
    drop.add(s.head);
    if (s.head > 0 && !drop.has(s.head - 1) && !lines[s.head - 1].trim()) drop.add(s.head - 1);
  }
  return lines.filter((_, i) => !drop.has(i)).join('\n');
}

/**
 * Appends dated one-line notes under "## Learned"/"## Aprendido" in the body (a new section with `heading` at the end,
 * after a blank line, when there is none); keeps the file's line endings. It only inserts lines (after the section's
 * last non-blank line), so dropping them gives the text back as it was: `added` are the lines to record for
 * permissionHash (the heading it created, then the notes).
 */
export function appendLearned(text: string, date: string, notes: string[], heading = 'Learned'): { text: string; count: number; added: string[] } {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const notesLines = notes.map(n => `- ${date}: ${n.replace(/\s*\r?\n\s*/g, ' ').trim()}`);
  const t = text.replace(/\r\n/g, '\n');
  const lines = t.split('\n');
  const [s] = learnedSections(t, lines.length);
  let at: number;
  let inserted: string[];
  let added: string[];
  let count: number;
  if (s) {
    at = s.head;
    for (let i = s.head + 1; i < s.end; i++) if (lines[i].trim()) at = i;
    at++;
    inserted = added = notesLines;
    count = lines.slice(s.head + 1, s.end).filter(l => /^- /.test(l)).length + notesLines.length;
  } else {
    // Before the final line break, if any.
    at = t === '' || t.endsWith('\n') ? lines.length - 1 : lines.length;
    added = [`## ${heading}`, ...notesLines];
    inserted = at > 0 ? ['', ...added] : added;
    count = notesLines.length;
  }
  const next = [...lines.slice(0, at), ...inserted, ...lines.slice(at)].join('\n');
  return { text: eol === '\n' ? next : next.replace(/\n/g, '\r\n'), count, added };
}
