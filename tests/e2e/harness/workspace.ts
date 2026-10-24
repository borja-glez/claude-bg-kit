// A8: the temp repo, home and config dir a real claude session runs in, and the reader of what the probe plugin recorded.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const E2E_KEY = 'sk-ant-e2e-scripted-000000000000';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const PLUGIN_DIRS: { readonly waypoint: string; readonly forge: string; readonly probe: string } = {
  waypoint: path.join(ROOT, 'plugins', 'waypoint'),
  forge: path.join(ROOT, 'plugins', 'forge'),
  probe: path.join(ROOT, 'tests', 'e2e', 'fixtures', 'probe'),
};

export interface Workspace { repo: string; home: string; configDir: string; hookLog: string; debugFile: string; sessionId: string }

export function makeWorkspace(tmp: (prefix: string) => string): Workspace {
  const repo = tmp('e2e-repo-');
  const git = (...a: string[]) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'e2e');
  git('config', 'user.email', 'e2e@example.invalid');
  git('config', 'core.autocrlf', 'false');
  writeFileSync(path.join(repo, 'README.md'), '# e2e\n');
  git('add', 'README.md');
  git('commit', '-qm', 'init');
  const home = tmp('e2e-home-');
  const configDir = path.join(home, '.claude');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(path.join(configDir, '.claude.json'), JSON.stringify({
    hasCompletedOnboarding: true,
    customApiKeyResponses: { approved: [E2E_KEY.slice(-20)], rejected: [] },
  }));
  return { repo, home, configDir, hookLog: path.join(home, 'hooks.jsonl'), debugFile: path.join(home, 'debug.log'), sessionId: randomUUID() };
}

export interface HookRecord { event: string; input: Record<string, unknown> }

/** What the probe plugin recorded: one {event, input} per line of the hook log. */
export function readHooks(ws: Pick<Workspace, 'hookLog'>): HookRecord[] {
  if (!existsSync(ws.hookLog)) return [];
  return readFileSync(ws.hookLog, 'utf8').split('\n').filter(l => l.trim() !== '').map(l => JSON.parse(l) as HookRecord);
}

/** Keys of tests/fixtures/hooks/session-start-*.json that the real `claude -p` (2.1.310) does not send in SessionStart,
 *  and that no forge or waypoint hook reads. */
export const FIXTURE_KEYS_NOT_SENT: readonly string[] = ['model'];

/** A recorded hook input of the repo's fixtures: tests/fixtures/hooks/<name>.json. */
export function hookFixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(ROOT, 'tests', 'fixtures', 'hooks', `${name}.json`), 'utf8')) as Record<string, unknown>;
}
