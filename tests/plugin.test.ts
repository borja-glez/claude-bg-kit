import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

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
    expect(p).toMatchObject({ name: 'lens', version: '0.10.0', types: './types/index.d.ts' });
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
  it('launch skill: busyUntil rule, --merge, --forge', () => {
    const md = read('plugins/waypoint/skills/launch/SKILL.md');
    for (const w of ['busyUntil', '--merge', '--forge', '--no-forge', 'exactly as returned']) expect(md).toContain(w);
  });
  it('work skill documents the multi-session protocol', () => {
    const md = read('plugins/waypoint/skills/work/SKILL.md');
    for (const w of ['SendMessage', 'ListAgents', ' inbox ', ' recover ', ' conflicts ', 'escalation', 'seen.json', 'MAIN_REPO', 'yields', '{heartbeatAt: NOW, status: "active"}']) expect(md).toContain(w);
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
  it('hooks module wires SessionStart, PostToolUse and Stop', () => {
    const h = JSON.parse(read('plugins/waypoint/hooks/hooks.json'));
    expect(h.hooks.SessionStart).toBeDefined();
    expect(h.hooks.PostToolUse).toBeDefined();
    expect(h.hooks.Stop).toBeDefined();
    expect(h.modules).toEqual(['./register.js']);
    expect(existsSync(new URL('../plugins/waypoint/hooks/register.js', import.meta.url))).toBe(true);
  });
  it('README documents the band, hooks and recommended permissions', () => {
    const md = read('plugins/waypoint/README.md');
    for (const w of ['## The band', '## Hooks', '## Permissions', 'pending-commits.jsonl', 'Bash(node *waypoint.cjs*)', 'Bash(git *)', 'ArtifactData']) expect(md).toContain(w);
  });
  it('forge run skill drives the Large path through waypoint', () => {
    const md = read('plugins/forge/skills/run/SKILL.md');
    for (const w of ['forge-planner', 'FORGE brief --plan', 'FORGE triage --plan', '/waypoint:design', '/waypoint:plan', '/waypoint:work',
      '--path large', 'review-perf', 'final review', 'report-<n>.txt', '"base"',
      'FORGE waypoint-cli', 'run.json', 'final-validators.json', 'FORGE verdict --task <project>-final', 'final-fix.txt', 'mkdir -p .forge/work/T', 'Commit title prefix', 'blocked path', '`start_prompt`']) expect(md).toContain(w);
    expect(md).not.toContain('report-<n>.md');
  });
  it('forge Large: approve steps, run.json once, lease, final re-review inputs, start_prompt', () => {
    const md = read('plugins/forge/skills/run/SKILL.md');
    for (const w of ['steps 1–3', '`/waypoint:launch` adds the forge suffix', 'only if that file does not exist',
      'final-validators-2.json', 'final-2.patch', '--dir .forge/work/<project>/final-2 --validators .forge/work/<project>/final-validators-2.json',
      '`redo` is treated as `fix`', '--no-merged', 'forge drives this session (forge:run Large loop)', 'design-page',
      'keeps its verdict and still scores', 'FORGE log --kind ruling --task <id>-<n>']) expect(md).toContain(w);
    expect(md).not.toContain('At the start of a Large run write');
    expect(read('plugins/forge/README.md')).toContain('keeps its verdict and still scores');
  });
  it('waypoint work skill hands §3 to forge when forge drives the session', () => {
    const md = read('plugins/waypoint/skills/work/SKILL.md');
    expect(md).toMatch(/forge:run.*Large/s);
    expect(md).toContain('only the first paragraph');
    expect(md).toContain("the session's initial prompt says forge drives it");
    expect(md).toContain('busyUntil');
    expect(md).toContain('90 minutes');
  });
  it('waypoint design approve stops before planning when forge drives the session', () => {
    expect(read('plugins/waypoint/skills/design/SKILL.md')).toContain('stop after step 3: `/forge:run` continues with `forge-planner`');
  });
  it('the run skill and every implementer edit with Edit/Write, never sed -i', () => {
    expect(read('plugins/forge/skills/run/SKILL.md')).toMatch(/Change the project's files with the Edit and Write tools, never with `sed -i`.*forge's own work files.*is fine/s);
    for (const a of ['mech', 'impl', 'impl-light', 'impl-heavy', 'fable']) {
      expect(read(`plugins/forge/agents/forge-${a}.md`)).toMatch(/Change the project's files with the Edit and Write tools, never with `sed -i`.*forge's own work files.*is fine/s);
    }
  });
  it('run skill: an ephemeral run is published on the roadmap as loose tasks when there is one', () => {
    const md = read('plugins/forge/skills/run/SKILL.md');
    for (const w of ['kind: "plan", loose: []', '**Ephemeral run.**', 'kind: "ephemeral"', '.forge/loose.json', '`queued`', '`accepted` → `running`',
      'never `plan.yaml` nor `state/T`', 'No roadmap → publish nothing', 'active: false']) {
      expect(md).toContain(w);
    }
  });
  it('run skill: model by size, ephemeral execution, parallel Medium briefs and the member conflict fix round', () => {
    const md = read('plugins/forge/skills/run/SKILL.md');
    for (const w of ['implementer.agent', '--batch', '**always delegated**', '10 lines or fewer', '### Ephemeral execution', '--kind ephemeral',
      '.forge/work/loose-tasks.json', 'no `--plan` nor `--db`', '**Briefs in parallel.**', 'FORGE swarm retry <T> --adopt', 'integrated into the current branch',
      'step 5 is its **Ephemeral run.** paragraph']) {
      expect(md).toContain(w);
    }
    expect(md).not.toContain('there is no roadmap (no ArtifactData');
    expect(md).not.toContain('Implement yourself, or spawn the `impl-light` agent');
    expect(md).not.toContain('A `conflict` on such a task is not retried');
  });
  it('the run skill logs done at the end and never commits unrelated changes on its own', () => {
    const md = read('plugins/forge/skills/run/SKILL.md');
    expect(md).toContain('7. Log the phase `done`');
    expect(md).toContain('5. Log the phase `done`, then report');
    expect(md).toMatch(/ask the user whether to commit, stash or leave them before you go on; never commit, stash or discard them on your own/);
  });
  it('the run skill tells the session when to raise a light path to Medium', () => {
    const md = read('plugins/forge/skills/run/SKILL.md');
    expect(md).toContain('**raise to at least Medium**');
    expect(md).toMatch(/changes behaviour callers rely on/);
    expect(md).toMatch(/bundles several independent changes/);
    expect(md).toMatch(/adds new behaviour with its tests/);
  });
  it('versions: forge 0.10.0, waypoint 0.15.0', () => {
    const forge = JSON.parse(read('plugins/forge/.claude-plugin/plugin.json'));
    expect(forge.version).toBe('0.10.0');
    expect(forge.dependencies).toEqual([{ name: 'waypoint', version: '^0.15.0' }]);
    expect(JSON.parse(read('plugins/waypoint/.claude-plugin/plugin.json')).version).toBe('0.15.0');
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
  it('decision skills: WP defined, the md locale and place, revert always written, revert rules', () => {
    const run = read('plugins/forge/skills/run/SKILL.md');
    const dec = run.slice(run.indexOf('## Decisions'), run.indexOf('## 1. Triage'));
    for (const w of ['`WP` = `FORGE waypoint-cli`', '--locale <es|en>', 'Always write `revert`', '--cwd .claude/worktrees/run', 'before `FORGE swarm merge`']) expect(dec).toContain(w);
    expect(run).toMatch(/Before `FORGE swarm merge`, without a roadmap, write and commit the run's decisions file/);
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
  it('forge manifest depends on waypoint ^0.15.0 and ships its CLI', () => {
    const p = JSON.parse(read('plugins/forge/.claude-plugin/plugin.json'));
    expect(p).toMatchObject({ name: 'forge', version: '0.10.0', dependencies: [{ name: 'waypoint', version: '^0.15.0' }] });
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
    for (const w of ['state/T', 'forge: {path', 'proposals pull', 'TV']) expect(md).toContain(w);
  });
  it('forge agents fix model, effort and maxTurns', () => {
    const expected: Record<string, [string, string | null]> = {
      'forge-impl-heavy': ['opus', 'xhigh'], 'forge-impl': ['opus', 'medium'], 'forge-impl-light': ['sonnet', null], 'forge-mech': ['haiku', null],
      'forge-review-correctness': ['opus', 'xhigh'], 'forge-review-security': ['opus', 'xhigh'], 'forge-review-perf': ['opus', 'xhigh'], 'forge-fable': ['fable', null],
      'forge-planner': ['opus', 'xhigh'],
    };
    for (const [name, [model, effort]] of Object.entries(expected)) {
      const md = read(`plugins/forge/agents/${name}.md`);
      const head = md.split(/\r?\n---\r?\n/)[0];
      expect(head).toMatch(new RegExp(`^---\r?\nname: ${name}\r?\n`));
      expect(head).toMatch(new RegExp(`\nmodel: ${model}\r?(\n|$)`));
      if (effort) expect(head).toMatch(new RegExp(`\neffort: ${effort}\r?(\n|$)`));
      expect(head).toMatch(/\nmaxTurns: \d+/);
      expect(head).toMatch(/\ndescription: .+/);
    }
    expect(read('plugins/forge/agents/forge-fable.md')).toMatch(/only when the user explicitly asks/i);
  });
  it('forge planner writes a plan waypoint accepts, implementers report in .txt', () => {
    const planner = read('plugins/forge/agents/forge-planner.md');
    for (const w of ['design.md', 'status: approved', 'plan.yaml', 'node "<waypoint.cjs>" validate', 'done_when', 'zones', 'never renumber']) expect(planner).toContain(w);
    for (const a of ['forge-impl-heavy', 'forge-impl', 'forge-impl-light', 'forge-mech', 'forge-fable']) {
      const md = read(`plugins/forge/agents/${a}.md`);
      expect(md).toContain('.txt');
      expect(md).toMatch(/also (put|include) the report in your reply/i);
      expect(md).toContain('Commit title prefix');
    }
    expect(read('plugins/forge/agents/forge-review-correctness.md')).toMatch(/final review/i);
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
    for (const s of ['FORGE verify-plan', 'forge-verify', 'FORGE surfaces learn', 'FORGE local set surfaces.', 'verify-skip', 'FORGE verify-cleanup', '--path', '`new`', 'asset: true', 'permission: changed']) expect(md).toContain(s);
    expect(md).toMatch(/explains how to check something[\s\S]*\.forge\/verify\/<name>\.md/);
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
    for (const w of ['FORGE triage', 'FORGE validate', 'FORGE verdict', 'FORGE round', 'FORGE agents', 'FORGE log', 'FORGE last',
      '## Trivial', '## Small', '## Medium', '## Large', 'ratchet', 'breaker', 'stalled', 'fresh-stronger', '/waypoint:design', 'never push', 'forge-fable', '--text-file', '--data-file', '<id>-<n>', 'BASE=$(git rev-parse HEAD)', 'absolute path',
      'tier ladder', '`mech` -> `impl-light` -> `impl` -> `impl-heavy`', 'git revert --no-edit $BASE..HEAD', '`invalid: true`',
      '`failures` of every validator with `ok: false` and no `preexisting` in `validators-<n>.json`', '--baseline .forge/work/<id>/baseline-<n>.json', '--base-run', 'FORGE last --task <id>-<n>']) expect(md).toContain(w);
  });
  it('forge run skill: Execution section with the task state machine and the mode choice', () => {
    const md = read('plugins/forge/skills/run/SKILL.md');
    for (const w of ['## Execution', 'FORGE swarm propose --plan', 'FORGE swarm worktree <T>', 'FORGE swarm task <T> --stage', 'FORGE swarm integrate <T>', 'FORGE swarm merge',
      '--merge-on-finish', '.claude/worktrees/run', 'leaseUntil', 'state/T.exec', 'meta/run', 'two lines', 'never cd']) expect(md).toContain(w);
    expect(md).not.toContain('## Swarm');
    expect(md).not.toContain('Run `/waypoint:work` and follow it');
    expect(md).not.toContain('Then continue `/waypoint:work` at §4');
    for (const w of ['git -C .claude/worktrees/run diff', '--no-merged forge/run-', '--cwd .claude/worktrees/run']) expect(md).toContain(w);
    expect(read('plugins/forge/skills/infinite/SKILL.md')).not.toContain("the tick's `progress`");
    const inf = read('plugins/forge/skills/infinite/SKILL.md');
    expect(inf).toContain('Execution step');
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
    const md = read('plugins/forge/skills/run/SKILL.md');
    const inf = read('plugins/forge/skills/infinite/SKILL.md');
    for (const s of [md, inf]) expect(s).toContain('any other `wait 0` is treated as `wait 300`');
    expect(md).toContain('FORGE swarm task <T> --drop');
    expect(md).not.toContain('`FORGE swarm retry <T>` later');
    expect(md).toContain('git -C <worktree> diff forge/run-<project>...HEAD');
    expect(md).toContain('FORGE swarm task <T> --lease <NOW + 10 min>');
    expect(md).toContain('commit-info <sha>');
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
    for (const s of ['## Decisions', 'FORGE decision add --data-file <f>', 'FORGE decision md --scope <scope>', 'FORGE decision list --auto --task <id>',
      '«Decisiones automáticas»', '"type": "git-revert"', '"type": "none"', 'decision: {point, what, chosen, alternatives, why, revert, auto: true}']) expect(run).toContain(s);
    expect(run).not.toContain('FORGE log --kind decision');
    expect(run.match(/automatic decisions/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    const inf = read('plugins/forge/skills/infinite/SKILL.md');
    expect(inf).toContain('FORGE decision add --data-file <f>');
    expect(inf).toContain('FORGE decision list --auto --since');
    expect(inf).not.toContain('FORGE log --kind decision');
  });
  it('decisions are only those taken without the user, and the Large report lists both the task and the run', () => {
    const run = read('plugins/forge/skills/run/SKILL.md');
    const sec = run.slice(run.indexOf('## Decisions'), run.indexOf('## 1. Triage'));
    expect(sec).toContain('Attended rulings stay `FORGE log --kind ruling`');
    expect(sec).not.toContain('a ruling that lets the work go on');
    expect(run).toContain('the automatic decisions (`## Decisions`, both `--task <project>` and `--run <runId>`)');
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
    for (const s of ['### Run member', '### Requests during an execution', '### Unattended', 'list the background sessions with ListAgents',
      'FORGE swarm relaunch', 'FORGE swarm nudge', 'The new session reads .forge/work/<T>/handover.md first', 'FORGE swarm report <T> --session <SID>',
      'A run member never integrates and never merges', 'An unattended execution never stops to ask', 'FORGE decision add --data-file',
      'FORGE swarm takeover --session <SID> --db DB', '--mode sessions']) expect(runMd).toContain(s);
    expect(runMd).not.toContain('Sessions mode arrives in a later version');
    expect(runMd).toContain('### Manual member');
    expect(runMd).toContain('FORGE swarm join --session <SID> --role manual');
    expect(runMd).toContain('FORGE swarm next --plan <plan> --db DB --session <SID>');
    expect(read('plugins/waypoint/skills/work/SKILL.md')).toContain('join the execution as a manual member: invoke /forge:run --join and follow its ### Manual member');
    expect(read('plugins/forge/skills/stop/SKILL.md')).toContain('[forge run] stop after your current step');
  });
  it('members join with their hook session id; sessions starts set the worktree up first; stop reaches only named members of the run', () => {
    const runMd = read('plugins/forge/skills/run/SKILL.md');
    expect(runMd).toContain('FORGE swarm join --session <SID> --role executor --task <T> --name wp-<project>-<T> --hook-session ${CLAUDE_SESSION_ID}');
    expect(runMd).toContain('FORGE swarm join --session <SID> --role manual --hook-session ${CLAUDE_SESSION_ID}');
    expect(runMd).toContain('`start {task}` in mode `sessions`: first `FORGE swarm worktree <T>`');
    expect(runMd).toMatch(/5\. \*\*Finish\.\*\* Commits on `task\/<T>`[^\n]*FORGE swarm report <T> --session <SID> --stage verdict --status accepted --no-agent/);
    expect(runMd).toContain('it never edits task code itself (except direct requests, below)');
    expect(runMd).not.toContain('on `integrated` only');
    expect(runMd).toContain('(`/waypoint:plan`)');
    const stop = read('plugins/forge/skills/stop/SKILL.md');
    expect(stop).toContain('whose `runId` is the `runId` remembered in step 1');
    expect(stop).toContain('do not report it');
    expect(stop).toContain('whose `name` is null');
    expect(read('plugins/waypoint/skills/work/SKILL.md')).toContain('no `~ : @ +`');
    for (const f of ['plugins/forge/README.md', 'plugins/forge/README.es.md']) {
      const md = read(f);
      for (const s of ['`swarm relaunch <task> --plan p`', '`swarm nudge <task> [--plan p]`', '`swarm join --session SID --role executor|manual [--task T] [--name N] [--hook-session ID]`',
        '--stage S [--status running|accepted|blocked] [--agent A | --no-agent] [--round N] [--lease ISO]`', '`swarm takeover --session SID [--db dir]`']) {
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
});
