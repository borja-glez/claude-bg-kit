import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
// A reference of forge:run (plugins/forge/skills/run/references/<name>.md).
const runRef = (name: string) => read(`plugins/forge/skills/run/references/${name}.md`);

describe('plugin layout', () => {
  it('marketplace bg-kit lists waypoint, lens and forge', () => {
    const m = JSON.parse(read('.claude-plugin/marketplace.json'));
    expect(m.name).toBe('bg-kit');
    expect(m.plugins).toEqual([
      expect.objectContaining({ name: 'waypoint', source: './plugins/waypoint' }),
      expect.objectContaining({ name: 'lens', source: './plugins/lens' }),
      expect.objectContaining({ name: 'forge', source: './plugins/forge' }),
    ]);
  });
  it('lens manifest, module and contract exist', () => {
    const p = JSON.parse(read('plugins/lens/.claude-plugin/plugin.json'));
    expect(p).toMatchObject({ name: 'lens', version: '0.13.0', types: './types/index.d.ts' });
    expect(JSON.parse(read('plugins/lens/hooks/hooks.json'))).toEqual({ modules: ['./register.js'] });
    for (const f of ['hooks/register.js', 'types/index.d.ts', 'README.md']) {
      expect(existsSync(new URL(`../plugins/lens/${f}`, import.meta.url))).toBe(true);
    }
    expect(JSON.parse(read('package.json')).name).toBe('claude-bg-kit');
  });
  it('plugin manifest and built files exist', () => {
    expect(JSON.parse(read('plugins/waypoint/.claude-plugin/plugin.json')).name).toBe('waypoint');
    for (const f of ['bin/waypoint', 'dist/waypoint.cjs', 'assets/roadmap.template.html']) {
      expect(existsSync(new URL(`../plugins/waypoint/${f}`, import.meta.url))).toBe(true);
    }
  });
  it('every skill has name and description frontmatter', () => {
    for (const s of ['plan', 'work', 'status', 'launch', 'design']) {
      const md = read(`plugins/waypoint/skills/${s}/SKILL.md`);
      expect(md).toMatch(new RegExp(`^---\\r?\\nname: ${s}\\r?\\ndescription: .+\\r?\\n`));
    }
  });
  it('launch skill: lease rule, --merge', () => {
    const md = read('plugins/waypoint/skills/launch/SKILL.md');
    for (const w of ['leaseUntil', '--merge', 'exactly as returned']) expect(md).toContain(w);
    expect(md).not.toContain('busyUntil');
  });
  it('work skill documents the multi-session protocol', () => {
    const md = read('plugins/waypoint/skills/work/SKILL.md');
    for (const w of ['SendMessage', 'ListAgents', ' inbox ', ' recover ', ' conflicts ', 'escalation', 'seen.json', 'MAIN_REPO', 'yields']) expect(md).toContain(w);
  });
  it('work skill reads and writes roadmap notes', () => {
    const md = read('plugins/waypoint/skills/work/SKILL.md');
    for (const w of ['waypoint.cjs" notes', 'lastNoteTs', 'notes/<EID>', 'session:<SID>']) expect(md).toContain(w);
    expect(read('plugins/waypoint/README.md')).toContain('Notes');
  });
  it('work skill clears pending commits and documents the stop guard', () => {
    const md = read('plugins/waypoint/skills/work/SKILL.md');
    expect(md).toContain('pending-commits.jsonl');
    expect(md).toContain('queue.jsonl');
    expect(md).toContain('Stop');
    expect(md).toContain('type: "commit"');
    expect(md).toContain('**Leaving a task.**');
  });
  it('hooks module wires SessionStart (with fork), SessionEnd, PostToolUse and Stop (A-03, B-11, K5-06)', () => {
    const h = JSON.parse(read('plugins/waypoint/hooks/hooks.json'));
    expect(h.hooks.SessionStart).toBeDefined();
    expect(h.hooks.PostToolUse).toBeDefined();
    expect(h.hooks.Stop).toBeDefined();
    expect(h.hooks.SessionStart[0].matcher).toBe('startup|resume|clear|compact|fork');
    expect(h.hooks.SessionEnd[0].hooks[0].command).toContain('hook session-end');
    expect(h.modules).toEqual(['./register.js']);
    expect(existsSync(new URL('../plugins/waypoint/hooks/register.js', import.meta.url))).toBe(true);
  });
  it('README documents the band, hooks and recommended permissions', () => {
    const md = read('plugins/waypoint/README.md');
    for (const w of ['## The band', '## Hooks', '## Permissions', 'pending-commits.jsonl', 'Bash(node *waypoint.cjs*)', 'Bash(git *)', 'ArtifactData']) expect(md).toContain(w);
  });
  it('forge run skill drives the Large path through waypoint', () => {
    const md = read('plugins/forge/skills/run/SKILL.md');
    for (const w of ['--path large', 'report-<n>.txt', '"base"', 'references/large.md']) expect(md).toContain(w);
    expect(runRef('ephemeral')).toContain('review-perf');
    const large = runRef('large');
    for (const w of ['forge-planner', '/waypoint:design', '/waypoint:plan', 'final review',
      'FORGE waypoint-cli', 'run.json', 'final-validators.json', 'FORGE verdict --task <project>-final', 'final-fix.txt', '`start_prompt`']) expect(large).toContain(w);
    for (const w of ['FORGE brief --plan', '/waypoint:work', 'blocked path']) expect(runRef('execution')).toContain(w);
    const steps = read('plugins/forge/skills/run/references/task-steps.md');
    for (const w of ['FORGE triage --plan', 'mkdir -p <WORK>', 'Commit title prefix']) expect(steps).toContain(w);
    expect(md).not.toContain('report-<n>.md');
  });
  it('forge run skill sizes and reviews each plan task by its real diff', () => {
    const md = read('plugins/forge/skills/run/SKILL.md');
    const steps = read('plugins/forge/skills/run/references/task-steps.md');
    for (const w of ['--task T --cwd <worktree> --base <base>', 'review.reviewers', 'review.flags', "the triage's `implementer.agent`"]) expect(steps).toContain(w);
    for (const s of [md, steps]) expect(s).not.toMatch(/FORGE verdict[^\n`]*--sensitive --perf/);
    const step3 = steps.split('\n').find(l => l.includes('3. **validate**'))!;
    expect(step3).toContain('a plan task is first sized again');
    expect(step3).not.toContain('(the path only goes up)');
    expect(step3).toContain('sets no floor');
    expect(steps).toContain('a Large one to `impl` (`impl-high` on a sensitive zone)');
    expect(steps).not.toContain('a Large one to `impl-heavy`)');
    expect(steps).not.toContain('`impl-heavy` on a sensitive zone');
    for (const f of ['plugins/forge/README.md', 'plugins/forge/README.es.md']) expect(read(f)).toContain('triage --plan p --task T --base');
  });
  it('forge-impl-high: opus at high effort, the same text as impl and impl-heavy', () => {
    const body = (a: string) => read(`plugins/forge/agents/${a}.md`).split(/\r?\n---\r?\n/).slice(1).join('\n---\n')
      .replace(/^\s*You implement one task of the forge method: [^\n]*\n/, '');
    const high = read('plugins/forge/agents/forge-impl-high.md');
    expect(high).toMatch(/\nmaxTurns: 70\r?\n/);
    expect(high).toMatch(/\nmodel: opus\r?\n/);
    expect(high).toMatch(/\neffort: high\r?\n/);
    expect(body('forge-impl-high')).toBe(body('forge-impl'));
    expect(body('forge-impl-high')).toBe(body('forge-impl-heavy'));
  });
  it('forge run texts: five-rung ladder, sensitive and delicate tasks start on impl-high, fix rounds take FORGE round\'s implementer', () => {
    const md = read('plugins/forge/skills/run/SKILL.md');
    const steps = read('plugins/forge/skills/run/references/task-steps.md');
    const member = read('plugins/forge/skills/member/SKILL.md');
    for (const s of [md, steps, member]) {
      expect(s).toContain('the implementer `FORGE review-close` prints');
      expect(s).not.toMatch(/one tier up (per |up )?the ladder/);
      expect(s).not.toMatch(/`impl-heavy` (on a sensitive zone|when the design marks|for delicate)/);
      expect(s).not.toContain('or `impl-heavy` for delicate');
    }
    expect(md).toContain('never compute the ladder by hand');
    expect(steps).toContain('never compute the ladder by hand');
    expect(steps).not.toContain('when the design marks the task delicate');
    expect(runRef('large')).toContain('one fix by `impl-heavy`');
    for (const s of [steps, member]) expect(s).toContain('`FORGE log --kind agent --task <T>-<n> --data-file <f>` (`{"agent":"<name>","role":"<role>"}`)');
    expect(md).not.toMatch(/When `last` is true the printed implementer is `impl-heavy`/);
    expect(md).not.toContain('or `impl-high` for delicate or important work');
    for (const s of [md, steps, member]) expect(s).toContain('`delicate`');
    expect(member).not.toContain('a Large task you cannot do unattended');
    expect(member).toContain('waypoint:work');
    expect(member).toMatch(/[Ll]ost task/);
    expect(Buffer.byteLength(member)).toBeLessThan(15 * 1024);
  });
  it('forge Large: approve steps, run.json once, lease, final re-review inputs, start_prompt', () => {
    const md = read('plugins/forge/skills/run/SKILL.md');
    const large = runRef('large');
    for (const w of ['steps 1–3', 'only if that file does not exist',
      'final-validators-2.json', 'final-2.patch', '--dir .forge/work/<project>/final-2 --validators .forge/work/<project>/final-validators-2.json',
      '`redo` is treated as `fix`', '--no-merged', 'design-page']) expect(large).toContain(w);
    for (const w of ['keeps its verdict and still scores', 'FORGE log --kind ruling --task <id>-<n>']) expect(md).toContain(w);
    for (const s of [md, large]) expect(s).not.toContain('At the start of a Large run write');
    expect(read('plugins/forge/README.md')).toContain('keeps its verdict and still scores');
  });
  it('waypoint work skill hands §3 to forge when forge drives the session', () => {
    const md = read('plugins/waypoint/skills/work/SKILL.md');
    expect(md).toMatch(/forge:run.*Large/s);
    expect(md).toContain('only the first paragraph');
    expect(md).not.toContain("initial prompt says forge drives it");
    expect(md).toContain('--busy-until');
    expect(md).toContain('90 minutes');
  });
  it('waypoint design approve stops before planning when forge drives the session', () => {
    expect(read('plugins/waypoint/skills/design/SKILL.md')).toContain('stop after step 3: `/forge:run` continues with `forge-planner`');
  });
  it('the run skill and every implementer edit with Edit/Write, never sed -i', () => {
    expect(read('plugins/forge/skills/run/SKILL.md')).toMatch(/Change the project's files with the Edit and Write tools, never with `sed -i`.*forge's own work files.*is fine/s);
    for (const a of ['mech', 'impl', 'impl-light', 'impl-high', 'impl-heavy', 'fable']) {
      expect(read(`plugins/forge/agents/forge-${a}.md`)).toMatch(/Change the project's files with the Edit and Write tools, never with `sed -i`.*forge's own work files.*is fine/s);
    }
  });
  it('run skill: an ephemeral run is published on the roadmap as loose tasks when there is one', () => {
    const md = runRef('execution');
    for (const w of ['kind: "plan", loose: []', '**Ephemeral run.**', 'kind: "ephemeral"', '.forge/loose.json', '`queued`', '`accepted` → `running`',
      'never `plan.yaml` nor `state/T`', 'No roadmap → publish nothing', 'active: false']) {
      expect(md).toContain(w);
    }
  });
  it('run skill: model by size, ephemeral execution, parallel Medium briefs and the member conflict fix round', () => {
    const md = read('plugins/forge/skills/run/SKILL.md');
    for (const w of ['implementer.agent', '--batch', '**always delegated**', '10 lines or fewer', '### Ephemeral execution', '**Briefs in parallel.**',
      'integrated into the current branch', 'references/ephemeral.md']) {
      expect(md).toContain(w);
    }
    const eph = runRef('ephemeral');
    for (const w of ['--kind ephemeral', '.forge/work/loose-tasks.json', 'no `--plan` nor `--db`', 'step 5 is its **Ephemeral run.** paragraph']) expect(eph).toContain(w);
    const exec = runRef('execution');
    expect(exec).toContain('FORGE swarm retry <T> --adopt');
    for (const s of [md, eph, exec]) {
      expect(s).not.toContain('there is no roadmap (no ArtifactData');
      expect(s).not.toContain('Implement yourself, or spawn the `impl-light` agent');
      expect(s).not.toContain('A `conflict` on such a task is not retried');
    }
  });
  it('the run skill logs done at the end and never commits unrelated changes on its own', () => {
    const md = read('plugins/forge/skills/run/SKILL.md');
    expect(md).toContain('7. Log the phase `done`');
    expect(runRef('large')).toContain('5. Log the phase `done`, then report');
    expect(md).toMatch(/ask the user whether to commit, stash or leave them before you go on; never commit, stash or discard them on your own/);
  });
  it('the run skill tells the session when to raise a light path to Medium', () => {
    const md = read('plugins/forge/skills/run/SKILL.md');
    expect(md).toContain('**raise to at least Medium**');
    expect(md).toMatch(/changes behaviour callers rely on/);
    expect(md).toMatch(/bundles several independent changes/);
    expect(md).toMatch(/adds new behaviour with its tests/);
  });
  it('versions: forge 0.21.1, waypoint 0.25.0', () => {
    const forge = JSON.parse(read('plugins/forge/.claude-plugin/plugin.json'));
    expect(forge.version).toBe('0.21.1');
    expect(forge.dependencies).toEqual([{ name: 'waypoint', version: '^0.25.0' }]);
    expect(JSON.parse(read('plugins/waypoint/.claude-plugin/plugin.json')).version).toBe('0.25.0');
  });
  it('CHANGELOG has the entries of forge 0.21.1, waypoint 0.25.0 and lens 0.13.0', () => {
    const md = read('CHANGELOG.md');
    // Each plugin's section, newest version first.
    const section = (p: string) => md.split(/^## /m).find(s => s.startsWith(`${p}\n`) || s.startsWith(`${p}\r\n`)) ?? '';
    const versions = (p: string) => [...section(p).matchAll(/^### (\d+\.\d+\.\d+) — /gm)].map(m => m[1]);
    expect(versions('waypoint').slice(0, 2)).toEqual(['0.25.0', '0.24.0']);
    expect(versions('forge').slice(0, 2)).toEqual(['0.21.1', '0.21.0']);
    expect(versions('lens').slice(0, 2)).toEqual(['0.13.0', '0.12.0']);
  });
  it('READMEs in Spanish and English tell the cost changes', () => {
    for (const lang of ['', '.es']) {
      const all = ['README', 'plugins/forge/README', 'plugins/waypoint/README', 'plugins/lens/README'].map((f) => read(`${f}${lang}.md`)).join('\n');
      for (const w of ['swarm.member', 'forge:member', 'impl-high', 'deferred', 'shadow']) expect(all).toContain(w);
      const forge = read(`plugins/forge/README${lang}.md`);
      for (const w of ['swarm.member', 'forge:member', 'forge-impl-high', 'deferred', 'FORGE shadow', 'FORGE prep', 'review-prep', 'review-close']) expect(forge).toContain(w);
      for (const w of ['--effort', '--model']) expect(read(`plugins/waypoint/README${lang}.md`)).toContain(w);
      expect(read(`plugins/lens/README${lang}.md`)).toContain('impl-high');
    }
  });
  it('skills print the lines the CLI hands over (campaign fixes)', () => {
    const run = read('plugins/forge/skills/run/SKILL.md');
    for (const s of ['Print `announce` exactly as printed', 'When the triage\'s `gate` is `plan`', '`untracked`', 'git commit -m "forge: track .forge/.gitignore" -- .forge/.gitignore',
      'FORGE verify-result --task <id>', 'Only the person grants a verify surface\'s permission']) expect(run).toContain(s);
    for (const s of ['its `diff` verbatim', '`ask.question` with exactly the three `ask.options`', '`missing` and `unknown` tools',
      'allowed --expect <the surface\'s hash from verify-plan>', 'When `diffTruncated` is true']) expect(runRef('verify')).toContain(s);
    expect(runRef('large')).toContain('never launch a round they did not ask for');
    expect(runRef('autonomy')).toContain('critique-dismiss');
    for (const s of ['**Print `announce` as it is, as a message of its own, before step 2**', 'Print its `say` lines as they are',
      '`run-deps`', '`main-deps`', '--retry-deps']) expect(runRef('execution')).toContain(s);
    expect(read('plugins/forge/skills/run/references/task-steps.md')).toContain('FORGE triage --plan <plan> --task T --cwd <worktree>');
    const design = read('plugins/waypoint/skills/design/SKILL.md');
    for (const s of ['then **end the turn**', '`round R: rewrite', 'waypoint critique-dismiss DESIGN --round <R> <numbers>', 'the proposals still open from earlier rounds']) expect(design).toContain(s);
    expect(read('plugins/waypoint/agents/design-critic.md')).toContain('still open from earlier rounds');
    expect(read('plugins/waypoint/skills/plan/SKILL.md')).toContain('--publish-info');
    expect(read('plugins/waypoint/skills/work/SKILL.md')).toContain('print each of its `say` lines as it is');
    expect(read('plugins/forge/skills/verify/SKILL.md')).toContain('Only the person grants one');
  });
  it('READMEs describe routing and auto mode', () => {
    for (const f of ['plugins/forge/README.md', 'plugins/forge/README.es.md']) {
      const md = read(f);
      for (const s of ['forge:route', '/forge:run --auto', 'workflow:', 'autonomy:', '`prefs [--workflow w] [--autonomy a]`', '`route --task id (--path p | --text-file f','`route set --task id --chosen o --by user|auto',
        '`route stage --stage s', 'hook route-session', 'hook route-prompt', '`local set workflow <w>|none`', '--autonomy auto']) expect(md).toContain(s);
    }
    for (const f of ['plugins/waypoint/README.md', 'plugins/waypoint/README.es.md']) for (const s of ['design-gate', 'approve --auto']) expect(read(f)).toContain(s);
    expect(read('plugins/lens/README.md')).toContain('auto mode');
    expect(read('plugins/lens/README.es.md')).toContain('modo auto');
  });
  it('READMEs describe the superpowers bridges', () => {
    for (const f of ['plugins/forge/README.md', 'plugins/forge/README.es.md']) {
      const md = read(f);
      for (const s of ['/forge:review', '--from-spec', '--superpowers-plan', 'tdd: superpowers', '`sp-plan tasks <f>`', '`sp-plan check <f> --task N`', '`sp-specs`', '`sp-plans`',
        '`sp-path <skill>`', '`tdd`', '`brief --superpowers-plan f --task N`', '`triage --task id --superpowers-plan f`']) expect(md).toContain(s);
    }
    for (const f of ['plugins/waypoint/README.md', 'plugins/waypoint/README.es.md']) {
      const md = read(f);
      for (const s of ['new --from', 'design-import']) expect(md).toContain(s);
    }
  });
  it('README version badges and dependency lines match the manifests', () => {
    const v = (p: string) => JSON.parse(read(`plugins/${p}/.claude-plugin/plugin.json`)).version as string;
    const dep = (JSON.parse(read('plugins/forge/.claude-plugin/plugin.json')).dependencies as { version: string }[])[0].version;
    for (const lang of ['', '.es']) {
      const root = read(`README${lang}.md`);
      for (const p of ['waypoint', 'forge', 'lens']) expect(root).toContain(`badge/${p}-${v(p)}-`);
      expect(root).toContain(`waypoint ${dep} `);
      for (const p of ['waypoint', 'forge', 'lens']) expect(read(`plugins/${p}/README${lang}.md`)).toMatch(new RegExp(`badge/versi(on|%C3%B3n)-${v(p).replace(/\./g, '\\.')}-`));
      const forge = read(`plugins/forge/README${lang}.md`);
      expect(forge).toContain(`waypoint%20${encodeURIComponent(dep)}-`);
      expect(forge).toContain(`) ${dep},`);
    }
  });
  it('implementers follow the TDD line and the correctness reviewer checks its evidence', () => {
    for (const a of ['forge-impl-heavy', 'forge-impl-high', 'forge-impl','forge-impl-light', 'forge-mech', 'forge-fable']) {
      expect(read(`plugins/forge/agents/${a}.md`)).toContain('When the brief has a `TDD: required` line');
    }
    const rc = read('plugins/forge/agents/forge-review-correctness.md');
    for (const w of ['`TDD: required`', "implementer's report", '"important"', 'failing run']) expect(rc).toContain(w);
  });
  it('forge review skill reviews a branch and never fixes, merges or pushes', () => {
    const md = read('plugins/forge/skills/review/SKILL.md');
    expect(md).toMatch(/^---\r?\nname: review\r?\n/);
    for (const w of ['git merge-base HEAD', 'review-<branch>-<tag>', '--base-run', 'git worktree add --detach', 'diff-1.patch', 'FORGE triage', 'review-correctness',
      'review-security', 'review-perf', 'FORGE verdict', 'nothing to review', 'Never merge', 'never push', '/forge:run']) expect(md).toContain(w);
  });
  it('forge review skill spawns the reviewers of its triage with their effort and model; forge:run passes --delicate', () => {
    const md = read('plugins/forge/skills/review/SKILL.md');
    const step4 = md.slice(md.indexOf('4. **Diff and zones.**'), md.indexOf('5. **Brief.**'));
    const step6 = md.slice(md.indexOf('6. **Review.**'), md.indexOf('7. **Report.**'));
    for (const w of ['«Review its performance too.»', '`review`', 'FORGE triage --task <id> --text-file .forge/work/<id>/task.txt --base <base>']) expect(step4).toContain(w);
    for (const w of ["step-4 triage's `review.reviewers`", "the Agent tool's `effort`", "the Agent tool's `model` when the reviewer's is not null", 'same effort and model',
      'each as subagent type `forge:<agent>`']) expect(step6).toContain(w);
    expect(step6).not.toContain('agents from `FORGE agents`');
    expect(step6).not.toContain('each as its `agent`');
    const run = read('plugins/forge/skills/run/SKILL.md');
    const medium2 = run.slice(run.indexOf('\n2. For each task, write'), run.indexOf('\n3. Do not validate'));
    expect(medium2).toContain('run Triage step 1 again with `--delicate`');
  });
  it('auto mode in the skills: launch questions, decisions by auto, the design loop and the gate, the never-auto list', () => {
    const md = read('plugins/forge/skills/run/SKILL.md');
    const summary = md.slice(md.indexOf('\n## Autonomy\n'), md.indexOf('\n## 1. Triage\n'));
    for (const w of ['FORGE prefs', '/forge:run --auto', 'references/autonomy.md']) expect(summary).toContain(w);
    const auto = runRef('autonomy');
    for (const w of ['FORGE prefs', '/forge:run --auto', 'FORGE triage --autonomy auto', 'FORGE swarm start --autonomy auto', '«¿Integro la rama de ejecución en `<rama>` al acabar?»',
      '--merge-on-finish', '`design-apply`', '`design-approve`', '`plan-confirm`', '`mode`', 'waypoint design-gate', '/waypoint:design approve --auto', 'at most 3 rounds',
      'el diseño necesita tu decisión', 'Never in auto', 'pushing', 'closing escalations', 'forge/run-<project>']) expect(auto).toContain(w);
    for (const w of ['FORGE route stage --stage handed-off', 'FORGE route stage --stage done']) expect(md).toContain(w);
    for (const w of ['Never approve it yourself unless autonomy is auto', 'not in auto: there a spec is used only with `--from-spec`']) expect(runRef('large')).toContain(w);
    expect(runRef('decisions')).toContain('"by": "<auto or unattended>"');
    expect(runRef('resuming')).toContain('keeps deciding alone');
    expect(md.split(/\r?\n---\r?\n/)[0]).toContain('--auto');
    const design = read('plugins/waypoint/skills/design/SKILL.md');
    for (const w of ['approve [--auto]', 'waypoint design-gate DESIGN', 'canAutoApprove', 'approved (auto)', '**Auto.**']) expect(design).toContain(w);
    const planner = read('plugins/forge/agents/forge-planner.md');
    for (const w of ['**Extend mode.**', 'closing task', 'never renumber', 'new: <ids>']) expect(planner).toContain(w);
    const inf = read('plugins/forge/skills/infinite/SKILL.md');
    for (const w of ['autonomy: auto', '`forge-planner` in extend mode', '`plan-confirm`', 'the approved-design rule', 'blocked-large']) expect(inf).toContain(w);
  });
  it('forge:route skill: first, steps aside for small work, one question, hands over', () => {
    const md = read('plugins/forge/skills/route/SKILL.md');
    expect(md).toMatch(/^---\r?\nname: route\r?\ndescription: Use FIRST — before superpowers:brainstorming, writing-plans or any other process skill — when the user asks for coding work that is more than a trivial edit/);
    for (const w of ['FORGE route --task <id> --text-file .forge/work/<id>/task.txt', 'Trivial or Small', 'workflow: forge', '`stepAside: true`', '`ask`', '--run-plan', 'sin forge',
      'FORGE route set --task <id> --chosen', '--remember', 'forge:run --from-spec', 'forge:run --superpowers-plan', 'FORGE route stage --stage planning', '/forge:review', '**the user chose**']) expect(md).toContain(w);
    expect(md).not.toContain('FORGE triage --task <id>');
  });
  it('forge:route skill after the final review: specs only on request, «sin forge» saved as off, routes tied to the session, never in a subagent', () => {
    const md = read('plugins/forge/skills/route/SKILL.md');
    expect(md.split(/\r?\n/).find(l => l.startsWith('description:'))).toContain('Never in a subagent');
    for (const w of ['--build-spec', '`off`', '--session ${CLAUDE_SESSION_ID}', 'FORGE route stage --stage done', '**In a subagent**']) expect(md).toContain(w);
    expect(md).not.toContain('forge local set workflow <option>');
    const inf = read('plugins/forge/skills/infinite/SKILL.md');
    expect(inf).toContain('{status: "free", owner: {"__delete__": true}, claimedAt: {"__delete__": true}, startedAt: {"__delete__": true}}');
    expect(inf).not.toContain('leave `T` `pending`');
  });
  it('forge hooks: the routing hooks on SessionStart and UserPromptSubmit', () => {
    const h = JSON.parse(read('plugins/forge/hooks/hooks.json')).hooks;
    expect(h.SessionStart).toEqual(expect.arrayContaining([expect.objectContaining({ matcher: 'startup|clear|compact|fork', hooks: [expect.objectContaining({ command: expect.stringContaining('hook route-session') })] })]));
    expect(h.UserPromptSubmit[0].hooks[0].command).toContain('hook route-prompt');
    expect(h.SessionStart).toEqual(expect.arrayContaining([expect.objectContaining({ matcher: 'startup|resume|clear|compact|fork', hooks: [expect.objectContaining({ command: expect.stringContaining('hook live') })] })]));
  });
  it('plan 2 leftovers in the texts: --from-spec triage, declined specs, review ids and base failures', () => {
    const md = read('plugins/forge/skills/run/SKILL.md');
    for (const w of ['**From a spec.** With `--from-spec <f>`', 'The path is Large whatever `FORGE triage` prints']) expect(md).toContain(w);
    expect(runRef('large')).toContain('FORGE sp-specs --decline <path>');
    const review = read('plugins/forge/skills/review/SKILL.md');
    for (const w of ['at most 40 characters', 'also failing on the base']) expect(review).toContain(w);
    expect(read('plugins/forge/README.md')).toContain('`/forge:run --from-spec <spec> [<task>]`');
    expect(read('plugins/forge/README.es.md')).toContain('`/forge:run --from-spec <spec> [<tarea>]`');
  });
  it('final review fixes: review baseline in a temporary worktree, TDD report everywhere, plan ticks committed from a file', () => {
    const review = read('plugins/forge/skills/review/SKILL.md');
    for (const w of ['git worktree add --detach', '--cwd <WT>', 'git worktree remove --force <WT>', 'never moves', 'skip the baseline', 'never commits, stashes or discards']) expect(review).toContain(w);
    expect(review).not.toContain('git switch');
    const md = read('plugins/forge/skills/run/SKILL.md');
    expect(read('plugins/forge/skills/run/references/task-steps.md')).toContain("the implementer's report path when the brief has a `TDD: required` line");
    const sp = runRef('superpowers-plan');
    for (const w of ['git commit -F .forge/work/<id>/commit-N.txt -- <f>', 'only when `checked` is above 0', "superpowers' own ledger"]) expect(sp).toContain(w);
    for (const s of [md, sp]) expect(s).not.toContain('git commit -m "<plan title>');
    const rc = read('plugins/forge/agents/forge-review-correctness.md');
    for (const w of ['changes logic', 'report-<n>.txt', 'do not flag']) expect(rc).toContain(w);
  });
  it('superpowers bridges in the skills: import a spec, run a superpowers plan, TDD', () => {
    const design = read('plugins/waypoint/skills/design/SKILL.md');
    for (const w of ['new --from <spec>', 'waypoint design-import', '--round 0', 'another round (recommended)', 'approve now', 'source:', '`docs/superpowers/` is in `.gitignore`']) expect(design).toContain(w);
    const md = read('plugins/forge/skills/run/SKILL.md');
    for (const w of ['--from-spec <f>', '### Superpowers plan', '--superpowers-plan <f>', 'references/superpowers-plan.md',
      'FORGE tdd', 'it starts `TDD: required`', "the implementer's report path", 'superpowers is not installed']) expect(md).toContain(w);
    for (const w of ['FORGE sp-specs', '/waypoint:design new --from']) expect(runRef('large')).toContain(w);
    const sp = runRef('superpowers-plan');
    for (const w of ['FORGE sp-plan tasks', 'FORGE triage --task <id> --superpowers-plan', 'FORGE brief --superpowers-plan', 'FORGE sp-plan check',
      'git ls-files --error-unmatch', 'one after another']) expect(sp).toContain(w);
    expect(sp).toMatch(/never `superpowers:executing-plans` nor `superpowers:subagent-driven-development`/);
    expect(md.split(/\r?\n---\r?\n/)[0]).toMatch(/--superpowers-plan/);
  });
  it('decision skills: WP defined, the md locale and place, revert always written, revert rules', () => {
    const dec = runRef('decisions');
    for (const w of ['`WP` = `FORGE waypoint-cli`', '--locale <es|en>', 'Always write `revert`', '--cwd .claude/worktrees/run', 'before `FORGE swarm merge`']) expect(dec).toContain(w);
    expect(runRef('execution')).toMatch(/Before `FORGE swarm merge`, without a roadmap, write and commit the run's decisions file/);
    const skill = read('plugins/forge/skills/decisions/SKILL.md');
    for (const w of ['relative to `MAIN`', 'does not exist', 'git log --all --oneline --grep', 'from the `depends_on` of every task left', '"runId"', "two options in the user's language", 'node "<WP>" design-validate', 'node "<WP>" design-snapshot']) expect(skill).toContain(w);
    expect(skill).not.toContain('"Revertir" / "No"');
  });
  it('READMEs describe the decisions', () => {
    for (const f of ['plugins/forge/README.md', 'plugins/forge/README.es.md']) {
      const md = read(f);
      for (const s of ['/forge:decisions', '`decision add --data-file f [--task id]`', '`decision md --scope s', 'docs/forge/decisions/']) expect(md).toContain(s);
      expect(md).not.toContain('forge log --kind decision`.');
    }
    for (const f of ['plugins/lens/README.md', 'plugins/lens/README.es.md', 'plugins/waypoint/README.md', 'plugins/waypoint/README.es.md']) expect(read(f)).toContain('⚑');
  });
  it('READMEs describe the timings', () => {
    for (const f of ['plugins/lens/README.md', 'plugins/lens/README.es.md']) {
      const md = read(f);
      expect(md).toContain('◷');
      expect(md).toContain('>24h');
      expect(md).toContain('.forge/usage/<session>.json');
    }
    expect(read('plugins/lens/README.md')).toContain('since start');
    expect(read('plugins/lens/README.es.md')).toContain('desde el inicio');
    expect(read('plugins/waypoint/README.md')).toContain('took 22 min');
    expect(read('plugins/waypoint/README.es.md')).toContain('tardó 22 min');
    for (const f of ['plugins/forge/README.md', 'plugins/forge/README.es.md']) {
      const md = read(f);
      expect(md).toContain('taskStartedAt');
      expect(md).toContain('finishedAt');
    }
    expect(read('docs/assets/art.mjs')).toMatch(/forge · T7 · 8m/);
  });
  it('READMEs describe the sessions mode as available, manual members and resume', () => {
    for (const f of ['plugins/forge/README.md', 'plugins/forge/README.es.md']) {
      const md = read(f);
      expect(md).not.toMatch(/not available yet|arrives in the next version|aún no disponible|llega en la versión siguiente/);
      expect(md).toContain('swarm takeover');
      expect(md).toContain('handover.md');
      expect(md).toContain('.forge/members/');
    }
    expect(read('plugins/waypoint/README.md')).toContain('--task --run');
    expect(read('plugins/lens/README.md')).toContain('manual');
    expect(read('docs/assets/art.mjs')).not.toContain('sessions mode arrives in the next version');
  });
  it('READMEs describe the execution modes and no longer the old swarm defaults', () => {
    for (const f of ['plugins/forge/README.md', 'plugins/forge/README.es.md', 'README.md', 'README.es.md']) {
      const md = read(f);
      expect(md).not.toMatch(/5 by default|default 5|5 por defecto/);
    }
    expect(read('plugins/forge/README.md')).toContain('forge/run-<project>');
    expect(read('plugins/forge/README.md')).not.toContain('busyUntil');
    expect(read('plugins/forge/README.es.md')).toContain('forge/run-<proyecto>');
  });
  it('plan skill publishes the roadmap with notes and proposals write rules for contributors', () => {
    const md = read('plugins/waypoint/skills/plan/SKILL.md');
    expect(md).toContain('{"db": {"rules": [{"path": "", "read": "view", "write": "admin"}, {"path": "notes", "read": "view", "write": "interact"}, {"path": "proposals", "read": "view", "write": "interact"}]}, "user": {"scopes": ["profile"]}, "downloads": true, "assets": {}}');
    expect(md).toContain('waypoint 0.9.4 or earlier');
    expect(md).toContain('0.7.x or earlier');
  });
  it('design-critic agent has frontmatter', () => {
    const md = read('plugins/waypoint/agents/design-critic.md');
    expect(md).toMatch(/^---\r?\nname: design-critic\r?\ndescription: .+\r?\n/);
  });
  it('design skill documents the design loop commands', () => {
    const md = read('plugins/waypoint/skills/design/SKILL.md');
    for (const w of ['design-snapshot', 'design-changed', 'critique-check', 'critique-select', 'design-page', 'rewrite', 'interview', 'approve', '--since', 'applied']) expect(md).toContain(w);
    expect(read('plugins/waypoint/skills/plan/SKILL.md')).toContain('plan.yaml does not exist yet');
  });
  it('forge manifest depends on waypoint ^0.25.0 and ships its CLI', () => {
    const p = JSON.parse(read('plugins/forge/.claude-plugin/plugin.json'));
    expect(p).toMatchObject({ name: 'forge', version: '0.21.1', dependencies: [{ name: 'waypoint', version: '^0.25.0' }] });
    expect(existsSync(new URL('../plugins/forge/dist/forge.cjs', import.meta.url))).toBe(true);
  });
  it('forge scout agent: frontmatter and rules', () => {
    const md = read('plugins/forge/agents/forge-scout.md');
    const head = md.split(/\r?\n---\r?\n/)[0];
    expect(head).toMatch(/^---\r?\nname: forge-scout\r?\n/);
    expect(head).toMatch(/\nmodel: opus\r?(\n|$)/);
    expect(head).toMatch(/\neffort: medium\r?(\n|$)/);
    expect(head).toMatch(/\nmaxTurns: 40/);
    for (const w of ['pillar', 'evidence', 'never edit code']) expect(md).toContain(w);
  });
  it('forge infinite and stop skills drive the CLI', () => {
    const md = read('plugins/forge/skills/infinite/SKILL.md');
    expect(md).toMatch(/^---\r?\nname: infinite\r?\n/);
    for (const w of ['FORGE infinite start', 'meta/infinite', 'proposals to-task', 'proposals policy', 'forge-scout', 'FORGE cycle', '.forge/stop', 'Never merge into `main` or push', 'budget', 'forge/infinite-', 'stopReason', 'if_version: PV', 'seen.json', 'never sent through `proposals policy`', 'event-id <SID>', 'MAIN_REPO', 'git merge-base --is-ancestor forge/infinite-', 'blocked-large', 'type: "question"', '--revises', 'the forge infinite run ended', 'found no task', 'no-cycle']) expect(md).toContain(w);
    const stop = read('plugins/forge/skills/stop/SKILL.md');
    expect(stop).toMatch(/^---\r?\nname: stop\r?\n/);
    expect(stop).toContain('FORGE stop');
    expect(read('plugins/forge/hooks/hooks.json')).toContain('hook stop');
    expect(read('plugins/forge/skills/decide/SKILL.md')).toContain('the latest doc you got');
  });
  it('forge main reads stdin only for the hook and never from a terminal', () => {
    const main = read('src/forge/cli/main.ts');
    expect(main).toMatch(/process\.argv\[2\] === 'hook' && !process\.stdin\.isTTY/);
    expect(read('plugins/forge/dist/forge.cjs')).toContain('process.stdin.isTTY');
    // Piped stdin (how Claude Code runs the hook) is still read: a garbage payload prints nothing.
    const cwd = mkdtempSync(path.join(tmpdir(), 'forge-main-'));
    const r = spawnSync(process.execPath, [fileURLToPath(new URL('../plugins/forge/dist/forge.cjs', import.meta.url)), 'hook', 'stop'], { cwd, input: 'garbage', encoding: 'utf8', timeout: 20000 });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
  });
  it('forge decide skill records decisions without free text in shell strings', () => {
    const md = read('plugins/forge/skills/decide/SKILL.md');
    expect(md).toMatch(/^---\r?\nname: decide\r?\n/);
    for (const w of ['FORGE proposals decide', 'FORGE proposals save --from', 'writes nothing locally', 'no doc for that id', '--by user', 'ArtifactData', 'proposals/<id>', 'if_version', 'notes', 'proposalId', '--reason-file', 'not logged in', '--from', '`set` `notes/<EID>`', 'event-id']) expect(md).toContain(w);
    expect(md).not.toContain('--reason "');
  });
  it('forge run skill writes forge state on waypoint tasks', () => {
    const md = read('plugins/forge/skills/run/SKILL.md');
    expect(md).toContain('references/verify.md');
    expect(runRef('verify')).toContain('state/T');
    for (const w of ['state/T', 'forge: {path', 'proposals pull', 'TV']) expect(read('plugins/forge/skills/run/references/task-steps.md')).toContain(w);
  });
  it('forge agents fix model, effort and maxTurns', () => {
    const expected: Record<string, [string, string]> = {
      'forge-impl-heavy': ['opus', 'xhigh'], 'forge-impl-high': ['opus', 'high'], 'forge-impl':['opus', 'medium'], 'forge-impl-light': ['sonnet', 'medium'], 'forge-mech': ['haiku', 'low'],
      'forge-review-correctness': ['opus', 'high'], 'forge-review-security': ['opus', 'high'], 'forge-review-perf': ['opus', 'high'], 'forge-fable': ['fable', 'high'],
      'forge-review-final': ['opus', 'xhigh'],
      'forge-planner': ['opus', 'xhigh'], 'forge-scout': ['opus', 'medium'], 'forge-verify': ['sonnet', 'high'], 'forge-verify-heavy': ['opus', 'high'],
    };
    const agents = readdirSync(new URL('../plugins/forge/agents/', import.meta.url)).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
    expect(agents.length).toBeGreaterThan(0);
    for (const name of agents) {
      const md = read(`plugins/forge/agents/${name}.md`);
      const head = md.split(/\r?\n---\r?\n/)[0];
      expect(head, `${name} frontmatter`).toMatch(new RegExp(`^---\r?\nname: ${name}\r?\n`));
      expect(head, `${name} must declare model`).toMatch(/\nmodel: \S+\r?(\n|$)/);
      expect(head, `${name} must declare effort`).toMatch(/\neffort: (low|medium|high|xhigh|max)\r?(\n|$)/);
      expect(head, `${name} maxTurns`).toMatch(/\nmaxTurns: \d+/);
      expect(head, `${name} description`).toMatch(/\ndescription: .+/);
      expect(expected[name], `${name} missing from expected model/effort table`).toBeDefined();
      const [model, effort] = expected[name];
      expect(head).toMatch(new RegExp(`\nmodel: ${model}\r?(\n|$)`));
      expect(head).toMatch(new RegExp(`\neffort: ${effort}\r?(\n|$)`));
    }
    expect(agents.sort()).toEqual(Object.keys(expected).sort());
    expect(read('plugins/forge/agents/forge-fable.md')).toMatch(/only when the user explicitly asks/i);
  });
  it('forge planner writes a plan waypoint accepts, implementers report in .txt', () => {
    const planner = read('plugins/forge/agents/forge-planner.md');
    for (const w of ['design.md', 'status: approved', 'plan.yaml', 'node "<waypoint.cjs>" validate', 'done_when', 'zones', 'never renumber']) expect(planner).toContain(w);
    for (const a of ['forge-impl-heavy', 'forge-impl-high', 'forge-impl', 'forge-impl-light', 'forge-mech', 'forge-fable']) {
      const md = read(`plugins/forge/agents/${a}.md`);
      expect(md).toContain('.txt');
      // J-10: the report goes in the reply only when writing its file failed, after the marker.
      expect(md).not.toMatch(/also (put|include) the report in your reply/i);
      const inReply = md.split(/\r?\n/).filter(l => l.includes('report in your reply'));
      expect(inReply, a).toHaveLength(1);
      expect(inReply[0].startsWith('5. '), a).toBe(true);
      expect(inReply[0], a).toContain('`--- report ---`');
      expect(md).toContain('Commit title prefix');
    }
    expect(read('plugins/forge/agents/forge-review-final.md')).toMatch(/final review/i);
  });
  it('reviewers write an early draft verdict and update it; the Large final review has its own agent', () => {
    const final = read('plugins/forge/agents/forge-review-final.md');
    const head = final.split(/\r?\n---\r?\n/)[0];
    for (const re of [/\nmodel: opus\r?\n/, /\neffort: xhigh\r?\n/, /\nmaxTurns: 80\r?\n/, /\ntools: Read, Grep, Glob, Bash, Write\r?(\n|$)/]) expect(head).toMatch(re);
    for (const w of ['design', 'plan', 'done_when', 'correctness.json', 'you have 80 turns', 'never edit']) expect(final, w).toContain(w);
    for (const a of ['forge-review-correctness', 'forge-review-security', 'forge-review-perf', 'forge-review-final']) {
      const md = read(`plugins/forge/agents/${a}.md`);
      for (const w of ['"complete": false', '"complete": true', 'at the latest by your 5th tool call', 'read it and continue from it instead of starting over',
        'You must write the file even when you pass or abstain']) expect(md, `${a}: ${w}`).toContain(w);
      expect(md, a).toMatch(/"complete": true \| false/);
    }
    for (const a of ['forge-review-correctness', 'forge-review-security', 'forge-review-perf']) expect(read(`plugins/forge/agents/${a}.md`)).toContain('you have 30 turns');
    const rc = read('plugins/forge/agents/forge-review-correctness.md');
    expect(rc).not.toMatch(/Final review \(Large path\)/);
    expect(rc).not.toContain('done_when');
    expect(runRef('large')).toContain('review-final');
    for (const s of [read('plugins/forge/skills/run/SKILL.md'), read('plugins/forge/skills/review/SKILL.md'), runRef('large'), runRef('task-steps')]) expect(s).toContain('incomplete');
  });
  it('forge-verify agents: models, no tools list, never edit the project', () => {
    for (const [file, model] of [['forge-verify', 'sonnet'], ['forge-verify-heavy', 'opus']] as const) {
      const md = read(`plugins/forge/agents/${file}.md`);
      expect(md).toMatch(new RegExp(`^name: ${file}$`, 'm'));
      expect(md).toMatch(new RegExp(`^model: ${model}$`, 'm'));
      expect(md).toMatch(/^effort: high$/m);
      expect(md).not.toMatch(/^tools:/m);
      expect(md).toContain('Never edit, create or delete files of the project');
      expect(md).toContain('pids.json');
      expect(md).toContain('"result": "pass" | "fail" | "blocked"');
      expect(md).toContain('learned');
    }
  });
  it('the run skill wires verification in', () => {
    const md = read('plugins/forge/skills/run/SKILL.md');
    for (const s of ['FORGE verify-plan', 'forge-verify', 'FORGE local set surfaces.', '--path', '`new`']) expect(md).toContain(s);
    expect(md).toMatch(/explains how to check something[\s\S]*\.forge\/verify\/<name>\.md/);
    expect(md).toMatch(/[Rr]ead `references\/verify\.md` now and follow `## Before the review`/);
    expect(md).toMatch(/[Rr]ead `references\/verify\.md` now and follow `## After the verdict`/);
    const ref = runRef('verify');
    for (const s of ['## Before the review', '## After the verdict', 'FORGE surfaces learn', 'FORGE local set surfaces.', 'verify-skip', 'FORGE verify-cleanup', 'asset: true', 'permission: changed'])
      expect(ref, s).toContain(s);
  });
  it('the verify skill exists', () => {
    const md = read('plugins/forge/skills/verify/SKILL.md');
    expect(md).toMatch(/^name: verify$/m);
    expect(md).toContain('.forge/verify/<name>.md');
  });
  it('forge run skill covers the paths and the CLI', () => {
    const md = read('plugins/forge/skills/run/SKILL.md');
    expect(md).toMatch(/^---\r?\nname: run\r?\ndescription: .+\r?\n/);
    expect(md).toContain('`FORGE` below means `node "${CLAUDE_PLUGIN_ROOT}/dist/forge.cjs"`');
    for (const w of ['FORGE triage', 'FORGE validate', 'FORGE review-prep', 'FORGE review-close', 'FORGE agents', 'FORGE log',
      '## Trivial', '## Small', '## Medium', '## Large', '## Resuming', 'ratchet', 'breaker', 'stalled', 'fresh-stronger', 'never push', 'forge-fable', '--text-file', '--data-file', '<id>-<n>', 'FORGE prep --task <id>-1 --path small --no-baseline', 'absolute path',
      'tier ladder', '`mech` -> `impl-light` -> `impl` -> `impl-high` -> `impl-heavy`','`revert`', '`invalid: true`',
      '`failures` of every validator with `ok: false` and no `preexisting` in `validators-<n>.json`', '--baseline .forge/work/<id>/baseline-<n>.json']) expect(md).toContain(w);
    for (const w of ['FORGE verdict', '/waypoint:design']) expect(runRef('large')).toContain(w);
    expect(runRef('execution')).toContain('--base-run');
    // FORGE last lives in the resuming reference; the core's Resuming line names what sends you there.
    for (const w of ['FORGE last --task <id>`', 'FORGE last --task <id>-<n>']) expect(runRef('resuming')).toContain(w);
  });
  it('forge run skill: Execution section with the task state machine and the mode choice', () => {
    const md = read('plugins/forge/skills/run/SKILL.md');
    for (const w of ['## Execution', 'references/execution.md']) expect(md).toContain(w);
    const exec = runRef('execution');
    for (const w of ['FORGE swarm worktree <T>', 'FORGE swarm integrate <T>', 'FORGE swarm merge',
      '--merge-on-finish', '.claude/worktrees/run', 'leaseUntil', 'meta/run', 'two lines', 'never cd', 'seconds', 'finishedAt']) expect(exec).toContain(w);
    expect(runRef('ephemeral')).toContain('FORGE swarm task <T> --stage');
    expect(runRef('manual-member')).toContain('state/T.exec');
    for (const s of [md, exec]) {
      expect(s).not.toContain('## Swarm');
      expect(s).not.toContain('Run `/waypoint:work` and follow it');
      expect(s).not.toContain('Then continue `/waypoint:work` at §4');
    }
    for (const w of ['FORGE swarm propose --plan', 'git -C .claude/worktrees/run diff', '--no-merged forge/run-', '--cwd .claude/worktrees/run']) expect(runRef('large')).toContain(w);
    expect(read('plugins/forge/skills/infinite/SKILL.md')).not.toContain("the tick's `progress`");
    const inf = read('plugins/forge/skills/infinite/SKILL.md');
    // Citations point to where the text lives now: the references of forge:run.
    expect(inf).toContain('`references/execution.md` step');
    for (const s of [inf, read('plugins/forge/skills/stop/SKILL.md')]) for (const w of ['Execution step', 'Large step', '`## Autonomy`', '`## Decisions`']) expect(s).not.toContain(w);
    expect(read('plugins/forge/skills/review/SKILL.md')).toContain('**Loose ids** in forge:run `references/ephemeral.md`');
    expect(read('plugins/waypoint/skills/work/SKILL.md')).toContain('`references/large.md` step 3');
    expect(runRef('decisions')).not.toContain('as the paths below say');
    expect(runRef('large')).not.toContain('(a run member, below)');
    expect(inf).not.toContain('Swarm step');
    expect(read('plugins/forge/skills/stop/SKILL.md')).toContain('meta/run');
  });
  it('infinite mode runs its execution on forge/run-<project> from the infinite branch and merges it back', () => {
    const inf = read('plugins/forge/skills/infinite/SKILL.md');
    expect(inf).not.toContain('--branch <the run branch');
    expect(inf).toContain('without `--branch` and with `--merge-on-finish`');
    expect(inf).toContain('run `FORGE swarm merge`');
  });
  it('execution skills: wait 0 only after an integration, claim races dropped, leases renewed, no task.json', () => {
    const md = runRef('execution');
    const inf = read('plugins/forge/skills/infinite/SKILL.md');
    for (const s of [md, inf]) expect(s).toContain('any other `wait 0` is treated as `wait 300`');
    expect(read('plugins/forge/skills/run/SKILL.md')).not.toContain('task.json');
    expect(md).toContain('FORGE swarm task <T> --drop');
    expect(md).not.toContain('`FORGE swarm retry <T>` later');
    expect(md).toContain('so the review diff review-prep writes (`<base>..HEAD`) holds only this task\'s work');
    expect(md).toContain('FORGE swarm task <T> --lease <NOW + 10 min>');
    expect(md).not.toContain('commit-info');
    for (const s of [md, inf]) expect(s).not.toContain('task.json');
    expect(inf).not.toContain('lastTickAt');
  });
  it('the plan skill declares assets only with evidence upload and warns about public sharing', () => {
    const md = read('plugins/waypoint/skills/plan/SKILL.md');
    expect(md).toContain('"assets": {}');
    expect(md).toMatch(/evidence: local/);
    expect(md).toMatch(/organization-internal|no longer be shared publicly/);
  });
  it('run and infinite record decisions with decision add, and every report lists them', () => {
    const run = read('plugins/forge/skills/run/SKILL.md');
    for (const s of ['## Decisions', 'FORGE decision add --data-file <f>', 'FORGE decision list --auto', '«Decisiones automáticas»', 'references/decisions.md']) expect(run).toContain(s);
    const dec = runRef('decisions');
    for (const s of ['FORGE decision add --data-file <f>', 'FORGE decision md --scope <scope>', 'FORGE decision list --auto --task <id>',
      '«Decisiones automáticas»', '"type": "git-revert"', '"type": "none"', 'decision: {point, what, chosen, alternatives, why, revert, auto: true}']) expect(dec).toContain(s);
    const refs = ['decisions', 'autonomy', 'large', 'execution', 'ephemeral', 'superpowers-plan', 'manual-member', 'resuming'].map(runRef);
    for (const s of [run, ...refs]) expect(s).not.toContain('FORGE log --kind decision');
    // Every report that closes work lists them: Medium (core), Large, Execution and Ephemeral execution.
    expect(run).toMatch(/7\. Log the phase `done`[^\n]*automatic decisions/);
    for (const r of ['large', 'execution', 'ephemeral']) expect(runRef(r)).toContain('automatic decisions');
    const inf = read('plugins/forge/skills/infinite/SKILL.md');
    expect(inf).toContain('FORGE decision add --data-file <f>');
    expect(inf).toContain('FORGE decision list --auto --since');
    expect(inf).not.toContain('FORGE log --kind decision');
  });
  it('decisions are only those taken without the user, and the Large report lists both the task and the run', () => {
    const run = read('plugins/forge/skills/run/SKILL.md');
    const sec = run.slice(run.indexOf('## Decisions'), run.indexOf('## 1. Triage'));
    expect(sec).toContain('attended rulings stay `FORGE log --kind ruling`');
    const dec = runRef('decisions');
    expect(dec).toContain('Attended rulings stay `FORGE log --kind ruling`');
    for (const s of [sec, dec]) expect(s).not.toContain('a ruling that lets the work go on');
    expect(runRef('large')).toContain('the automatic decisions (`references/decisions.md`, both `--task <project>` and `--run <runId>`)');
  });
  it('the decisions skill aborts a revert that stops for any reason and never reverts a decision twice', () => {
    const md = read('plugins/forge/skills/decisions/SKILL.md');
    for (const s of ['git -C <D> merge-base --is-ancestor <head> HEAD', 'stops for any reason', 'FORGE decision list --all', 'already reverted']) expect(md).toContain(s);
  });
  it('the decisions skill lists them and reverts one only after a confirmation', () => {
    const md = read('plugins/forge/skills/decisions/SKILL.md');
    expect(md).toMatch(/^---\r?\nname: decisions\r?\n/);
    for (const s of ['FORGE decision list', 'FORGE decision show <n>', 'AskUserQuestion', 'git -C <D> revert --no-edit <base>..<head>',
      'git -C <D> revert --abort', 'design-reopen', 'plan-edit', 'branch-discard', '"by": "user"', '"revertOf": <n>', 'Never push']) expect(md).toContain(s);
  });
  it('forge registers the live hooks', () => {
    const hooks = read('plugins/forge/hooks/hooks.json');
    for (const ev of ['SessionStart', 'SessionEnd', 'SubagentStart', 'SubagentStop', 'Stop']) expect(hooks).toContain(`"${ev}"`);
    expect(hooks).toContain('hook live');
  });
  it('skills describe the sessions executor, run members, manual members and unattended runs', () => {
    const runMd = read('plugins/forge/skills/run/SKILL.md');
    for (const s of ['**Run members.**', '### Unattended', '### Manual member', 'FORGE decision add --data-file', 'references/manual-member.md']) expect(runMd).toContain(s);
    const exec = runRef('execution');
    for (const s of ['### Requests during an execution', '### Unattended', 'list the background sessions with ListAgents',
      'FORGE swarm relaunch', 'FORGE swarm nudge', 'The new session reads <WORK>/handover.md first',
      'An unattended execution never stops to ask']) expect(exec).toContain(s);
    expect(runRef('large')).toContain('--mode sessions');
    // The takeover reads no roadmap listing: the band's rule decides (coordinatorGone).
    expect(runRef('resuming')).toContain('`FORGE swarm takeover --session <SID> --hook-session <CSID>`');
    expect(runRef('resuming')).not.toContain('--db DB');
    expect(read('plugins/forge/skills/member/SKILL.md')).toContain('A run member never integrates and never merges');
    for (const s of [runMd, exec]) expect(s).not.toContain('Sessions mode arrives in a later version');
    const manual = runRef('manual-member');
    for (const s of ['FORGE swarm report <T> --session <SID>', 'FORGE swarm join --session <SID> --role manual', 'FORGE swarm next --plan <plan> --db DB --session <SID>']) expect(manual).toContain(s);
    expect(read('plugins/waypoint/skills/work/SKILL.md')).toContain('join the execution as a manual member: invoke /forge:run --join and follow its ### Manual member');
    expect(read('plugins/forge/skills/stop/SKILL.md')).toContain('[forge run] stop after your current step');
  });
  it('the task steps live in references/task-steps.md and forge:run no longer repeats them', () => {
    const steps = read('plugins/forge/skills/run/references/task-steps.md');
    for (const w of ["**A task's steps**", '1. **brief**: `mkdir -p <WORK>', '2. **implement**', '3. **validate**', '4. **verify** and **review**', '5. **verdict**',
      "the implementer's report path when the brief has a `TDD: required` line", 'FORGE swarm task <T> --stage <S>']) expect(steps).toContain(w);
    const run = read('plugins/forge/skills/run/SKILL.md');
    expect(run).toContain('`references/task-steps.md`');
    const exec = runRef('execution');
    expect(exec).toContain('`references/task-steps.md`');
    expect(exec).toMatch(/read it now/);
    for (const s of [run, exec]) for (const w of ['1. **brief**: `mkdir -p <WORK>', '4. **verify** and **review**: ', '5. **verdict**: when the last of them returns']) expect(s).not.toContain(w);
  });
  it('forge:run is split into references: each exists, the core cites it and no longer repeats its text', () => {
    const run = read('plugins/forge/skills/run/SKILL.md');
    for (const f of ['large', 'execution', 'ephemeral', 'superpowers-plan', 'manual-member', 'resuming', 'autonomy', 'decisions', 'verify']) {
      expect(existsSync(new URL(`../plugins/forge/skills/run/references/${f}.md`, import.meta.url)), f).toBe(true);
      expect(run, f).toMatch(new RegExp(`[Rr]ead \`references/${f}\\.md\` now`));
    }
    for (const w of ['FORGE swarm propose --plan', 'FORGE swarm integrate <T>', 'FORGE swarm start --project loose', 'FORGE sp-plan check', 'FORGE swarm join --session <SID> --role manual',
      'FORGE swarm takeover', '| `design-apply` |', '"type": "design-reopen"', 'final-validators.json', 'An unattended execution never stops to ask']) expect(run, w).not.toContain(w);
  });
  it('forge:run core: at most 25 KB, every cited reference exists, each path opens with the order to read its reference', () => {
    const run = read('plugins/forge/skills/run/SKILL.md');
    expect(Buffer.byteLength(run, 'utf8')).toBeLessThanOrEqual(25600);
    expect(Buffer.byteLength(run, 'utf8'), 'core keeps a margin: at most 22 KB').toBeLessThanOrEqual(22528);
    // Every references/<file>.md cited by a skill of forge or waypoint exists in forge:run's references.
    const files: string[] = [];
    for (const p of ['forge', 'waypoint']) {
      for (const s of readdirSync(new URL(`../plugins/${p}/skills/`, import.meta.url))) {
        const dir = `plugins/${p}/skills/${s}`;
        if (existsSync(new URL(`../${dir}/SKILL.md`, import.meta.url))) files.push(`${dir}/SKILL.md`);
        if (existsSync(new URL(`../${dir}/references/`, import.meta.url))) {
          for (const r of readdirSync(new URL(`../${dir}/references/`, import.meta.url))) if (r.endsWith('.md')) files.push(`${dir}/references/${r}`);
        }
      }
    }
    let cited = 0;
    for (const f of files) {
      for (const m of read(f).matchAll(/references\/([A-Za-z0-9_-]+)\.md/g)) {
        cited++;
        expect(existsSync(new URL(`../plugins/forge/skills/run/references/${m[1]}.md`, import.meta.url)), `${f} cites references/${m[1]}.md`).toBe(true);
      }
    }
    expect(cited).toBeGreaterThan(0);
    // Each path that lives in a reference opens with the order to read it.
    const lines = run.split(/\r?\n/);
    for (const [heading, ref] of [['### Superpowers plan', 'superpowers-plan'], ['## Large', 'large'], ['## Execution', 'execution'], ['### Manual member', 'manual-member'],
      ['### Unattended', 'execution'], ['### Ephemeral execution', 'ephemeral'], ['## Resuming', 'resuming']] as const) {
      const at = lines.indexOf(heading);
      expect(at, heading).toBeGreaterThan(-1);
      const first = lines.slice(at + 1).find(l => l.trim() !== '')!;
      expect(first, heading).toMatch(new RegExp(`^Read (\`### [A-Za-z ]+\` in )?\`references/${ref}\\.md\` now`));
    }
  });
  it('reviewers at high with the delta mode; Medium and the task steps review with review-prep and review-close', () => {
    for (const [name, key] of [['correctness', 'correctness'], ['security', 'security'], ['perf', 'perf']]) {
      const md = read(`plugins/forge/agents/forge-review-${name}.md`);
      const [head, ...rest] = md.split(/\r?\n---\r?\n/);
      const body = rest.join('\n---\n');
      expect(head).toMatch(/\nmodel: opus\r?\n/);
      expect(head).toMatch(/\neffort: high\r?\n/);
      for (const w of ['delta mode', '`mode: delta`', 'the full diff', 'fix-<n>-<round>.patch', `previous-${key}.json`, 'your own previous findings',
        'are fixed', 'breaks nothing', '"origin"', '`previous`', '`fix`', '`untouched`', 'the CLI decides what blocks', 'Round 1']) expect(body, `${name}: ${w}`).toContain(w);
      expect(body).toMatch(/"origin": "previous" \| "fix" \| "untouched"/);
    }
    const run = read('plugins/forge/skills/run/SKILL.md');
    const medium = run.slice(run.indexOf('## Medium'), run.indexOf('### Superpowers plan'));
    const steps = read('plugins/forge/skills/run/references/task-steps.md');
    for (const [label, s] of [['Medium', medium], ['task-steps', steps]] as const) {
      for (const w of ['FORGE review-prep --task', 'FORGE review-close --task', '`spawn`', "the Agent tool's `model`", '`effort`', 'twin', 'shadow/',
        '`missing`', '`deferred`', '`next`', '`implementer`', '`carried`']) expect(s, `${label}: ${w}`).toContain(w);
      expect(s, `${label} still calls verdict`).not.toMatch(/FORGE verdict/);
      expect(s, `${label} still calls round`).not.toMatch(/FORGE round/);
      expect(s, `${label} still writes the diff`).not.toMatch(/git (-C <worktree> )?diff \$?<?[Bb][Aa][Ss][Ee]>?\.\.HEAD >/);
    }
    expect(medium).toContain('FORGE verify-plan');
    expect(medium).toMatch(/7\. [^\n]*`deferred`[^\n]*file and line/);
    expect(steps).toContain('--path large');
    expect(steps).not.toContain('--delicate');
    const large = runRef('large');
    expect(large).toContain('FORGE verdict --task <project>-final --dir .forge/work/<project>/final-1');
    expect(large).toContain('one fix by `impl-heavy`');
    expect((large.match(/spawn (the )?`review-final`/g) ?? []).length).toBe(2);
    expect(large).not.toContain('final review mode');
    expect(large).not.toContain('FORGE review-prep');
    expect(large).not.toContain('FORGE review-close');
    const resume = runRef('resuming');
    expect(resume).not.toMatch(/FORGE round/);
    const member = read('plugins/forge/skills/member/SKILL.md');
    expect(member).not.toMatch(/FORGE round/);
    expect(Buffer.byteLength(member, 'utf8')).toBeLessThan(15 * 1024);
  });
  it('review fixes of T013: loose Medium briefs, twins before the close, deferred handed over, mode passed', () => {
    const run = read('plugins/forge/skills/run/SKILL.md');
    const medium = run.slice(run.indexOf('\n## Medium'), run.indexOf('### Superpowers plan'));
    const steps = read('plugins/forge/skills/run/references/task-steps.md');
    const member = read('plugins/forge/skills/member/SKILL.md');
    const ephemeral = runRef('ephemeral');
    // 1. A Medium brief's loose task reviews with the Medium task's triage; Trivial and Small keep a plain validate.
    expect(ephemeral).toMatch(/review-prep[^\n]*the Medium task's triage/);
    expect(ephemeral).toMatch(/\*\*validate:\*\* Trivial and Small: `FORGE validate --all --path <path>/);
    // 2. review-close no longer waits for the shadow twins (C-11).
    for (const s of [medium, steps]) expect(s).not.toContain('twins included');
    // 3. Deferred findings: written to the main checkout's deferred.json, named in the member's reply, read by the closing reports.
    for (const s of [steps, member]) expect(s).toContain('<MAIN>/<WORK>/deferred.json');
    expect(member).toMatch(/text: "<T> done"[^\n]*deferred\.json/);
    const end = runRef('execution').split('\n').find(l => l.startsWith('7. **End.**'))!;
    expect(end).toContain('<WORK>/deferred.json');
    const ephEnd = ephemeral.split('\n').find(l => l.startsWith('4. **End.**'))!;
    expect(ephEnd).toContain('<WORK>/deferred.json');
    expect(Buffer.byteLength(member, 'utf8')).toBeLessThan(15 * 1024);
    // Minors: the entry's mode goes to the reviewer; full is not only round 1; stale references updated.
    for (const s of [medium, steps]) expect(s).toMatch(/its `mode`/);
    for (const name of ['correctness', 'security', 'perf']) {
      expect(read(`plugins/forge/agents/forge-review-${name}.md`)).toContain('`mode: full` (round 1, after a redo, or a reviewer new to the brief)');
    }
    expect(steps).not.toContain("step 4's once it ran");
    expect(run).not.toContain('used for `validate`, `verdict` and `round`');
    expect(run).not.toContain('diff forge/run-<project>...HEAD');
  });
  it('FORGE prep folds BASE, the phase and the baseline; each stage change is one batch with state/T.exec, state/T.forge and the lease', () => {
    const run = read('plugins/forge/skills/run/SKILL.md');
    const medium = run.slice(run.indexOf('\n## Medium'), run.indexOf('### Superpowers plan'));
    const steps = read('plugins/forge/skills/run/references/task-steps.md');
    expect(medium).toContain('FORGE prep --task <id>-<n> --path medium');
    expect(medium).not.toContain('--base-run');
    expect(medium).not.toMatch(/record `BASE=\$\(git rev-parse HEAD\)`/);
    const brief = steps.split('\n').find(l => l.startsWith('1. **brief**'))!;
    expect(brief).toContain('FORGE prep --task T-1 --path large --cwd <worktree>');
    expect(brief).not.toContain('--base-run');
    const head = steps.split('\n').find(l => l.startsWith("**A task's steps**"))!;
    expect(head).toMatch(/one ArtifactData `batch`/);
    for (const w of ['`state/T.exec`', '`state/T.forge`', '`sessions/<SID>`', 'leaseUntil']) expect(head).toContain(w);
    expect(head).not.toMatch(/After each stage change and each verdict also `update state\/T`/);
    const ephemeral = runRef('ephemeral');
    expect(ephemeral).toContain('FORGE prep --task T-1 --path <path> --cwd <worktree>');
    expect(Buffer.byteLength(read('plugins/forge/skills/member/SKILL.md'), 'utf8')).toBeLessThan(15 * 1024);
  });
  it('forge:member: a small skill with frontmatter, join, the claim, the finish and the task steps', () => {
    const md = read('plugins/forge/skills/member/SKILL.md');
    expect(md).toMatch(/^---\r?\nname: member\r?\ndescription: .+\r?\n/);
    for (const w of ['FORGE swarm join --session <SID> --role executor --task <T> --name wp-<project>-<T> --hook-session ${CLAUDE_SESSION_ID}', '**Claim.**', '**Finish.**',
      'references/task-steps.md', 'A run member never integrates and never merges', 'FORGE decision add --data-file', 'FORGE swarm report <T> --session <SID>',
      'session-id <name>', '`<SID>-2`', 'handover.md', 'Edit and Write', '### Manual member', 'forge:run --join']) expect(md).toContain(w);
    expect(Buffer.byteLength(md, 'utf8')).toBeLessThan(15000);
  });
  it('forge:run: no old run-member prompt, and the launch of tick and relaunch as printed (J-16)', () => {
    const run = read('plugins/forge/skills/run/SKILL.md');
    expect(run).toContain('**Run members.**');
    for (const w of ['/forge:run --plan <plan> --task <T> — run member of <SID>', '→ Run member']) expect(run).not.toContain(w);
    expect(read('plugins/forge/skills/member/SKILL.md')).not.toContain('/forge:run --plan <plan> --task <T>');
    expect(run).not.toContain('### Run member');
    expect(run).not.toContain('FORGE swarm join --session <SID> --role executor');
    expect(run).not.toContain('node "<WP>" launch <plan> <T>');
    const exec = runRef('execution');
    expect(exec).not.toContain('FORGE swarm join --session <SID> --role executor');
    expect(exec).not.toContain('node "<WP>" launch <plan> <T>');
    const start = exec.split('\n').find(l => l.includes('`start {task}` in mode `sessions`'))!;
    expect(start).toContain('`launch`');
    expect(start).toContain('node "<WP>" <launch…>');
    const relaunch = exec.split('\n').find(l => l.includes('`relaunch {task}`'))!;
    expect(relaunch).toContain('node "<WP>" <launch…>');
  });
  it('members join with their hook session id; sessions starts set the worktree up first; stop reaches only named members of the run', () => {
    const runMd = read('plugins/forge/skills/run/SKILL.md');
    expect(read('plugins/forge/skills/member/SKILL.md')).toContain('FORGE swarm join --session <SID> --role executor --task <T> --name wp-<project>-<T> --hook-session ${CLAUDE_SESSION_ID}');
    const manual = runRef('manual-member');
    const exec = runRef('execution');
    expect(manual).toContain('FORGE swarm join --session <SID> --role manual --hook-session <CSID>');
    expect(exec).toContain('`start {task}` in mode `sessions`: first `FORGE swarm worktree <T>`');
    expect(manual).toMatch(/5\. \*\*Finish\.\*\* Commits on `task\/<T>`[^\n]*FORGE swarm report <T> --session <SID> --stage verdict --status accepted --no-agent/);
    expect(exec).toContain('it never edits task code itself (except direct requests, below)');
    for (const s of [runMd, exec]) expect(s).not.toContain('on `integrated` only');
    expect(exec).toContain('(`/waypoint:plan`)');
    const stop = read('plugins/forge/skills/stop/SKILL.md');
    expect(stop).toContain('If `FORGE stop` printed `members`');
    expect(stop).toContain('do not report it');
    expect(stop).toContain('whose `name` is null');
    expect(read('plugins/waypoint/skills/work/SKILL.md')).toContain('no `~ : @ +`');
    for (const f of ['plugins/forge/README.md', 'plugins/forge/README.es.md']) {
      const md = read(f);
      for (const s of ['`swarm relaunch <task> --plan p`', '`swarm nudge <task> [--plan p]`', '`swarm join --session SID --role executor|manual [--task T] [--name N] [--hook-session ID]`',
        '--stage S [--status running|accepted|blocked] [--agent A | --no-agent] [--round N] [--lease ISO]`', '`swarm takeover --session SID --hook-session ID`']) {
        expect(md).toContain(f.endsWith('es.md') ? s.replace(/<task>/g, '<tarea>') : s);
      }
    }
    expect(read('plugins/forge/skills/infinite/SKILL.md')).toContain('has diverged from');
  });
  it('READMEs describe the model by size, ephemeral executions and the member conflict fix round', () => {
    for (const f of ['plugins/forge/README.md', 'plugins/forge/README.es.md']) {
      const md = read(f);
      expect(md).toContain('--kind ephemeral');
      expect(md).toContain('swarm retry <T> --adopt');
      expect(md).toContain('.forge/loose.json');
      expect(md).toContain('--batch');
      expect(md).not.toContain('main session, `impl-light` or `mech`');
      expect(md).not.toContain('sesión principal, `impl-light` o `mech`');
    }
    expect(read('docs/assets/art.mjs')).toContain('delegated: mech / light');
    expect(read('plugins/waypoint/README.md')).toContain('Loose tasks');
    expect(read('plugins/waypoint/README.es.md')).toContain('Tareas sueltas');
    expect(read('plugins/forge/README.md')).not.toMatch(/ephemeral[^.]*no roadmap/i);
  });
  it('no reference and no agent leans on ${CLAUDE_…} substitution, which only a SKILL.md body gets (C1, J-01)', () => {
    const plugins = fileURLToPath(new URL('../plugins/', import.meta.url));
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
      .flatMap(d => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
    const files = readdirSync(plugins).flatMap(p => [
      ...(existsSync(path.join(plugins, p, 'skills')) ? walk(path.join(plugins, p, 'skills')).filter(f => path.basename(f) !== 'SKILL.md') : []),
      ...(existsSync(path.join(plugins, p, 'agents')) ? readdirSync(path.join(plugins, p, 'agents')).filter(f => f.endsWith('.md')).map(f => path.join(plugins, p, 'agents', f)) : []),
    ]);
    expect(files.length).toBeGreaterThan(20);
    const hits = files.flatMap(f => readFileSync(f, 'utf8').split(/\r?\n/)
      .flatMap((l, i) => (l.includes('${CLAUDE_') ? [`${path.relative(plugins, f)}:${i + 1}`] : [])));
    expect(hits).toEqual([]);
  });
  it('the skills give the commands that bind a session its Claude id: CSID in SKILL.md, <CSID> in the references (C1)', () => {
    expect(read('plugins/forge/skills/run/SKILL.md')).toContain('`CSID` = `${CLAUDE_SESSION_ID}`');
    expect(runRef('execution')).toContain('FORGE swarm start --project <project> --session <SID> --hook-session <CSID>');
    expect(runRef('ephemeral')).toContain('--session <SID> --hook-session <CSID> --kind ephemeral');
    expect(runRef('ephemeral')).toContain('--session <its coordinator> --hook-session <CSID> --kind ephemeral');
    const resuming = runRef('resuming');
    expect(resuming).toContain('`--session`, `--hook-session <CSID>`');
    expect(resuming).not.toContain('the Stop hook binds');
    expect(runRef('manual-member')).toContain('FORGE swarm join --session <SID> --role manual --hook-session <CSID>');
  });
  it('forge:infinite binds its run at start with the Claude id, not at the first Stop (K5-03)', () => {
    const inf = read('plugins/forge/skills/infinite/SKILL.md');
    expect(inf).toContain('`CSID` = `${CLAUDE_SESSION_ID}`');
    expect(inf).toContain('FORGE infinite start --cycles N --hours H --session <CSID>');
    expect(inf).not.toContain('first Stop hook binds');
    expect(inf).not.toContain('binds to the session that first hits the Stop hook');
  });
  it('stopping, stalling or closing an execution publishes meta/run inactive and frees the coordinator tasks (A-23)', () => {
    const step7 = runRef('execution').split('\n').find(l => l.startsWith('7. **End.**'))!;
    const stop = read('plugins/forge/skills/stop/SKILL.md');
    for (const s of [step7, stop]) {
      for (const w of ['FORGE swarm close', 'active: false', 'status: "free"', 'exec: {"__delete__": true}', 'owner: {"__delete__": true}']) expect(s).toContain(w);
    }
    for (const w of ['`stalled`', '`stopped`', '`budget`']) expect(step7).toContain(w);
    // Carry 2: a stopped or budget close also reaches the run's member sessions it prints.
    for (const w of ['`sessions`', '/forge:stop` step 2b']) expect(step7, w).toContain(w);
    expect(stop).toContain('closedAt');
  });
  it('integrating a task writes its summary in the batch and the last commit in a call of its own (H-16)', () => {
    const integ = runRef('execution').split('\n').find(l => l.trimStart().startsWith('- `integrate {task}`'))!;
    const apartAt = integ.indexOf('Then, in a call of its own');
    expect(apartAt).toBeGreaterThan(0);
    const batch = integ.slice(integ.indexOf('`integrated` → ArtifactData `batch`'), apartAt);
    expect(batch).toContain('summary: "');
    expect(batch).toContain('commits: [<the `commit` that `integrate` printed>]');
    expect(batch).not.toContain('meta/project');
    const call = integ.slice(apartAt, integ.indexOf('Print its `say` lines'));
    expect(call).toContain('update meta/project');
    expect(call).toContain('metrics: {tests: <tests>, lastCommit: {sha, ts}}');
    expect(call).not.toContain('if_version:');
  });
  it('design apply records what it applied with --applied, also across rounds (K3-12)', () => {
    const md = read('plugins/waypoint/skills/design/SKILL.md');
    const apply = md.slice(md.indexOf('## apply <spec>'), md.indexOf('## rewrite'));
    for (const w of ['--applied r<R1>:<numbers>', 'r<R>:<list|all>', 'apply r1:4,5 r2:all']) expect(apply).toContain(w);
    expect(md.slice(md.indexOf('## rewrite'), md.indexOf('## interview'))).toContain('--round R --rewrite');
    expect(md.slice(md.indexOf('## approve'), md.indexOf('## Publish'))).toContain('apply r<R>:<numbers>');
    expect(md).not.toContain('--note "round R: applied');
  });
  it('no skill adds or obeys the forge mark of a track session; a track of a forge plan joins as a manual member (J-02)', () => {
    const skills = fileURLToPath(new URL('../plugins/', import.meta.url));
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
      .flatMap(d => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
    const files = readdirSync(skills).flatMap(p => (existsSync(path.join(skills, p, 'skills')) ? walk(path.join(skills, p, 'skills')) : []));
    expect(files.filter(f => readFileSync(f, 'utf8').includes('forge drives this session')).map(f => path.relative(skills, f))).toEqual([]);
    expect(read('plugins/waypoint/skills/launch/SKILL.md')).toContain('(`/waypoint:work` §0.5)');
  });
  it('READMEs describe swarm close, the Claude session id, the integrated commit and the design loop of wave 0', () => {
    for (const f of ['plugins/forge/README.md', 'plugins/forge/README.es.md']) {
      const md = read(f);
      for (const s of ['`swarm close`', '`swarm start --project P --session SID --hook-session ID', '`swarm takeover --session SID --hook-session ID`',
        '`infinite start --cycles N | --hours H --session ID', 'CLAUDE_CODE_SESSION_ID', '`commit`', 'kind: e2e']) expect(md).toContain(s);
      // The takeover no longer reads the roadmap lease: --db is accepted for one more version but no longer documented.
      expect(md).not.toContain('--hook-session ID [--db dir]');
      expect(md).not.toContain('Stop hook binds');
      expect(md).not.toContain('first Stop or SubagentStart');
      expect(md).not.toContain('primer Stop o SubagentStart');
    }
    for (const f of ['plugins/waypoint/README.md', 'plugins/waypoint/README.es.md']) {
      const md = read(f);
      for (const s of ['--applied', '--rewrite', 'apply r1:4,5 r2:all', '?debug=1', '/waypoint:work` §0.5']) expect(md).toContain(s);
    }
  });
  it('implementers run the validate command prep printed, never the whole suite, and the skills pass it (J-11)', () => {
    const impls = ['forge-impl-heavy', 'forge-impl-high', 'forge-impl', 'forge-impl-light', 'forge-mech', 'forge-fable'];
    const lines = (a: string) => read(`plugins/forge/agents/${a}.md`).split(/\r?\n/);
    const step3 = (a: string) => lines(a).find(l => l.startsWith('3. '))!;
    const input = (a: string) => lines(a).find(l => l.startsWith('Input from the caller:'))!;
    for (const a of impls) {
      expect(step3(a), a).toBe(step3('forge-impl'));
      expect(input(a), a).toBe(input('forge-impl'));
      expect(read(`plugins/forge/agents/${a}.md`), a).not.toContain('FORGE validate --affected <files you changed');
    }
    const run = read('plugins/forge/skills/run/SKILL.md').split(/\r?\n/);
    const small1 = run.find(l => l.startsWith('1. A Small task is **always delegated**'))!;
    const medium2 = run.find(l => l.startsWith('2. For each task, write'))!;
    const steps2 = runRef('task-steps').split(/\r?\n/).find(l => l.startsWith('2. **implement**'))!;
    const brief = runRef('ephemeral').split(/\r?\n/).find(l => l.includes('- **brief:**'))!;
    const member = read('plugins/forge/skills/member/SKILL.md').split(/\r?\n/).find(l => l.startsWith('**Implementer.**'))!;
    const manual = runRef('manual-member').split(/\r?\n/).find(l => l.startsWith('2. **Take a pending task**'))!;
    for (const [label, s] of [['small1', small1], ['medium2', medium2], ['steps2', steps2], ['brief', brief], ['member', member], ['manual', manual]]) {
      expect(s, label).toContain('`validate`');
    }
  });
  it('no forge:run file keeps BASE in a shell variable; Small takes it from prep --no-baseline (J-13)', () => {
    const dir = fileURLToPath(new URL('../plugins/forge/skills/run/', import.meta.url));
    const files = ['SKILL.md', ...readdirSync(path.join(dir, 'references')).map(f => `references/${f}`)];
    for (const f of files) {
      const text = readFileSync(path.join(dir, f), 'utf8');
      expect(text, f).not.toContain('$BASE');
      expect(text, f).not.toContain('BASE=$(');
    }
    expect(read('plugins/forge/skills/member/SKILL.md')).not.toContain('$BASE');
    const run = read('plugins/forge/skills/run/SKILL.md');
    expect(run).toContain('FORGE prep --task <id>-1 --path small --no-baseline');
    expect(run).toContain('`<BASE>`');
  });
  it('a validators round sends the implementer back without reviewers (C-08)', () => {
    const run = read('plugins/forge/skills/run/SKILL.md').split(/\r?\n/);
    expect(run.find(l => l.startsWith('3. Do not validate or write the diff yourself'))).toContain('`validatorsRound`');
    const step3 = runRef('task-steps').split(/\r?\n/).find(l => l.startsWith('3. **validate**'))!;
    for (const w of ['`validatorsRound`', 'FORGE swarm task <T> --stage implement']) expect(step3).toContain(w);
  });
  it('forge READMEs describe the validation of wave 1a: the tree cache, --affected, the parallel batch, the validators round and stats', () => {
    for (const f of ['plugins/forge/README.md', 'plugins/forge/README.es.md']) {
      const md = read(f);
      for (const s of ['.forge/cache/validate', 'affected_cmd', 'cache: true', 'parallel: 3', 'retry: flaky', '`validatorsRound`', '`newFailing`',
        'skipped: "not-affected"', '`stats [--days N | --since iso] [--json] [--locale es|en]`', '--no-cache', '--out f', '--no-baseline']) {
        expect(md, `${f}: ${s}`).toContain(s);
      }
      // Every command that reads the tree cache takes --no-cache.
      const lines = md.split(/\r?\n/);
      for (const cmd of ['- `validate ', '- `prep --task', '- `review-prep --task', '- `swarm integrate ']) {
        expect(lines.find(l => l.startsWith(cmd))?.split('` - ')[0], `${f}: ${cmd}`).toContain('[--no-cache]');
      }
    }
  });
  it('implementers: the same Fix round section in all six, the failing test first only under TDD: required, a reply of two lines (J-07, J-10, J-18, K4-03)', () => {
    const impls = ['forge-impl-heavy', 'forge-impl-high', 'forge-impl', 'forge-impl-light', 'forge-mech', 'forge-fable'];
    const text = (a: string) => read(`plugins/forge/agents/${a}.md`).replace(/\r\n/g, '\n');
    const fixRound = (a: string) => text(a).slice(text(a).indexOf('\n## Fix round\n'));
    for (const a of impls) {
      expect(text(a), a).toContain('\n## Fix round\n');
      expect(fixRound(a), a).toBe(fixRound('forge-impl'));
      for (const w of ['NEEDS_CONTEXT', '"residual"', '`<id>: fixed in <file>:<line>`', 'handover']) expect(fixRound(a), `${a}: ${w}`).toContain(w);
      const lines = text(a).split('\n');
      for (const l of lines.filter(x => /failing test first/i.test(x))) expect(l, a).toContain('`TDD: required`');
      expect(lines.find(l => l.startsWith('6. ')), a).toContain('`<status> <commit SHA>`');
    }
  });
  it('reviewers share the verdict rule and the rule on validators, each role has its own severities, and the delta asks for the id and regression (J-05, J-09, J-19, J-20, K4-02)', () => {
    const reviewers = ['forge-review-correctness', 'forge-review-security', 'forge-review-perf', 'forge-review-final'];
    const lines = (a: string) => read(`plugins/forge/agents/${a}.md`).split(/\r?\n/);
    const line = (a: string, start: string) => lines(a).find(l => l.startsWith(start));
    for (const a of reviewers) {
      for (const start of ['Verdict rule:', 'Confidence:', 'You may read code around the diff and run read-only commands.']) {
        expect(line(a, start), `${a}: ${start}`).toBeDefined();
        expect(line(a, start), `${a}: ${start}`).toBe(line('forge-review-correctness', start));
      }
      expect(read(`plugins/forge/agents/${a}.md`), a).not.toContain('focused read-only commands (tests, greps)');
    }
    const severities = (a: string) => lines(a).filter(l => /^- (critical|important|minor): /.test(l));
    const [c, s, p] = ['forge-review-correctness', 'forge-review-security', 'forge-review-perf'].map(severities);
    for (const x of [c, s, p]) expect(x).toHaveLength(3);
    expect(new Set([c.join('\n'), s.join('\n'), p.join('\n')]).size).toBe(3);
    for (const a of ['forge-review-correctness', 'forge-review-security', 'forge-review-perf']) {
      const md = read(`plugins/forge/agents/${a}.md`);
      for (const w of ['"id": "F3"', '"regression": true', 'copy its `"id"`']) expect(md, `${a}: ${w}`).toContain(w);
    }
    const tdd = line('forge-review-correctness', 'When the brief has a `TDD: required` line')!;
    for (const w of ['`mode: full`', '`mode: delta`', '"important"', '"minor"']) expect(tdd, w).toContain(w);
    expect(read('plugins/forge/agents/forge-review-correctness.md')).toContain('`express: true`');
    const security = read('plugins/forge/agents/forge-review-security.md');
    for (const w of ['"outOfModel": true', '`threatModel`']) expect(security, w).toContain(w);
  });

  it('forge:run and the task steps close without waiting for twins, follow ask, handover and revert, and run an express review\'s validators in the background (C-11, C-13, C-15, J-08, K4-02, measure 7)', () => {
    const run = read('plugins/forge/skills/run/SKILL.md');
    const medium = run.slice(run.indexOf('\n## Medium'), run.indexOf('### Superpowers plan'));
    const steps = runRef('task-steps');
    const conv = runRef('convergence');
    for (const s of [medium, steps]) expect(s).toContain('references/convergence.md');
    for (const w of ['`revert`', '`handover`', '`threatModel`', '`express: true`', 'Threat model: <that path>']) expect(medium, w).toContain(w);
    expect(medium).not.toContain('git revert --no-edit');
    for (const w of ['FORGE shadow collect --task', '`shadowPending`', '`ask`', '--out-of-model', '--defer', 'NEEDS_CONTEXT', '`validators.cmd`', 'run_in_background',
      '`residual`', '`reviews`', 'threatModel.outOfScope', '"point": "ruling"', 'AskUserQuestion', '`revert.args`', '`revert.steps`', 'git revert -m 1']) expect(conv, w).toContain(w);
    expect(medium).toMatch(/FORGE review-close --task <id>-<n>[^`]*--locale <es\|en>/);
    expect(steps).toMatch(/FORGE review-close --task T-<n>[^`]*--locale <es\|en>/);
    expect(medium).toContain('one line per finding with its id, `residual`, file and line');
    expect(steps).not.toContain('unless a `redo` starts a new brief');
    for (const w of ['`revert`', 'FORGE shadow collect --task', '`handover`', 'NEEDS_CONTEXT', '`threatModel`', '`validators.cmd`']) expect(steps, w).toContain(w);
    expect(runRef('step')).toContain('`revert.steps`');
  });
  it('forge:run Medium: every step starts its own line, 0 to 7 in order (I6)', () => {
    const run = read('plugins/forge/skills/run/SKILL.md').replace(/\r\n/g, '\n');
    const medium = run.slice(run.indexOf('\n## Medium'), run.indexOf('### Superpowers plan'));
    expect(medium).toMatch(/^5\. Each time a reviewer finishes/m);
    expect(medium.match(/^\d+b?\. /gm)).toEqual(['0. ', '1. ', '2. ', '3. ', '3b. ', '4. ', '5. ', '6. ', '7. ']);
  });
  it('convergence.md: a theme added to threatModel.outOfScope also needs protects without a threatModel, and the config is checked after the edit (I5)', () => {
    const line = runRef('convergence').split(/\r?\n/).find(l => l.includes('threatModel.outOfScope'));
    for (const w of ['`protects`', 'FORGE config get threatModel']) expect(line, w).toContain(w);
  });
  it('forge READMEs describe the convergence of wave 1b: reviews, ids, residuals, the express review, the threat model, the handover and shadow collect', () => {
    for (const f of ['plugins/forge/README.md', 'plugins/forge/README.es.md']) {
      const md = read(f);
      for (const s of ['findings-index-<n>.json', '`residual`', 'review.express', 'review.personDocs', 'threatModel:', 'outOfScope', '`reviews`', '--out-of-model', '--defer',
        'handover-<n>-<round>.md', '`revert`', 'shadow collect', '`shadowPending`']) expect(md, `${f}: ${s}`).toContain(s);
    }
    expect(read('plugins/forge/README.md')).not.toContain('up to 4 rounds');
    expect(read('plugins/forge/README.es.md')).not.toContain('hasta 4 rondas');
  });

  it('After the verdict closes a verification with FORGE verify-close (measure 10)', () => {
    const after = runRef('verify').split('## After the verdict')[1];
    for (const w of ['FORGE verify-close --task <id>-<n>', '--evidence', '`oversize: true`', '`evidence.previous`', '`commit`', '`proposals`']) expect(after, w).toContain(w);
  });

  it('FORGE setup is the one rule to install a worktree; infinite cites decisions.md and the Unattended row (J-17)', () => {
    const review = read('plugins/forge/skills/review/SKILL.md');
    expect(review).toContain('FORGE setup --cwd <WT>');
    expect(review).not.toContain('npm ci');
    const inf = read('plugins/forge/skills/infinite/SKILL.md');
    expect(inf).toContain('skills/run/references/decisions.md');
    expect(inf).not.toContain('"what": "execution not started"');
    expect(inf).toContain('`### Unattended` in forge:run `references/execution.md`');
    const row = runRef('execution').split('\n').find(l => l.startsWith('| A Large task |'))!;
    for (const w of ['/forge:infinite', 'autonomy: auto']) expect(row).toContain(w);
  });
  it('no skill keeps the swarm member of waypoint launch nor the old run-member prompt (J-16)', () => {
    const plugins = fileURLToPath(new URL('../plugins/', import.meta.url));
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
      .flatMap(d => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
    const files = readdirSync(plugins).flatMap(p => (existsSync(path.join(plugins, p, 'skills')) ? walk(path.join(plugins, p, 'skills')) : []));
    for (const w of ['--swarm', '→ Run member', 'swarm member', 'launchedBy', '§0.6', '§0 item 6']) {
      expect(files.filter(f => readFileSync(f, 'utf8').includes(w)).map(f => path.relative(plugins, f)), w).toEqual([]);
    }
    const work = read('plugins/waypoint/skills/work/SKILL.md');
    expect(work).toMatch(/\n5\. \*\*forge execution\.\*\*/);
    expect(work).not.toMatch(/\n6\. \*\*forge execution\.\*\*/);
  });

  it('the planner reads the measured fixed cost and marks delicate tasks (C-07, J-14)', () => {
    expect(runRef('large')).toContain('FORGE stats --json > .forge/work/<project>/stats.json');
    const planner = read('plugins/forge/agents/forge-planner.md');
    for (const w of ['**Fixed cost.**', 'overheadMin.p50', 'estimate.ratio', 'delicate: true', 'estimate_min', 'delicate?']) expect(planner, w).toContain(w);
    expect(planner).not.toContain('(≤ ~60 min)');
    expect(planner).toContain('assume 7');
    expect(planner).toContain('null');
    // Extend mode and its contract stay.
    for (const w of ['**Extend mode.**', 'closing task', 'never renumber', 'new: <ids>']) expect(planner).toContain(w);
  });
  it('the coordinator steps with swarm step in the background, asks the start questions once and starts in a clean session (C-03, C-10, D-12, D-13, J-21)', () => {
    const exec = runRef('execution');
    const lines = exec.split('\n');
    const step1 = lines.find(l => l.startsWith('1. **Start (once).**'))!;
    // The start questions are never asked again; only the bind's seat question (I4) is asked here.
    const seatQuestion = step1.slice(step1.indexOf('**Bind first**'), step1.indexOf('Run `FORGE swarm start'));
    expect(seatQuestion).toContain('AskUserQuestion');
    expect(step1.replace(seatQuestion, '')).not.toContain('AskUserQuestion');
    for (const w of ['launch.json', '/forge:run --execute <project>']) expect(step1).toContain(w);
    const integ = lines.find(l => l.trimStart().startsWith('- `integrate {task}`'))!;
    for (const w of ['run_in_background', '--out .forge/work/run/integrate-<T>.json']) expect(integ).toContain(w);
    expect(lines.find(l => l.startsWith('3. **Decide.**'))).toContain('references/step.md');
    const requests = exec.slice(exec.indexOf('### Requests during an execution'), exec.indexOf('### Unattended'));
    for (const w of ['FORGE swarm sleep 300 --mark', 'question note', 'AskUserQuestion']) expect(requests).toContain(w);
    const step = runRef('step');
    for (const w of ['FORGE swarm step --plan <plan> --db DB', '--out .forge/work/run/step.json', 'run_in_background', '--returned', '--versions .forge/work/run/versions.json',
      '`publish`', '`claim: true`', '`spawnImplementer`', '`spawnReviewers`', '`express`', '`validatorsRound`', '`readReport`', '`respawnReviewers`', '`reviewMissing`',
      '`accepted`', '`resumeImplementer`', '`freshImplementer`', '`redo`', '`ask`', '`blocked`', '`integrated`', '`error`', 'references/task-steps.md', 'references/convergence.md']) expect(step, w).toContain(w);
    const steps = runRef('task-steps').split('\n');
    for (const [n, out] of [['1. **brief**', '--out <WORK>/prep-1.json'], ['3. **validate**', '--out <WORK>/review-prep-<n>.json']] as const) {
      const l = steps.find(s => s.startsWith(n))!;
      expect(l, n).toContain('run_in_background');
      expect(l, n).toContain(out);
    }
    const large = runRef('large');
    for (const w of ['launch.json', '/forge:run --execute <project>', '/clear', '`mostlySerial`', 'FORGE swarm propose --plan <plan> --locale', 'keep the ids of tasks that stay']) expect(large, w).toContain(w);
    const run = read('plugins/forge/skills/run/SKILL.md');
    expect(run).toContain('/forge:run --execute <project>');
    expect(run).not.toContain('two or more briefs');
    expect(run).toContain('~<min> min');
    // An express review whose background validation gave no results: review-close exits 2 and the validators run again in the foreground.
    expect(runRef('convergence')).toContain('review-close exits 2');
    // Fix round 1: every turn ends with a marked sleep, the same rule in step.md and Execution step 6; wait 0 only after
    // integrated, back to a fresh list; the express command read again from review-plan.json; infinite cycles stay in the foreground.
    const wait6 = lines.find(l => l.startsWith('6. **Wait.**'))!;
    const wait5 = step.split('\n').find(l => l.startsWith('5. **Wait.**'))!;
    for (const s of [wait6, wait5]) for (const w of ['FORGE swarm sleep 300 --mark', 'run_in_background: true', '`swarm sleep 0` exits 2']) expect(s, w).toContain(w);
    expect(wait5).toContain('back to Execution step 2');
    for (const w of ['`validatorsCmd`', '`review-plan.json`', 'FORGE swarm stop']) expect(step, w).toContain(w);
    const decide = lines.find(l => l.startsWith('3. **Decide.**'))!;
    for (const w of ['/forge:infinite', 'no `swarm step`', 'timeout: 600000']) expect(decide, w).toContain(w);
    const inf = read('plugins/forge/skills/infinite/SKILL.md');
    expect(inf).toContain('no `swarm step`');
    expect(inf).not.toContain('instead of the merge question');
  });
  it('the coordinator gives the person\'s answers to the step, which also waits for verify, runs one at a time and reviews an adopted task (W1c final fix wave, group A)', () => {
    const step = runRef('step');
    for (const w of ['--ruling <T>:<answer>', '--ruling <T>:review', 'defer:F3[+F5]', '`busy`', '.forge/jobs/step.lock', '`verify-pending.json`', '`verify`']) expect(step, w).toContain(w);
    const conv = runRef('convergence');
    for (const w of ['--ruling <T>:fix', '--ruling <T>:defer:']) expect(conv, w).toContain(w);
    expect(runRef('task-steps')).toContain('--dir <WORK>/reviews-<n>-<round>');
    expect(runRef('execution')).toContain('it needs only that `brief-1.md` and its implementer');
  });
  it('the carries of wave 1c reach the text: safePath, the moved base file, swarm merge busy and route set --why-file (W1c final fix wave, group D)', () => {
    expect(runRef('decisions')).toContain('"safePath"');
    for (const ref of ['resuming', 'task-steps']) expect(runRef(ref), ref).toContain('base-<n>.json');
    const exec = runRef('execution');
    for (const w of ['`busy`', 'neither move the base nor re-run that baseline yourself']) expect(exec, w).toContain(w);
    expect(runRef('step')).toContain('attended, ask the person whether to stop the run');
    expect(runRef('step')).toContain('give the ruling again, corrected, on the next step');
    expect(read('plugins/forge/skills/infinite/SKILL.md')).toContain('`busy` → an integration is still merging');
    for (const f of ['plugins/forge/README.md', 'plugins/forge/README.es.md']) expect(read(f), f).toContain('[--why-file f]');
  });
  it('the step\'s fallback runs in the foreground, a twin is collected, launch.json outlives a failed start and --execute skips triage (W1c final fix wave, group E)', () => {
    const step = runRef('step').split('\n');
    const read2 = step.find(l => l.startsWith('2. **Read**'))!;
    for (const w of ['timeout: 600000', 'not active', 'Execution step 7']) expect(read2, w).toContain(w);
    expect(step.find(l => l.includes('`twin: true`'))).toContain('FORGE shadow collect --task');
    expect(runRef('execution').split('\n').find(l => l.startsWith('1. **Start (once).**'))).toContain('printed its `runId`');
    const run = read('plugins/forge/skills/run/SKILL.md').replace(/\r\n/g, '\n');
    expect(run.split('\n').find(l => l.startsWith('description:'))).toContain('/forge:run --execute <project>');
    expect(run.slice(run.indexOf('## 1. Triage'), run.indexOf('1. **Run it.**'))).toContain('`--execute <project>`');
  });
  it('READMEs describe wave 1c: swarm step, background jobs and the lock, a clean session, verify-close, setup, the routing probe and delicate', () => {
    for (const f of ['plugins/forge/README.md', 'plugins/forge/README.es.md']) {
      const md = read(f);
      for (const s of ['`swarm step --plan P --db DIR', '.forge/jobs/', 'validateJobs:', '.forge/execution.lock', 'merging.json', '`recovered`', '/forge:run --execute <project>',
        'launch.json', '`verify-close --task', '`setup [--cwd dir]`', '`route --task id (--path p | --text-file f', '--remember', '`profile`', '`mostlySerial`',
        'delicate: true', 'FORGE stats --json', '--out <file>']) expect(md, `${f}: ${s}`).toContain(s);
    }
    for (const f of ['plugins/waypoint/README.md', 'plugins/waypoint/README.es.md']) {
      const md = read(f);
      for (const s of ['delicate: true', '§0.5']) expect(md, `${f}: ${s}`).toContain(s);
      expect(md).not.toContain('--swarm');
    }
  });
  it('the skills bind the conversation to its seat, and work lets the CLI build its batches (wave 2a)', () => {
    const work = read('plugins/waypoint/skills/work/SKILL.md');
    for (const w of ['bind <plan> --via work --claude ${CLAUDE_SESSION_ID}', '--second-seat', '--takeover', '--resume', 'heartbeat --register', '--sessions DB/sessions',
      'waypoint.cjs" claim <plan> --db DB', '--recovered-from', '`solo`', 'waypoint.cjs" done <plan> --db DB', '--summary-file <SEAT>/summary.txt',
      'waypoint.cjs" block <plan> --db DB', '--why-file <SEAT>/block-reason.txt', '--busy-until', '--idle', 'waiting_on', '--base <MAIN_BRANCH>',
      'release <plan> --seat <SID> --free <T>', '<SEAT>/pending-commits.jsonl', '<SEAT>/seen.json', '<SEAT>/queue.jsonl', 'git status --porcelain --untracked-files=no',
      '## 7. Release', '**Arguments.**']) expect(work, w).toContain(w);
    for (const w of ['PREV_AGENT', 'busyUntil:', '.waypoint/<project>/pending-commits.jsonl', '.waypoint/<project>/queue.jsonl', 'git -C MAIN_REPO status',
      'git -C MAIN_REPO rev-parse', '{status: "blocked", blockedBy:', '{status: "done", doneAt: NOW', 'type: "started", sessionId: SID']) expect(work, w).not.toContain(w);
    const design = read('plugins/waypoint/skills/design/SKILL.md');
    for (const w of ['bind DESIGN --via design --claude ${CLAUDE_SESSION_ID}', '--second-seat', '## park', 'design-park DESIGN', 'release DESIGN --claude ${CLAUDE_SESSION_ID}']) expect(design, w).toContain(w);
    expect(runRef('execution')).toContain('bind <plan> --via forge-run --claude <CSID>');
    expect(read('plugins/forge/skills/member/SKILL.md')).toContain('bind <plan> --via forge-member --claude ${CLAUDE_SESSION_ID}');
    expect(read('plugins/forge/skills/infinite/SKILL.md')).toContain('bind <plan> --via forge-infinite --claude <CSID>');
  });
  it('the coordinator and the infinite run bind before they start, so a held seat never becomes the SID of a run (I4)', () => {
    const ex = runRef('execution');
    const bindAt = ex.indexOf('bind <plan> --via forge-run --claude <CSID>');
    expect(bindAt).toBeGreaterThan(-1);
    expect(bindAt).toBeLessThan(ex.indexOf('FORGE swarm start --project <project> --session <SID>'));
    // Exit 4 prints no sid: both rebind with --resume, so the run never goes on unbound.
    const exBind = ex.slice(bindAt, ex.indexOf('FORGE swarm start --project <project>'));
    for (const w of ['--second-seat', '--takeover', 'AskUserQuestion', 'Exit 4', '--resume']) expect(exBind, w).toContain(w);
    expect(exBind).not.toContain('say so in one line and go on');
    const inf = read('plugins/forge/skills/infinite/SKILL.md');
    const infBind = inf.indexOf('bind <plan> --via forge-infinite --claude <CSID>');
    expect(infBind).toBeGreaterThan(-1);
    expect(infBind).toBeLessThan(inf.indexOf('FORGE infinite start --cycles'));
    const infText = inf.slice(infBind, inf.indexOf('FORGE infinite start --cycles'));
    for (const w of ['--second-seat', 'Exit 4', '--resume']) expect(infText, w).toContain(w);
    expect(infText).not.toContain('say so in one line and go on');
  });
  it('READMEs describe wave 2a: seats and bindings, the roles, the new commands and SessionEnd', () => {
    for (const f of ['plugins/waypoint/README.md', 'plugins/waypoint/README.es.md']) {
      const md = read(f);
      // A `|` inside a table cell is escaped, or the row splits into extra cells.
      const row = md.split('\n').find(l => /^\| (Sessions|Sesiones) \|/.test(l)) ?? '';
      expect(row.split(/(?<!\\)\|/).length, `${f}: Sessions row cells`).toBe(4);
      for (const s of ['bound.json', 'seats/main-2/', '`bind <plan\\|design> --via v', '`release <plan>', '`claim`', '`done`', '`block --why-file f`', '`heartbeat [--register]',
        '`design-park <design.md>`', '**SessionEnd**', '/waypoint:work resume', '/waypoint:work release', 'waiting_on', 'info/exclude', 'last-head.json']) expect(md, `${f}: ${s}`).toContain(s);
    }
    for (const f of ['plugins/forge/README.md', 'plugins/forge/README.es.md']) {
      const md = read(f);
      for (const s of ['--via forge-run', 'info/exclude']) expect(md, `${f}: ${s}`).toContain(s);
    }
  });
  it("design resume, the band's [Resume] of a draft, binds with --resume and never launches the critic (audit-w2b 3)", () => {
    const design = read('plugins/waypoint/skills/design/SKILL.md');
    const subcommands = design.split('\n').find(l => l.startsWith('The first token of the arguments is the subcommand:')) ?? '';
    expect(subcommands).toContain('`resume`');
    const at = design.indexOf('\n## resume\n');
    expect(at).toBeGreaterThan(-1);
    const section = design.slice(at + 1, design.indexOf('\n## ', at + 1));
    for (const w of ['waypoint bind DESIGN --via design --resume --claude ${CLAUDE_SESSION_ID}', '--second-seat', 'waypoint design-gate DESIGN']) expect(section, w).toContain(w);
    for (const w of ['design-critic', 'critique-check', 'design-snapshot']) expect(section, w).not.toContain(w);
  });
  it('READMEs describe wave 2b: the band by role, its notices and the commands their buttons run', () => {
    for (const f of ['plugins/waypoint/README.md', 'plugins/waypoint/README.es.md']) {
      const md = read(f);
      for (const s of ['viewer', '`notice`', '$.session.id()', '$.store', '/waypoint:work resume', '/waypoint:work release T019', '/forge:run --join', '/forge:run --resume', '/forge:stop'])
        expect(md, `${f}: ${s}`).toContain(s);
    }
  });
  it('forge stop prints what to release, the stop skill releases each task once, and step 7 also frees stopped tasks (K2-02)', () => {
    const stop = read('plugins/forge/skills/stop/SKILL.md');
    for (const w of ['`release`', '`members`', '`write`', 'if_version', 'FORGE swarm close', '{closed, runId, stopReason, release, members, sessions}']) expect(stop).toContain(w);
    expect(stop).not.toContain('.forge/members/');
    const step7 = runRef('execution').split('\n').find(l => l.startsWith('7. **End.**'))!;
    expect(step7).toContain('`running` or `stopped` with `executor` `subagents`');
  });
  it('the ephemeral run says its tick closes it when it finishes (wave 0 handoff)', () => {
    expect(runRef('ephemeral')).toContain('`closedBy: merge`');
  });
  it('the task steps, the ephemeral run and the member brief a resumed task with its earlier commits (D-02)', () => {
    for (const s of [runRef('task-steps'), runRef('ephemeral'), read('plugins/forge/skills/member/SKILL.md')]) {
      for (const w of ['`prior`', 'prior.json', '--prior-file']) expect(s).toContain(w);
    }
  });
  it('the skills take a task folder from what the CLI prints: swarm start gets the plan, worktree and adopt print work, the step names its own dirs (D-08)', () => {
    const exec = runRef('execution');
    expect(exec).toContain('FORGE swarm start --project <project> --session <SID> --hook-session <CSID> --plan <plan>');
    expect(exec).toContain('`FORGE swarm worktree <T>` → `{worktree, branch, base, work, resumed, prior}`');
    expect(exec).toContain('`FORGE swarm retry <T> --adopt` → `{task, adopted, previous, worktree, branch, work}`');
    expect(runRef('manual-member')).toContain('`FORGE swarm worktree <T> --member <SID>` → `{worktree, branch, base, work, setup, resumed, prior}`');
    expect(runRef('ephemeral')).toContain('`FORGE swarm worktree <T>` → `{worktree, branch, base, work, setup, resumed, prior}`');
    expect(read('plugins/forge/skills/member/SKILL.md')).toContain('`FORGE swarm worktree <T> --member <SID>` → `{worktree, branch, base, work, resumed, prior}`');
    // Under swarm step the coordinator never sees swarm worktree's work: verify-plan's --dir is the `out` of the step's spawn entries.
    const spawnReviewers = runRef('step').split('\n').find(l => l.includes('`spawnReviewers` ('))!;
    expect(spawnReviewers).toMatch(/`--dir` [^\n]*`inputs\.out`/);
    expect(runRef('step')).toContain('`spawnImplementer`\'s `brief`');
    // Where no swarm worktree output is at hand, <WORK> is still a field the CLI printed: relaunch's `work`, swarm status's `work`.
    const relaunch = exec.split('\n').find(l => l.includes('`relaunch {task}`'))!;
    expect(relaunch).toMatch(/`<WORK>\/handover\.md` \([^)]*`work`/);
    const end = exec.split('\n').find(l => l.startsWith('7. **End.**'))!;
    expect(end).toMatch(/`<WORK>\/deferred\.json` \([^)]*`work`[^)]*`FORGE swarm status`/);
    expect(runRef('resuming')).toMatch(/`<WORK>`[^\n]*`work`[^\n]*`FORGE swarm status`/);
    expect(runRef('decisions')).toContain('`.forge/work/<id>` outside an execution');
  });
  it('the end of an execution offers swarm cleanup, and records it in auto (D-03)', () => {
    const exec = runRef('execution');
    for (const w of ['FORGE swarm cleanup --dry-run', 'FORGE swarm cleanup', 'branch-discard', '`kept`']) expect(exec).toContain(w);
    // Final review 8: an ephemeral run's end offers it too (its task worktrees would refuse a later run's repeated id).
    const ephEnd = runRef('ephemeral').split('\n').find(l => l.startsWith('4. **End.**'))!;
    for (const w of ['**Cleanup.**', 'FORGE swarm cleanup --dry-run', 'FORGE swarm cleanup', 'branch-discard', '`kept`']) expect(ephEnd, w).toContain(w);
  });
  it('a resumed task whose earlier attempt has more commits than prior lists passes their count to the brief (carry 3)', () => {
    for (const s of [runRef('task-steps'), runRef('ephemeral')]) for (const w of ['`priorTotal`', '--prior-total']) expect(s, w).toContain(w);
  });
  it('/forge:run --resume is a section of references/resuming.md, and SKILL.md names it in its Resuming line (2b handoff)', () => {
    const res = runRef('resuming');
    for (const w of ['## /forge:run --resume', 'FORGE swarm status', '`closedAt`', '`replaced`', '/forge:stop', '--resume']) expect(res).toContain(w);
    expect(res).not.toContain('${CLAUDE_');
    const line = read('plugins/forge/skills/run/SKILL.md').split('\n').find(l => l.startsWith('Read `references/resuming.md`'))!;
    expect(line).toContain('`/forge:run --resume`');
    // It binds first, as execution.md step 1 does: a conversation resumed after /clear holds no binding. An ephemeral run binds at its start too.
    expect(res.slice(res.indexOf('## /forge:run --resume'))).toContain('bind <plan> --via forge-run --claude <CSID>');
    expect(runRef('ephemeral').split('\n').find(l => l.startsWith('2. **Start.**'))).toContain('bind <plan> --via forge-run --claude <CSID>');
    // Final review 1: an ended run whose coordinator is still on it is left to that conversation (swarm status's coordinator).
    const step4 = res.slice(res.indexOf('## /forge:run --resume')).split('\n').find(l => l.startsWith('4. '))!;
    for (const w of ['`coordinator.liveness`', '`hookSession`', '<CSID>', 'claude --resume <hookSession>']) expect(step4, w).toContain(w);
  });
  it('READMEs describe wave 2c: cleanup, stop from any worktree, routes per session, work folders by project and resumed tasks', () => {
    for (const f of ['plugins/forge/README.md', 'plugins/forge/README.es.md']) {
      const md = read(f);
      for (const s of ['`swarm cleanup [--dry-run]`', '`/forge:stop`', '.forge/route/<session>.json', '.forge/work/<project>/<T>/', '`prior`', '--prior-file', '`stopped`', '`unbound: true`'])
        expect(md, `${f}: ${s}`).toContain(s);
    }
    for (const f of ['plugins/waypoint/README.md', 'plugins/waypoint/README.es.md']) expect(read(f), f).toContain(f.endsWith('es.md') ? 'sin zonas' : 'without zones');
  });
  it('forge READMEs name the CLI fields of wave 2c: the handover by project, cleanup\'s unmerged ledger, stop\'s running jobs and /forge:run --resume', () => {
    for (const f of ['plugins/forge/README.md', 'plugins/forge/README.es.md']) {
      const md = read(f);
      for (const s of ['.forge/work/<project>/<T>/handover.md', '`unmerged ledger`', '{main, run, execution, release, members, running}', '/forge:run --resume'])
        expect(md, `${f}: ${s}`).toContain(s);
      expect(md, f).not.toContain('`.forge/work/<T>/handover.md`');
    }
  });
  it("forge READMEs pin the CLI contracts of wave 2c's fix waves: close's sessions, relaunch's work, the /clear carry, a route without a session, start's plan, status's coordinator, cleanup's prune (carry 11, final review)", () => {
    for (const f of ['plugins/forge/README.md', 'plugins/forge/README.es.md']) {
      const md = read(f);
      const line = (start: string) => md.split('\n').find(l => l.startsWith(start)) ?? '';
      expect(line('- `swarm close`'), `${f}: close`).toContain('`sessions`');
      expect(line('- `swarm relaunch'), `${f}: relaunch`).toContain('`work`');
      expect(md.split('\n').find(l => l.includes('`.forge/route/<session>.json`') && l.includes('`/clear`')), `${f}: carry`).toMatch(/\b2 min/);
      for (const cmd of ['- `route set', '- `route stage']) expect(line(cmd), `${f}: ${cmd}`).toMatch(/CLAUDE_CODE_SESSION_ID[^\n]*(code|código) 2/);
      expect(line('- `swarm start'), `${f}: start`).toContain('[--plan F]');
      expect(line('- `swarm status'), `${f}: status`).toContain('`coordinator: {hookSession, liveness}`');
      for (const w of ['`prunable`', '`pruned`']) expect(line('- `swarm cleanup'), `${f}: ${w}`).toContain(w);
      expect(line('- `swarm worktree'), `${f}: worktree`).toContain('`priorTotal`');
      expect(line('- `brief --plan'), `${f}: brief`).toContain('--prior-total N');
      // R5: the set-aside folder is named after the run that sets the rounds aside, not the run they came from.
      expect(line('- `prep --task'), `${f}: prep`).toContain(f.endsWith('es.md') ? 'apartadas por `<runId>`' : 'set aside by `<runId>`');
      expect(md, f).not.toContain('.forge/work/<id>/');
      expect(md, f).not.toContain('work/<task-id>/');
      expect(md, f).not.toContain('work/<id-de-tarea>/');
    }
  });

  it('the task line is a contract of the task steps, the run member and the branch review (E-02)', () => {
    for (const f of ['plugins/forge/skills/run/references/task-steps.md', 'plugins/forge/skills/member/SKILL.md', 'plugins/forge/skills/review/SKILL.md']) {
      expect(read(f), f).toContain('forge-task:');
    }
    expect(read('plugins/forge/skills/run/references/task-steps.md')).toContain('`taskLine`');
  });

  it('READMEs describe wave 3a: the status per task, the task line, the tasks in progress and the classic hooks', () => {
    for (const f of ['plugins/forge/README.md', 'plugins/forge/README.es.md']) {
      const md = read(f);
      for (const s of ['.forge/status/<key>.json', '`taskLine`', 'forge-task:', 'taskStartedAt']) expect(md, `${f}: ${s}`).toContain(s);
    }
    expect(read('plugins/lens/README.md')).toContain('Tasks in progress');
    expect(read('plugins/lens/README.es.md')).toContain('Tareas en curso');
    for (const f of ['plugins/lens/README.md', 'plugins/lens/README.es.md']) {
      for (const s of ['.forge/status/', '.forge/jobs/', '`SubagentStart`', '`TaskCreated`', 'forge-task:']) expect(read(f), `${f}: ${s}`).toContain(s);
    }
  });
  it('READMEs describe wave 3b: the band letters and the keyboard outside fullscreen, the photo, the status line', () => {
    for (const f of ['plugins/waypoint/README.md', 'plugins/waypoint/README.es.md']) {
      const md = read(f);
      for (const s of ['ctrl+x tab', '`n`', '`t`', '`x`', '`m`', '⋯', '▲', '✎', "{ plugin: 'waypoint', key: 'drawn' }"]) expect(md, `${f}: ${s}`).toContain(s);
    }
    for (const f of ['plugins/lens/README.md', 'plugins/lens/README.es.md']) {
      const md = read(f);
      for (const s of ['/lens live', 'ctrl+x tab', '`p`', '$.ui.status', 'CommandOutput', '↓']) expect(md, `${f}: ${s}`).toContain(s);
    }
    expect(read('plugins/lens/README.md')).toContain('/lens photo');
    expect(read('plugins/lens/README.es.md')).toContain('/lens foto');
    // Carry 10: the hint's tail is a contract text in each language, as the band draws it.
    for (const plugin of ['waypoint', 'lens']) {
      expect(read(`plugins/${plugin}/README.md`), `${plugin} en`).toContain('ctrl+x tab · band');
      expect(read(`plugins/${plugin}/README.es.md`), `${plugin} es`).toContain('ctrl+x tab · banda');
    }
  });
});
