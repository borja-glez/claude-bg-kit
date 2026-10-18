import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, openSync, closeSync, fstatSync, readSync, rmSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ExecMany, RepoReader } from '../validators.js';
import type { ExecResult } from './run.js';

const MAX_OUTPUT = 4 * 1024 * 1024;
const MAX_GIT_OUTPUT = 256 * 1024 * 1024;

// Reads at most the last MAX_OUTPUT bytes of a file, flagging truncation.
function readTail(fd: number): string {
  const size = fstatSync(fd).size;
  const len = Math.min(size, MAX_OUTPUT);
  const buf = Buffer.alloc(len);
  let off = 0;
  while (off < len) {
    const n = readSync(fd, buf, off, len - off, size - len + off);
    if (n <= 0) break;
    off += n;
  }
  const text = buf.subarray(0, off).toString('utf8');
  return size > MAX_OUTPUT ? `[output truncated]\n${text}` : text;
}

const TIMEOUT_EXIT = 124;

// Runs inside a separate node process: argv = [cmd, timeoutMs, logPath] (passed after `--`, so a command
// that starts with a dash is never read as a node option). It spawns the command through
// the shell with stdio on the log file and, on its own timer, kills the whole process tree while the
// root is still alive (taskkill /T on Windows, the process group elsewhere), drops a `<log>.timeout`
// marker and exits 124. Otherwise it exits with the command's code.
const WRAPPER_SOURCE = `
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const [cmd, ms, log] = process.argv.slice(1);
const win = process.platform === 'win32';
const fd = fs.openSync(log, 'a');
let timedOut = false;
const child = spawn(cmd, { shell: true, stdio: ['ignore', fd, fd], detached: !win, windowsHide: true });
const timer = setTimeout(() => {
  timedOut = true;
  try { fs.writeFileSync(log + '.timeout', ''); } catch {}
  try {
    if (win) execFileSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true });
    else process.kill(-child.pid, 'SIGKILL');
  } catch {}
  process.exit(${TIMEOUT_EXIT});
}, Number(ms));
child.on('error', e => { clearTimeout(timer); try { fs.writeSync(fd, 'spawn error: ' + e.message + require('os').EOL); } catch {} process.exit(127); });
child.on('exit', code => { clearTimeout(timer); if (!timedOut) process.exit(code === null ? 1 : code); });
`;

// The command runs under a small node wrapper that owns the timeout and kills the whole tree, so
// timed-out validators leave no orphans. Output goes to a temp file, not pipes, so nothing that
// escapes can keep us blocked on open pipes; only the last MAX_OUTPUT bytes are read back.
export function defaultExec(cwd: string) {
  return (cmd: string, timeoutSec: number): ExecResult => {
    const t0 = Date.now();
    const timeoutMs = timeoutSec * 1000;
    let dir: string | undefined;
    let fd: number | undefined;
    try {
      dir = mkdtempSync(path.join(tmpdir(), 'forge-exec-'));
      const file = path.join(dir, 'out.log');
      fd = openSync(file, 'w+');
      const r = spawnSync(process.execPath, ['-e', WRAPPER_SOURCE, '--', cmd, String(timeoutMs), file], {
        cwd, windowsHide: true, timeout: timeoutMs + 15000, stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8', maxBuffer: 64 * 1024,
      });
      const err = r.error as NodeJS.ErrnoException | undefined;
      const timedOut = err?.code === 'ETIMEDOUT' || (r.status === TIMEOUT_EXIT && existsSync(`${file}.timeout`));
      let output = readTail(fd);
      if (r.stderr) output += `${output && !output.endsWith('\n') ? '\n' : ''}${r.stderr}`;
      if (err && !timedOut) output += `${output && !output.endsWith('\n') ? '\n' : ''}${err.message}\n`;
      return { code: r.status ?? 1, output, ms: Date.now() - t0, timedOut };
    } catch (e) {
      return { code: 1, output: `forge: could not run the command: ${(e as Error).message}\n`, ms: Date.now() - t0, timedOut: false };
    } finally {
      if (fd !== undefined) { try { closeSync(fd); } catch { /* ignore */ } }
      if (dir !== undefined) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } }
    }
  };
}

