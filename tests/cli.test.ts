import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, copyFileSync, existsSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { run, isCommitCommand, type Io } from '../src/cli/run.js';
import { makesCommits, readForge } from '../src/cli/hooks.js';
import { describeViewer } from '../src/lib/viewer-role.js';
import { parsePlan } from '../src/lib/plan.js';
import { launchRun, HERDR_TEMPLATE } from '../src/lib/launcher.js';
import { buildDocs, planHash } from '../src/lib/sync.js';
import { parseDesign } from '../src/lib/design.js';

const FIXTURE = new URL('./fixtures/plan.yaml', import.meta.url);
let dir: string;
let io: Io;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'wp-'));
  copyFileSync(FIXTURE, path.join(dir, 'plan.yaml'));
  const assets = path.join(dir, 'assets');
  mkdirSync(assets);
  writeFileSync(path.join(assets, 'roadmap.template.html'), '<title>__TITLE__</title><script type="application/json" id="wp-snapshot">__SNAPSHOT__</script>');
  io = { cwd: dir, now: () => new Date('2026-10-11T10:00:00.000Z'), rand: () => 0, assetsDir: assets };
});

describe('waypoint CLI', () => {
  it('clean-cache deletes only the given collection cache', () => {
    const base = path.join(dir, '.waypoint', 'demo-shop', 'dbcache');
    mkdirSync(path.join(base, 'state'), { recursive: true });
    mkdirSync(path.join(base, 'meta'), { recursive: true });
    writeFileSync(path.join(base, 'state', 'T001.json'), '{}');
    const r = run(['clean-cache', 'plan.yaml', 'state'], io);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(path.join(base, 'state'));
    expect(existsSync(path.join(base, 'state'))).toBe(false);
    expect(existsSync(path.join(base, 'meta'))).toBe(true);
    expect(run(['clean-cache', 'plan.yaml', 'state'], io).code).toBe(0);
  });

  it('clean-cache rejects unsafe collection names', () => {
    for (const c of ['../x', 'a/b', '', '..']) expect(run(['clean-cache', 'plan.yaml', c], io).code).toBe(2);
    expect(run(['clean-cache', 'plan.yaml'], io).code).toBe(2);
  });

  it('hash prints the plan hash', () => {
    const r = run(['hash', 'plan.yaml'], io);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(`${planHash(parsePlan(readFileSync(FIXTURE, 'utf8')))}
`);
  });

  it('next flags unblock when the task is currently blocked', () => {
    mkdirSync(path.join(dir, 'st'));
    writeFileSync(path.join(dir, 'st', 'T001.json'), JSON.stringify({ status: 'done' }));
    writeFileSync(path.join(dir, 'st', 'T002.json'), JSON.stringify({ status: 'blocked', blockedBy: ['T001'] }));
    const r = JSON.parse(run(['next', 'plan.yaml', '--states', 'st', '--session', 'main'], io).stdout);
    expect(r.task.id).toBe('T002');
    expect(r.unblock).toBe(true);
    const fresh = JSON.parse(run(['next', 'plan.yaml', '--session', 'main'], io).stdout);
    expect(fresh.unblock).toBeUndefined();
  });

  it('validate reports ok and fails with all issues', () => {
    expect(run(['validate', 'plan.yaml'], io)).toMatchObject({ code: 0, stdout: 'ok: 6 tasks, 2 phases, 2 tracks\nwarning: 1 task(s) without zones run alone in a forge execution: T006\n' });
    // With zones on every task there is no warning.
    writeFileSync(path.join(dir, 'zoned.yaml'), `${readFileSync(FIXTURE, 'utf8').trimEnd()}\n    zones: ["src/mail/**"]\n`);
    expect(run(['validate', 'zoned.yaml'], io)).toMatchObject({ code: 0, stdout: 'ok: 6 tasks, 2 phases, 2 tracks\n' });
    writeFileSync(path.join(dir, 'bad.yaml'), readFileSync(FIXTURE, 'utf8').replace('depends_on: [T004]', 'depends_on: [T404]'));
    const r = run(['validate', 'bad.yaml'], io);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('task T006: unknown dependency T404');
  });

  it('page embeds a safe snapshot and the title', () => {
    const planPath = path.join(dir, 'plan.yaml');
    writeFileSync(planPath, readFileSync(planPath, 'utf8').replace('title: Esquema de pedidos', 'title: "Esquema </script><b>x"'));
    const r = run(['page', 'plan.yaml', '--out', '.waypoint/roadmap.html'], io);
    expect(r.code).toBe(0);
    const html = readFileSync(path.join(dir, '.waypoint/roadmap.html'), 'utf8');
    expect(html).toContain('<title>demo-shop Roadmap</title>');
    expect(html).not.toContain('</script><b>');
    const json = html.match(/id="wp-snapshot">(.*?)<\/script>/)![1];
    expect(json).not.toContain('<');
    const parsed = JSON.parse(json);
    expect(parsed.meta.name).toBe('demo-shop');
    expect(parsed.phases[0].tasks[0].title).toBe('Esquema </script><b>x');
  });

  it('sync writes files and prints batches using known versions', () => {
    writeFileSync(path.join(dir, 'known.json'), JSON.stringify({ meta: { project: 3 } }));
    const r = run(['sync', 'plan.yaml', '--out', '.waypoint/sync', '--known', 'known.json', '--session', 'main'], io);
    expect(r.code).toBe(0);
    const { batches } = JSON.parse(r.stdout);
    const meta = batches[0][0];
    expect(meta).toMatchObject({ op: 'update', collection: 'meta', if_version: 3 });
    expect(path.isAbsolute(meta.file_path)).toBe(true);
    expect(existsSync(meta.file_path)).toBe(true);
    expect(batches.flat().at(-1).doc_id).toBe('20261011T100000000Z-main-0000');
  });

  it('sync does not re-orphan a task already orphaned in states', () => {
    writeFileSync(path.join(dir, 'known.json'), JSON.stringify({ state: { T009: 4 } }));
    const states = path.join(dir, 'dbcache/state');
    mkdirSync(states, { recursive: true });
    writeFileSync(path.join(states, 'T009.json'), JSON.stringify({ status: 'orphaned' }));
    const r = run(['sync', 'plan.yaml', '--out', '.waypoint/sync', '--known', 'known.json', '--states', 'dbcache/state'], io);
    expect(r.code).toBe(0);
    const docIds = JSON.parse(r.stdout).batches.flat().map((w: { doc_id: string }) => w.doc_id);
    expect(docIds).not.toContain('T009');
  });

  it('next reads states from a directory of JSON files', () => {
    const states = path.join(dir, 'dbcache/state');
    mkdirSync(states, { recursive: true });
    writeFileSync(path.join(states, 'T001.json'), JSON.stringify({ status: 'done' }));
    const r = run(['next', 'plan.yaml', '--states', 'dbcache/state', '--session', 'main', '--track', 'backend'], io);
    expect(JSON.parse(r.stdout)).toMatchObject({ task: { id: 'T002' }, resumed: false });
  });

  it('status prints a human summary', () => {
    const r = run(['status', 'plan.yaml'], io);
    expect(r.stdout).toContain('demo-shop · v0.1 · 0% (0/6)');
    expect(r.stdout).toContain('next: T001 Esquema de pedidos');
  });

  it('small helpers', () => {
    expect(run(['session-id', 'Interfaz Gráfica'], io).stdout).toBe('interfaz-grafica\n');
    expect(run(['event-id', 'main'], io).stdout).toBe('20261011T100000000Z-main-0000\n');
    expect(run(['now'], io).stdout).toBe('2026-10-11T10:00:00.000Z\n');
    expect(run(['nope'], io).code).toBe(2);
  });

  it('commit-info reads the last commit', () => {
    const git = (...a: string[]) => execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd: dir });
    git('init', '-q');
    git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'add', 'plan.yaml');
    git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'T001: Esquema de pedidos');
    const info = JSON.parse(run(['commit-info'], io).stdout);
    expect(info).toMatchObject({ title: 'T001: Esquema de pedidos', del: 0 });
    expect(info.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(info.add).toBeGreaterThan(50);
    // A sha of another branch (e.g. an integration on the run branch) reads from the same object database.
    git('checkout', '-q', '-b', 'side');
    git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'forge: integrate T1');
    const side = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
    git('checkout', '-q', '-');
    expect(JSON.parse(run(['commit-info', side], io).stdout)).toMatchObject({ sha: side, title: 'forge: integrate T1' });
  });
});

