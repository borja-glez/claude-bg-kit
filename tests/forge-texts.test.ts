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
      for (const w of ['`git mv`', '`git mv -f` when that name is already in the repository', 'return its text in your reply', 'say which in your report', 'Never get around the refusal']) expect(deliver, `${a}: ${w}`).toContain(w);
    }
  });
  it('forge-planner writes review_focus, which the brief carries to the reviewers (A7)', () => {
    const md = read('plugins/forge/agents/forge-planner.md');
    expect(md).toContain('design_ref?, review_focus?}]');
    expect(md.split('\n').find(l => l.trimStart().startsWith('- `review_focus`'))).toMatch(/at most 6/);
  });
});

// w8 integration, the final review's fixes to forge's texts.
describe("forge's texts (w8 integration)", () => {
  const line = (p: string, start: string) => read(p).split(/\r?\n/).find(l => l.startsWith(start)) ?? '';
  it('a new surface is committed alone: no .forge/.gitignore goes with it (FR5 left none to add)', () => {
    const draft = line('plugins/forge/skills/run/references/verify.md', '- Each `drafts` entry:');
    expect(draft).toContain("Commit a new surface with the task's work.");
    const told = line('plugins/forge/skills/verify/SKILL.md', '- **The user explains how to check something**');
    expect(told).toContain('commit the surface alone (pathspec) and say');
    for (const t of [draft, told]) expect(t).not.toContain('.forge/.gitignore');
  });
  it('untracked names a .forge/.gitignore git does not track whose rules are not exactly forge\'s, in the skill and both READMEs', () => {
    const run = line('plugins/forge/skills/run/SKILL.md', '1. **Run it.**');
    expect(run).toContain("`untracked` (a `.forge/.gitignore` git does not track whose rules are not exactly forge's: item 4)");
    expect(run).not.toContain('while `.forge/.gitignore` is not in git');
    const en = read('plugins/forge/README.md'), es = read('plugins/forge/README.es.md');
    expect(en).not.toContain('an earlier forge left is not in git');
    expect(es).not.toContain('que dejó un forge anterior no');
    expect(line('plugins/forge/README.md', '- `triage [')).toContain("`untracked`, a `.forge/.gitignore` git does not track whose rules are not exactly forge's");
    expect(line('plugins/forge/README.md', '- `begin --task')).toContain("`untracked`, as `triage` prints it");
    expect(line('plugins/forge/README.es.md', '- `triage [')).toContain('`untracked`, un `.forge/.gitignore` sin seguimiento cuyas reglas no son exactamente las de forge');
    expect(line('plugins/forge/README.es.md', '- `begin --task')).toContain('`untracked`, como lo imprime `triage`');
  });
  it("the coordinator reads the notes with waypoint's notes command and keeps lastNoteTs in its own seat's session.json", () => {
    const exec = 'plugins/forge/skills/run/references/execution.md';
    expect(line(exec, '1. **Start (once).**')).toContain('`SEAT` = its `seatDir`');
    const notes = line(exec, '2. **Read.**');
    expect(notes).toContain('`node "<WP>" notes --notes DB/notes --plan <plan> --since <lastNoteTs>`');
    expect(notes).toContain('`lastNoteTs` of `<SEAT>/session.json`');
    expect(notes).toContain('store its `latest` as `lastNoteTs` in that same file');
    expect(notes).not.toContain('in `.waypoint/<project>/session.json`');
    expect(notes).not.toContain('as `/waypoint:work` §1.4 does');
  });
  it('an implementer that returns a refused deliverable as text: it says how, and the coordinator writes it, commits it and says so', () => {
    for (const a of ['forge-impl-heavy', 'forge-impl-high', 'forge-impl', 'forge-impl-light', 'forge-mech', 'forge-fable']) {
      const deliver = line(`plugins/forge/agents/${a}.md`, 'A project file with such a name');
      expect(deliver, a).toContain('return its text in your reply, after your two lines, under a line `--- <its path> ---`, for the caller to write');
    }
    const ts = line('plugins/forge/skills/run/references/task-steps.md', '2. **implement**');
    const med = line('plugins/forge/skills/run/references/medium.md', '2. For each task');
    for (const [name, t] of [['task-steps', ts], ['medium', med]] as const) {
      for (const w of ['under a line `--- <path> ---`', 'with the Write tool', "brief's `Commit title`", 'tell the person in one line']) expect(t, `${name}: ${w}`).toContain(w);
    }
    expect(ts).toContain("in the task's worktree");
    expect(ts).toContain('before the step that names the task in `--returned`');
  });
  it('the README says the live signal is written under a lock, that SubagentStart also checks for deviations, the files they leave in .forge/ and the no-validators warning', () => {
    for (const [p, live, list, warn] of [
      ['plugins/forge/README.md', ['`live/<sessionId>.json.lock`', 'the deviation check'], ['`deviation.lock`', '`deviations-told.json`', '`live/<id>.json.lock`', '`work/run/deviations-told.json`'],
        ['No validators detected', '`announce`', '`prep`']],
      ['plugins/forge/README.es.md', ['`live/<sessionId>.json.lock`', 'la comprobación de desvíos'], ['`deviation.lock`', '`deviations-told.json`', '`live/<id>.json.lock`', '`work/run/deviations-told.json`'],
        ['No hay validadores', '`announce`', '`prep`']],
    ] as const) {
      const md = read(p).split(/\r?\n/);
      const at = md.findIndex(l => l === '### Live signal' || l === '### Señal en vivo');
      const signal = md.slice(at + 1, at + 4).join('\n');
      for (const w of live) expect(signal, `${p}: ${w}`).toContain(w);
      const forgeDir = md.find(l => l.startsWith('`.forge/` ')) ?? '';
      for (const w of list) expect(forgeDir, `${p}: ${w}`).toContain(w);
      const validators = md.find(l => l.startsWith('**Validators.**') || l.startsWith('**Validadores.**')) ?? '';
      for (const w of warn) expect(validators, `${p}: ${w}`).toContain(w);
    }
  });
});
