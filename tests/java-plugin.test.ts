import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
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
const RULE_IDS = ['core-free', 'ports-and-layout', 'aggregates', 'events-split', 'outbox', 'domain-exception', 'archunit', 'specrepo-reads', 'idempotent-consumers', 'business-no', 'flyway-immutable'];
const DDD = 'plugins/java/skills/spring-hexagonal-ddd';
const DDD_REFS = ['cqrs-and-specrepo', 'hexagonal-layout', 'messaging-and-outbox', 'persistence-and-flyway', 'tactical-ddd', 'testing'];
// A2: every SKILL.md of plugins/** weighs at most 16,000 bytes.
const SKILL_CAP = 16_000;
// After compaction only about 5,000 tokens of a skill come back: its fixed rules sit in its first 6,000 bytes.
const RULES_WITHIN = 6_000;
const REF_CAP = 10_000;
/** A2's pointer to a reference: read it at that moment, and again each time. */
const pointer = (ref: string) => `read \`references/${ref}.md\` now, and again every time you get here: your memory of it does not survive compaction`;
const bytes = (text: string) => Buffer.byteLength(text, 'utf8');
/** The frontmatter and size rules every skill of the plugin keeps. */
const checkSkill = (dir: string, name: string) => {
  const { raw, data } = front(`${dir}/SKILL.md`);
  expect(data.name).toBe(name);
  expect(String(data.description)).toMatch(/^Use when /);
  expect(String(data.description).length).toBeLessThanOrEqual(500);
  expect(raw.length).toBeLessThanOrEqual(1024);
  expect(bytes(read(`${dir}/SKILL.md`))).toBeLessThanOrEqual(SKILL_CAP);
};

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
  it('spring-hexagonal-ddd: its frontmatter, under the cap, and the eleven rules in order within its first 6,000 bytes', () => {
    checkSkill(DDD, 'spring-hexagonal-ddd');
    const top = Buffer.from(read(`${DDD}/SKILL.md`), 'utf8').subarray(0, RULES_WITHIN).toString('utf8').replace(/\r\n/g, '\n');
    const at = RULE_IDS.map((id, i) => top.indexOf(`\n${i + 1}. \`${id}\``));
    expect(RULE_IDS.filter((_, i) => at[i] < 0)).toEqual([]);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(top).toContain('**When the project lacks what a rule names.**');
  });
  it('spring-hexagonal-ddd: its six references, each cited with the order to read it now and again, none over 10,000 bytes', () => {
    const md = read(`${DDD}/SKILL.md`);
    expect(readdirSync(path.join(repo, DDD, 'references')).sort()).toEqual(DDD_REFS.map(r => `${r}.md`));
    for (const r of DDD_REFS) {
      expect(md, r).toContain(pointer(r));
      expect(bytes(read(`${DDD}/references/${r}.md`)), r).toBeLessThanOrEqual(REF_CAP);
    }
  });
});