describe('multi-session commands', () => {
  const writeDocs = (sub: string, docs: Record<string, unknown>) => {
    const d = path.join(dir, sub);
    mkdirSync(d, { recursive: true });
    for (const [id, body] of Object.entries(docs)) writeFileSync(path.join(d, `${id}.json`), JSON.stringify(body));
    return sub;
  };

  it('next reports conflicts and prefers non-conflicting tasks', () => {
    const plan = readFileSync(path.join(dir, 'plan.yaml'), 'utf8').replace('zones: ["web/cart/**"]', 'zones: ["src/db/cart/**"]');
    writeFileSync(path.join(dir, 'plan.yaml'), plan);
    const states = writeDocs('c/state', { T001: { status: 'in_progress', owner: 'be' } });
    const r = JSON.parse(run(['next', 'plan.yaml', '--states', states, '--session', 'ui', '--track', 'ui'], io).stdout);
    expect(r.task.id).toBe('T003');
    expect(r.conflicts[0]).toMatchObject({ taskId: 'T001', owner: 'be' });
  });

  it('conflicts / recover / inbox / escalations', () => {
    const states = writeDocs('c/state', { T001: { status: 'in_progress', owner: 'be' } });
    const sessions = writeDocs('c/sessions', { be: { name: 'be', heartbeatAt: '2026-10-11T09:00:00.000Z', status: 'active' } });
    const msg = { ts: '2026-10-11T09:30:00Z', from: 'ui', to: 'be', type: 'overlap_warning', taskId: 'T001', text: 'x', status: 'open' };
    const messages = writeDocs('c/messages', { m1: msg, m2: { ...msg, from: 'be', to: 'ui', type: 'reply' }, m3: msg, m4: { ...msg, from: 'be', to: 'ui', type: 'reply' } });
    expect(JSON.parse(run(['conflicts', 'plan.yaml', '--states', states, '--session', 'x', '--task', 'T001'], io).stdout)).toEqual([]);
    expect(JSON.parse(run(['recover', 'plan.yaml', '--states', states, '--sessions', sessions], io).stdout)).toEqual([{ taskId: 'T001', owner: 'be' }]);
    expect(JSON.parse(run(['recover', 'plan.yaml', '--states', states, '--sessions', sessions, '--minutes', '120'], io).stdout)).toEqual([]);
    expect(JSON.parse(run(['inbox', '--messages', messages, '--session', 'be'], io).stdout).map((m: { id: string }) => m.id)).toEqual(['m1', 'm3']);
    expect(JSON.parse(run(['escalations', '--messages', messages], io).stdout)).toHaveLength(1);
  });

  it('launch creates the worktree once and reuses it', () => {
    const git = (...a: string[]) => execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd: dir });
    git('init', '-q');
    git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'add', '.');
    git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'init');
    const first = JSON.parse(run(['launch', 'plan.yaml', 'ui'], io).stdout);
    expect(first).toMatchObject({ branch: 'track/ui', name: 'wp-demo-shop-ui' });
    expect(first.command).toBe('claude --bg --name wp-demo-shop-ui "/waypoint:work ui"');
    expect(first.run).toBe(`(cd '${first.worktree}' && ${first.command})`);
    expect(existsSync(path.join(first.worktree, 'plan.yaml'))).toBe(true);
    const again = run(['launch', 'plan.yaml', 'ui'], io);
    expect(again.code).toBe(0);
    expect(JSON.parse(again.stdout).worktree).toBe(first.worktree);
    expect(run(['launch', 'plan.yaml', 'nope'], io).code).toBe(1);
  });

  describe('launch prompt', () => {
    const MARK = 'forge drives this session (forge:run Large loop)';
    const MERGE = ' — the user authorizes merging track/ui into main at phase close';
    const launch = (...flags: string[]) => {
      const git = (...a: string[]) => execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd: dir });
      if (!existsSync(path.join(dir, '.git'))) {
        git('init', '-q');
        git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'add', '.');
        git('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'init');
      }
      return JSON.parse(run(['launch', 'plan.yaml', 'ui', ...flags], io).stdout);
    };
    const writeDesign = (startPrompt: string) =>
      writeFileSync(path.join(dir, 'design.md'), `---\ntitle: T\nproject: demo-shop\nsummary: S\nstart_prompt: "${startPrompt}"\n---\nbody\n`);

    it('plain prompt is unchanged and returned', () => {
      const r = launch();
      expect(r.prompt).toBe('/waypoint:work ui');
      expect(r.command).toBe('claude --bg --name wp-demo-shop-ui "/waypoint:work ui"');
    });
    it('--merge appends the merge authorization', () => {
      expect(launch('--merge').prompt).toBe(`/waypoint:work ui${MERGE}`);
    });
    it('--forge and --no-forge are accepted and change nothing (J-02)', () => {
      expect(launch('--forge').prompt).toBe('/waypoint:work ui');
      expect(launch('--no-forge').prompt).toBe('/waypoint:work ui');
    });
    it('--merge with --forge adds only the merge authorization', () => {
      const r = launch('--merge', '--forge');
      expect(r.prompt).toBe(`/waypoint:work ui${MERGE}`);
      expect(r.command).toBe(`claude --bg --name wp-demo-shop-ui "${r.prompt}"`);
    });
    it('a design start_prompt that carries the old forge mark no longer adds it (J-02)', () => {
      writeDesign(`/waypoint:work <track> — ${MARK}`);
      expect(launch().prompt).toBe('/waypoint:work ui');
    });
    it('--swarm is obsolete: accepted with a warning, it no longer changes the prompt (J-16)', () => {
      launch(); // makes the repo
      const r = run(['launch', 'plan.yaml', 'ui', '--swarm', 'main', '--base', 'HEAD'], io);
      expect(r.code).toBe(0);
      expect(r.stderr).toBe('--swarm is obsolete: forge launches run members with --task\n');
      expect(JSON.parse(r.stdout).prompt).toBe('/waypoint:work ui');
    });
    it('--swarm refuses --merge, a missing id and an id with shell characters', () => {
      const r = (...flags: string[]) => run(['launch', 'plan.yaml', 'ui', ...flags], io);
      launch(); // makes the repo
      expect(r('--swarm', 'main', '--merge').code).toBe(2);
      expect(r('--swarm').code).toBe(2);
      expect(r('--swarm', 'a"b').code).toBe(2);
      expect(r('--swarm', '--forge').code).toBe(2);
    });
  });

  describe('launch root and base', () => {
    const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', '-c', 'core.autocrlf=false', ...a], { cwd, encoding: 'utf8' }).trim();
    const init = () => {
      git(dir, 'init', '-q', '-b', 'main');
      git(dir, 'add', '.');
      git(dir, 'commit', '-qm', 'init');
    };
    const real = (p: string) => path.resolve(p).toLowerCase();

    it('creates the worktree under the main checkout even when run from inside a worktree', () => {
      init();
      const first = JSON.parse(run(['launch', 'plan.yaml', 'ui'], io).stdout);
      const inner = { ...io, cwd: first.worktree };
      const second = JSON.parse(run(['launch', 'plan.yaml', 'backend'], inner).stdout);
      expect(real(second.worktree)).toBe(real(path.join(dir, '.claude', 'worktrees', 'backend')));
      expect(existsSync(path.join(dir, '.claude', 'worktrees', 'backend', 'plan.yaml'))).toBe(true);
      expect(existsSync(path.join(first.worktree, '.claude', 'worktrees', 'backend'))).toBe(false);
    });
    it('--base is the start point of a new track branch', () => {
      init();
      git(dir, 'checkout', '-qb', 'forge/infinite-1');
      writeFileSync(path.join(dir, 'extra.txt'), 'x\n');
      git(dir, 'add', 'extra.txt');
      git(dir, 'commit', '-qm', 'extra');
      const tip = git(dir, 'rev-parse', 'HEAD');
      git(dir, 'checkout', '-q', 'main');
      const r = JSON.parse(run(['launch', 'plan.yaml', 'ui', '--swarm', 'main', '--base', 'forge/infinite-1'], io).stdout);
      expect(git(dir, 'rev-parse', 'track/ui')).toBe(tip);
      expect(existsSync(path.join(r.worktree, 'extra.txt'))).toBe(true);
    });
    it('--swarm needs --base, and --base must be a safe branch name', () => {
      init();
      expect(run(['launch', 'plan.yaml', 'ui', '--swarm', 'main'], io).code).toBe(2);
      expect(run(['launch', 'plan.yaml', 'ui', '--base', '-x'], io).code).toBe(2);
      expect(run(['launch', 'plan.yaml', 'ui', '--base', 'a b'], io).code).toBe(2);
      expect(run(['launch', 'plan.yaml', 'ui', '--base'], io).code).toBe(2);
      expect(run(['launch', 'plan.yaml', 'ui', '--base', 'main'], io).code).toBe(0);
    });
    it('adds .claude/worktrees/ to info/exclude once when nothing ignores it, so git status stays clean (A-08)', () => {
      init();
      // No global ignore file either: the user's own may already ignore .claude/.
      const none = path.join(mkdtempSync(path.join(tmpdir(), 'wp-noexcl-')), 'excludes');
      writeFileSync(none, '');
      git(dir, 'config', 'core.excludesFile', none);
      expect(run(['launch', 'plan.yaml', 'ui'], io).code).toBe(0);
      expect(run(['launch', 'plan.yaml', 'backend'], io).code).toBe(0);
      const lines = readFileSync(path.join(dir, '.git', 'info', 'exclude'), 'utf8').split(/\r?\n/);
      expect(lines.filter(l => l === '.claude/worktrees/')).toHaveLength(1);
      expect(git(dir, 'status', '--porcelain')).not.toContain('.claude');
    });
  });

  describe('launch --task', () => {
    const git = (...a: string[]) => execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', '-c', 'core.autocrlf=false', ...a], { cwd: dir, encoding: 'utf8' }).trim();
    const init = () => { git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-qm', 'init'); git('branch', 'forge/run-demo-shop'); };
    const args = ['launch', 'plan.yaml', 'T001', '--task', '--run', 'r1', '--coordinator', 'S1', '--base', 'forge/run-demo-shop'];
    it('creates task/<T> from the run branch and a forge run member prompt', () => {
      init();
      const r = JSON.parse(run(args, io).stdout);
      expect(r).toMatchObject({ branch: 'task/T001', name: 'wp-demo-shop-T001', runId: 'r1', task: 'T001' });
      expect(path.resolve(r.worktree).toLowerCase()).toBe(path.resolve(dir, '.claude', 'worktrees', 'task-T001').toLowerCase());
      expect(r.prompt).toBe('/forge:member --plan plan.yaml --task T001 — run member of S1: work only T001, then stop');
      expect(r.command).toBe(`claude --bg --name wp-demo-shop-T001 "${r.prompt}"`);
      expect(git('rev-parse', 'task/T001')).toBe(git('rev-parse', 'forge/run-demo-shop'));
    });
    it('--effort and --model go into command and run, before the prompt', () => {
      init();
      const r = JSON.parse(run([...args, '--effort', 'medium'], io).stdout);
      expect(r.command).toBe(`claude --bg --name wp-demo-shop-T001 --effort medium "${r.prompt}"`);
      expect(r.run).toContain(`&& claude --bg --name wp-demo-shop-T001 --effort medium "${r.prompt}")`);
      const m = JSON.parse(run([...args, '--effort', 'high', '--model', 'sonnet'], io).stdout);
      expect(m.command).toBe(`claude --bg --name wp-demo-shop-T001 --effort high --model sonnet "${m.prompt}"`);
      expect(m.run).toContain(`&& claude --bg --name wp-demo-shop-T001 --effort high --model sonnet "${m.prompt}")`);
    });
    it('refuses an --effort or --model outside the closed list with code 2, before any worktree', () => {
      init();
      for (const bad of [['--effort', 'extreme'], ['--effort'], ['--model', 'gpt-4'], ['--model', 'sonnet;rm'], ['--model']]) {
        expect(run([...args, ...bad], io).code).toBe(2);
      }
      expect(existsSync(path.join(dir, '.claude', 'worktrees', 'task-T001'))).toBe(false);
    });
    it('reuses an existing task branch with its work (relaunch)', () => {
      init();
      git('branch', 'task/T001', 'main');
      git('checkout', '-q', 'task/T001');
      writeFileSync(path.join(dir, 'done.txt'), 'x\n'); git('add', 'done.txt'); git('commit', '-qm', 'work');
      const tip = git('rev-parse', 'HEAD');
      git('checkout', '-q', 'main');
      const r = JSON.parse(run(args, io).stdout);
      expect(existsSync(path.join(r.worktree, 'done.txt'))).toBe(true);
      expect(git('rev-parse', 'task/T001')).toBe(tip);
      expect(run(args, io).code).toBe(0);
    });
    it('refuses unknown tasks and missing or unsafe flags', () => {
      init();
      expect(run(['launch', 'plan.yaml', 'T999', '--task', '--run', 'r1', '--coordinator', 'S1', '--base', 'main'], io).code).toBe(1);
      expect(run(['launch', 'plan.yaml', 'T001', '--task', '--coordinator', 'S1', '--base', 'main'], io).code).toBe(2);
      expect(run(['launch', 'plan.yaml', 'T001', '--task', '--run', 'r1', '--base', 'main'], io).code).toBe(2);
      expect(run(['launch', 'plan.yaml', 'T001', '--task', '--run', 'r1', '--coordinator', 'a"b', '--base', 'main'], io).code).toBe(2);
      expect(run(['launch', 'plan.yaml', 'T001', '--task', '--run', 'r1', '--coordinator', 'S1'], io).code).toBe(2);
      expect(run([...args, '--merge'], io).code).toBe(2);
    });
    it('--launcher bg is the default; herdr follows the spike; anything else is refused', () => {
      init();
      const def = JSON.parse(run(args, io).stdout);
      const bg = JSON.parse(run([...args, '--launcher', 'bg'], io).stdout);
      expect(bg.run).toBe(def.run);
      expect(bg.run).toBe(launchRun('bg', { name: bg.name, prompt: bg.prompt, worktree: bg.worktree }));
      const h = run([...args, '--launcher', 'herdr'], io);
      if (HERDR_TEMPLATE === null) {
        expect(h.code).toBe(2);
        expect(h.stderr).toContain('launch: herdr cannot open panes from the command line; use launcher bg');
      } else {
        expect(JSON.parse(h.stdout).run).toBe(launchRun('herdr', { name: bg.name, prompt: bg.prompt, worktree: bg.worktree }));
      }
      expect(run([...args, '--launcher', 'nope'], io).code).toBe(2);
    });
    it('a launcher that cannot run is refused before any worktree or branch exists', () => {
      init();
      if (HERDR_TEMPLATE !== null) return; // only a refused launcher shows it
      expect(run([...args, '--launcher', 'herdr'], io).code).toBe(2);
      expect(existsSync(path.join(dir, '.claude', 'worktrees', 'task-T001'))).toBe(false);
      expect(git('branch', '--list', 'task/T001')).toBe('');
      expect(run(['launch', 'plan.yaml', 'ui', '--launcher', 'herdr'], io).code).toBe(2);
      expect(existsSync(path.join(dir, '.claude', 'worktrees', 'ui'))).toBe(false);
      expect(git('branch', '--list', 'track/ui')).toBe('');
    });
    it('refuses a plan path with characters outside the safe set, before anything is created', () => {
      init();
      for (const bad of ['plan".yaml', 'plan$(x).yaml', 'plan`x`.yaml', 'a;b.yaml']) {
        expect(run(['launch', bad, 'T001', '--task', '--run', 'r1', '--coordinator', 'S1', '--base', 'forge/run-demo-shop'], io).code).toBe(2);
      }
      expect(existsSync(path.join(dir, '.claude', 'worktrees', 'task-T001'))).toBe(false);
      expect(run(['launch', path.join(dir, 'plan.yaml'), 'T001', '--task', '--run', 'r1', '--coordinator', 'S1', '--base', 'forge/run-demo-shop'], io).code).toBe(0);
    });
  });
});

describe('final fix: db plan cache, idle owners, recover caches', () => {
  const writeDocs = (sub: string, docs: Record<string, unknown>) => {
    const d = path.join(dir, sub);
    mkdirSync(d, { recursive: true });
    for (const [id, body] of Object.entries(docs)) writeFileSync(path.join(d, `${id}.json`), JSON.stringify(body));
    return sub;
  };
  const dbPlan = () => {
    const meta = { name: 'demo-shop', locale: 'es', version: '0.2', planHash: 'x', tracks: [{ id: 'backend', name: 'Backend', color: 'blue' }], versions: [], phaseOrder: ['F9'], metrics: {}, syncedAt: '' };
    writeDocs('db/meta', { project: meta });
    writeDocs('db/plan', { F9: { id: 'F9', name: 'Db only', plan_status: 'committed', order: 0, tasks: [{ id: 'T099', title: 'Solo en la db', track: 'backend', phase: 'F9', done_when: 'x', depends_on: [], zones: [] }] } });
    return 'db';
  };

  it('next/conflicts/status/recover --db read the plan from the db cache', () => {
    const db = dbPlan();
    const r = run(['next', 'plan.yaml', '--db', db, '--session', 'be', '--track', 'backend'], io);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).task.id).toBe('T099');
    expect(run(['conflicts', 'plan.yaml', '--db', db, '--session', 'be', '--task', 'T099'], io).code).toBe(0);
    const st = run(['status', 'plan.yaml', '--db', db], io);
    expect(st.stdout).toContain('next: T099 Solo en la db');
    expect(st.stdout).toContain('v0.2');
    const states = writeDocs('c/state', { T099: { status: 'in_progress', owner: 'gone' } });
    const sessions = writeDocs('c/sessions', {});
    expect(JSON.parse(run(['recover', 'plan.yaml', '--db', db, '--states', states, '--sessions', sessions], io).stdout)).toEqual([{ taskId: 'T099', owner: 'gone' }]);
  });

  it('--db with a missing cache fails', () => {
    for (const cmd of [['next', '--session', 'be'], ['conflicts', '--session', 'be', '--task', 'T001'], ['status']]) {
      const r = run([cmd[0], 'plan.yaml', '--db', 'nodb', ...cmd.slice(1)], io);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain('db plan cache missing');
    }
    writeDocs('half/meta', { project: { name: 'demo-shop' } });
    expect(run(['next', 'plan.yaml', '--db', 'half', '--session', 'be'], io).stderr).toContain('db plan cache missing');
  });

  it('next/conflicts --sessions mark conflicts with idle owners', () => {
    const plan = readFileSync(path.join(dir, 'plan.yaml'), 'utf8').replace('zones: ["web/cart/**"]', 'zones: ["src/db/cart/**"]');
    writeFileSync(path.join(dir, 'plan.yaml'), plan);
    const states = writeDocs('c/state', { T001: { status: 'in_progress', owner: 'be' } });
    const sessions = writeDocs('c/sessions', { be: { name: 'be', heartbeatAt: '2026-10-11T09:00:00.000Z', status: 'active' } });
    const r = JSON.parse(run(['next', 'plan.yaml', '--states', states, '--sessions', sessions, '--session', 'ui', '--track', 'ui'], io).stdout);
    expect(r.task.id).toBe('T003');
    expect(r.conflicts[0]).toMatchObject({ taskId: 'T001', owner: 'be', ownerIdle: true });
    const c = JSON.parse(run(['conflicts', 'plan.yaml', '--states', states, '--sessions', sessions, '--session', 'ui', '--task', 'T003'], io).stdout);
    expect(c[0]).toMatchObject({ owner: 'be', ownerIdle: true });
  });

  it('recover requires existing --states and --sessions caches', () => {
    const states = writeDocs('c/state', {});
    const sessions = writeDocs('c/sessions', {});
    expect(run(['recover', 'plan.yaml', '--states', states], io).code).toBe(1);
    expect(run(['recover', 'plan.yaml', '--sessions', sessions], io).code).toBe(1);
    const r = run(['recover', 'plan.yaml', '--states', states, '--sessions', 'c/nope'], io);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('cache missing');
    expect(run(['recover', 'plan.yaml', '--states', states, '--sessions', sessions], io).code).toBe(0);
  });
});

describe('residual fix: --sessions guard', () => {
  it('next and conflicts fail when the --sessions cache is missing', () => {
    for (const cmd of [['next', '--session', 'be'], ['conflicts', '--session', 'be', '--task', 'T001']]) {
      const r = run([cmd[0], 'plan.yaml', '--sessions', 'c/nope', ...cmd.slice(1)], io);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain('cache missing');
    }
    mkdirSync(path.join(dir, 'c/sessions'), { recursive: true });
    expect(run(['next', 'plan.yaml', '--sessions', 'c/sessions', '--session', 'be'], io).code).toBe(0);
    expect(run(['conflicts', 'plan.yaml', '--sessions', 'c/sessions', '--session', 'be', '--task', 'T001'], io).code).toBe(0);
  });
});

