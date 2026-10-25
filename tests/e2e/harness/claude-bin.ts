// A8: finds the claude CLI the e2e scenarios run, and builds the command line that starts it.
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

export interface ClaudeBin { file: string; prefix: readonly string[]; version: string; viaCmd: boolean }

/** The claude version tests/e2e/README.md was recorded with; whoever re-records its observations raises this. */
export const OBSERVED_WITH = '2.1.310';

/** The claude to run: BGKIT_E2E_CLAUDE when set (that file or none), else the first one on PATH. */
export function resolveClaude(env: Record<string, string | undefined>, platform: NodeJS.Platform, isFile: (p: string) => boolean): string | null {
  const override = env.BGKIT_E2E_CLAUDE;
  if (override) return isFile(override) ? override : null;
  const win = platform === 'win32';
  const p = win ? path.win32 : path.posix;
  const pathVar = env.PATH ?? env.Path ?? '';
  const names = win ? ['claude.exe', 'claude.cmd'] : ['claude'];
  for (const dir of pathVar.split(win ? ';' : ':')) {
    if (!dir) continue;
    for (const name of names) {
      const file = p.join(dir, name);
      if (isFile(file)) return file;
    }
  }
  return null;
}

/** The x.y.z a `claude --version` output starts with. */
export function parseVersion(out: string): string | null {
  const m = /^\s*(\d+\.\d+\.\d+)/.exec(out);
  return m ? m[1] : null;
}

/** Spawn arguments for a claude: an .exe runs as it is; a .cmd goes through cmd.exe, which splits what it should not. */
export function spawnSpec(bin: ClaudeBin, args: readonly string[], comspec?: string): { file: string; args: string[] } {
  if (!bin.viaCmd) return { file: bin.file, args: [...bin.prefix, ...args] };
  const safe = /^[^\s"&|<>^%!]+$/;
  for (const a of [bin.file, ...bin.prefix, ...args]) {
    if (!safe.test(a)) throw new Error(`e2e: claude.cmd cannot take ${JSON.stringify(a)}: install the native claude.exe or point BGKIT_E2E_CLAUDE at one`);
  }
  return { file: comspec ?? 'cmd.exe', args: ['/d', '/c', bin.file, ...bin.prefix, ...args] };
}

/** The claude on this machine and its version, or null when there is none that answers --version. */
export function findClaude(env: Record<string, string | undefined> = process.env): ClaudeBin | null {
  const file = resolveClaude(env, process.platform, p => existsSync(p) && statSync(p).isFile());
  if (!file) return null;
  const bin: ClaudeBin = { file, prefix: [], version: '', viaCmd: /\.cmd$/i.test(file) };
  const spec = spawnSpec(bin, ['--version']);
  const r = spawnSync(spec.file, spec.args, { encoding: 'utf8', timeout: 30_000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0) return null;
  const version = parseVersion(r.stdout);
  return version ? { ...bin, version } : null;
}

/** The one line a run starts with. */
export function announceLine(bin: ClaudeBin | null): string {
  if (!bin) return 'e2e: no claude CLI found (PATH or BGKIT_E2E_CLAUDE): every scenario is skipped';
  if (bin.version === OBSERVED_WITH) return `e2e: claude ${bin.version} (${bin.file})`;
  return `e2e: claude ${bin.version} (${bin.file}); tests/e2e/README.md was recorded with ${OBSERVED_WITH}: a pinned scenario that fails may be a change of Claude Code`;
}
