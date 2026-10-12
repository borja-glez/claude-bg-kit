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

/** What a permission is tied to: the whole file, line endings normalised. forge's own notes are re-blessed by `surfaces learn`. */
export function surfaceHash(text: string): string {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);
}

const strs = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string' && s.trim() !== '') : []);
export const surfaceFile = (name: string) => `.forge/verify/${name}.md`;

export function parseSurface(name: string, text: string): Surface {
  const t = text.replace(/\r\n/g, '\n');
  const out: Surface = { name, file: surfaceFile(name), title: name, affects: null, tools: [], hash: surfaceHash(text) };
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

export function readSurfaces(root: string): Surface[] {
  let names: string[] = [];
  try { names = readdirSync(path.join(root, '.forge', 'verify')); } catch { return []; }
  return names.filter(f => f.endsWith('.md') && NAME.test(f.slice(0, -3))).sort().map(f => {
    const name = f.slice(0, -3);
    let text = '';
    try { text = readFileSync(path.join(root, '.forge', 'verify', f), 'utf8'); } catch { /* unreadable: empty */ }
    return parseSurface(name, text);
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

const HEADING = /^##\s+(Learned|Aprendido)\s*$/;

/** Lines (with offsets) of the body: after a leading YAML header, outside ``` fences. */
function bodyLines(t: string): { text: string; at: number }[] {
  const out: { text: string; at: number }[] = [];
  let pos = 0;
  const hdr = /^---\n[\s\S]*?\n---[ \t]*(\n|$)/.exec(t);
  if (hdr) pos = hdr[0].length;
  let fence = false;
  for (const text of t.slice(pos).split('\n')) {
    if (/^\s*(```|~~~)/.test(text)) fence = !fence;
    else if (!fence) out.push({ text, at: pos });
    pos += text.length + 1;
  }
  return out;
}

/** Appends dated one-line notes under "## Learned"/"## Aprendido" in the body (created with `heading` when missing); keeps the file's line endings. */
export function appendLearned(text: string, date: string, notes: string[], heading = 'Learned'): { text: string; count: number } {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = notes.map(n => `- ${date}: ${n.replace(/\s*\r?\n\s*/g, ' ').trim()}`);
  const t = text.replace(/\r\n/g, '\n');
  const bl = bodyLines(t);
  const hi = bl.findIndex(l => HEADING.test(l.text));
  let next: string;
  let count: number;
  if (hi >= 0) {
    const start = bl[hi].at + bl[hi].text.length;
    const endLine = bl.slice(hi + 1).find(l => /^## /.test(l.text));
    const section = t.slice(start, endLine ? endLine.at : undefined);
    const kept = section.replace(/\n+$/, '');
    count = (kept.match(/^- /gm) ?? []).length + lines.length;
    next = `${t.slice(0, start)}${kept}\n${lines.join('\n')}\n${endLine ? '\n' + t.slice(endLine.at) : ''}`;
  } else {
    const head = t.replace(/\n+$/, '');
    next = `${head}${head ? '\n\n' : ''}## ${heading}\n${lines.join('\n')}\n`;
    count = lines.length;
  }
  return { text: eol === '\n' ? next : next.replace(/\n/g, '\r\n'), count };
}
