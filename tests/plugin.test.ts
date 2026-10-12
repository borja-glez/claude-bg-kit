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
    expect(p).toMatchObject({ name: 'lens', version: '0.5.3', types: './types/index.d.ts' });
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
      '§3', '--path large', 'review-perf', 'final review', 'report-<n>.txt', '"base"',
      'FORGE waypoint-cli', 'run.json', 'final-validators.json', 'FORGE verdict --task <project>-final', 'final-fix.txt', 'mkdir -p .forge/work/T', 'Commit title prefix', 'blocked path', 'first paragraph', '`start_prompt`']) expect(md).toContain(w);
    expect(md).not.toContain('report-<n>.md');
  });
  it('forge Large: approve steps, run.json once, lease, final re-review inputs, start_prompt', () => {
    const md = read('plugins/forge/skills/run/SKILL.md');
    for (const w of ['steps 1–3', 'every agent spawned in that step has returned', '`/waypoint:launch` adds the forge suffix', 'only if that file does not exist', 'busyUntil: <NOW + 90 min>', 'busyUntil: {"__delete__": true}',
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
  it('versions: forge 0.5.4, waypoint 0.10.0', () => {
    expect(JSON.parse(read('plugins/forge/.claude-plugin/plugin.json')).version).toBe('0.5.4');
    expect(JSON.parse(read('plugins/waypoint/.claude-plugin/plugin.json')).version).toBe('0.10.0');
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
  it('forge manifest depends on waypoint ^0.10.0 and ships its CLI', () => {
    const p = JSON.parse(read('plugins/forge/.claude-plugin/plugin.json'));
    expect(p).toMatchObject({ name: 'forge', version: '0.5.4', dependencies: [{ name: 'waypoint', version: '^0.10.0' }] });
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
      '`failures` of every validator with `ok: false` in `validators-<n>.json`', 'FORGE last --task <id>-<n>']) expect(md).toContain(w);
  });
  it('the plan skill declares assets only with evidence upload and warns about public sharing', () => {
    const md = read('plugins/waypoint/skills/plan/SKILL.md');
    expect(md).toContain('"assets": {}');
    expect(md).toMatch(/evidence: local/);
    expect(md).toMatch(/organization-internal|no longer be shared publicly/);
  });
});