describe('task batches from the CLI (A-14)', () => {
  const docsAt = (sub: string, docs: Record<string, unknown>) => {
    const d = path.join(dir, sub);
    mkdirSync(d, { recursive: true });
    for (const [id, body] of Object.entries(docs)) writeFileSync(path.join(d, `${id}.json`), JSON.stringify(body));
    return sub;
  };
  // The runtime plan as the roadmap holds it (meta and plan listings), from the fixture.
  const dbOf = () => {
    const { meta, phases } = buildDocs(parsePlan(readFileSync(path.join(dir, 'plan.yaml'), 'utf8')), '2026-10-11T10:00:00.000Z');
    docsAt('db/meta', { project: meta });
    docsAt('db/plan', Object.fromEntries(phases.map(p => [p.id, p])));
    return 'db';
  };
  const cli = (...a: string[]) => run(a, { ...io, env: {} });
  const claim = (...extra: string[]) => cli('claim', 'plan.yaml', '--db', 'db', '--session', 'be', '--task', 'T001', '--state-version', '3', '--session-version', '7', ...extra);

  it('claim prints the batch of a start with its lease, solo from the sessions listing, and the cache sees the claim at once', () => {
    dbOf();
    docsAt('db/sessions', { be: { name: 'be', heartbeatAt: '2026-10-11T09:59:00.000Z', status: 'active' }, gone: { name: 'gone', heartbeatAt: '2026-10-11T08:00:00.000Z', status: 'active' } });
    const r = claim('--sessions', 'db/sessions');
    expect(r.code).toBe(0);
    const o = JSON.parse(r.stdout);
    expect(o).toMatchObject({ now: '2026-10-11T10:00:00.000Z', eid: '20261011T100000000Z-be-0000', leaseUntil: '2026-10-11T10:10:00.000Z', solo: true });
    expect(o.batch.map((w: { op: string; collection: string; doc_id: string }) => `${w.op} ${w.collection}/${w.doc_id}`))
      .toEqual(['update state/T001', `set events/${o.eid}`, 'update sessions/be']);
    expect(o.batch[0]).toMatchObject({ if_version: 3, data: { status: 'in_progress', owner: 'be', zonesTouched: [] } });
    expect(o.batch[2]).toMatchObject({ if_version: 7, data: { currentTask: 'T001', leaseUntil: '2026-10-11T10:10:00.000Z', status: 'active' } });
    // Review Focus 1: with --db the local cache shows the claim before any new listing, so the hooks know the task.
    expect(JSON.parse(readFileSync(path.join(dir, 'db', 'state', 'T001.json'), 'utf8'))).toMatchObject({ status: 'in_progress', owner: 'be' });
    docsAt('db/sessions', { ui: { name: 'ui', heartbeatAt: '2026-10-11T09:58:00.000Z', status: 'active' } });
    expect(JSON.parse(claim('--sessions', 'db/sessions').stdout).solo).toBe(false);
    expect(JSON.parse(claim().stdout).solo).toBe(false);
  });
  it('versions, ids and the task are checked: exit 2', () => {
    dbOf();
    expect(cli('claim', 'plan.yaml', '--db', 'db', '--session', 'be', '--task', 'T001', '--state-version', 'x', '--session-version', '7').code).toBe(2);
    expect(cli('claim', 'plan.yaml', '--db', 'db', '--session', 'be', '--task', 'T001', '--state-version', '0', '--session-version', '7').code).toBe(2);
    expect(cli('claim', 'plan.yaml', '--db', 'db', '--session', 'be', '--task', '../T1', '--state-version', '1', '--session-version', '7').code).toBe(2);
    expect(cli('claim', 'plan.yaml', '--db', 'db', '--session', 'be', '--task', 'T999', '--state-version', '1', '--session-version', '7').code).toBe(2);
    expect(cli('claim', 'plan.yaml', '--db', 'db', '--task', 'T001', '--state-version', '1', '--session-version', '7').code).toBe(2);
    expect(cli('heartbeat', '--session', 'be').code).toBe(2);
    expect(cli('heartbeat', '--session', 'be', '--session-version', '2', '--busy-until', 'soon').code).toBe(2);
  });
  it('an empty value (the next flag right after --session, --task, --by or --recovered-from) is exit 2, not an id', () => {
    dbOf();
    writeFileSync(path.join(dir, 'why.txt'), 'Waits.');
    expect(cli('claim', 'plan.yaml', '--db', 'db', '--session', '--task', 'T001', '--state-version', '1', '--session-version', '7').code).toBe(2);
    expect(cli('claim', 'plan.yaml', '--db', 'db', '--session', 'be', '--task', 'T001', '--state-version', '1', '--session-version', '7', '--recovered-from', '--unblock').code).toBe(2);
    expect(cli('block', 'plan.yaml', '--db', 'db', '--session', 'be', '--task', '--state-version', '4', '--session-version', '8', '--by', 'T002', '--why-file', 'why.txt').code).toBe(2);
    expect(cli('block', 'plan.yaml', '--db', 'db', '--session', 'be', '--task', 'T001', '--state-version', '4', '--session-version', '8', '--by', '--why-file', 'why.txt').code).toBe(2);
    expect(cli('heartbeat', '--session', '--session-version', '2').code).toBe(2);
    expect(cli('done', 'plan.yaml', '--db', 'db', '--session', '', '--task', 'T001', '--state-version', '4', '--session-version', '8', '--meta-version', '2', '--summary-file', 'why.txt').code).toBe(2);
    expect(cli('heartbeat', '--register', '--session', 'be', '--name', 'b', '--agent', 'a', '--branch', 'main', '--worktree', '/r', '--session-version', '0').code).toBe(2);
    expect(existsSync(path.join(dir, 'db', 'state'))).toBe(false);
  });
  it('an empty --db (the next flag, or nothing) is exit 2: the cache is never written under a flag name', () => {
    dbOf();
    writeFileSync(path.join(dir, 'why.txt'), 'Waits.');
    expect(cli('claim', 'plan.yaml', '--db', '--session', 'be', '--task', 'T001', '--state-version', '3', '--session-version', '7').code).toBe(2);
    expect(cli('block', 'plan.yaml', '--db', '--session', 'be', '--task', 'T001', '--state-version', '4', '--session-version', '8', '--by', 'T002', '--why-file', 'why.txt').code).toBe(2);
    expect(cli('block', 'plan.yaml', '--session', 'be', '--task', 'T001', '--state-version', '4', '--session-version', '8', '--by', 'T002', '--why-file', 'why.txt', '--db').code).toBe(2);
    expect(existsSync(path.join(dir, '--session'))).toBe(false);
    expect(existsSync(path.join(dir, 'db', 'state'))).toBe(false);
  });
  it('done and block need a task of the plan, as claim does: exit 2, and nothing reaches the cache', () => {
    dbOf();
    writeFileSync(path.join(dir, 'why.txt'), 'Waits.');
    expect(cli('done', 'plan.yaml', '--db', 'db', '--session', 'be', '--task', 'T0019', '--state-version', '4', '--session-version', '8', '--meta-version', '2', '--summary-file', 'why.txt').code).toBe(2);
    expect(cli('block', 'plan.yaml', '--db', 'db', '--session', 'be', '--task', 'T0019', '--state-version', '4', '--session-version', '8', '--by', 'T002', '--why-file', 'why.txt').code).toBe(2);
    expect(existsSync(path.join(dir, 'db', 'state'))).toBe(false);
  });
  it('claim --unblock writes unblocked then started in the order of their ids, and the cache forgets the block', () => {
    dbOf();
    writeFileSync(path.join(dir, 'why.txt'), 'Waits for the keys.');
    expect(cli('block', 'plan.yaml', '--db', 'db', '--session', 'be', '--task', 'T001', '--state-version', '2', '--session-version', '6', '--by', 'external', '--why-file', 'why.txt').code).toBe(0);
    const cached = () => JSON.parse(readFileSync(path.join(dir, 'db', 'state', 'T001.json'), 'utf8'));
    expect(cached()).toMatchObject({ status: 'blocked', blockedBy: ['external'], blockedReason: 'Waits for the keys.' });
    const o = JSON.parse(claim('--unblock').stdout);
    expect(o.eids).toHaveLength(2);
    expect(o.eids[0] < o.eids[1]).toBe(true);
    expect(o.batch.map((w: { collection: string; doc_id: string }) => `${w.collection}/${w.doc_id}`)).toEqual(['state/T001', `events/${o.eids[0]}`, `events/${o.eids[1]}`, 'sessions/be']);
    expect(o.batch[1].data.type).toBe('unblocked');
    expect(o.batch[2].data.type).toBe('started');
    expect(cached()).toMatchObject({ status: 'in_progress', owner: 'be' });
    expect(cached()).not.toHaveProperty('blockedBy');
    expect(cached()).not.toHaveProperty('blockedReason');
  });
  it('a refused recovery claim: the cache says ours until state is listed again, and next then does not resume it (I2)', () => {
    dbOf();
    docsAt('db/state', { T001: { status: 'in_progress', owner: 'gone', zonesTouched: [] } });
    docsAt('db/sessions', {
      gone: { name: 'gone', heartbeatAt: '2026-10-11T08:00:00.000Z', status: 'active' },
      be: { name: 'be', heartbeatAt: '2026-10-11T09:59:00.000Z', status: 'active' },
      rival: { name: 'rival', heartbeatAt: '2026-10-11T09:59:00.000Z', status: 'active' },
    });
    expect(claim('--recovered-from', 'gone').code).toBe(0);
    const next = () => JSON.parse(cli('next', 'plan.yaml', '--db', 'db', '--states', 'db/state', '--sessions', 'db/sessions', '--session', 'be', '--track', 'backend').stdout);
    // The roadmap refuses the batch (version_mismatch: rival recovered T001 first), but the mirror already wrote it.
    expect(next()).toMatchObject({ task: { id: 'T001' }, resumed: true });
    // work §1.6: list state again, then step 7.
    docsAt('db/state', { T001: { status: 'in_progress', owner: 'rival', zonesTouched: [], recoveredFrom: 'gone' } });
    const n = next();
    expect(n.resumed).toBe(false);
    expect(n.task?.id).not.toBe('T001');
  });
  it('heartbeat --register with an empty --claude takes the id from the environment, so another checkout is still refused', () => {
    const reg = (env: Record<string, string>, ...extra: string[]) => run(['heartbeat', '--register', '--session', 'be', '--name', 'backend', '--agent', 'work-1', '--branch', 'track/backend', '--worktree', '/repo/wt', '--claude', ...extra], { ...io, env });
    docsAt('db/sessions', {});
    expect(JSON.parse(reg({ CLAUDE_CODE_SESSION_ID: 'c-1' }, '--sessions', 'db/sessions').stdout).batch[0].data.claude).toBe('c-1');
    expect(JSON.parse(reg({}, '--sessions', 'db/sessions').stdout).batch[0].data).not.toHaveProperty('claude');
    // The other checkout registered with the same empty substitution: the flag name is nobody's id.
    docsAt('db/sessions', { be: { name: 'be', heartbeatAt: '2026-10-11T09:59:00.000Z', status: 'active', claude: '--sessions', worktree: '/other' } });
    const held = reg({ CLAUDE_CODE_SESSION_ID: 'c-1' }, '--sessions', 'db/sessions');
    expect(held.code).toBe(3);
    expect(JSON.parse(held.stdout)).toEqual({ held: 'be', use: 'be-2' });
    expect(reg({}, '--sessions', 'db/sessions').code).toBe(3);
  });
  it('done reads the commit itself and the summary from a file', () => {
    const git = (...a: string[]) => execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', '-c', 'core.autocrlf=false', ...a], { cwd: dir, encoding: 'utf8' }).trim();
    git('init', '-q'); git('add', 'plan.yaml'); git('commit', '-qm', 'T001: esquema');
    dbOf();
    writeFileSync(path.join(dir, 'summary.txt'), 'El esquema de pedidos está aplicado.\n');
    const r = cli('done', 'plan.yaml', '--db', 'db', '--session', 'be', '--task', 'T001', '--state-version', '4', '--session-version', '8', '--meta-version', '2', '--summary-file', 'summary.txt', '--tests', '12');
    expect(r.code).toBe(0);
    const o = JSON.parse(r.stdout);
    const sha = git('rev-parse', 'HEAD');
    expect(o.batch[0]).toMatchObject({ if_version: 4, data: { status: 'done', summary: 'El esquema de pedidos está aplicado.', commits: [{ sha, title: 'T001: esquema' }] } });
    expect(o.batch[1].data).toMatchObject({ type: 'done', sha, text: 'T001: esquema' });
    expect(o.batch[3]).toMatchObject({ collection: 'meta', if_version: 2, data: { metrics: { lastCommit: { sha }, tests: 12 } } });
    expect(JSON.parse(readFileSync(path.join(dir, 'db', 'state', 'T001.json'), 'utf8')).status).toBe('done');
    expect(cli('done', 'plan.yaml', '--db', 'db', '--session', 'be', '--task', 'T001', '--state-version', '4', '--session-version', '8', '--meta-version', '2').code).toBe(2);
    expect(cli('done', 'plan.yaml', '--db', 'db', '--session', 'be', '--task', 'T001', '--state-version', '4', '--session-version', '8', '--meta-version', '2', '--summary-file', 'summary.txt', '--rev', '--all').code).toBe(2);
  });
  it('block --why-file writes the reason in the blocked event and in state/T.blockedReason', () => {
    dbOf();
    writeFileSync(path.join(dir, 'why.txt'), `Waits for the payments API\nkeys.${String.fromCharCode(0x202e)}`);
    const o = JSON.parse(cli('block', 'plan.yaml', '--db', 'db', '--session', 'be', '--task', 'T001', '--state-version', '4', '--session-version', '8', '--by', 'T002,external', '--why-file', 'why.txt').stdout);
    expect(o.batch[0].data).toEqual({ status: 'blocked', blockedBy: ['T002', 'external'], blockedReason: 'Waits for the payments API keys.' });
    expect(o.batch[1].data).toMatchObject({ type: 'blocked', text: 'Waits for the payments API keys.' });
    writeFileSync(path.join(dir, 'empty.txt'), ' \n');
    for (const bad of [['--by', 'T002', '--why-file', 'empty.txt'], ['--by', 'T002'], ['--by', 'a b', '--why-file', 'why.txt'], ['--why-file', 'why.txt']]) {
      expect(cli('block', 'plan.yaml', '--db', 'db', '--session', 'be', '--task', 'T001', '--state-version', '4', '--session-version', '8', ...bad).code, bad.join(' ')).toBe(2);
    }
  });
  it('heartbeat renews leaseUntil; --register keeps the Claude id and refuses a SID another checkout holds alive', () => {
    expect(JSON.parse(cli('heartbeat', '--session', 'be', '--session-version', '2').stdout).batch[0])
      .toEqual({ op: 'update', collection: 'sessions', doc_id: 'be', data: { heartbeatAt: '2026-10-11T10:00:00.000Z', leaseUntil: '2026-10-11T10:10:00.000Z', status: 'active' }, if_version: 2 });
    const reg = (...extra: string[]) => cli('heartbeat', '--register', '--session', 'be', '--name', 'backend', '--agent', 'work-1', '--branch', 'track/backend', '--worktree', '/repo/wt', '--claude', 'c-1', ...extra);
    expect(JSON.parse(reg().stdout).batch[0]).toMatchObject({ op: 'set', data: { claude: 'c-1', worktree: '/repo/wt', status: 'active' } });
    docsAt('db/sessions', { be: { name: 'be', heartbeatAt: '2026-10-11T09:59:00.000Z', status: 'active', claude: 'c-9', worktree: '/other' } });
    const held = reg('--sessions', 'db/sessions');
    expect(held.code).toBe(3);
    expect(JSON.parse(held.stdout)).toEqual({ held: 'be', use: 'be-2' });
    docsAt('db/sessions', { be: { name: 'be', heartbeatAt: '2026-10-11T09:59:00.000Z', status: 'active', claude: 'c-9', worktree: '/repo/wt' } });
    expect(reg('--sessions', 'db/sessions', '--session-version', '3').code).toBe(0);
  });
});

