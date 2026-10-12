import { expect, mock, test } from 'claude-code/testing';
import type { On } from 'claude-code';

const ROOT = '/repo';
const URL = 'https://claude.ai/artifact/Q71skZnSzoxfxm2799thGY';
const norm = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '');

// A file system answered from memory, that records what the plugin writes.
function serveFiles(on: On, files: Record<string, string>) {
  on('session.root', () => ({ value: ROOT }));
  on('fs.read', (_$, e) => (norm(e.path) in files ? { value: files[norm(e.path)] } : { deny: `ENOENT ${e.path}` }));
  on('fs.exists', (_$, e) => ({ value: norm(e.path) in files || Object.keys(files).some(f => f.startsWith(`${norm(e.path)}/`)) }));
  on('fs.write', (_$, e) => { files[norm(e.path)] = e.text; return { value: undefined }; });
  on('fs.stat', (_$, e) => (norm(e.path) in files ? { value: { kind: 'file' as const, size: 1, mtimeMs: 1, isLink: false } } : { deny: `ENOENT ${e.path}` }));
  on('fs.list', (_$, e) => {
    const prefix = `${norm(e.path)}/`;
    const names = new Map<string, 'file' | 'dir'>();
    for (const path of Object.keys(files)) {
      if (!path.startsWith(prefix)) continue;
      const [head = '', ...rest] = path.slice(prefix.length).split('/');
      names.set(head, rest.length ? 'dir' : 'file');
    }
    return names.size ? { value: [...names].map(([name, kind]) => ({ name, kind, size: 1, mtimeMs: 1, isLink: false })) } : { deny: `ENOENT ${e.path}` };
  });
}

function start(on: On) {
  mock.clock(on, { now: Date.parse('2026-10-11T20:00:00.000Z') });
  on('session.start', (_$, e) => ({ cwd: e.cwd }));
  on('command.list', () => ({ value: [] }));
}

const FILES = (): Record<string, string> => ({
  [`${ROOT}/.waypoint/orders/session.json`]: JSON.stringify({ sessionId: 'main', url: URL }),
  [`${ROOT}/.waypoint/orders/dbcache/state/T001.json`]: '{\n  "status": "free"\n}\n',
  [`${ROOT}/.waypoint/other/session.json`]: JSON.stringify({ sessionId: 'x', url: 'https://claude.ai/artifact/AnotherOne123' }),
});
const CLAIM = {
  action: 'batch', url: URL, writes: [
    { op: 'update', collection: 'state', doc_id: 'T001', data: { status: 'in_progress', owner: 'main', startedAt: '2026-10-11T20:00:00.000Z' } },
    { op: 'set', collection: 'events', doc_id: 'e1', data: { type: 'started' } },
    { op: 'update', collection: 'sessions', doc_id: 'main', data: { currentTask: 'T001' } },
  ],
};

test("a successful write to the project's roadmap updates its local copy at once", async ($, on) => {
  const files = FILES();
  serveFiles(on, files);
  start(on);
  on('tool.call', { tool: 'ArtifactData' }, () => ({ result: {}, text: 'database batch committed (3 writes)' }) as never);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.tool.call({ tool: 'ArtifactData', ...CLAIM } as never);
  expect(JSON.parse(files[`${ROOT}/.waypoint/orders/dbcache/state/T001.json`])).toEqual({ status: 'in_progress', owner: 'main', startedAt: '2026-10-11T20:00:00.000Z' });
  expect(JSON.parse(files[`${ROOT}/.waypoint/orders/dbcache/sessions/main.json`])).toEqual({ currentTask: 'T001' });
  expect(files[`${ROOT}/.waypoint/orders/dbcache/events/e1.json`]).toBeUndefined();
  expect(Object.keys(files).some(f => f.startsWith(`${ROOT}/.waypoint/other/dbcache`))).toBe(false);
});

test('a failed write, or one to another artifact, leaves the copy as it was', async ($, on) => {
  const files = FILES();
  serveFiles(on, files);
  start(on);
  let answer: unknown = { isError: true, result: 'boom', text: 'boom' };
  on('tool.call', { tool: 'ArtifactData' }, () => answer as never);
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true });
  await $.tool.call({ tool: 'ArtifactData', ...CLAIM } as never);
  answer = { result: {}, text: 'version_mismatch on state/T001' };
  await $.tool.call({ tool: 'ArtifactData', ...CLAIM } as never);
  answer = { result: {}, text: 'database batch committed (3 writes)' };
  await $.tool.call({ tool: 'ArtifactData', ...CLAIM, url: 'https://claude.ai/artifact/SomethingElse99' } as never);
  expect(files[`${ROOT}/.waypoint/orders/dbcache/state/T001.json`]).toBe('{\n  "status": "free"\n}\n');
});
