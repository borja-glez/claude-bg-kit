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
const AGENT = 'plugins/java/agents/architecture-reviewer.md';
const OSS = 'plugins/java/skills/java-oss-library';

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
  it('architecture-reviewer: read-only tools, opus at high effort, the skill preloaded, and its report contract', () => {
    const { data } = front(AGENT);
    expect(data).toEqual({ name: 'architecture-reviewer', description: expect.stringContaining('on demand'), tools: 'Read, Grep, Glob, Bash', model: 'opus', effort: 'high', maxTurns: 40, skills: ['java:spring-hexagonal-ddd'] });
    const body = read(AGENT).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
    for (const w of ['rules not loaded', 'rules: spring-hexagonal-ddd', 'tests: ', 'not run: ', 'findings:', '- [<critical|important|minor>] <file>:<line> `<rule id>`',
      'pre-existing (outside the diff, at most 5):', 'not applicable:', 'verdict: ', '*ArchitectureTest*', './gradlew quality', '600000']) expect(body, w).toContain(w);
  });
  it('java-oss-library: its frontmatter, under the cap, AGENTS.md as the contract it points to, and the release in its reference', () => {
    checkSkill(OSS, 'java-oss-library');
    const md = read(`${OSS}/SKILL.md`);
    expect(readdirSync(path.join(repo, OSS, 'references'))).toEqual(['release.md']);
    expect(md).toContain(pointer('release'));
    for (const w of ['AGENTS.md', 'build-logic', 'quality', 'coverage', 'spotlessCheckAll', 'spotlessApplyAll', 'verifyBoot3Compatibility', 'verifyBoot4Compatibility',
      'agent-ready', 'needs-design', '### Decision', 'rebase --onto', 'docs/superpowers']) expect(md, w).toContain(w);
    const release = read(`${OSS}/references/release.md`);
    for (const w of ['vanniktech', 'Maven Central', 'apiBaseline', 'japicmp', 'chore: bump version to', 'CHANGELOG.md']) expect(release, w).toContain(w);
    // AGENTS.md stays the contract: the skill names it and never copies its steps.
    for (const w of ['Check the labels first', 'Regression test first', 'Stay in scope', 'When blocked']) expect(md + release, w).not.toContain(w);
  });
  it('the java READMEs, in English and Spanish, show its version and name its skills, its agent, its install and the eleven rules; the bg-kit READMEs list it', () => {
    const v = JSON.parse(read('plugins/java/.claude-plugin/plugin.json')).version as string;
    for (const [f, badge] of [['plugins/java/README.md', `badge/version-${v}-`], ['plugins/java/README.es.md', `badge/versi%C3%B3n-${v}-`]]) {
      const md = read(f);
      expect(md, f).toContain(badge);
      for (const w of ['/java:spring-hexagonal-ddd', '/java:java-oss-library', 'java:architecture-reviewer', 'claude plugin install java@bg-kit', '"java@bg-kit": false', ...RULE_IDS.map(id => `\`${id}\``)])
        expect(md, `${f}: ${w}`).toContain(w);
    }
    for (const [f, link] of [['README.md', 'plugins/java/README.md'], ['README.es.md', 'plugins/java/README.es.md']]) {
      const md = read(f);
      for (const w of [`](${link})`, 'claude plugin install java@bg-kit']) expect(md, `${f}: ${w}`).toContain(w);
      expect(md, f).toMatch(/^ {2}java\/ /m);
      expect(md, f).not.toMatch(/three plugins|tres plugins/);
    }
  });
});