describe('design commands', () => {
  const rel = 'docs/waypoint/demo-shop/design.md';
  const ddir = () => path.join(dir, 'docs/waypoint/demo-shop');
  const hist = () => path.join(ddir(), 'design/history');
  beforeEach(() => {
    mkdirSync(ddir(), { recursive: true });
    copyFileSync(new URL('./fixtures/design.md', import.meta.url), path.join(dir, rel));
    writeFileSync(path.join(dir, 'assets/design.template.html'), '<title>__TITLE__</title><script type="application/json" id="wp-design-data">__DATA__</script>');
  });
  const changelog = () => JSON.parse(readFileSync(path.join(ddir(), 'design/changelog.json'), 'utf8'));

  it('design-validate reports counts and problems', () => {
    const r = run(['design-validate', rel], io);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^ok: \d+ words, \d+ sections, v0/);
    writeFileSync(path.join(dir, 'bad.md'), '---\ntitle: x\n---\nhola\n');
    const b = run(['design-validate', 'bad.md'], io);
    expect(b.code).toBe(1);
    expect(b.stderr).toContain('project');
  });

  it('design-snapshot never fills gaps and never overwrites', () => {
    const a = run(['design-snapshot', rel, '--note', 'borrador'], io);
    expect(JSON.parse(a.stdout).version).toBe(1);
    expect(JSON.parse(run(['design-snapshot', rel, '--note', 'borrador'], io).stdout).version).toBe(2);
    expect(existsSync(path.join(hist(), 'v1.md'))).toBe(true);
    expect(existsSync(path.join(hist(), 'v2.md'))).toBe(true);
    const log = changelog();
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ version: 1, date: '2026-10-11', note: 'borrador', round: 0 });
    writeFileSync(path.join(hist(), 'v3.md'), 'x');
    expect(JSON.parse(run(['design-snapshot', rel, '--note', 'n', '--round', '2'], io).stdout).version).toBe(4);
    expect(changelog()[2].round).toBe(2);
    expect(run(['design-validate', rel], io).stdout).toContain('v4');
  });

  it('design-snapshot touches nothing when the changelog is ahead of the history', () => {
    mkdirSync(path.join(ddir(), 'design'), { recursive: true });
    const log = JSON.stringify([{ version: 9, date: '2026-01-01', note: 'x', words: 1, round: 1 }]);
    writeFileSync(path.join(ddir(), 'design/changelog.json'), log);
    const r = run(['design-snapshot', rel, '--note', 'b'], io);
    expect(r.code).toBe(1);
    expect(existsSync(path.join(hist(), 'v1.md'))).toBe(false);
    expect(readFileSync(path.join(ddir(), 'design/changelog.json'), 'utf8')).toBe(log);
  });

  it('design-changed compares against history', () => {
    expect(JSON.parse(run(['design-changed', rel], io).stdout)).toMatchObject({ scope: 'full' });
    run(['design-snapshot', rel, '--note', 'a'], io);
    const p = path.join(dir, rel);
    writeFileSync(p, readFileSync(p, 'utf8').replace('no tiene rollback', 'tiene rollback parcial'));
    expect(JSON.parse(run(['design-changed', rel], io).stdout)).toEqual({ since: 1, changed: ['riesgos'], scope: 'changed' });
    expect(JSON.parse(run(['design-changed', rel, '--since', '1'], io).stdout).since).toBe(1);
  });

  it('critique-check and critique-select', () => {
    const prop = (n: number) => ({ n, category: 'risk', severity: 'major', section: 'riesgos', problem: 'p', change: 'c' });
    writeFileSync(path.join(dir, 'c.json'), JSON.stringify({ round: 1, version: 1, scope: 'full', proposals: [prop(1), prop(2)] }));
    const ok1 = run(['critique-check', 'c.json', '--locale', 'es'], io);
    expect(ok1.code).toBe(0);
    expect(ok1.stdout).toMatch(/^1\. \[Riesgo/);
    expect(JSON.parse(run(['critique-select', 'c.json', '2'], io).stdout)).toHaveLength(1);
    const bad = run(['critique-select', 'c.json', '1,9'], io);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain('9');
    writeFileSync(path.join(dir, 'g.json'), JSON.stringify({ round: 1, version: 1, scope: 'full', proposals: [prop(1), prop(3)] }));
    expect(run(['critique-check', 'g.json'], io).code).toBe(1);
  });

  it('design-page escapes the embedded JSON', () => {
    const p = path.join(dir, rel);
    writeFileSync(p, readFileSync(p, 'utf8').replace('title: Tienda Demo', 'title: "Tienda </script><b>"'));
    const r = run(['design-page', rel, '--out', '.waypoint/demo-shop/design-page.html'], io);
    expect(r.code).toBe(0);
    const html = readFileSync(path.join(dir, '.waypoint/demo-shop/design-page.html'), 'utf8');
    expect(html).not.toContain('</script><');
    const m = /id="wp-design-data">(.*?)<\/script>/s.exec(html)!;
    const data = JSON.parse(m[1]);
    expect(data.meta.title).toBe('Tienda </script><b>');
    expect(data.source).toBe('docs/waypoint/demo-shop/');
    execFileSync('git', ['init', '-q'], { cwd: dir });
    run(['design-page', rel, '--out', 'p.html'], io);
    const g = JSON.parse(/id="wp-design-data">(.*?)<\/script>/s.exec(readFileSync(path.join(dir, 'p.html'), 'utf8'))![1]);
    expect(g.source).toBe('docs/waypoint/demo-shop/');
  });

  it('design-page keeps __DATA__ / __TITLE__ in the title or text literal', () => {
    const p = path.join(dir, rel);
    writeFileSync(p, readFileSync(p, 'utf8').replace('title: Tienda Demo', 'title: "A __DATA__ b __TITLE__"'));
    const r = run(['design-page', rel, '--out', 'o.html'], io);
    expect(r.code).toBe(0);
    const html = readFileSync(path.join(dir, 'o.html'), 'utf8');
    expect(html).toContain('<title>A __DATA__ b __TITLE__ · Design</title>');
    const data = JSON.parse(/id="wp-design-data">(.*?)<\/script>/s.exec(html)![1]);
    expect(data.meta.title).toBe('A __DATA__ b __TITLE__');
  });

  it('design-park parks a draft once, and refuses an approved design (K3-13)', () => {
    const r = run(['design-park', rel], io);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ status: 'parked', changed: true });
    expect(parseDesign(readFileSync(path.join(dir, rel), 'utf8')).meta.status).toBe('parked');
    expect(JSON.parse(run(['design-park', rel], io).stdout).changed).toBe(false);
    writeFileSync(path.join(dir, rel), readFileSync(path.join(dir, rel), 'utf8').replace('status: parked', 'status: approved'));
    const no = run(['design-park', rel], io);
    expect(no.code).toBe(2);
    expect(no.stderr).toContain('only a draft design can be parked');
    expect(run(['design-park'], io).code).toBe(2);
  });
  it('design-park on a missing or unreadable design says so cleanly and writes nothing', () => {
    const missing = run(['design-park', 'docs/waypoint/nope/design.md'], io);
    expect(missing).toMatchObject({ code: 2, stdout: '' });
    expect(missing.stderr).toBe('design-park: cannot read docs/waypoint/nope/design.md\n');
    writeFileSync(path.join(dir, rel), '---\ntitle: x\n---\nhola\n');
    const broken = run(['design-park', rel], io);
    expect(broken.code).toBe(1);
    expect(broken.stderr).not.toMatch(/^error:|\n\s+at /);
    expect(readFileSync(path.join(dir, rel), 'utf8')).toBe('---\ntitle: x\n---\nhola\n');
  });

  describe('critique-check against the design', () => {
    const prop = (section: string) => ({ n: 1, category: 'risk', severity: 'major', section, problem: 'p', change: 'c' });
    const write = (name: string, c: object) => writeFileSync(path.join(dir, name), JSON.stringify(c));
    const base = { round: 2, version: 3, scope: 'full' };
    it('accepts matching round/version and known slugs (and _intro)', () => {
      write('a.json', { ...base, proposals: [prop('riesgos')] });
      expect(run(['critique-check', 'a.json', '--round', '2', '--version', '3', '--design', rel], io).code).toBe(0);
      write('i.json', { ...base, proposals: [prop('_intro')] });
      expect(run(['critique-check', 'i.json', '--round', '2', '--version', '3', '--design', rel], io).code).toBe(0);
    });
    it('rejects a different round or version', () => {
      write('a.json', { ...base, proposals: [prop('riesgos')] });
      const r = run(['critique-check', 'a.json', '--round', '1', '--version', '3'], io);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain('round');
      const v = run(['critique-check', 'a.json', '--version', '9'], io);
      expect(v.code).toBe(1);
      expect(v.stderr).toContain('version');
    });
    it('rejects sections that are not slugs of the design', () => {
      write('b.json', { ...base, proposals: [prop('Riesgos')] });
      const r = run(['critique-check', 'b.json', '--design', rel], io);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain('Riesgos');
    });
  });

  describe('design-snapshot --applied and --rewrite (A-04, K3-01)', () => {
    const local = () => path.join(dir, '.waypoint', 'demo-shop');
    const prop = (n: number) => ({ n, category: 'gap', severity: 'major', section: '_intro', problem: 'p', change: 'c' });
    const critique = (round: number, count: number) => writeFileSync(path.join(local(), `critique-r${round}.json`),
      JSON.stringify({ round, version: round, scope: 'full', proposals: Array.from({ length: count }, (_, i) => prop(i + 1)) }));
    beforeEach(() => { mkdirSync(local(), { recursive: true }); critique(1, 5); critique(2, 3); });
    it('writes applied by round, sorted and without duplicates, a bare list of --round, and rewrite', () => {
      const r = run(['design-snapshot', rel, '--note', 'resumen', '--round', '2', '--applied', 'r1:5,4,4', 'r2:2'], io);
      expect(r.code).toBe(0);
      expect(JSON.parse(r.stdout)).toMatchObject({ version: 1, applied: { 1: [4, 5], 2: [2] } });
      expect(changelog()[0]).toMatchObject({ note: 'resumen', round: 2, applied: { 1: [4, 5], 2: [2] } });
      expect(changelog()[0]).not.toHaveProperty('rewrite');
      expect(JSON.parse(run(['design-snapshot', rel, '--note', 'x', '--round', '2', '--applied', '1,3'], io).stdout).applied).toEqual({ 2: [1, 3] });
      expect(run(['design-snapshot', rel, '--note', 'reescrito', '--round', '2', '--rewrite'], io).code).toBe(0);
      expect(changelog()[2]).toMatchObject({ round: 2, rewrite: true });
      expect(changelog()[2]).not.toHaveProperty('applied');
    });
    it('exits 2 and writes nothing for a bad item, a list without --round, a later round, a missing critique, an unknown number or a bad --rewrite', () => {
      for (const extra of [
        ['--round', '2', '--applied'], ['--round', '2', '--applied', 'r1:x'], ['--round', '2', '--applied', 'r01:1'],
        ['--applied', '1,2'], ['--round', '1', '--applied', 'r2:1'], ['--round', '3', '--applied', 'r3:1'],
        ['--round', '2', '--applied', 'r1:9'], ['--rewrite'], ['--round', '3', '--rewrite'],
      ]) expect(run(['design-snapshot', rel, '--note', 'n', ...extra], io).code, extra.join(' ')).toBe(2);
      expect(run(['design-snapshot', rel, '--note', 'n', '--round', '2', '--applied', 'r1:9'], io).stderr).toBe('design-snapshot: round 1 has no proposal 9\n');
      expect(existsSync(hist())).toBe(false);
      expect(existsSync(path.join(ddir(), 'design/changelog.json'))).toBe(false);
    });
  });
});

