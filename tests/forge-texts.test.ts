import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// A7: the text contracts wave 7 adds to forge's agents, skills and references.
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe("forge's texts (A7)", () => {
  it('forge-review-final lists what it declined to judge, and the Large report hands the final deferred over (A7)', () => {
    const md = read('plugins/forge/agents/forge-review-final.md');
    expect(md).toContain('"declined": [{"what": "...", "why": "..."}]');
    expect(md).toContain('**Declined to judge**');
    expect(read('plugins/forge/skills/run/references/large.md').split('\n').find(l => l.startsWith('5. '))).toContain("the final verdict's `deferred`");
  });
});
