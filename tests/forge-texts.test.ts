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
  it('FC6: the implementers state the real rule on .md files, and how a project file under it is still delivered, never in silence', () => {
    for (const a of ['forge-impl-heavy', 'forge-impl-high', 'forge-impl', 'forge-impl-light', 'forge-mech', 'forge-fable']) {
      const md = read(`plugins/forge/agents/${a}.md`);
      expect(md, a).not.toContain('cannot write `.md` files');
      const lines = md.split(/\r?\n/);
      expect(lines.find(l => l.startsWith('5. ')), a).toContain('refuses to Write a `.md` file whose name starts with REPORT, SUMMARY, FINDINGS or ANALYSIS (any case)');
      const deliver = lines.find(l => l.startsWith('A project file with such a name'));
      for (const w of ['`git mv`', 'return its text in your reply', 'say which in your report', 'Never get around the refusal']) expect(deliver, `${a}: ${w}`).toContain(w);
    }
  });
  it('forge-planner writes review_focus, which the brief carries to the reviewers (A7)', () => {
    const md = read('plugins/forge/agents/forge-planner.md');
    expect(md).toContain('design_ref?, review_focus?}]');
    expect(md.split('\n').find(l => l.trimStart().startsWith('- `review_focus`'))).toMatch(/at most 6/);
  });
});