describe('classic hooks', () => {
  const NOW = Date.parse('2026-10-11T10:00:00.000Z');
  const ago = (min: number) => new Date(NOW - min * 60000).toISOString();
  const wp = (...p: string[]) => path.join(dir, '.waypoint', 'demo-shop', ...p);
  const docsDir = () => path.join(dir, 'docs', 'waypoint', 'demo-shop');
  const hook = (sub: string, stdin: unknown, over: Partial<Io> = {}) =>
    run(['hook', sub], { ...io, env: {}, ...over, stdin: typeof stdin === 'string' ? stdin : JSON.stringify(stdin) });
  const context = (r: { stdout: string }): string => (r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : '');
  const setup = () => { mkdirSync(docsDir(), { recursive: true }); copyFileSync(FIXTURE, path.join(docsDir(), 'plan.yaml')); };
  /** The seat `sid` (its session.json) bound to the Claude conversation `claude`, as waypoint bind leaves it. */
  const bindAs = (claude: string, over: Record<string, unknown> = {}, sid = 'backend', seatDir = wp()) => {
    mkdirSync(seatDir, { recursive: true });
    if (!existsSync(path.join(seatDir, 'session.json'))) writeFileSync(path.join(seatDir, 'session.json'), JSON.stringify({ sessionId: sid, track: 'backend' }));
    writeFileSync(path.join(seatDir, 'bound.json'), JSON.stringify({ sid, claude, pid: null, via: 'work', since: ago(30), seenAt: ago(1), endedAt: null, endReason: null, ...over }));
  };
  const ownTask = (task: string, owner = 'backend', status = 'in_progress') => {
    mkdirSync(wp('dbcache', 'state'), { recursive: true });
    writeFileSync(wp('dbcache', 'state', `${task}.json`), JSON.stringify({ status, owner }));
  };
  const bound = (seatDir = wp()) => JSON.parse(readFileSync(path.join(seatDir, 'bound.json'), 'utf8'));
  const pending = (seatDir = wp()) => path.join(seatDir, 'pending-commits.jsonl');
  const pendingLines = (seatDir = wp()) => (existsSync(pending(seatDir)) ? readFileSync(pending(seatDir), 'utf8').trim().split('\n').filter(Boolean) : []);
  // A real repository in the test dir.
  const gitAt = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...a], { cwd, encoding: 'utf8' }).trim();
  const git = (...a: string[]) => gitAt(dir, ...a);
  const gitInit = () => { git('init', '-q'); git('add', '.'); git('commit', '-q', '-m', 'init'); };
  const commitFile = (name: string) => { writeFileSync(path.join(dir, name), name); git('add', name); git('commit', '-q', '-m', `add ${name}`); return git('rev-parse', 'HEAD'); };
  const NOT_OWNER = ['Current task', 'continue', 'Use /waypoint:work'];

  it('isCommitCommand matches real commits only', () => {
    const yes = ['git add . && git commit -m x', 'x; git commit -m y', 'true | git commit -m z', 'git -c user.name=a commit -m x', 'git -C sub commit -m x', 'git --no-pager commit -m x', '(git commit -m x)', 'cd a && (git add . && git commit -m x)'];
    const no = ['git commit-tree abc', 'git commit-graph write', 'echo commit', 'git log --grep commit', 'git commit --dry-run -m x'];
    for (const c of yes) expect(isCommitCommand(c), c).toBe(true);
    for (const c of no) expect(isCommitCommand(c), c).toBe(false);
  });

  describe('session-start (A-02, A-03, B-01, B-10, B-11, J-04, K3-13)', () => {
    it("gives the owner the full context: seat, track, the seat's task and its open messages", () => {
      setup(); bindAs('A'); ownTask('T002');
      mkdirSync(wp('dbcache', 'messages'), { recursive: true });
      writeFileSync(wp('dbcache', 'messages', 'm1.json'), JSON.stringify({ ts: ago(5), from: 'ui', to: 'backend', type: 'reply', text: 'x', status: 'open' }));
      const r = hook('session-start', { session_id: 'A', source: 'startup' });
      expect(JSON.parse(r.stdout).hookSpecificOutput.hookEventName).toBe('SessionStart');
      const ctx = context(r);
      for (const w of ['project demo-shop', 'Session backend track backend', 'Current task: T002 API de pedidos', 'Open messages: 1', '/waypoint:work']) expect(ctx).toContain(w);
    });
    it("the owner's task is the one its seat has claimed or in progress in the state cache, never a done one or another seat's", () => {
      setup(); bindAs('A');
      ownTask('T001', 'backend', 'done'); ownTask('T003', 'ui');
      expect(context(hook('session-start', { session_id: 'A' }))).toContain('Current task: none');
      ownTask('T002', 'backend', 'claimed');
      expect(context(hook('session-start', { session_id: 'A' }))).toContain('Current task: T002 API de pedidos');
    });
    it('is silent without docs/waypoint and survives a corrupt plan', () => {
      expect(hook('session-start', { session_id: 'A' })).toEqual({ code: 0, stdout: '', stderr: '' });
      mkdirSync(docsDir(), { recursive: true });
      writeFileSync(path.join(docsDir(), 'plan.yaml'), 'not: [yaml');
      bindAs('A');
      const c = hook('session-start', { session_id: 'A' });
      expect(c.code).toBe(0);
      expect(c.stderr).toBe('');
      expect(c.stdout).not.toMatch(/error|Error|Unexpected/);
    });
    it('keeps the owner context when the messages cache is corrupt', () => {
      setup(); bindAs('A');
      mkdirSync(wp('dbcache', 'messages'), { recursive: true });
      writeFileSync(wp('dbcache', 'messages', 'm1.json'), '{oops');
      const ctx = context(hook('session-start', { session_id: 'A' }));
      expect(ctx).toContain('project demo-shop');
      expect(ctx).toContain('Open messages: 0');
    });
    it('another live session gets one fact for every source, never the task to continue; a fork says so', () => {
      setup(); bindAs('A'); ownTask('T002');
      for (const source of ['startup', 'resume', 'clear', 'compact', 'fork']) {
        const ctx = context(hook('session-start', { session_id: 'B', source }));
        for (const w of ['Another session (seat backend, seen 1 min ago)', 'T002 "API de pedidos"', 'not bound to the roadmap']) expect(ctx, source).toContain(w);
        for (const w of NOT_OWNER) expect(ctx, source).not.toContain(w);
        expect(ctx.includes('fork'), source).toBe(source === 'fork');
      }
      expect(bound().claude).toBe('A');
    });
    it('a later conversation is offered what was left in progress for 24 hours, and nothing after', () => {
      setup(); bindAs('A', { endedAt: ago(120), endReason: 'clear' }); ownTask('T002');
      const ctx = context(hook('session-start', { session_id: 'C', source: 'startup' }));
      for (const w of ['T002 "API de pedidos"', 'seat backend', 'ended by /clear 2 h ago', '/waypoint:work resume']) expect(ctx).toContain(w);
      for (const w of NOT_OWNER) expect(ctx).not.toContain(w);
      const later = context(hook('session-start', { session_id: 'C', source: 'startup' }, { now: () => new Date(NOW + 23 * 3600_000) }));
      expect(later).toContain('no session is bound to it');
      expect(later).not.toContain('T002');
      bindAs('A', { endedAt: ago(0.5), endReason: 'clear' });
      expect(context(hook('session-start', { session_id: 'C', source: 'clear' }))).toContain('ended by /clear just now');
      bindAs('A', { seenAt: ago(20) });
      expect(context(hook('session-start', { session_id: 'C', source: 'startup' }))).toContain('last seen 20 min ago');
    });
    it('resume and compact reopen the owner binding; a resume after an hour says how long', () => {
      setup(); bindAs('A', { endedAt: ago(90), endReason: 'resume' });
      const ctx = context(hook('session-start', { session_id: 'A', source: 'resume', seconds_since_last_response: 7300 }));
      expect(ctx.startsWith('Resumed after 2 h. waypoint: project demo-shop')).toBe(true);
      expect(bound()).toMatchObject({ endedAt: null, endReason: null, seenAt: new Date(NOW).toISOString() });
      bindAs('A', { endedAt: ago(5), endReason: 'other' });
      expect(context(hook('session-start', { session_id: 'A', source: 'compact' }))).toContain('Current task: none');
      expect(bound().endedAt).toBeNull();
    });
    it('an owner bound for the infinite run, or for a forge run with no task open, hears one fact, not the work skill (M8)', () => {
      setup();
      for (const via of ['forge-infinite', 'forge-run']) {
        bindAs('A', { via });
        for (const source of ['compact', 'resume']) {
          const ctx = context(hook('session-start', { session_id: 'A', source }));
          expect(ctx, `${via} ${source}`).toContain('seat backend');
          for (const w of NOT_OWNER) expect(ctx, `${via} ${source}`).not.toContain(w);
        }
      }
      ownTask('T002');
      expect(context(hook('session-start', { session_id: 'A', source: 'compact' }))).toContain('Current task: T002');
    });
    it('a released binding stays released through a compact or a resume: neither reopened nor renewed, and the seat stays free', () => {
      setup();
      for (const source of ['compact', 'resume']) {
        bindAs('A', { seenAt: ago(4), endedAt: ago(2), endReason: 'released' });
        hook('session-start', { session_id: 'A', source, seconds_since_last_response: 7300 });
        expect(bound(), source).toMatchObject({ claude: 'A', seenAt: ago(4), endedAt: ago(2), endReason: 'released' });
      }
      expect(run(['bind', 'docs/waypoint/demo-shop/plan.yaml', '--via', 'work', '--claude', 'B'], { ...io, env: {} }).code).toBe(0);
    });
    it('the coordinator and a member of the execution hear from forge only, and so does anyone else (B-10, K5-10)', () => {
      setup(); bindAs('claude-member', { via: 'forge-member' });
      const T = ago(10);
      mkdirSync(path.join(dir, '.forge', 'members'), { recursive: true });
      writeFileSync(path.join(dir, '.forge', 'execution.json'), JSON.stringify({ runId: 'r1', kind: 'plan', mode: 'sessions', parallel: 2, project: 'demo-shop', base: 'main', branch: 'forge/run-demo-shop', mergeOnFinish: false,
        coordinator: 'main', hookSession: 'claude-coord', active: true, stopReason: null, stallReason: null, startedAt: T, lastStepAt: T, lastBlockStep: null, sleepUntil: null, tasks: {} }));
      writeFileSync(path.join(dir, '.forge', 'members', 'backend.json'), JSON.stringify({ sessionId: 'backend', role: 'executor', runId: 'r1', task: 'T002', name: null, since: T, hookSession: 'claude-member' }));
      for (const s of ['claude-coord', 'claude-member', 'someone-else']) expect(hook('session-start', { session_id: s, source: 'startup' }).stdout, s).toBe('');
      // No implicit binding: waypoint's hooks never write forge's files.
      expect(JSON.parse(readFileSync(path.join(dir, '.forge', 'execution.json'), 'utf8')).hookSession).toBe('claude-coord');
    });
    it('without a binding a plan is announced on a fresh start only and a design never; the owner of a draft hears of it (K3-13)', () => {
      setup();
      const none = context(hook('session-start', { session_id: 'B', source: 'startup' }));
      for (const w of ['project demo-shop has a roadmap', 'no session is bound to it']) expect(none).toContain(w);
      for (const source of ['resume', 'clear', 'compact', 'fork']) expect(hook('session-start', { session_id: 'B', source }).stdout, source).toBe('');
      rmSync(path.join(docsDir(), 'plan.yaml'));
      copyFileSync(new URL('./fixtures/design.md', import.meta.url), path.join(docsDir(), 'design.md'));
      expect(hook('session-start', { session_id: 'B', source: 'startup' }).stdout).toBe('');
      bindAs('A', { via: 'design' });
      expect(context(hook('session-start', { session_id: 'A' }))).toContain('design document demo-shop v0 (draft)');
      writeFileSync(path.join(docsDir(), 'design.md'), readFileSync(path.join(docsDir(), 'design.md'), 'utf8').replace('start_prompt:', 'status: parked\nstart_prompt:'));
      expect(hook('session-start', { session_id: 'A' }).stdout).toBe('');
    });
    it('an input without a session id, with a source or a reason the engine may add later, or broken never fails (Review Focus 5)', () => {
      setup(); bindAs('A');
      // M1, spec §4.3 point 1: without a valid session id only session-start acts, with role none.
      for (const input of [{}, { session_id: null }, { session_id: '../x' }]) {
        const none = context(hook('session-start', input));
        expect(none, JSON.stringify(input)).toBe('waypoint: project demo-shop has a roadmap (not published); no session is bound to it.');
      }
      bindAs('A', { endedAt: ago(30), endReason: 'clear' }); ownTask('T002');
      expect(context(hook('session-start', {}))).not.toContain('left in progress');
      bindAs('A');
      expect(context(hook('session-start', { session_id: 'A', source: 'teleport' }))).toContain('Session backend');
      expect(hook('session-start', 'not json')).toEqual({ code: 0, stdout: '', stderr: '' });
      for (const sub of ['post-commit', 'stop', 'session-end']) expect(hook(sub, { tool_input: { command: 'git commit -m x' } }), sub).toEqual({ code: 0, stdout: '', stderr: '' });
      hook('session-end', { session_id: 'A', reason: 'teleported' });
      expect(bound()).toMatchObject({ endedAt: new Date(NOW).toISOString(), endReason: 'other' });
    });
    it('a corrupt binding, a missing .waypoint or an unreadable seat binds nobody, and no hook fails (§4.10)', () => {
      setup(); gitInit();
      const quiet = { code: 0, stdout: '', stderr: '' };
      const every = (claude: string) => {
        expect(context(hook('session-start', { session_id: claude, cwd: dir }))).toContain('no session is bound to it');
        for (const sub of ['post-commit', 'stop', 'session-end']) expect(hook(sub, { session_id: claude, cwd: dir, tool_input: { command: 'git commit -m x' } }), sub).toEqual(quiet);
      };
      // No .waypoint at all: nothing is created.
      every('A');
      expect(existsSync(path.join(dir, '.waypoint'))).toBe(false);
      // A corrupt bound.json in the checkout seat, an extra seat whose bound.json cannot be read, another that is a file.
      bindAs('A'); ownTask('T002');
      const corrupt = '{"sid":"backend","claude":';
      writeFileSync(wp('bound.json'), corrupt);
      mkdirSync(wp('seats', 'main-2', 'bound.json'), { recursive: true });
      writeFileSync(wp('seats', 'main-3'), 'not a seat');
      commitFile('a.txt');
      every('A');
      expect(readFileSync(wp('bound.json'), 'utf8')).toBe(corrupt);
      expect(pendingLines()).toHaveLength(0);
      expect(existsSync(wp('last-head.json'))).toBe(false);
    });
    it("stores the owner's HEAD as its base in last-head.json, and nothing for another session", () => {
      setup(); gitInit(); bindAs('A');
      hook('session-start', { session_id: 'B', cwd: dir });
      expect(existsSync(wp('last-head.json'))).toBe(false);
      hook('session-start', { session_id: 'A', cwd: dir });
      const lh = JSON.parse(readFileSync(wp('last-head.json'), 'utf8'));
      expect(lh.session).toBe('A');
      expect(Object.values(lh.heads)).toEqual([git('rev-parse', 'HEAD')]);
    });
    it('resolves the project from CLAUDE_PROJECT_DIR, then the input cwd, then the process cwd', () => {
      setup();
      const elsewhere = mkdtempSync(path.join(tmpdir(), 'wp-else-'));
      const at = (stdin: object, env: Record<string, string> = {}) =>
        run(['hook', 'session-start'], { ...io, cwd: elsewhere, env, stdin: JSON.stringify(stdin) }).stdout.trim();
      expect(at({})).toBe('');
      expect(at({ cwd: dir })).toContain('project demo-shop');
      expect(at({ cwd: elsewhere }, { CLAUDE_PROJECT_DIR: dir })).toContain('project demo-shop');
      expect(at({ cwd: dir }, { CLAUDE_PROJECT_DIR: elsewhere })).toBe('');
      expect(run(['hook', 'session-start'], { ...io, env: {}, stdin: '{}' }).stdout).toContain('project demo-shop');
    });
  });

  describe('session-end (A-03)', () => {
    it('closes every binding of its session with its reason, and touches no other', () => {
      setup();
      bindAs('A');
      bindAs('A', {}, 'main-2', wp('seats', 'main-2'));
      bindAs('B', {}, 'main-3', wp('seats', 'main-3'));
      expect(hook('session-end', { session_id: 'A', reason: 'clear' })).toEqual({ code: 0, stdout: '', stderr: '' });
      for (const seat of [wp(), wp('seats', 'main-2')]) expect(bound(seat)).toMatchObject({ endedAt: new Date(NOW).toISOString(), endReason: 'clear' });
      expect(bound(wp('seats', 'main-3')).endedAt).toBeNull();
    });
  });

  describe('post-commit (A-17, B-05)', () => {
    const commit = (claude: string, command = 'git commit -m x', over: Partial<Io> = {}, extra: Record<string, unknown> = {}) =>
      hook('post-commit', { session_id: claude, cwd: dir, tool_input: { command }, ...extra }, over);
    it('records every commit HEAD gained for the owner, whatever the command, and only once', () => {
      setup(); gitInit(); bindAs('A'); ownTask('T002');
      hook('session-start', { session_id: 'A', cwd: dir });
      const sha = commitFile('a.txt');
      expect(commit('A', 'bash -c "git commit -m T002"')).toEqual({ code: 0, stdout: '', stderr: '' });
      expect(pendingLines().map(l => JSON.parse(l))).toEqual([{ ts: new Date(NOW).toISOString(), task: 'T002', sha, command: 'bash -c "git commit -m T002"', session: 'A', seat: 'backend' }]);
      commit('A', 'git commit -m again');
      commit('A', 'echo nothing moved');
      expect(pendingLines()).toHaveLength(1);
    });
    it('with no base yet only a commit command records HEAD; a dry run does not', () => {
      setup(); gitInit(); bindAs('A'); ownTask('T002');
      const sha = commitFile('a.txt');
      commit('A', 'git commit --dry-run -m x');
      expect(pendingLines()).toHaveLength(0);
      rmSync(wp('last-head.json'), { force: true });
      commit('A', 'git commit -m x');
      expect(JSON.parse(pendingLines()[0]).sha).toBe(sha);
    });
    it('finds the task in the state cache, claimed as well as in progress', () => {
      setup(); gitInit(); bindAs('A'); ownTask('T002', 'backend', 'claimed');
      commitFile('a.txt');
      commit('A', 'git commit -m x');
      expect(JSON.parse(pendingLines()[0]).task).toBe('T002');
    });
    it('a merge records only its own commit, and an amend drops the line of the commit it replaced', () => {
      setup(); gitInit(); bindAs('A'); ownTask('T002');
      hook('session-start', { session_id: 'A', cwd: dir });
      git('checkout', '-q', '-b', 'side');
      commitFile('s.txt');
      git('checkout', '-q', '-');
      git('merge', '--no-ff', '-q', '-m', 'merge side', 'side');
      const merge = git('rev-parse', 'HEAD');
      commit('A', 'git merge --no-ff side');
      expect(pendingLines().map(l => JSON.parse(l).sha)).toEqual([merge]);
      git('commit', '-q', '--amend', '-m', 'merge side, again');
      const amended = git('rev-parse', 'HEAD');
      commit('A', 'git commit --amend');
      expect(pendingLines().map(l => JSON.parse(l).sha)).toEqual([amended]);
    });
    it('reads HEAD in the worktree of the command, with a base of its own', () => {
      setup(); gitInit(); bindAs('A'); ownTask('T002');
      hook('session-start', { session_id: 'A', cwd: dir });
      const wt = path.join(mkdtempSync(path.join(tmpdir(), 'wp-wt-')), 'wt');
      git('worktree', 'add', '-q', '-b', 'other', wt);
      writeFileSync(path.join(wt, 'w.txt'), 'w');
      gitAt(wt, 'add', 'w.txt');
      gitAt(wt, 'commit', '-q', '-m', 'in wt');
      const there = gitAt(wt, 'rev-parse', 'HEAD');
      commit('A', 'git commit -m "in wt"', { env: { CLAUDE_PROJECT_DIR: dir } }, { cwd: wt });
      expect(pendingLines().map(l => JSON.parse(l).sha)).toEqual([there]);
      expect(Object.keys(JSON.parse(readFileSync(wp('last-head.json'), 'utf8')).heads)).toHaveLength(2);
    });
    it('records at most 20 commits per call: the newest, oldest first', () => {
      setup(); gitInit(); bindAs('A'); ownTask('T002');
      hook('session-start', { session_id: 'A', cwd: dir });
      for (let i = 1; i <= 22; i++) git('commit', '-q', '--allow-empty', '-m', `c${i}`);
      commit('A');
      expect(pendingLines().map(l => JSON.parse(l).sha)).toEqual(git('rev-list', '--max-count=20', 'HEAD').split('\n').reverse());
    });
    it('a reset or a rebase drops the lines of the commits HEAD no longer reaches', () => {
      setup(); gitInit(); bindAs('A'); ownTask('T002');
      hook('session-start', { session_id: 'A', cwd: dir });
      const a = commitFile('a.txt');
      commit('A');
      const b = commitFile('b.txt');
      commit('A');
      expect(pendingLines().map(l => JSON.parse(l).sha)).toEqual([a, b]);
      git('reset', '-q', '--hard', 'HEAD~1');
      commit('A', 'git reset --hard HEAD~1');
      expect(pendingLines().map(l => JSON.parse(l).sha)).toEqual([a]);
      const c = commitFile('c.txt');
      commit('A');
      expect(pendingLines().map(l => JSON.parse(l).sha)).toEqual([a, c]);
      // a is dropped from under c, which is replayed onto the base with a new sha.
      git('rebase', '-q', '--onto', 'HEAD~2', 'HEAD~1');
      const replayed = git('rev-parse', 'HEAD');
      commit('A', 'git rebase --onto HEAD~2 HEAD~1');
      expect(pendingLines().map(l => JSON.parse(l).sha)).toEqual([replayed]);
    });
    it('a renewal that cannot be written never drops a commit, nor the reminder', () => {
      setup(); gitInit(); bindAs('A'); ownTask('T002');
      hook('session-start', { session_id: 'A', cwd: dir });
      bindAs('A', { seenAt: ago(4) });
      // bound.json can no longer be replaced: the temporary file writeAtomic writes is a directory.
      mkdirSync(wp(`bound.json.${process.pid}.tmp`));
      const sha = commitFile('a.txt');
      commit('A');
      expect(pendingLines().map(l => JSON.parse(l).sha)).toEqual([sha]);
      expect(bound().seenAt).toBe(ago(4));
      ownTask('T002', 'backend', 'done');
      expect(JSON.parse(hook('stop', { session_id: 'A' }).stdout).decision).toBe('block');
      expect(bound().seenAt).toBe(ago(4));
    });
    it('an owner by execution records nothing: forge records its commits through integrate (§4.3)', () => {
      setup(); gitInit(); ownTask('T002');
      const T = ago(10);
      mkdirSync(path.join(dir, '.forge', 'members'), { recursive: true });
      writeFileSync(path.join(dir, '.forge', 'execution.json'), JSON.stringify({ runId: 'r1', kind: 'plan', mode: 'sessions', parallel: 2, project: 'demo-shop', base: 'main', branch: 'forge/run-demo-shop', mergeOnFinish: false,
        coordinator: 'main', hookSession: 'claude-coord', active: true, stopReason: null, stallReason: null, startedAt: T, lastStepAt: T, lastBlockStep: null, sleepUntil: null, tasks: {} }));
      writeFileSync(path.join(dir, '.forge', 'members', 'backend.json'), JSON.stringify({ sessionId: 'backend', role: 'executor', runId: 'r1', task: 'T002', name: null, since: T, hookSession: 'claude-member' }));
      for (const s of ['claude-coord', 'claude-member']) {
        bindAs(s, { via: 'forge-member' });
        hook('session-start', { session_id: s, cwd: dir });
        commitFile(`${s}.txt`);
        commit(s);
      }
      expect(pendingLines()).toHaveLength(0);
      expect(existsSync(wp('last-head.json'))).toBe(false);
    });
    it('another session records nothing, and its commits never reach the seat (A-02)', () => {
      setup(); gitInit(); bindAs('A'); ownTask('T002');
      hook('session-start', { session_id: 'A', cwd: dir });
      commitFile('b.txt');
      commit('B');
      expect(pendingLines()).toHaveLength(0);
    });
    it('between tasks the base follows HEAD: what was committed with no task open is never given to the next task (Review Focus 2)', () => {
      setup(); gitInit(); bindAs('A');
      hook('session-start', { session_id: 'A', cwd: dir });
      commitFile('between.txt');
      commit('A', 'git merge main');
      expect(pendingLines()).toHaveLength(0);
      ownTask('T002');
      const sha = commitFile('task.txt');
      commit('A');
      expect(pendingLines().map(l => JSON.parse(l).sha)).toEqual([sha]);
    });
    it("two seats in one worktree: each records only what its own commit commands made, and the other's Bash calls only move its base (C2)", () => {
      setup(); writeFileSync(path.join(dir, '.gitignore'), '.waypoint/\n'); gitInit();
      bindAs('A', {}, 'main'); ownTask('T001', 'main');
      const seat2 = wp('seats', 'main-2');
      bindAs('B', {}, 'main-2', seat2); ownTask('T003', 'main-2');
      hook('session-start', { session_id: 'A', cwd: dir });
      hook('session-start', { session_id: 'B', cwd: dir });
      // Each commit is followed by the hook of the conversation that made it; the other's Bash calls come in between.
      const a1 = commitFile('a1.txt');
      commit('A', 'git commit -m a1');
      commit('B', 'npm test');
      const b1 = commitFile('b1.txt');
      commit('B', 'git commit -m b1');
      // A commits again with no Bash call of its own since b1 (its edits went through the Edit tool).
      const a2 = commitFile('a2.txt');
      commit('A', 'git add a2.txt && git commit -m a2');
      commit('B', 'ls');
      const b2 = commitFile('b2.txt');
      commit('B', 'git cherry-pick --continue');
      commit('A', 'npm test');
      // A commit command that makes nothing (a pre-commit hook refused it) right after the other's commit takes nothing.
      const b3 = commitFile('b3.txt');
      commit('B', 'git commit -m b3');
      commit('A', 'git commit -m refused');
      // A's Bash call ends between B's commit and B's hook: B still records its commit.
      const b4 = commitFile('b4.txt');
      commit('A', 'ls');
      commit('B', 'git commit -m b4');
      expect(pendingLines().map(l => JSON.parse(l).sha)).toEqual([a1, a2]);
      expect(pendingLines(seat2).map(l => JSON.parse(l).sha)).toEqual([b1, b2, b3, b4]);
    });
    describe('two seats in one worktree: the edges (C2)', () => {
      const seat2 = () => wp('seats', 'main-2');
      const shas = (seat = wp()) => pendingLines(seat).map(l => JSON.parse(l).sha);
      const twoSeats = () => {
        setup(); writeFileSync(path.join(dir, '.gitignore'), '.waypoint/\n'); gitInit();
        bindAs('A', {}, 'main'); ownTask('T001', 'main');
        bindAs('B', {}, 'main-2', seat2()); ownTask('T003', 'main-2');
        hook('session-start', { session_id: 'A', cwd: dir });
        hook('session-start', { session_id: 'B', cwd: dir });
      };
      it('what a seat recorded stays its own after it ended: the position rule does not hand it to the other', () => {
        twoSeats();
        const b1 = commitFile('b1.txt');
        commit('B', 'git commit -m b1');
        hook('session-end', { session_id: 'B', reason: 'prompt_input_exit' });
        commit('A', 'npm test');
        expect(shas()).toEqual([]);
        const a1 = commitFile('a1.txt');
        commit('A', 'git commit -m a1');
        expect(shas()).toEqual([a1]);
        expect(shas(seat2())).toEqual([b1]);
      });
      it('a commit command that makes nothing takes nothing, also once the other seat removed its line', () => {
        twoSeats();
        commitFile('b1.txt');
        commit('B', 'git commit -m b1');
        writeFileSync(pending(seat2()), '');
        commit('A', 'git add -A && git commit -m wip');
        expect(shas()).toEqual([]);
      });
      it("a long command's commit that the other seat recorded first is never lost: a duplicate at worst", () => {
        twoSeats();
        // A runs `git commit -m a1 && git push`; during the push B commits and its hook runs; then A's hook.
        const a1 = commitFile('a1.txt');
        const b1 = commitFile('b1.txt');
        commit('B', 'git commit -m b1');
        commit('A', 'git commit -m a1 && git push');
        expect(shas()).toEqual([a1]);
        expect(shas(seat2())).toEqual([a1, b1]);
      });
      it("another seat's pull is not this seat's: its base marks what it saw", () => {
        twoSeats();
        git('checkout', '-q', '-b', 'upstream');
        const p1 = commitFile('p1.txt');
        git('checkout', '-q', '-');
        git('merge', '-q', '--ff-only', 'upstream');
        commit('B', 'git pull');
        const a1 = commitFile('a1.txt');
        commit('A', 'git commit -m a1');
        expect(shas()).toEqual([a1]);
        expect(shas(seat2())).not.toContain(p1);
      });
    });
    it('the commands that make commits on HEAD: commit, merge, cherry-pick, revert, rebase --continue and am (C2)', () => {
      const yes = ['git commit -m x', 'git merge --no-ff side', 'git -c a=b cherry-pick abc', 'x && git revert HEAD', 'git rebase --continue', 'git rebase -q --continue', 'git am < p.patch'];
      const no = ['git merge-base a b', 'git pull', 'git rebase main', 'git status', 'npm test', 'git log --grep merge', 'git amend'];
      for (const c of yes) expect(makesCommits(c), c).toBe(true);
      for (const c of no) expect(makesCommits(c), c).toBe(false);
    });
    it('two seats: main-2 records in its own files and the Stop of the checkout seat does not count them (B-05, K5-05)', () => {
      setup(); gitInit(); bindAs('A'); ownTask('T001');
      const seat2 = wp('seats', 'main-2');
      bindAs('C', {}, 'main-2', seat2); ownTask('T003', 'main-2');
      hook('session-start', { session_id: 'C', cwd: dir });
      const sha = commitFile('c.txt');
      commit('C');
      expect(pendingLines(seat2).map(l => JSON.parse(l))).toEqual([expect.objectContaining({ sha, task: 'T003', seat: 'main-2', session: 'C' })]);
      expect(pendingLines()).toHaveLength(0);
      expect(hook('stop', { session_id: 'A' }).stdout).toBe('');
      ownTask('T003', 'main-2', 'done');
      expect(JSON.parse(hook('stop', { session_id: 'C' }).stdout).reason).toContain('.waypoint/demo-shop/seats/main-2/pending-commits.jsonl');
    });
  });

  describe('stop (B-05, A-07)', () => {
    it('reminds the owner once per distinct pending set, and never blocks another session (A-02)', () => {
      setup(); bindAs('A');
      expect(hook('stop', { session_id: 'A' }).stdout.trim()).toBe('');
      writeFileSync(pending(), '{"ts":"x","task":"T002","command":"git commit","sha":"a"}\n');
      expect(hook('stop', { session_id: 'B' }).stdout).toBe('');
      const out = JSON.parse(hook('stop', { session_id: 'A' }).stdout);
      expect(out.decision).toBe('block');
      expect(out.reason).toBe("waypoint: 1 commit(s) / 0 queued roadmap update(s) are not in the live roadmap yet. Record them (work skill: a `commit` event for intermediate commits, or the task's completion), or flush the queue, then remove those lines from .waypoint/demo-shop/pending-commits.jsonl. You can also stop now; this reminder shows once per change. Tell the user in Spanish (es), the plan's language.");
      expect(hook('stop', { session_id: 'A' }).stdout.trim()).toBe('');
      writeFileSync(pending(), '{"ts":"x","task":"T002","command":"git commit","sha":"a"}\n{"ts":"y","task":"T002","command":"git commit","sha":"b"}\n');
      expect(JSON.parse(hook('stop', { session_id: 'A' }).stdout).reason).toContain('2 commit(s)');
      expect(hook('stop', { session_id: 'A', stop_hook_active: true }).stdout.trim()).toBe('');
      expect(hook('stop', 'not json')).toEqual({ code: 0, stdout: '', stderr: '' });
    });
    it('counts a commit once even when parallel hooks wrote its line twice (M3)', () => {
      setup(); bindAs('A');
      writeFileSync(pending(), '{"ts":"x","task":"T002","command":"git commit","sha":"a"}\n{"ts":"x","task":"T002","command":"git commit","sha":"a"}\n');
      expect(JSON.parse(hook('stop', { session_id: 'A' }).stdout).reason).toContain('waypoint: 1 commit(s)');
    });
    it('reminds the owner of queued roadmap updates alone', () => {
      setup(); bindAs('A');
      writeFileSync(wp('queue.jsonl'), '{"op":"set"}\n');
      const out = JSON.parse(hook('stop', { session_id: 'A' }).stdout);
      expect(out.decision).toBe('block');
      expect(out.reason).toContain('0 commit(s) / 1 queued');
      expect(hook('stop', { session_id: 'A' }).stdout.trim()).toBe('');
    });
    it("the owner's hooks renew its binding at most once a minute, so another session still finds it alive (Review Focus 3)", () => {
      setup(); bindAs('A', { seenAt: ago(4) });
      hook('stop', { session_id: 'A' });
      expect(bound().seenAt).toBe(new Date(NOW).toISOString());
      bindAs('A', { seenAt: ago(0.5) });
      hook('stop', { session_id: 'A' });
      expect(bound().seenAt).toBe(ago(0.5));
      bindAs('A', { seenAt: ago(4) });
      hook('stop', { session_id: 'A' });
      const later: Io = { ...io, env: {}, now: () => new Date(NOW + 4 * 60000) };
      expect(run(['bind', 'docs/waypoint/demo-shop/plan.yaml', '--via', 'work', '--claude', 'B'], later).code).toBe(3);
      bindAs('A', { seenAt: ago(4), endedAt: ago(1), endReason: 'released' });
      hook('stop', { session_id: 'A' });
      expect(bound().seenAt).toBe(ago(4));
    });
    it('renew only the newest of the conversation\'s live bindings in the project; the others lapse, as the band does (M5)', () => {
      setup();
      // backend was released by A's bind --second-seat, and a renewal raced it back to life: two live bindings of A.
      bindAs('A', { seenAt: ago(3) });
      bindAs('A', { seenAt: ago(2) }, 'main-2', wp('seats', 'main-2'));
      hook('stop', { session_id: 'A' });
      expect(bound(wp('seats', 'main-2')).seenAt).toBe(new Date(NOW).toISOString());
      expect(bound().seenAt).toBe(ago(3));
      // A resume reopens and renews the newest one only.
      bindAs('A', { seenAt: ago(3) });
      bindAs('A', { seenAt: ago(2), endedAt: ago(1), endReason: 'resume' }, 'main-2', wp('seats', 'main-2'));
      hook('session-start', { session_id: 'A', source: 'resume' });
      expect(bound(wp('seats', 'main-2'))).toMatchObject({ seenAt: new Date(NOW).toISOString(), endedAt: null, endReason: null });
      expect(bound().seenAt).toBe(ago(3));
    });

    describe('during a forge execution (A-07)', () => {
      const T = '2026-10-11T09:50:00.000Z';
      const forge = (file: string, v: unknown) => {
        mkdirSync(path.dirname(path.join(dir, '.forge', file)), { recursive: true });
        writeFileSync(path.join(dir, '.forge', file), typeof v === 'string' ? v : JSON.stringify(v));
      };
      const exec = (over: Record<string, unknown> = {}) => ({
        runId: 'r1', kind: 'plan', mode: 'subagents', parallel: 3, project: 'demo-shop', base: 'main', branch: 'forge/run-demo-shop', mergeOnFinish: false,
        coordinator: 'main', hookSession: 'claude-coord', active: true, stopReason: null, stallReason: null, startedAt: T, lastStepAt: null,
        lastBlockStep: null, sleepUntil: null, tasks: {}, ...over,
      });
      const blocks = (sessionId: string) => hook('stop', { session_id: sessionId }).stdout.includes('"decision":"block"');
      beforeEach(() => {
        setup();
        mkdirSync(wp(), { recursive: true });
        writeFileSync(pending(), '{"ts":"x","task":"T001","command":"git commit","sha":"a"}\n');
      });
      it('never blocks the coordinator, a member of the execution or the infinite run, even bound to the seat', () => {
        forge('execution.json', exec());
        forge('members/backend.json', { sessionId: 'backend', role: 'executor', runId: 'r1', task: 'T002', name: null, since: T, hookSession: 'claude-member' });
        forge('run.json', { mode: 'infinite', active: true, startedAt: T, budget: { cycles: 3 }, cycle: 0, noProgress: 0, lastError: null, repeatedError: false, lastBlockEvents: null, queueMax: 10, sessionId: 'claude-inf', blocksSinceCycle: 0 });
        for (const s of ['claude-coord', 'claude-member', 'claude-inf']) {
          bindAs(s, { via: 'forge-run' });
          expect(blocks(s), s).toBe(false);
        }
        bindAs('owner');
        expect(blocks('owner')).toBe(true);
      });
      it("an active execution of another project, or the checkout's ephemeral run, still steps its own sessions: no reminder for them", () => {
        forge('execution.json', exec({ project: 'other-shop' }));
        forge('members/m1.json', { sessionId: 'm1', role: 'executor', runId: 'r1', task: 'T002', name: null, since: T, hookSession: 'claude-member' });
        for (const s of ['claude-coord', 'claude-member']) {
          bindAs(s);
          expect(blocks(s), s).toBe(false);
        }
        forge('execution.json', exec({ kind: 'ephemeral', project: 'scratch' }));
        bindAs('claude-coord');
        expect(blocks('claude-coord')).toBe(false);
        bindAs('owner');
        expect(blocks('owner')).toBe(true);
      });
      it("read the members as the band does: the 50 newest files of 8 KiB or less, so both give one session the same role", () => {
        forge('execution.json', exec({ mode: 'sessions' }));
        bindAs('claude-member', { via: 'forge-member' });
        const member = { sessionId: 'backend', role: 'executor', runId: 'r1', task: 'T002', name: null, since: T, hookSession: 'claude-member' };
        const file = path.join(dir, '.forge', 'members', 'backend.json');
        const at = (ms: number) => { const d = new Date(Date.now() + ms); utimesSync(file, d, d); };
        for (let i = 0; i < 50; i++) forge(`members/m${i}.json`, { sessionId: `m${i}`, role: 'executor', runId: 'r0', task: null, name: null, since: T, hookSession: null });
        // Among the 50 newest: the run's member, which forge steps (no reminder).
        forge('members/backend.json', member);
        at(3600_000);
        expect(blocks('claude-member')).toBe(false);
        // The 51st newest is not read: the session is the seat's owner, reminded of its commits.
        at(-86_400_000);
        expect(blocks('claude-member')).toBe(true);
        // Nor is a member file over 8 KiB, however new.
        writeFileSync(pending(), '{"ts":"y","task":"T001","command":"git commit","sha":"b"}\n');
        forge('members/backend.json', { ...member, pad: 'x'.repeat(9000) });
        at(3600_000);
        expect(blocks('claude-member')).toBe(true);
      });
      it("an open coordinator conversation keeps its run: its own live binding, in any project, seat and via, settled by its pid (2b carry)", () => {
        // 20 minutes without a step or a signal: without a binding, the run has no coordinator.
        forge('execution.json', exec({ lastStepAt: ago(20) }));
        const gone = () => readForge(dir, 'demo-shop', NOW).coordinatorEnded;
        expect(gone()).toBe(true);
        // Bound in another project's extra seat (a takeover through /waypoint:work binds `work`): it waits on the person.
        const seat = path.join(dir, '.waypoint', 'other', 'seats', 'main-2');
        bindAs('claude-coord', {}, 'main-2', seat);
        expect(gone()).toBe(false);
        // Its process died (the hooks check the pid; the band cannot), its binding ended, or it lapsed: no coordinator.
        bindAs('claude-coord', { pid: 2147483646 }, 'main-2', seat);
        expect(gone()).toBe(true);
        bindAs('claude-coord', { endedAt: ago(2), endReason: 'other' }, 'main-2', seat);
        expect(gone()).toBe(true);
        bindAs('claude-coord', { seenAt: ago(6) }, 'main-2', seat);
        expect(gone()).toBe(true);
        // Another conversation's live binding says nothing of the coordinator.
        bindAs('someone-else', {}, 'main-2', seat);
        expect(gone()).toBe(true);
      });
      it('an active run no session is bound to has no coordinator at once: another session is its previous, whose text forge gives (final review, item 9)', () => {
        forge('execution.json', exec({ hookSession: null, lastStepAt: ago(1) }));
        const f = readForge(dir, 'demo-shop', NOW);
        expect(f.coordinatorEnded).toBe(true);
        expect(describeViewer({ bound: null, execution: f.exec, members: [], sessionId: 'someone-else', now: NOW, coordinatorEnded: f.coordinatorEnded }))
          .toMatchObject({ role: 'previous', subject: 'execution' });
        // B-10: waypoint's SessionStart leaves a run's text to forge's live hook.
        expect(hook('session-start', { session_id: 'someone-else', source: 'startup' }).stdout).toBe('');
      });
      it('a closed execution or a broken execution.json gives no forge role: the owner is reminded as before', () => {
        bindAs('claude-coord');
        forge('execution.json', exec({ active: false, stopReason: 'stopped', closedAt: T, closedBy: 'close' }));
        expect(blocks('claude-coord')).toBe(true);
        forge('execution.json', '{"runId":');
        writeFileSync(pending(), '{"ts":"y","task":"T001","command":"git commit","sha":"b"}\n');
        expect(blocks('claude-coord')).toBe(true);
      });
      it('the commits of the task the seat has in progress do not count; the others still do', () => {
        bindAs('A');
        ownTask('T001');
        expect(blocks('A')).toBe(false);
        writeFileSync(pending(), '{"ts":"x","task":"T001","command":"git commit","sha":"a"}\n{"ts":"y","task":"T002","command":"git commit","sha":"b"}\n');
        expect(JSON.parse(hook('stop', { session_id: 'A' }).stdout).reason).toContain('1 commit(s)');
        ownTask('T001', 'backend', 'done');
        expect(JSON.parse(hook('stop', { session_id: 'A' }).stdout).reason).toContain('2 commit(s)');
      });
      it('the commits of a task the seat has claimed (not yet started) do not count either', () => {
        bindAs('A');
        ownTask('T001', 'backend', 'claimed');
        expect(blocks('A')).toBe(false);
        writeFileSync(pending(), '{"ts":"x","task":"T001","command":"git commit","sha":"a"}\n{"ts":"y","task":"T002","command":"git commit","sha":"b"}\n');
        expect(JSON.parse(hook('stop', { session_id: 'A' }).stdout).reason).toContain('1 commit(s)');
      });
      const PLAN = 'docs/waypoint/demo-shop/plan.yaml';
      const atMin = (min: number, cwd = dir): Io => ({ ...io, cwd, env: {}, now: () => new Date(NOW + min * 60000) });
      it("the coordinator's hooks renew its own binding whatever its role, so the seat stays held through the run (C1)", () => {
        expect(run(['bind', PLAN, '--via', 'forge-run', '--claude', 'claude-coord'], atMin(0)).code).toBe(0);
        forge('execution.json', exec());
        ownTask('T001', 'main');
        for (const min of [2, 4, 6, 8]) {
          hook('stop', { session_id: 'claude-coord' }, atMin(min));
          hook('post-commit', { session_id: 'claude-coord', tool_input: { command: 'ls' } }, atMin(min));
        }
        expect(bound().seenAt).toBe(new Date(NOW + 8 * 60000).toISOString());
        const b = run(['bind', PLAN, '--via', 'work', '--claude', 'B'], atMin(9));
        expect(b.code).toBe(3);
        expect(JSON.parse(b.stdout).held.claude).toBe('claude-coord');
      });
      it("a member's hooks renew its binding in its task worktree the same way (C1)", () => {
        writeFileSync(path.join(dir, '.gitignore'), '.waypoint/\n.forge/\n.claude/\n');
        gitInit();
        const wt = path.join(dir, '.claude', 'worktrees', 'task-T002');
        git('worktree', 'add', '-q', '-b', 'task/T002', wt);
        expect(run(['bind', PLAN, '--via', 'forge-member', '--claude', 'claude-member'], atMin(0, wt)).code).toBe(0);
        forge('execution.json', exec({ mode: 'sessions' }));
        forge('members/T002.json', { sessionId: 'T002', role: 'executor', runId: 'r1', task: 'T002', name: null, since: T, hookSession: 'claude-member' });
        for (const min of [2, 4, 6, 8]) {
          hook('stop', { session_id: 'claude-member', cwd: wt }, atMin(min, wt));
          hook('post-commit', { session_id: 'claude-member', cwd: wt, tool_input: { command: 'ls' } }, atMin(min, wt));
        }
        const b = run(['bind', PLAN, '--via', 'work', '--claude', 'B'], atMin(9, wt));
        expect(b.code).toBe(3);
        expect(JSON.parse(b.stdout).held.claude).toBe('claude-member');
      });
    });
  });
});

