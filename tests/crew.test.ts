import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { walk } from './helpers/files.js';

// w7 D4: the crew plugin is text only: a manifest, its agents and its two READMEs.
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CREW = path.join(ROOT, 'plugins', 'crew');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');
const files = () => walk(CREW).map(f => path.relative(CREW, f).split(path.sep).join('/'));

/** An agent of crew: the whole file, its frontmatter (without the fences) and its body. */
const agent = (name: string) => {
  const md = read(`plugins/crew/agents/${name}.md`);
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(md);
  return { md, head: m?.[1] ?? '', body: m?.[2] ?? '' };
};
const field = (head: string, key: string) => new RegExp(`^${key}: (.+)$`, 'm').exec(head)?.[1].trim();
const toolsOf = (head: string) => field(head, 'tools')?.split(/,\s*/) ?? [];

describe('crew plugin (w7 D4)', () => {
  it('a manifest with no dependencies, and a marketplace entry with its description', () => {
    const m = JSON.parse(read('plugins/crew/.claude-plugin/plugin.json'));
    expect(m).toMatchObject({ name: 'crew', author: { name: 'Borja' } });
    expect(typeof m.description).toBe('string');
    expect(m.dependencies).toBeUndefined();
    const entry = JSON.parse(read('.claude-plugin/marketplace.json')).plugins.find((p: { name: string }) => p.name === 'crew');
    expect(entry).toEqual({ name: 'crew', source: './plugins/crew', description: m.description });
  });
  it('holds only text: the manifest, agents/*.md and the two READMEs (no src, bundle, hooks, skills or scripts)', () => {
    expect(files().filter(f => !/^(\.claude-plugin\/plugin\.json|agents\/[a-z-]+\.md|README(\.es)?\.md)$/.test(f))).toEqual([]);
  });
  it('names no personal path and holds no invisible or bidi character', () => {
    for (const f of walk(CREW)) {
      const t = readFileSync(f, 'utf8');
      expect(t, f).not.toMatch(/[A-Za-z]:[\\/]Users[\\/]|\/Users\/|\/home\/|E:[\\/]work|(?<![\w.])\/[a-z]\/work(?![\w-])/i);
      // The same invisible and bidi set as A7's plugin-hygiene test.
      expect(t, f).not.toMatch(/[\u00AD\u061C\u115F\u1160\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\u3164\uFEFF\uFFA0]/);
    }
  });
  it('novice-reader: read-only, opus at high effort, its three personas and the report it returns', () => {
    const { md, head, body } = agent('novice-reader');
    expect(field(head, 'name')).toBe('novice-reader');
    expect(field(head, 'description')).toContain('never rewrites');
    expect([field(head, 'model'), field(head, 'effort'), field(head, 'maxTurns')]).toEqual(['opus', 'high', '40']);
    expect(toolsOf(head)).toEqual(['Read', 'Grep', 'Glob', 'WebFetch']);
    for (const p of ['full-stack developer with no ML', 'junior Java developer', 'recruiter']) expect(body, p).toContain(p);
    for (const w of ['## Verdict', '## Earlier points', '## Findings', '## Not checked', '[blocker]', '[major]', '[minor]', 'seam']) expect(body, w).toContain(w);
    expect(Buffer.byteLength(md)).toBeLessThan(12000);
  });
  it('playtest-qa: one browser at a time on the GPU, real input only, its own processes by PID, figures per minute', () => {
    const { md, head, body } = agent('playtest-qa');
    expect(field(head, 'name')).toBe('playtest-qa');
    expect(field(head, 'description')).toContain('at most two at a time');
    expect([field(head, 'model'), field(head, 'effort'), field(head, 'maxTurns')]).toEqual(['opus', 'medium', '150']);
    expect(toolsOf(head)).toEqual(['Read', 'Write', 'Grep', 'Glob', 'Bash']);
    for (const w of ['--enable-gpu --use-angle=d3d11 --enable-unsafe-webgpu', 'window.game', 'Input.dispatchKeyEvent', 'Input.dispatchMouseEvent',
      'playtest-qa-slots', 'owner.json', 'text/javascript', 'SwiftShader', 'by PID', 'log/segment-',
      '## Environment', '## Tutorial', '## Per minute', '## Theme', '## Findings', '## Not checked']) expect(body, w).toContain(w);
    expect(Buffer.byteLength(md)).toBeLessThan(12000);
  });
  it('crew has exactly its two agents, and neither has Edit or NotebookEdit nor can spawn agents', () => {
    expect(files().filter(f => f.startsWith('agents/')).sort()).toEqual(['agents/novice-reader.md', 'agents/playtest-qa.md']);
    for (const n of ['novice-reader', 'playtest-qa']) {
      for (const t of ['Agent', 'Task', 'Edit', 'NotebookEdit']) expect(toolsOf(agent(n).head), `${n}: ${t}`).not.toContain(t);
    }
  });
  it('the crew READMEs in English and Spanish, and the root READMEs list and install crew', () => {
    for (const [f, other] of [['README.md', 'README.es.md'], ['README.es.md', 'README.md']]) {
      const md = read(`plugins/crew/${f}`);
      for (const w of [`](${other})`, '](../../README', 'claude plugin install crew@bg-kit', '`novice-reader`', '`playtest-qa`', 'playtest-qa-slots'])
        expect(md, `${f}: ${w}`).toContain(w);
    }
    expect(read('README.md')).toContain('[plugins/crew](plugins/crew/README.md)');
    expect(read('README.es.md')).toContain('[plugins/crew](plugins/crew/README.es.md)');
    for (const f of ['README.md', 'README.es.md']) expect(read(f), f).toContain('claude plugin install crew@bg-kit');
  });
});
