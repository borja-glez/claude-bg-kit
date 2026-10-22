import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { run } from '../src/forge/cli/run.js';
import { startRun, saveRun } from '../src/forge/run.js';
import { dbPrefix, dockerPrefix, isLocalHost, resourcesFile } from '../src/forge/resources.js';
import { useTempDirs } from './helpers/tmp.js';

const tmp = useTempDirs();
const NOW = new Date('2026-10-22T10:00:00Z');
let main: string, wt: string;
// main is no git repository: mainCheckout(main) is main itself, where run.json lives.
const cli = (args: string[]) => run(['resource', ...args], { cwd: main, now: () => NOW, env: {} });
beforeEach(() => {
  main = tmp('res-');
  wt = path.join(main, '.claude', 'worktrees', 'spike-x');
  mkdirSync(wt, { recursive: true });
  saveRun(main, { ...startRun(NOW, { hours: 1 }, 10, 's1'), autonomous: { profile: 'spike', name: 'x', runId: 'spike-x', worktree: wt, branch: 'forge/spike-x', startBranch: 'main', protectedBranches: ['main'] } });
});

describe('dbPrefix, dockerPrefix and isLocalHost', () => {
  it('name what only this run can have made, never the start of another run\'s name (M3)', () => {
    expect(dbPrefix('product-mi-juego')).toBe('fg_product_mi_juego__');
    expect(dockerPrefix('spike-x')).toBe('fg-spike-x--');
    expect(`${dbPrefix('spike-a-b')}main`.startsWith(dbPrefix('spike-a'))).toBe(false);
    expect(`${dockerPrefix('spike-a-b')}db`.startsWith(dockerPrefix('spike-a'))).toBe(false);
  });
  it('one list of local hosts (L3)', () => {
    for (const h of ['localhost', 'LOCALHOST', '127.0.0.2', '::1', '[::1]', '0.0.0.0', 'app.localhost']) expect(isLocalHost(h), h).toBe(true);
    for (const h of ['db.example.com', '128.0.0.1', 'localhost.example.com', '10.0.0.5']) expect(isLocalHost(h), h).toBe(false);
  });
});

describe('forge resource', () => {
  it('registers a database of the run on a local host, once', () => {
    const r = cli(['add', '--kind', 'postgres', '--name', 'fg_spike_x__main', '--host', 'localhost']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ resource: { kind: 'postgres', name: 'fg_spike_x__main', host: 'localhost' }, count: 1 });
    expect(JSON.parse(cli(['add', '--kind', 'postgres', '--name', 'fg_spike_x__main']).stdout).count).toBe(1);
    expect(JSON.parse(cli(['list']).stdout)).toMatchObject({ runId: 'spike-x', resources: [{ name: 'fg_spike_x__main' }] });
  });
  it('registers a new SQLite file inside the worktree, stored absolute; a relative one resolves from the cwd', () => {
    expect(JSON.parse(cli(['add', '--kind', 'sqlite', '--name', path.join(wt, 'data', 'dev.db')]).stdout).resource.name).toBe(path.join(wt, 'data', 'dev.db'));
    // From the main checkout, a relative path lands outside the worktree.
    expect(cli(['add', '--kind', 'sqlite', '--name', 'dev.db']).code).toBe(2);
  });
  it('refuses what the run cannot have made, and writes nothing', () => {
    writeFileSync(path.join(wt, 'old.db'), '');
    for (const args of [
      ['--kind', 'postgres', '--name', 'prod'], ['--kind', 'postgres', '--name', 'fg_spike_x__main', '--host', 'db.example.com'],
      ['--kind', 'postgres', '--name', 'fg_spike_x_y__main'], ['--kind', 'container', '--name', 'fg-spike-x-y--db'],
      ['--kind', 'container', '--name', 'postgres'], ['--kind', 'sqlite', '--name', path.join(wt, 'old.db')], ['--kind', 'sqlite', '--name', path.join(main, 'x.db')],
      ['--kind', 'redis', '--name', '99999'], ['--kind', 'redis', '--name', '6379'], ['--kind', 'redis', '--name', '80'], ['--kind', 'printer', '--name', 'fg-spike-x--a'],
    ]) expect(cli(['add', ...args]).code, args.join(' ')).toBe(2);
    expect(existsSync(resourcesFile(main, 'spike-x'))).toBe(false);
  });
  it('is exit 2 without an autonomous run', () => {
    saveRun(main, startRun(NOW, { hours: 1 }, 10, 's1'));
    expect(cli(['add', '--kind', 'container', '--name', 'fg-spike-x--db']).code).toBe(2);
    expect(cli(['list']).code).toBe(2);
  });
});
