import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { walk } from './helpers/files.js';

const repo = fileURLToPath(new URL('..', import.meta.url));
const read = (p: string) => readFileSync(path.join(repo, p), 'utf8');
/** Every file of plugins/java, repo-relative with forward slashes. */
const javaFiles = () => walk(path.join(repo, 'plugins', 'java')).map(f => path.relative(repo, f).split(path.sep).join('/'));
/** The frontmatter of a skill or agent file: its raw text and its YAML. */
const front = (p: string) => {
  const raw = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(read(p))?.[1] ?? '';
  return { raw, data: (parse(raw) ?? {}) as Record<string, unknown> };
};
// Built from code points, so this file never holds them (as tests/source-text.test.ts does).
const cp = (n: number) => String.fromCharCode(n);
const INVISIBLE = new RegExp(`[${cp(0x202a)}-${cp(0x202e)}${cp(0x2066)}-${cp(0x2069)}${cp(0xfeff)}${cp(0x200b)}-${cp(0x200f)}]`);
// A path of the machine: a Windows home or work folder (either slash), a macOS or Linux home.
const PERSONAL = /\b[A-Za-z]:[\\/](?:Users|work)\b|\/(?:Users|home)\/[A-Za-z]/;
// A pinned version: the skills read versions from gradle/libs.versions.toml or Context7.
const PINNED = /\b\d+\.\d+\.\d+\b/;

describe('the java plugin (w7 D1)', () => {
  it('the marketplace lists java, and its manifest names it at 0.1.0 with the same description', () => {
    const m = JSON.parse(read('.claude-plugin/marketplace.json'));
    const entry = m.plugins.find((p: { name: string }) => p.name === 'java');
    expect(entry).toEqual({ name: 'java', source: './plugins/java', description: expect.stringContaining('Spring Boot') });
    expect(JSON.parse(read('plugins/java/.claude-plugin/plugin.json'))).toEqual({ name: 'java', description: entry.description, version: '0.1.0', author: { name: 'Borja' } });
  });
  it('the hygiene patterns find what they look for, and only that', () => {
    for (const s of ['C:\\Users\\ana\\x', 'E:/work/java', 'E:\\work\\java', 'see /Users/ana/repo', '/home/ana/.m2']) expect(PERSONAL.test(s), s).toBe(true);
    for (const s of ['RFC 9457', 'the Boot 4 starter', 'https://code.claude.com/docs/en/sub-agents', 'src/main/java']) expect(PERSONAL.test(s) || PINNED.test(s), s).toBe(false);
    expect(PINNED.test('Spring Boot 4.0.8')).toBe(true);
    expect(INVISIBLE.test(`a${cp(0x202e)}b`)).toBe(true);
  });
  it('no file of plugins/java holds a machine path or an invisible character, and no skill or agent pins a version', () => {
    const files = javaFiles();
    expect(files).toContain('plugins/java/.claude-plugin/plugin.json');
    const hits = files.flatMap(f => {
      const text = read(f);
      const out: string[] = [];
      if (PERSONAL.test(text)) out.push(`${f}: machine path`);
      if (INVISIBLE.test(text)) out.push(`${f}: invisible character`);
      if (/^plugins\/java\/(skills|agents)\//.test(f) && PINNED.test(text)) out.push(`${f}: pinned version`);
      return out;
    });
    expect(hits).toEqual([]);
  });
});