describe('notes command', () => {
  const writeNotes = (docs: Record<string, unknown>) => {
    const d = path.join(dir, 'c', 'notes');
    mkdirSync(d, { recursive: true });
    for (const [id, v] of Object.entries(docs)) writeFileSync(path.join(d, `${id}.json`), typeof v === 'string' ? v : JSON.stringify(v));
    return d;
  };
  const note = { ts: '2026-10-05T00:00:00Z', type: 'idea', author: 'user:u1', text: 'x' };

  it('returns user notes newer than --since and the latest ts of all notes', () => {
    const d = writeNotes({
      old: { ...note, ts: '2026-10-01T00:00:00Z' },
      fresh: note,
      sess: { ...note, author: 'session:S', ts: '2026-10-09T00:00:00Z' },
    });
    const r = run(['notes', '--notes', d, '--since', '2026-10-03T00:00:00Z'], io);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.notes.map((n: { id: string }) => n.id)).toEqual(['fresh']);
    expect(out.latest).toBe('2026-10-09T00:00:00.000Z');
  });
  it('includes a session question answered after since', () => {
    const d = writeNotes({ q: { ...note, author: 'session:S', type: 'question', ts: '2026-10-01T00:00:00Z', answer: 'ok', answeredBy: 'user:u1', answeredAt: '2026-10-08T00:00:00Z' } });
    const out = JSON.parse(run(['notes', '--notes', d, '--since', '2026-10-03T00:00:00Z'], io).stdout);
    expect(out.notes.map((n: { id: string }) => n.id)).toEqual(['q']);
  });
  it('ignores corrupt files and tolerates an invalid --since or missing ts', () => {
    const d = writeNotes({ bad: '{not json', odd: { type: 'nope' }, nots: { type: 'idea', author: 'user:u1', text: 't' }, ok: note });
    const out = JSON.parse(run(['notes', '--notes', d, '--since', 'garbage'], io).stdout);
    expect(out.notes.map((n: { id: string }) => n.id).sort()).toEqual(['nots', 'ok']);
    expect(out.latest).toBe('2026-10-05T00:00:00.000Z');
    const none = JSON.parse(run(['notes', '--notes', d, '--since', '2030-01-01T00:00:00Z'], io).stdout);
    expect(none.notes).toEqual([]);
  });
  it('latest is null for an empty directory', () => {
    const d = writeNotes({});
    expect(JSON.parse(run(['notes', '--notes', d], io).stdout)).toEqual({ notes: [], latest: null, say: [], mentions: [] });
  });
  it('latest covers answeredAt so a second call with it returns nothing', () => {
    const d = writeNotes({ q: { ...note, author: 'session:S', type: 'question', ts: '2026-10-01T00:00:00Z', answer: 'ok', answeredAt: '2026-10-08T00:00:00Z' } });
    const first = JSON.parse(run(['notes', '--notes', d, '--since', '2026-10-03T00:00:00Z'], io).stdout);
    expect(first.notes).toHaveLength(1);
    expect(first.latest).toBe('2026-10-08T00:00:00.000Z');
    expect(JSON.parse(run(['notes', '--notes', d, '--since', first.latest], io).stdout).notes).toEqual([]);
  });
  it('fails with code 1 when --notes is a file', () => {
    const f = path.join(dir, 'afile.json');
    writeFileSync(f, '{}');
    const r = run(['notes', '--notes', f], io);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('notes cache missing — list notes first');
  });
  it('treats a missing notes directory as no notes yet', () => {
    const r = run(['notes', '--notes', path.join(dir, 'nope')], io);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ notes: [], latest: null, say: [], mentions: [] });
  });
  it('fails with code 1 without --notes', () => {
    expect(run(['notes'], io).code).toBe(1);
  });

  describe('say: the line to tell the person', () => {
    const docs = {
      a: { ...note, text: 'Revisad T002 antes que T999 y T0001' },
      b: { ...note, ts: '2026-10-06T00:00:00Z', author: 'user:u2', authorName: 'Ana', text: 'línea\n  dos' },
      q: { ...note, author: 'session:S', type: 'question', ts: '2026-10-01T00:00:00Z', text: '¿T003?', answer: 'sí, T003', answeredBy: 'user:u1', answeredAt: '2026-10-08T00:00:00Z' },
      s: { ...note, author: 'session:S', ts: '2026-10-07T00:00:00Z', text: 'de una sesión' },
    };
    const notes = (...extra: string[]) => JSON.parse(run(['notes', '--notes', writeNotes(docs), '--since', '2026-10-03T00:00:00Z', ...extra], io).stdout);
    it('in Spanish, one line per person note and per answer, with the tasks of the plan it names', () => {
      const out = notes('--plan', 'plan.yaml');
      expect(out.say).toEqual([
        'Nota de una persona en el roadmap: «Revisad T002 antes que T999 y T0001»',
        'Nota de Ana en el roadmap: «línea dos»',
        'Respuesta de una persona en el roadmap: «sí, T003»',
      ]);
      expect(out.mentions).toEqual([['T002'], [], ['T003']]);
    });
    it('in English from --locale, which wins over the plan', () => {
      const out = notes('--plan', 'plan.yaml', '--locale', 'en');
      expect(out.say).toEqual([
        'Someone\'s note on the roadmap: "Revisad T002 antes que T999 y T0001"',
        'Ana\'s note on the roadmap: "línea dos"',
        'Someone\'s answer on the roadmap: "sí, T003"',
      ]);
    });
    it('defaults to English, names no task without a plan and clips long texts to 200 characters', () => {
      const d = writeNotes({ long: { ...note, text: `T002 ${'x'.repeat(300)}` } });
      const out = JSON.parse(run(['notes', '--notes', d], io).stdout);
      expect(out.say).toHaveLength(1);
      const quoted = /"(.*)"$/.exec(out.say[0])![1];
      expect(Array.from(quoted)).toHaveLength(200);
      expect(quoted.endsWith('…')).toBe(true);
      expect(out.mentions).toEqual([[]]);
    });
    it('an empty listing says nothing; a bad --locale is refused', () => {
      expect(JSON.parse(run(['notes', '--notes', path.join(dir, 'nope')], io).stdout)).toEqual({ notes: [], latest: null, say: [], mentions: [] });
      expect(run(['notes', '--notes', writeNotes(docs), '--locale', 'fr'], io).code).toBe(2);
    });
  });
});

