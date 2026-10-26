// FC5: the Claude Code forge's platform facts were recorded with, and the version of the one here (forge doctor).
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

/** The claude version the platform facts were recorded with: tests/e2e/README.md's observations, forge's hooks and
 *  agents. Whoever re-records them raises this, and the version .github/workflows/ci.yml installs with it
 *  (tests/ci-script.test.ts); forge doctor warns when the Claude Code here is another. */
export const OBSERVED_WITH = '2.1.310';

/** The x.y.z a `claude --version` output starts with. */
export function parseVersion(out: string): string | null {
  const m = /^\s*(\d+\.\d+\.\d+)/.exec(out);
  return m ? m[1] : null;
}

/** Where the version came from: the binary that runs this session, the claude on PATH, or Claude Code's AI_AGENT. */
export interface ClaudeVersion { version: string; source: 'running' | 'path' | 'env' }
export interface ClaudeVersionDeps { platform: NodeJS.Platform; isFile: (file: string) => boolean; run: (file: string) => string | null }

/** The output of `<file> --version`, or null when it does not answer in 10 s with exit 0. Never through a shell. */
function askVersion(file: string): string | null {
  try {
    const r = spawnSync(file, ['--version'], { encoding: 'utf8', timeout: 10_000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    return r.status === 0 ? r.stdout : null;
  } catch { return null; }
}

const DEFAULT_DEPS: ClaudeVersionDeps = {
  platform: process.platform,
  isFile: f => { try { return existsSync(f) && statSync(f).isFile(); } catch { return false; } },
  run: askVersion,
};

/**
 * The version of the Claude Code here: the binary that runs this session (CLAUDE_CODE_EXECPATH), else the first claude
 * of PATH (claude.exe on Windows: a claude.cmd would need cmd.exe), each asked with --version; else the one Claude
 * Code's AI_AGENT names (`claude-code_2-1-310_agent`). Null when none of them says.
 */
export function claudeVersion(env: Record<string, string | undefined>, deps: ClaudeVersionDeps = DEFAULT_DEPS): ClaudeVersion | null {
  const asked = (file: string) => { const out = deps.run(file); return out === null ? null : parseVersion(out); };
  const running = env.CLAUDE_CODE_EXECPATH?.trim();
  const fromRunning = running ? asked(running) : null;
  if (fromRunning) return { version: fromRunning, source: 'running' };
  const win = deps.platform === 'win32';
  const p = win ? path.win32 : path.posix;
  for (const dir of (env.PATH ?? env.Path ?? '').split(win ? ';' : ':')) {
    if (!dir) continue;
    const file = p.join(dir, win ? 'claude.exe' : 'claude');
    if (!deps.isFile(file)) continue;
    const v = asked(file);
    if (v) return { version: v, source: 'path' };
  }
  const m = /^claude-code_(\d+)-(\d+)-(\d+)(?:_|$)/.exec(env.AI_AGENT ?? '');
  return m ? { version: `${m[1]}.${m[2]}.${m[3]}`, source: 'env' } : null;
}