// Runs inside one node process for a whole batch (execMany): argv = [specFile] (after `--`). The spec holds the commands,
// each with its log file, the timeout in ms, how many run at once and the file for the results. Each command runs
// through the shell with stdio on its log and its own timer, which kills its whole process tree as WRAPPER_SOURCE does
// (taskkill /T on Windows, the process group elsewhere) and records the timeout exit code with timedOut. When every
// command has ended it writes [{code, ms, timedOut}] in the commands' order and exits 0.
const MANY_WRAPPER_SOURCE = `
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const spec = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const win = process.platform === 'win32';
const results = new Array(spec.cmds.length);
let next = 0, running = 0, done = 0;
const finish = () => { fs.writeFileSync(spec.out, JSON.stringify(results)); process.exit(0); };
const start = () => {
  while (running < spec.concurrency && next < spec.cmds.length) {
    const i = next++;
    running++;
    const t0 = Date.now();
    const fd = fs.openSync(spec.cmds[i].log, 'a');
    let timedOut = false, settled = false, timer = null;
    const settle = code => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { fs.closeSync(fd); } catch {}
      results[i] = { code, ms: Date.now() - t0, timedOut };
      running--; done++;
      if (done === spec.cmds.length) finish(); else start();
    };
    let child;
    try { child = spawn(spec.cmds[i].cmd, { shell: true, stdio: ['ignore', fd, fd], detached: !win, windowsHide: true }); }
    catch (e) { try { fs.writeSync(fd, 'spawn error: ' + e.message + require('os').EOL); } catch {} settle(127); continue; }
    timer = setTimeout(() => {
      timedOut = true;
      try {
        if (win) execFileSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true });
        else process.kill(-child.pid, 'SIGKILL');
      } catch {}
      settle(${TIMEOUT_EXIT});
    }, spec.timeoutMs);
    child.on('error', e => { try { fs.writeSync(fd, 'spawn error: ' + e.message + require('os').EOL); } catch {} settle(127); });
    child.on('exit', code => settle(code === null ? 1 : code));
  }
};
if (!spec.cmds.length) finish(); else start();
`;

// A batch of commands in one spawnSync of MANY_WRAPPER_SOURCE (C-12): the CLI stays synchronous, and each command keeps
// its own log, code and timeout. The batch's own timeout is the per-command one times the waves, plus 15 s.
export function defaultExecMany(cwd: string): ExecMany {
  return (cmds: string[], timeoutSec: number, concurrency: number): ExecResult[] => {
    const t0 = Date.now();
    let dir: string | undefined;
    try {
      dir = mkdtempSync(path.join(tmpdir(), 'forge-many-'));
      const logs = cmds.map((_, i) => path.join(dir!, `${i}.log`));
      for (const l of logs) writeFileSync(l, '');
      const out = path.join(dir, 'out.json');
      const spec = path.join(dir, 'spec.json');
      const width = Math.max(1, Math.min(Math.floor(concurrency) || 1, cmds.length || 1));
      writeFileSync(spec, JSON.stringify({ cmds: cmds.map((cmd, i) => ({ cmd, log: logs[i] })), timeoutMs: timeoutSec * 1000, concurrency: width, out }));
      const r = spawnSync(process.execPath, ['-e', MANY_WRAPPER_SOURCE, '--', spec], {
        cwd, windowsHide: true, timeout: timeoutSec * 1000 * Math.ceil(cmds.length / width) + 15000, stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8', maxBuffer: 64 * 1024,
      });
      let rows: unknown = null;
      try { rows = JSON.parse(readFileSync(out, 'utf8')); } catch { rows = null; }
      const err = r.error as NodeJS.ErrnoException | undefined;
      return cmds.map((_, i) => {
        let output = '';
        let fd: number | undefined;
        try { fd = openSync(logs[i], 'r'); output = readTail(fd); } catch { output = ''; } finally { if (fd !== undefined) { try { closeSync(fd); } catch { /* ignore */ } } }
        const row = Array.isArray(rows) ? rows[i] as { code?: unknown; ms?: unknown; timedOut?: unknown } | null : null;
        if (row && typeof row.code === 'number') return { code: row.code, output, ms: typeof row.ms === 'number' ? row.ms : Date.now() - t0, timedOut: row.timedOut === true };
        // The batch itself died (its own timeout, a crash): a command without a result fails and says why.
        const why = err ? err.message : (r.stderr || 'the batch of validators ended early').trim();
        return { code: 1, output: `${output}${output && !output.endsWith('\n') ? '\n' : ''}forge: ${why}\n`, ms: Date.now() - t0, timedOut: err?.code === 'ETIMEDOUT' };
      });
    } catch (e) {
      return cmds.map(() => ({ code: 1, output: `forge: could not run the commands: ${(e as Error).message}\n`, ms: Date.now() - t0, timedOut: false }));
    } finally {
      if (dir !== undefined) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } }
    }
  };
}

// null when git fails (not a repository, git missing, output too large, or a non-zero exit such as
// `git grep` finding nothing).
export function defaultGit(cwd: string) {
  return (args: string[]): string | null => {
    try { return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: MAX_GIT_OUTPUT, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch { return null; }
  };
}

export const repoReader = (root: string): RepoReader => ({
  exists: rel => existsSync(path.join(root, rel)),
  read: rel => { try { return readFileSync(path.join(root, rel), 'utf8'); } catch { return null; } },
  list: dir => { try { return readdirSync(path.join(root, dir ?? '')); } catch { return []; } },
});