describe('next --base (swarm members)', () => {
  const git = (...a: string[]) => execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', '-c', 'core.autocrlf=false', ...a], { cwd: dir, encoding: 'utf8' }).trim();
  const PLAN = `project: shop
locale: es
version: "1"
artifacts: {}
versions: []
tracks:
  - { id: a, name: A, color: blue }
  - { id: b, name: B, color: mauve }
phases:
  - { id: p1, name: P1, plan_status: committed }
tasks:
  - { id: A1, title: A1, track: a, phase: p1, done_when: x, depends_on: [], zones: [src/a/**] }
  - { id: B1, title: B1, track: b, phase: p1, done_when: x, depends_on: [A1], zones: [src/b/**] }
`;
  it('skips a task whose dependency in another track is not in the base branch yet', () => {
    writeFileSync(path.join(dir, 'plan.yaml'), PLAN);
    git('init', '-q', '-b', 'main');
    git('add', 'plan.yaml');
    git('commit', '-qm', 'init');
    git('checkout', '-qb', 'track/a');
    writeFileSync(path.join(dir, 'a.txt'), 'a\n');
    git('add', 'a.txt');
    git('commit', '-qm', 'A1');
    const sha = git('rev-parse', 'HEAD');
    git('checkout', '-q', 'main');
    mkdirSync(path.join(dir, 'st'), { recursive: true });
    writeFileSync(path.join(dir, 'st', 'A1.json'), JSON.stringify({ status: 'done', commits: [{ sha, ts: '', title: 'A1', add: 1, del: 0 }] }));
    const next = (...extra: string[]) => run(['next', 'plan.yaml', '--states', 'st', '--session', 'b', '--track', 'b', ...extra], io);
    expect(JSON.parse(next('--base', 'main').stdout)).toMatchObject({ task: null, waiting_on: [{ taskId: 'B1', dependsOn: 'A1' }] });
    expect(JSON.parse(next().stdout).task.id).toBe('B1');
    git('merge', '-q', '--no-ff', '-m', 'swarm: integrate a', 'track/a');
    const merged = JSON.parse(next('--base', 'main').stdout);
    expect(merged.task.id).toBe('B1');
    expect(merged).not.toHaveProperty('waiting_on');
    expect(next('--base', '-x').code).toBe(2);
    expect(next('--base').code).toBe(2);
  });
});

