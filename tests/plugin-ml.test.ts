import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { walk } from './helpers/files.js';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ML = fileURLToPath(new URL('../plugins/ml/', import.meta.url));
/** Every file of plugins/ml, relative to it, with forward slashes. */
const mlFiles = () => walk(ML).map(f => path.relative(ML, f).split(path.sep).join('/'));
const SKILL = 'plugins/ml/skills/ml-local-gpu/SKILL.md';
const REFS = 'plugins/ml/skills/ml-local-gpu/references';
const refNames = () => readdirSync(new URL(`../${REFS}/`, import.meta.url)).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3)).sort();
/** Soft hyphen, zero-width and direction marks, bidi embeddings, overrides and isolates, invisible operators and the BOM:
 *  built from code points, so this file holds none of them. */
const INVISIBLE = new RegExp(`[${[[0xad, 0xad], [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x2064], [0x2066, 0x2069], [0xfeff, 0xfeff]]
  .map(([a, b]) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`).join('')}]`);

describe('plugin ml (w7 D3)', () => {
  it('the marketplace lists ml at ./plugins/ml with the description of its manifest', () => {
    const entry = JSON.parse(read('.claude-plugin/marketplace.json')).plugins.find((p: { name: string }) => p.name === 'ml');
    const manifest = JSON.parse(read('plugins/ml/.claude-plugin/plugin.json'));
    expect(entry).toMatchObject({ name: 'ml', source: './plugins/ml' });
    expect(manifest).toMatchObject({ name: 'ml', author: { name: 'Borja' } });
    expect(manifest.description).toBe(entry.description);
    expect(manifest.dependencies).toBeUndefined();
  });
  it('ml is text only: its manifest, two READMEs and Markdown skills; no src, dist, hooks, bin, scripts or agents', () => {
    const files = mlFiles();
    expect(files).toContain('.claude-plugin/plugin.json');
    expect(files.filter(f => !/^(\.claude-plugin\/plugin\.json|README(\.es)?\.md|skills\/[a-z0-9-]+\/(SKILL|references\/[a-z0-9-]+)\.md)$/.test(f))).toEqual([]);
  });
  it('ml-local-gpu: its name, a description of when to use it, and at most 16,000 bytes (what compaction re-attaches)', () => {
    const md = read(SKILL);
    const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(md)?.[1] ?? '';
    expect(fm).toMatch(/^name: ml-local-gpu$/m);
    expect(fm).toMatch(/^description: Use when \S/m);
    const desc = /^description: (.*)$/m.exec(fm)?.[1] ?? '';
    expect(desc).not.toContain(': ');
    expect(fm.split(/\r?\n/)).toHaveLength(2);
    expect(fm.length).toBeLessThanOrEqual(1024);
    expect(Buffer.byteLength(md, 'utf8')).toBeLessThanOrEqual(16000);
  });
  it('ml-local-gpu: every rule lives in SKILL.md, where compaction keeps it, with its command (Review Focus 1, 2, 3, 5)', () => {
    const md = read(SKILL);
    for (const w of ['pyproject.toml', 'uv run', 'https://download.pytorch.org/whl/cu130', 'uv lock', 'https://download.pytorch.org/whl/cpu',
      'nvidia-smi --query-gpu=memory.used,memory.total', 'torch.cuda.mem_get_info()', 'torch.cuda.max_memory_reserved()', 'nvidia-smi --query-gpu=temperature.gpu', 'GPU temperature unavailable',
      'Context7', 'inspect.signature', 'HF_TOKEN', 'jupyter nbconvert --to notebook --execute --inplace', "newline='\\n'",
      'ruff format --check', 'GroupShuffleSplit']) expect(md, w).toContain(w);
  });
  it("ml-local-gpu pins no package version: the project's pyproject and lock decide (Review Focus 4)", () => {
    for (const f of [SKILL, ...refNames().map(r => `${REFS}/${r}.md`)]) {
      expect(read(f), f).not.toMatch(/\b(?:torch|trl|transformers|peft|accelerate|bitsandbytes|onnxruntime(?:-web)?)\s*(?:==|>=|<=|~=|@)\s*\d/);
    }
  });
  it('ml-local-gpu: the references it cites are the ones it has, each behind the order to read it now and again', () => {
    const md = read(SKILL);
    const cited = [...new Set([...md.matchAll(/references\/([a-z0-9-]+)\.md/g)].map(m => m[1]))].sort();
    expect(cited).toEqual(['browser-inference', 'hub-publishing']);
    expect(refNames()).toEqual(cited);
    for (const r of cited) expect(md, r).toContain(`Read \`references/${r}.md\` now, and again every time you get here: your memory of it does not survive compaction.`);
  });
  it('the references: the webgpu entry and serial sessions in the browser, the card as the Hub README and the token from HF_TOKEN', () => {
    const browser = read(`${REFS}/browser-inference.md`);
    for (const w of ['onnxruntime-web/webgpu', 'InferenceSession.create']) expect(browser, w).toContain(w);
    const hub = read(`${REFS}/hub-publishing.md`);
    for (const w of ['README.md', 'HF_TOKEN']) expect(hub, w).toContain(w);
  });
  it('the ml READMEs, in English and Spanish, link each other and bg-kit, install ml@bg-kit and name ml:ml-local-gpu', () => {
    for (const [f, other, root] of [['plugins/ml/README.md', '[Español](README.es.md)', '../../README.md'], ['plugins/ml/README.es.md', '[English](README.md)', '../../README.es.md']]) {
      const md = read(f);
      for (const w of [other, root, 'claude plugin install ml@bg-kit', 'ml:ml-local-gpu', 'nvidia-smi']) expect(md, `${f}: ${w}`).toContain(w);
    }
  });
  it('the root READMEs list ml with its README, its install line and its folder', () => {
    for (const [f, readme] of [['README.md', 'plugins/ml/README.md'], ['README.es.md', 'plugins/ml/README.es.md']]) {
      const md = read(f);
      for (const w of [`(${readme})`, 'claude plugin install ml@bg-kit', '  ml/ ']) expect(md, `${f}: ${w}`).toContain(w);
    }
  });
  it('plugins/ml carries no machine data, personal path, project of the author, invisible or bidi character, nor ${CLAUDE_ outside a SKILL.md', () => {
    const BAD: [string, RegExp][] = [
      ['Windows home', /\b[A-Za-z]:[\\/]Users[\\/][^\\/\s]+/i], ['macOS home', /\/Users\/[^/\s]+/], ['Linux home', /\/home\/[^/\s]+/],
      ['work folder', /\b[A-Za-z]:[\\/]work\b/i], ['GPU model', /\b(?:RTX|GTX|GeForce|Quadro|Titan)\b/i], ['GPU model', /\b\d{4}\s?(?:Ti|SUPER)\b/],
      ['a project or domain of the author', /\b(?:rukh|chess-lm|borjaglez)/i], ['invisible or bidi character', INVISIBLE],
    ];
    const hits = mlFiles().flatMap(f => {
      const text = readFileSync(path.join(ML, f), 'utf8');
      return [...BAD.filter(([, re]) => re.test(text)).map(([what]) => `${f}: ${what}`),
        ...(f.startsWith('skills/') && /borja/i.test(text) ? [`${f}: a personal name`] : []),
        ...(!f.endsWith('SKILL.md') && text.includes('${CLAUDE_') ? [`${f}: \${CLAUDE_`] : [])];
    });
    expect(hits).toEqual([]);
  });
});
