import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { walk } from './helpers/files.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = path.join(ROOT, 'plugins', 'web');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const manifest = () => JSON.parse(read('plugins/web/.claude-plugin/plugin.json'));
/** Personal paths, machine data and the names of the projects the skill was written from (spec, «Común a D1–D4»; A7). */
const PERSONAL = /[A-Za-z]:[\\/](?:Users|work)[\\/]|\/(?:Users|home)\/[^/\s]+|LOCALAPPDATA|borjaglez|rukh|chess-lm/i;
/** Zero-width, bidi and BOM characters (A7). Built from code points, as in tests/source-text.test.ts, which fails on any raw one under tests/. */
const cp = (n: number) => String.fromCharCode(n);
const INVISIBLE = new RegExp(`[${cp(0x200b)}-${cp(0x200f)}${cp(0x202a)}-${cp(0x202e)}${cp(0x2060)}-${cp(0x2064)}${cp(0x2066)}-${cp(0x2069)}${cp(0xfeff)}]`);

describe('plugin web (w7 D2)', () => {
  it('the manifest is web 0.1.1, and the marketplace lists it from plugins/web with the same description', () => {
    expect(manifest()).toEqual({ name: 'web', description: expect.stringMatching(/^Astro sites with Preact islands/), version: '0.1.1', author: { name: 'Borja' } });
    expect(JSON.parse(read('.claude-plugin/marketplace.json')).plugins).toContainEqual({ name: 'web', source: './plugins/web', description: manifest().description });
  });
  it('web is text only: a manifest, its READMEs and skills, without hooks, bundles, scripts, sources or agents', () => {
    const files = walk(WEB).map(f => path.relative(WEB, f).split(path.sep).join('/'));
    expect(files).toContain('.claude-plugin/plugin.json');
    for (const f of files) expect(f).toMatch(/^(\.claude-plugin\/plugin\.json|README(\.es)?\.md|skills\/[a-z-]+\/(SKILL\.md|references\/[a-z-]+\.md))$/);
  });
  it('no file of plugins/web carries a personal path, a project name, a CR or an invisible character', () => {
    for (const f of walk(WEB)) {
      const text = readFileSync(f, 'utf8');
      const rel = path.relative(ROOT, f);
      expect(text, rel).not.toMatch(PERSONAL);
      expect(text, rel).not.toMatch(INVISIBLE);
      expect(text.includes('\r'), rel).toBe(false);
    }
  });
  it('READMEs: the plugin pair with its badge, install line, skill and the other language; the root READMEs list it', () => {
    const v = manifest().version as string;
    for (const [lang, other] of [['', 'README.es.md'], ['.es', 'README.md']] as const) {
      const md = read(`plugins/web/README${lang}.md`);
      expect(md).toMatch(new RegExp(`badge/versi(on|%C3%B3n)-${v.replace(/\./g, '\\.')}-`));
      for (const s of ['claude plugin install web@bg-kit', 'astro-dokploy-site', `(${other})`, 'claude plugin disable web@bg-kit --scope local']) expect(md, s).toContain(s);
      const root = read(`README${lang}.md`);
      for (const s of [`badge/web-${v}-`, 'claude plugin install web@bg-kit', `(plugins/web/README${lang}.md)`, '  web/  ']) expect(root, s).toContain(s);
    }
  });
});

const SKILL_DIR = 'plugins/web/skills/astro-dokploy-site';
const REFS = ['csp', 'deploy', 'islands', 'verify'];
const POINTER = /Read `references\/([a-z-]+)\.md` now, and again every time you get here\./g;
/** The rules a compaction must not drop (spec D2, «Contenido»): they live in SKILL.md itself. */
const SKILL_TOKENS = ['pnpm', 'mounted', 'min-height', 'Dockerfile', 'Docker Context Path', 'security.csp', 'is:inline', '<style is:inline>',
  'new Worker(new URL(', "{ type: 'module' }", '<Term', 'pnpm format:check', 'astro check', 'TypeScript 6', "CLAUDECODE: ''", '--ignore-lock',
  '4321', 'reuseExistingServer: false', 'lhci', 'EPERM', 'npx lighthouse', 'numberOfRuns', 'CHROME_PATH', "channel: 'chrome'",
  'CLAUDE.md', 'AGENTS.md', '.claude/', 'package.json', 'Context7'];