describe('design-import', () => {
  it('imports a spec into a new design.md, never overwrites one and checks its arguments', () => {
    mkdirSync(path.join(dir, 'docs', 'superpowers', 'specs'), { recursive: true });
    writeFileSync(path.join(dir, 'docs/superpowers/specs/s.md'), '# Cart totals — design\n\n## Purpose\n\nShow totals.\n\n## Scope\n\nx\n');
    const args = ['design-import', 'docs/superpowers/specs/s.md', '--project', 'cart', '--locale', 'en', '--out', 'docs/waypoint/cart/design.md'];
    const r = run(args, io);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ title: 'Cart totals', sections: 2, source: 'docs/superpowers/specs/s.md' });
    const d = parseDesign(readFileSync(path.join(dir, 'docs/waypoint/cart/design.md'), 'utf8'));
    expect(d.meta).toMatchObject({ project: 'cart', status: 'draft', summary: 'Show totals.', source: 'docs/superpowers/specs/s.md' });
    expect(run(['design-validate', 'docs/waypoint/cart/design.md'], io).code).toBe(0);
    expect(run(args, io).code).toBe(2);
    expect(run(['design-import', 'docs/superpowers/specs/s.md', '--project', '..', '--out', 'o1.md'], io).code).toBe(2);
    expect(run(['design-import', 'missing.md', '--project', 'cart', '--out', 'o2.md'], io).code).toBe(2);
    expect(run(['design-import', 'docs/superpowers/specs/s.md', '--out', 'o4.md'], io).code).toBe(2);
    // A design the import would make invalid (an empty locale) is refused like any bad argument, and nothing is written.
    expect(run(['design-import', 'docs/superpowers/specs/s.md', '--project', 'cart2', '--locale', '', '--out', 'o5.md'], io).code).toBe(2);
    expect(existsSync(path.join(dir, 'o5.md'))).toBe(false);
    writeFileSync(path.join(dir, 'flat.md'), '# Only a title\n\ntext\n');
    expect(run(['design-import', 'flat.md', '--project', 'cart', '--out', 'o3.md'], io).code).toBe(2);
    expect(existsSync(path.join(dir, 'o3.md'))).toBe(false);
  });
});

describe('design-gate', () => {
  it('prints the gate from the changelog and the critiques, and refuses a missing design argument', () => {
    const d = path.join(dir, 'docs', 'waypoint', 'demo-shop');
    mkdirSync(path.join(d, 'design'), { recursive: true });
    copyFileSync(new URL('./fixtures/design.md', import.meta.url), path.join(d, 'design.md'));
    writeFileSync(path.join(d, 'design', 'changelog.json'), JSON.stringify([{ version: 1, date: '2026-10-13', note: 'v1', words: 10, round: 0 }]));
    const rel = 'docs/waypoint/demo-shop/design.md';
    expect(JSON.parse(run(['design-gate', rel], io).stdout)).toMatchObject({ version: 1, rounds: 0, canAutoApprove: false });
    const local = path.join(dir, '.waypoint', 'demo-shop');
    mkdirSync(local, { recursive: true });
    writeFileSync(path.join(local, 'critique-r1.json'), JSON.stringify({ round: 1, version: 1, scope: 'full', proposals: [{ n: 1, category: 'gap', severity: 'major', section: '_intro', problem: 'p', change: 'c' }] }));
    expect(JSON.parse(run(['design-gate', rel], io).stdout)).toMatchObject({ rounds: 1, latestRound: 1, canAutoApprove: true });
    writeFileSync(path.join(local, 'critique-r2.json'), 'not json');
    expect(JSON.parse(run(['design-gate', rel], io).stdout)).toMatchObject({ rounds: 1, latestRound: 2, invalid: [2], canAutoApprove: false });
    expect(run(['design-gate'], io).code).toBe(2);
  });

  describe('pending proposals and critique-dismiss', () => {
    const rel = 'docs/waypoint/demo-shop/design.md';
    const local = () => path.join(dir, '.waypoint', 'demo-shop');
    const prop = (n: number, severity: string) => ({ n, category: 'gap', severity, section: '_intro', problem: 'p', change: 'c' });
    beforeEach(() => {
      const d = path.join(dir, 'docs', 'waypoint', 'demo-shop');
      mkdirSync(path.join(d, 'design'), { recursive: true });
      copyFileSync(new URL('./fixtures/design.md', import.meta.url), path.join(d, 'design.md'));
      writeFileSync(path.join(d, 'design', 'changelog.json'), JSON.stringify([
        { version: 1, date: '2026-10-13', note: 'v1', words: 10, round: 0 },
        { version: 2, date: '2026-10-13', note: 'round 1: applied 1 — a', words: 10, round: 1 },
      ]));
      mkdirSync(local(), { recursive: true });
      writeFileSync(path.join(local(), 'critique-r1.json'), JSON.stringify({ round: 1, version: 1, scope: 'full', proposals: [prop(1, 'major'), prop(2, 'critical'), prop(3, 'minor')] }));
      writeFileSync(path.join(local(), 'critique-r2.json'), JSON.stringify({ round: 2, version: 2, scope: 'changed', proposals: [] }));
    });
    it('design-gate lists the proposals left from earlier rounds, and a skipped critical blocks approval', () => {
      expect(JSON.parse(run(['design-gate', rel], io).stdout)).toMatchObject({
        latestRound: 2, criticalPending: [{ round: 1, n: 2 }], canAutoApprove: false,
        pending: [{ round: 1, n: 2, severity: 'critical', section: '_intro' }, { round: 1, n: 3, severity: 'minor', section: '_intro' }],
        pendingCounts: { critical: 1, major: 0, minor: 1 },
      });
    });
    it('critique-dismiss merges the numbers into dismissed.json and the gate stops counting them', () => {
      const a = run(['critique-dismiss', rel, '--round', '1', '3'], io);
      expect(a.code).toBe(0);
      expect(JSON.parse(a.stdout)).toEqual({ round: 1, dismissed: [3] });
      expect(JSON.parse(run(['critique-dismiss', rel, '--round', '1', '2,3'], io).stdout)).toEqual({ round: 1, dismissed: [2, 3] });
      expect(JSON.parse(readFileSync(path.join(local(), 'dismissed.json'), 'utf8'))).toEqual({ 1: [2, 3] });
      expect(JSON.parse(run(['critique-dismiss', rel, '--round', '2', 'all'], io).stdout)).toEqual({ round: 2, dismissed: [] });
      expect(JSON.parse(run(['design-gate', rel], io).stdout)).toMatchObject({ pending: [], criticalPending: [], canAutoApprove: true });
    });
    it('critique-dismiss refuses a bad spec, a missing critique and missing arguments with code 2', () => {
      expect(run(['critique-dismiss', rel, '--round', '1', '9'], io).code).toBe(2);
      expect(run(['critique-dismiss', rel, '--round', '1', 'x'], io).code).toBe(2);
      expect(run(['critique-dismiss', rel, '--round', '7', 'all'], io).code).toBe(2);
      expect(run(['critique-dismiss', rel, '--round', '0', 'all'], io).code).toBe(2);
      expect(run(['critique-dismiss', rel, '1'], io).code).toBe(2);
      expect(run(['critique-dismiss', rel, '--round', '1'], io).code).toBe(2);
      expect(run(['critique-dismiss'], io).code).toBe(2);
      expect(existsSync(path.join(local(), 'dismissed.json'))).toBe(false);
      expect(run(['nope'], io).stderr).toContain('critique-dismiss');
    });
  });
});

describe('page --publish-info and the sync line', () => {
  const setArtifact = (url: string) => {
    const p = path.join(dir, 'plan.yaml');
    writeFileSync(p, readFileSync(p, 'utf8').replace(/^(locale: \w+\n)/m, `$1artifacts:\n  roadmap: ${url}\n`));
  };
  const info = () => JSON.parse(run(['page', 'plan.yaml', '--out', 'r.html', '--publish-info'], io).stdout);
  const caps = { db: { rules: [{ path: '', read: 'view', write: 'admin' }, { path: 'notes', read: 'view', write: 'interact' }, { path: 'proposals', read: 'view', write: 'interact' }] }, user: { scopes: ['profile'] }, downloads: true };
  it('without .forge the roadmap stays shareable and nothing is said', () => {
    expect(info()).toEqual({ out: path.join(dir, 'r.html'), capabilities: caps, internal: false, say: null });
    expect(existsSync(path.join(dir, 'r.html'))).toBe(true);
  });
  it('with forge evidence uploaded it declares assets and tells the person once, in the plan language', () => {
    mkdirSync(path.join(dir, '.forge'));
    expect(info()).toEqual({ out: path.join(dir, 'r.html'), capabilities: { ...caps, assets: {} }, internal: true,
      say: 'El roadmap lleva las capturas de verificación de forge, así que queda interno de tu organización y no se puede compartir públicamente (con evidence: local en .forge/config.yaml no se suben).' });
    const p = path.join(dir, 'plan.yaml');
    writeFileSync(p, readFileSync(p, 'utf8').replace('locale: es', 'locale: en'));
    expect(info().say).toBe("The roadmap carries forge's verification screenshots, so it stays internal to your organization and cannot be shared publicly (with evidence: local in .forge/config.yaml they are not uploaded).");
    setArtifact('https://claude.ai/artifact/r1');
    expect(info()).toMatchObject({ internal: true, say: null });
  });
  it('evidence: local leaves assets out', () => {
    mkdirSync(path.join(dir, '.forge'));
    writeFileSync(path.join(dir, '.forge', 'config.yaml'), 'evidence: local\n');
    expect(info()).toMatchObject({ capabilities: caps, internal: false, say: null });
  });
  it('without the flag page prints the bare path as before', () => {
    expect(run(['page', 'plan.yaml', '--out', 'r.html'], io).stdout).toBe(`${path.join(dir, 'r.html')}\n`);
  });
  it('sync says the roadmap url and the counts in the plan language, null without a roadmap', () => {
    const say = () => JSON.parse(run(['sync', 'plan.yaml', '--out', '.waypoint/sync'], io).stdout).say;
    expect(say()).toBeNull();
    setArtifact('https://claude.ai/artifact/r1');
    expect(say()).toBe('Roadmap: https://claude.ai/artifact/r1 · 6 tareas, 2 fases, 2 frentes.');
    const p = path.join(dir, 'plan.yaml');
    writeFileSync(p, readFileSync(p, 'utf8').replace('locale: es', 'locale: en'));
    expect(say()).toBe('Roadmap: https://claude.ai/artifact/r1 · 6 tasks, 2 phases, 2 tracks.');
  });
});
