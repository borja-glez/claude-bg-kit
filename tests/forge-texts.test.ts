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
  it('the automatic decisions the skills write carry their cost if wrong, and the report and the list show it (A7)', () => {
    const shape = '"ifWrong": {"cost": "<low|medium|high>", "note": "<one line>"}';
    const ref = read('plugins/forge/skills/run/references/decisions.md');
    expect(ref).toContain(shape);
    expect(ref.split('\n').find(l => l.startsWith('- **Report.**'))).toContain('coste si es erróneo: <ifWrong.cost>');
    expect(read('plugins/forge/skills/member/SKILL.md')).toContain(shape);
    expect(read('plugins/forge/skills/decisions/SKILL.md')).toContain('`ifWrong`');
  });
});