/** The exact values each procedure needs, in the reference read at that moment. */
const REF_TOKENS: Record<string, string[]> = {
  deploy: ['Dockerfile path', 'Docker Context Path', 'corepack', '--frozen-lockfile', 'HEALTHCHECK', 'package.json', 'absolute_redirect off', 'add_header',
    'include', "frame-ancestors 'none'", 'default_type text/javascript', 'application/wasm', 'gzip_static on', 'immutable', 'docker build'],
  csp: ['security.csp', 'scriptDirective', 'hashes', 'sha256-', 'is:inline', "kind: 'attribute'", "worker-src 'self' blob:", '<style is:inline>',
    'prefers-reduced-motion: no-preference', '<meta'],
  islands: ['mounted', 'useEffect', 'min-height', "new Worker(new URL('./", 'import.meta.url', "{ type: 'module' }", 'data:video/mp2t', 'postbuild',
    '<Term', '/^<Term\\b/m', '.mdx', '.astro'],
  verify: ['pnpm format && pnpm format:check', 'pnpm check', 'TypeScript 6', "CLAUDECODE: ''", "CURSOR_TRACE_ID: ''", '--ignore-lock',
    'process.env.PORT ?? 4321', 'reuseExistingServer: false', 'CLAUDECODE= pnpm preview', 'lhci autorun', 'numberOfRuns: 3', 'minScore', 'EPERM',
    '--headless=new', '--remote-debugging-port=<free port>', '--port=<free port>', 'npx lighthouse', 'mcr.microsoft.com/playwright',
    'export CHROME_PATH=$(ls /ms-playwright/chromium-*/chrome-linux64/chrome)', 'MSYS_NO_PATHCONV=1', 'gh run watch', "channel: 'chrome'", 'requestAnimationFrame',
    "scrollTo({ behavior: 'instant' })", 'PID'],
};

describe('skill astro-dokploy-site (w7 D2)', () => {
  const skill = () => read(`${SKILL_DIR}/SKILL.md`);
  it('frontmatter: its name and a description of when to use it, valid YAML within 1,024 characters', () => {
    const m = /^---\n([\s\S]*?)\n---\n/.exec(skill());
    expect(m).not.toBeNull();
    expect(m![1].length).toBeLessThanOrEqual(1024);
    const front = parse(m![1]);
    expect(Object.keys(front)).toEqual(['name', 'description']);
    expect(front.name).toBe('astro-dokploy-site');
    expect(front.description).toMatch(/^Use when /);
  });
  it('SKILL.md stays within 16,000 bytes, so a compaction re-attaches all of it (A2)', () => {
    expect(Buffer.byteLength(skill(), 'utf8')).toBeLessThanOrEqual(16000);
  });
  it('each reference is pointed to once with the order to re-read it, and SKILL.md cites no other', () => {
    expect(readdirSync(path.join(ROOT, SKILL_DIR, 'references')).sort()).toEqual(REFS.map(r => `${r}.md`));
    expect([...skill().matchAll(POINTER)].map(m => m[1]).sort()).toEqual(REFS);
    expect([...new Set([...skill().matchAll(/references\/([A-Za-z0-9_-]+)\.md/g)].map(m => m[1]))].sort()).toEqual(REFS);
  });
  it('SKILL.md holds the rules a compaction must not drop', () => {
    for (const t of SKILL_TOKENS) expect(skill(), t).toContain(t);
  });
  it('each reference holds the exact values of its procedure', () => {
    for (const [ref, tokens] of Object.entries(REF_TOKENS)) {
      const md = read(`${SKILL_DIR}/references/${ref}.md`);
      for (const t of tokens) expect(md, `${ref}: ${t}`).toContain(t);
    }
  });
});
