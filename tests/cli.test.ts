import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { run, isCommitCommand, type Io } from '../src/cli/run.js';
import { parsePlan } from '../src/lib/plan.js';
import { launchRun, HERDR_TEMPLATE } from '../src/lib/launcher.js';
import { planHash } from '../src/lib/sync.js';
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
    expect(run(['validate', 'plan.yaml'], io)).toMatchObject({ code: 0, stdout: 'ok: 6 tasks, 2 phases, 2 tracks\n' });
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
    const git = (...a: string[]) => execFileSync('git', a, { cwd: dir });
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
    const git = (...a: string[]) => execFileSync('git', a, { cwd: dir });
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
    const FORGE = ' — forge drives this session (forge:run Large loop)';
    const MERGE = ' — the user authorizes merging track/ui into main at phase close';
    const launch = (...flags: string[]) => {
      const git = (...a: string[]) => execFileSync('git', a, { cwd: dir });
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
    it('--forge appends the forge marker', () => {
      expect(launch('--forge').prompt).toBe(`/waypoint:work ui${FORGE}`);
    });
    it('both: forge first, then merge', () => {
      const r = launch('--merge', '--forge');
      expect(r.prompt).toBe(`/waypoint:work ui${FORGE}${MERGE}`);
      expect(r.command).toBe(`claude --bg --name wp-demo-shop-ui "${r.prompt}"`);
    });
    it('auto-detects forge from the design start_prompt', () => {
      writeDesign(`/waypoint:work <track>${FORGE}`);
      expect(launch().prompt).toBe(`/waypoint:work ui${FORGE}`);
    });
    it('--no-forge overrides auto-detection', () => {
      writeDesign(`/waypoint:work <track>${FORGE}`);
      expect(launch('--no-forge').prompt).toBe('/waypoint:work ui');
    });
    const SWARM = ' — swarm member of main: do not merge into the base branch; keep taking tasks of your track and stop when it has no next task';
    it('--swarm forces the forge marker and appends the swarm rules', () => {
      expect(launch('--swarm', 'main', '--base', 'HEAD').prompt).toBe(`/waypoint:work ui${FORGE}${SWARM}`);
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
    const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', ...a], { cwd, encoding: 'utf8' }).trim();
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
  });

  describe('launch --task', () => {
    const git = (...a: string[]) => execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', ...a], { cwd: dir, encoding: 'utf8' }).trim();
    const init = () => { git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-qm', 'init'); git('branch', 'forge/run-demo-shop'); };
    const args = ['launch', 'plan.yaml', 'T001', '--task', '--run', 'r1', '--coordinator', 'S1', '--base', 'forge/run-demo-shop'];
    it('creates task/<T> from the run branch and a forge run member prompt', () => {
      init();
      const r = JSON.parse(run(args, io).stdout);
      expect(r).toMatchObject({ branch: 'task/T001', name: 'wp-demo-shop-T001', runId: 'r1', task: 'T001' });
      expect(path.resolve(r.worktree).toLowerCase()).toBe(path.resolve(dir, '.claude', 'worktrees', 'task-T001').toLowerCase());
      expect(r.prompt).toBe('/forge:run --plan plan.yaml --task T001 — run member of S1: work only T001, then stop');
      expect(r.command).toBe(`claude --bg --name wp-demo-shop-T001 "${r.prompt}"`);
      expect(git('rev-parse', 'task/T001')).toBe(git('rev-parse', 'forge/run-demo-shop'));
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
});

describe('classic hooks', () => {
  const wp = () => path.join(dir, '.waypoint', 'demo-shop');
  const docsDir = () => path.join(dir, 'docs', 'waypoint', 'demo-shop');
  const hook = (sub: string, stdin: unknown) => run(['hook', sub], { ...io, stdin: typeof stdin === 'string' ? stdin : JSON.stringify(stdin) });
  const setup = (session?: object) => {
    mkdirSync(docsDir(), { recursive: true });
    copyFileSync(FIXTURE, path.join(docsDir(), 'plan.yaml'));
    if (session) {
      mkdirSync(wp(), { recursive: true });
      writeFileSync(path.join(wp(), 'session.json'), JSON.stringify(session));
    }
  };
  const pending = () => path.join(wp(), 'pending-commits.jsonl');

  it('session-start injects roadmap context', () => {
    setup({ sessionId: 'backend', track: 'backend', currentTask: 'T002' });
    const r = hook('session-start', {});
    expect(r.code).toBe(0);
    const ctx = JSON.parse(r.stdout).hookSpecificOutput;
    expect(ctx.hookEventName).toBe('SessionStart');
    expect(ctx.additionalContext).toContain('project demo-shop');
    expect(ctx.additionalContext).toContain('Session backend');
    expect(ctx.additionalContext).toContain('/waypoint:work');
  });
  it('session-start is silent without docs/waypoint and survives a corrupt plan', () => {
    const r = hook('session-start', {});
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe('');
    mkdirSync(docsDir(), { recursive: true });
    writeFileSync(path.join(docsDir(), 'plan.yaml'), 'not: [yaml');
    const c = hook('session-start', {});
    expect(c.code).toBe(0);
    expect(c.stderr).toBe('');
    expect(c.stdout).not.toMatch(/error|Error|Unexpected/);
  });
  it('session-start keeps the roadmap context when the messages cache is corrupt', () => {
    setup({ sessionId: 'backend', track: 'backend', currentTask: 'T002' });
    mkdirSync(path.join(wp(), 'dbcache', 'messages'), { recursive: true });
    writeFileSync(path.join(wp(), 'dbcache', 'messages', 'm1.json'), '{oops');
    const ctx = JSON.parse(hook('session-start', {}).stdout).hookSpecificOutput.additionalContext;
    expect(ctx).toContain('project demo-shop');
    expect(ctx).toContain('Open messages: 0');
  });
  // A real repository in the test dir: post-commit records a commit only when HEAD moved.
  const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd: dir, encoding: 'utf8' }).trim();
  const gitInit = () => { git('init', '-q'); git('add', '.'); git('commit', '-q', '-m', 'init'); };
  const commitFile = (name: string) => { writeFileSync(path.join(dir, name), name); git('add', name); git('commit', '-q', '-m', `add ${name}`); return git('rev-parse', 'HEAD'); };
  const pendingLines = () => (existsSync(pending()) ? readFileSync(pending(), 'utf8').trim().split('\n').filter(Boolean) : []);

  it('isCommitCommand matches real commits only', () => {
    const yes = ['git add . && git commit -m x', 'x; git commit -m y', 'true | git commit -m z', 'git -c user.name=a commit -m x', 'git -C sub commit -m x', 'git --no-pager commit -m x', '(git commit -m x)', 'cd a && (git add . && git commit -m x)'];
    const no = ['git commit-tree abc', 'git commit-graph write', 'echo commit', 'git log --grep commit', 'git commit --dry-run -m x'];
    for (const c of yes) expect(isCommitCommand(c), c).toBe(true);
    for (const c of no) expect(isCommitCommand(c), c).toBe(false);
  });
  it('post-commit records a commit only when HEAD moved, with its sha', () => {
    setup({ sessionId: 'backend', track: 'backend', currentTask: 'T002' });
    gitInit();
    mkdirSync(wp(), { recursive: true });
    writeFileSync(path.join(wp(), 'last-head'), git('rev-parse', 'HEAD'));
    // A failed commit: HEAD did not move.
    const r = hook('post-commit', { tool_input: { command: 'git commit -m "nothing to commit"' } });
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe('');
    expect(pendingLines()).toHaveLength(0);
    const sha = commitFile('a.txt');
    hook('post-commit', { tool_input: { command: 'git add . && git commit -m "T002: x"' } });
    expect(pendingLines()).toHaveLength(1);
    expect(JSON.parse(pendingLines()[0])).toMatchObject({ task: 'T002', sha });
    expect(readFileSync(path.join(wp(), 'last-head'), 'utf8').trim()).toBe(sha);
    // The same HEAD again (a retry that failed): not recorded twice.
    hook('post-commit', { tool_input: { command: 'git commit -m "T002: x"' } });
    hook('post-commit', { tool_input: { command: 'echo commit' } });
    expect(pendingLines()).toHaveLength(1);
  });
  it('post-commit records the first commit when no head was stored yet', () => {
    setup({ sessionId: 'backend', track: 'backend', currentTask: 'T002' });
    gitInit();
    const sha = commitFile('a.txt');
    hook('post-commit', { tool_input: { command: 'git commit -m x' } });
    expect(JSON.parse(pendingLines()[0]).sha).toBe(sha);
  });
  it('post-commit skips --dry-run even when HEAD moved', () => {
    setup({ sessionId: 'backend', track: 'backend', currentTask: 'T002' });
    gitInit();
    mkdirSync(wp(), { recursive: true });
    writeFileSync(path.join(wp(), 'last-head'), git('rev-parse', 'HEAD'));
    commitFile('a.txt');
    hook('post-commit', { tool_input: { command: 'git commit --dry-run -m x' } });
    expect(pendingLines()).toHaveLength(0);
  });
  it('post-commit finds the task from the state cache (claimed or in progress)', () => {
    setup({ sessionId: 'backend', track: 'backend' });
    gitInit();
    mkdirSync(path.join(wp(), 'dbcache', 'state'), { recursive: true });
    writeFileSync(path.join(wp(), 'dbcache', 'state', 'T002.json'), JSON.stringify({ status: 'claimed', owner: 'backend' }));
    commitFile('a.txt');
    hook('post-commit', { tool_input: { command: 'git commit -m x' } });
    expect(JSON.parse(pendingLines()[0]).task).toBe('T002');
  });
  it('session-start stores the current HEAD as last-head', () => {
    setup({ sessionId: 'backend', track: 'backend', currentTask: 'T002' });
    gitInit();
    hook('session-start', {});
    expect(readFileSync(path.join(wp(), 'last-head'), 'utf8').trim()).toBe(git('rev-parse', 'HEAD'));
  });
  it('session-start reads the current task from the state cache without currentTask', () => {
    setup({ sessionId: 'backend', track: 'backend' });
    mkdirSync(path.join(wp(), 'dbcache', 'state'), { recursive: true });
    writeFileSync(path.join(wp(), 'dbcache', 'state', 'T001.json'), JSON.stringify({ status: 'done', owner: 'backend' }));
    writeFileSync(path.join(wp(), 'dbcache', 'state', 'T002.json'), JSON.stringify({ status: 'in_progress', owner: 'backend' }));
    writeFileSync(path.join(wp(), 'dbcache', 'state', 'T003.json'), JSON.stringify({ status: 'in_progress', owner: 'ui' }));
    const ctx = JSON.parse(hook('session-start', {}).stdout).hookSpecificOutput.additionalContext;
    expect(ctx).toContain('Current task: T002 API de pedidos');
  });
  it('hooks resolve the project from CLAUDE_PROJECT_DIR, then the input cwd, then the process cwd', () => {
    setup({ sessionId: 'backend', track: 'backend', currentTask: 'T002' });
    const elsewhere = mkdtempSync(path.join(tmpdir(), 'wp-else-'));
    const at = (stdin: object, env?: Record<string, string>) =>
      run(['hook', 'session-start'], { ...io, cwd: elsewhere, env, stdin: JSON.stringify(stdin) }).stdout.trim();
    expect(at({})).toBe('');
    expect(at({ cwd: dir })).toContain('project demo-shop');
    expect(at({ cwd: elsewhere }, { CLAUDE_PROJECT_DIR: dir })).toContain('project demo-shop');
    expect(at({ cwd: dir }, { CLAUDE_PROJECT_DIR: elsewhere })).toBe('');
    expect(run(['hook', 'session-start'], { ...io, stdin: '{}' }).stdout).toContain('project demo-shop');
  });
  it('stop blocks while commits are pending, once per distinct pending set', () => {
    setup({ sessionId: 'backend', track: 'backend', currentTask: 'T002' });
    expect(hook('stop', {}).stdout.trim()).toBe('');
    writeFileSync(pending(), '{"ts":"x","task":"T002","command":"git commit","sha":"a"}\n');
    const r = hook('stop', {});
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.decision).toBe('block');
    expect(out.reason).toBe("waypoint: 1 commit(s) / 0 queued roadmap update(s) are not in the live roadmap yet. Record them (work skill: a `commit` event for intermediate commits, or the task's completion), or flush the queue, then remove those lines from .waypoint/demo-shop/pending-commits.jsonl. You can also stop now; this reminder shows once per change. Tell the user in Spanish (es), the plan's language.");
    // Same pending set: the reminder is not repeated.
    expect(hook('stop', {}).stdout.trim()).toBe('');
    // A new line: it blocks again.
    writeFileSync(pending(), '{"ts":"x","task":"T002","command":"git commit","sha":"a"}\n{"ts":"y","task":"T002","command":"git commit","sha":"b"}\n');
    expect(JSON.parse(hook('stop', {}).stdout).reason).toContain('2 commit(s)');
    expect(hook('stop', { stop_hook_active: true }).stdout.trim()).toBe('');
    const bad = hook('stop', 'not json');
    expect(bad.code).toBe(0);
    expect(bad.stdout.trim()).toBe('');
  });
  it('stop blocks on queued roadmap updates alone', () => {
    setup({ sessionId: 'backend', track: 'backend', currentTask: 'T002' });
    writeFileSync(path.join(wp(), 'queue.jsonl'), '{"op":"set"}\n');
    const out = JSON.parse(hook('stop', {}).stdout);
    expect(out.decision).toBe('block');
    expect(out.reason).toContain('0 commit(s) / 1 queued');
    expect(hook('stop', {}).stdout.trim()).toBe('');
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
  const git = (...a: string[]) => execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', ...a], { cwd: dir, encoding: 'utf8' }).trim();
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
    expect(JSON.parse(next('--base', 'main').stdout).task).toBeNull();
    expect(JSON.parse(next().stdout).task.id).toBe('B1');
    git('merge', '-q', '--no-ff', '-m', 'swarm: integrate a', 'track/a');
    expect(JSON.parse(next('--base', 'main').stdout).task.id).toBe('B1');
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
