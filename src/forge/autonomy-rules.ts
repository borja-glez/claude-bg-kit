// Plan 6b-1, Task 4: the first four autonomy rules. In an autonomous run (ctx.autonomous not null) a PreToolUse hook
// (Task 7) runs these on every Bash, PowerShell, Edit, Write and NotebookEdit call; an attended session gets null from
// each. They deny, before it happens: switching the guard off (self), writes and deletes outside the run's roots or whose
// target is unknown (files), global installs (install), and git that pushes, moves a protected branch or touches state the
// clone shares (git). The lists below are the readable reference the spec asks for; names compare through commandName.
import type { GuardCtx, GuardInput, GuardRule, GuardVerdict } from './guard.js';
import { FILE_TOOLS, forgeCalls, shellCommand, targetPaths } from './guard.js';
import { commandName, type Dialect, type Segment, type Word } from './shell-words.js';
import { bashSegments, deny, insideRoots, segmentPath } from './autonomy-shared.js';

// ---- lists ----------------------------------------------------------------------------------------------------------

// FILE_WRITERS (H4): commands that create, delete, overwrite, move or link a file. fsutil hardlink, sed -i and find -delete write only in a form writeTargets reads.
export const FILE_WRITERS: readonly string[] = [
  'rm', 'rmdir', 'unlink', 'shred', 'truncate', 'del', 'erase', 'rd', 'remove-item', 'ri', 'clear-content', 'mv', 'move', 'move-item', 'mi', 'ren', 'rename-item',
  'cp', 'copy', 'xcopy', 'robocopy', 'copy-item', 'cpi', 'ln', 'mklink', 'tee', 'set-content', 'sc', 'add-content', 'ac', 'out-file', 'set-item', 'new-item', 'ni',
  'export-csv', 'export-clixml', 'chmod', 'chown', 'icacls', 'attrib', 'dd', 'install', 'patch', 'rsync', 'tar', 'unzip', '7z', 'expand-archive', 'start-bitstransfer',
  'sort', 'fsutil', 'sed', 'gsed', 'perl', 'ruby', 'find',
];
const FILE_WRITER_SET = new Set(FILE_WRITERS);
// Copy and move-like writers whose only target is the destination (the last operand, or the -t directory); their sources are not written.
const COPY_LIKE = new Set(['cp', 'copy', 'copy-item', 'cpi', 'xcopy', 'robocopy', 'rsync', 'install']);
// Writers whose target is named only by an OUTPUT_FLAGS option (or a redirection), never a positional argument.
const OUTPUT_ONLY = new Set(['curl', 'wget', 'tar', 'unzip', '7z', 'dd', 'sort', 'patch', 'start-bitstransfer', 'expand-archive', 'invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm']);
// Writers each of whose non-switch operands is a target.
const POSITIONAL = new Set(['rm', 'rmdir', 'unlink', 'shred', 'truncate', 'del', 'erase', 'rd', 'remove-item', 'ri', 'clear-content', 'mv', 'move', 'move-item', 'mi',
  'ren', 'rename-item', 'tee', 'set-content', 'sc', 'add-content', 'ac', 'out-file', 'set-item', 'new-item', 'ni', 'export-csv', 'export-clixml', 'chmod', 'chown', 'attrib']);
// In-place editors: a writer only with -i; their script arguments (-e, -f, a bare script) are not targets (M13).
const SCRIPT_INPLACE = new Set(['sed', 'gsed', 'perl', 'ruby']);
// A `/switch` is never a target in the cmd dialect, nor after these cmd builtins in any dialect (M13).
const SLASH_SWITCH = new Set(['del', 'erase', 'rd', 'copy', 'xcopy', 'robocopy', 'move', 'attrib']);

// OUTPUT_FLAGS (H4): the option that names where a non-positional writer writes; curl -O, dd of= and 7z -o<dir> are read apart.
export const OUTPUT_FLAGS: Record<string, readonly string[]> = {
  curl: ['-o', '--output'],
  wget: ['-O', '--output-document', '-P', '--directory-prefix'],
  'invoke-webrequest': ['-outfile'], iwr: ['-outfile'], 'invoke-restmethod': ['-outfile'], irm: ['-outfile'],
  'start-bitstransfer': ['-destination'], 'expand-archive': ['-destinationpath'],
  tar: ['-C', '--directory'], unzip: ['-d'], sort: ['-o', '--output'], patch: ['-d', '-o'],
};

export const SETTINGS_FILES: readonly string[] = ['.claude/settings.json', '.claude/settings.local.json'];

// CLAUDE_SWITCHES (H5): the claude subcommands and flags that would switch the guard off.
const CLAUDE_SUBS: Record<string, readonly string[]> = {
  plugin: ['disable', 'uninstall', 'install', 'update', 'marketplace'], config: ['set', 'add', 'remove'], mcp: ['add', 'add-json', 'remove'],
};
const CLAUDE_FLAGS: readonly string[] = ['--settings', '--setting-sources', '--dangerously-skip-permissions'];

// Package systems whose write subcommands are a global install (sudo is always one).
const PKG_SYSTEMS = new Set(['brew', 'choco', 'winget', 'scoop', 'apt', 'apt-get', 'dnf', 'yum', 'pacman', 'zypper', 'snap', 'port', 'apk']);
const PKG_VERBS = new Set(['install', 'upgrade', 'uninstall', 'remove', 'update', 'reinstall', 'tap', 'link', 'unlink', 'cleanup', 'autoremove', 'purge']);
const PS_INSTALL = new Set(['install-module', 'install-package', 'install-psresource', 'install-script', 'update-module', 'uninstall-module']);
// Download-and-run (H7): a downloader piped into, or feeding a dynamic word to, an interpreter.
const DOWNLOADERS = new Set(['curl', 'wget', 'iwr', 'irm', 'invoke-webrequest', 'invoke-restmethod']);
const INTERPRETERS = new Set(['sh', 'bash', 'zsh', 'dash', 'fish', 'pwsh', 'powershell', 'iex', 'invoke-expression', 'python', 'node', 'ruby', 'perl']);

// git's global options that take a value, read before the subcommand (H3).
const GIT_VALUED = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env', '--exec-path']);
const GIT_DIR_CMDS = new Set(['merge', 'rebase', 'reset', 'cherry-pick', 'revert', 'commit', 'pull', 'am', 'clean', 'restore']);

const SELF_INSTEAD = 'the guard stays on for this whole conversation, also after the run stops (`FORGE stop` ends the run, never the guard); record what you needed as not done, and the person does it in a new conversation';
const INSTALL_INSTEAD = 'install inside the worktree: node_modules, a .venv, or a tools folder of the worktree with PLAYWRIGHT_BROWSERS_PATH and the like';

// forge's parser takes `--cwd <dir>` out wherever it sits (self reads the call without it).
const CWD_FLAG = /(?:^|\s)--cwd\s+(?:"[^"]*"|'[^']*'|\S+)/gi;

// ---- write targets --------------------------------------------------------------------------------------------------

const valWord = (w: Word, from: number): Word => ({ text: w.text.slice(from), dynamic: w.dynamic, glob: false });
const cwdWord = (): Word => ({ text: '.', dynamic: false, glob: false });

/** A switch, not a path: a `-flag`, or a `/switch` in cmd or after a cmd builtin (M13). */
function isSwitch(w: Word, name: string, dialect: Dialect): boolean {
  if (w.text.startsWith('-')) return true;
  return /^\/./.test(w.text) && (dialect === 'cmd' || SLASH_SWITCH.has(name));
}

/** Whether a tar invocation extracts (only then does -C name a write target). */
const tarExtracts = (args: Word[]): boolean =>
  args.some(w => w.text === '--extract' || w.text.startsWith('--extract=') || (/^[a-z]+$/i.test(w.text.replace(/^-+/, '')) && w.text.replace(/^-+/, '').includes('x')));

/** The values of any of `flags` (space form, `=` glued, or glued after a short `-x`); PowerShell flags match without case. */
function flagValues(args: Word[], flags: readonly string[], dialect: Dialect): Word[] {
  const out: Word[] = [];
  for (let k = 0; k < args.length; k++) {
    const t = args[k].text;
    for (const f of flags) {
      const short = f.length === 2 && f.startsWith('-') && f[1] !== '-';
      if (t === f || (dialect !== 'bash' && t.toLowerCase() === f.toLowerCase())) { if (args[k + 1]) out.push(args[k + 1]); break; }
      if (t.startsWith(f + '=')) { out.push(valWord(args[k], f.length + 1)); break; }
      if (short && t.length > 2 && t.startsWith(f)) { out.push(valWord(args[k], 2)); break; }
    }
  }
  return out;
}

function outputTargets(name: string, args: Word[], seg: Segment): Word[] {
  const out: Word[] = [];
  const flags = OUTPUT_FLAGS[name];
  if (flags && !(name === 'tar' && !tarExtracts(args))) out.push(...flagValues(args, flags, seg.dialect));
  if (name === 'curl' && args.some(w => w.text === '--remote-name' || /^-[A-Za-z]*O/.test(w.text))) out.push(cwdWord());
  if (name === 'dd') for (const w of args) if (/^of=/.test(w.text)) out.push(valWord(w, 3));
  if (name === '7z') for (const w of args) if (/^-o./.test(w.text)) out.push(valWord(w, 2));
  return out;
}

function copyTargets(args: Word[], name: string, seg: Segment): Word[] {
  for (let k = 0; k < args.length; k++) {
    const t = args[k].text;
    if (t === '-t' || t === '--target-directory') return args[k + 1] ? [args[k + 1]] : [];
    if (t.startsWith('--target-directory=')) return [valWord(args[k], '--target-directory='.length)];
  }
  const operands = args.filter(w => !isSwitch(w, name, seg.dialect));
  return operands.length ? [operands[operands.length - 1]] : [];
}

function sedTargets(args: Word[]): Word[] {
  const scriptFlag = (t: string) => ['-e', '--expression', '-f', '--file'].includes(t);
  const hasEF = args.some(w => scriptFlag(w.text) || /^-[ef]/.test(w.text));
  const inPlace = args.some(w => w.text === '-i' || w.text === '--in-place' || w.text.startsWith('--in-place=') || (/^-i/.test(w.text) && !w.text.startsWith('--')));
  if (!inPlace) return [];
  const operands: Word[] = [];
  for (let k = 0; k < args.length; k++) {
    if (scriptFlag(args[k].text)) { k++; continue; } // its value is a script
    if (args[k].text.startsWith('-')) continue;
    operands.push(args[k]);
  }
  if (!hasEF) operands.shift(); // the first operand is the script
  return operands;
}

/** The words a segment writes: its write redirections and, by the command, its file operands (T4: a dynamic argv[0] is judged by its non-flag args). */
export function writeTargets(seg: Segment): Word[] {
  const out: Word[] = [];
  for (const r of seg.redirects) if (r.op === '>' || r.op === '>>') out.push(r.target);
  const argv = seg.argv;
  if (!argv.length) return out;
  if (argv[0].dynamic) { for (const w of argv.slice(1)) if (!w.text.startsWith('-')) out.push(w); return out; }
  const name = commandName(argv[0]), args = argv.slice(1);
  if (OUTPUT_ONLY.has(name)) { out.push(...outputTargets(name, args, seg)); return out; }
  if (name === 'ln' || name === 'mklink') { for (const w of args) if (!isSwitch(w, name, seg.dialect)) out.push(w); return out; }
  if (name === 'find') { if (args.some(w => w.text === '-delete')) for (const w of args) { if (w.text.startsWith('-') || w.text.startsWith('(')) break; out.push(w); } return out; }
  if (SCRIPT_INPLACE.has(name)) { out.push(...sedTargets(args)); return out; }
  if (name === 'icacls') { const op = args.find(w => !isSwitch(w, name, seg.dialect)); if (op) out.push(op); return out; }
  if (name === 'fsutil') { if (args[0]?.text.toLowerCase() === 'hardlink') for (const w of args.slice(1)) if (!isSwitch(w, name, seg.dialect) && w.text.toLowerCase() !== 'create') out.push(w); return out; }
  if (COPY_LIKE.has(name)) { out.push(...copyTargets(args, name, seg)); return out; }
  if (POSITIONAL.has(name)) { for (const w of args) if (!isSwitch(w, name, seg.dialect)) out.push(w); return out; }
  return out;
}

// ---- self -----------------------------------------------------------------------------------------------------------

function endsWithSettings(p: string, platform: NodeJS.Platform = process.platform): boolean {
  const fold = platform === 'win32' || platform === 'darwin';
  const s = fold ? p.replace(/\\/g, '/').toLowerCase() : p.replace(/\\/g, '/');
  return SETTINGS_FILES.some(f => { const suf = fold ? f.toLowerCase() : f; return s === suf || s.endsWith('/' + suf); });
}

/** A claude call that would switch the guard off: a settings subcommand, or a switch flag anywhere (H5). */
function claudeSwitch(argv: Word[]): boolean {
  const a = argv.map(w => w.text);
  if (a.some(t => CLAUDE_FLAGS.includes(t) || /^--permission-mode=bypasspermissions$/i.test(t))) return true;
  if (a.some((t, k) => t === '--permission-mode' && /^bypasspermissions$/i.test(a[k + 1] ?? ''))) return true;
  const sub = a.slice(1).filter(t => !t.startsWith('-'));
  return !!sub[0] && (CLAUDE_SUBS[sub[0]]?.includes(sub[1] ?? '') ?? false);
}

export const selfRule: GuardRule = {
  id: 'self',
  check(input, ctx) {
    if (!ctx.autonomous) return null;
    if (FILE_TOOLS.includes(input.tool_name)) {
      for (const p of targetPaths(input, ctx)) if (endsWithSettings(p)) return deny('self', `writing the project settings (${p}) would switch the hook off`, SELF_INSTEAD);
      return null;
    }
    const segs = bashSegments(input, ctx);
    if (!segs) return null;
    for (const seg of segs) {
      for (const w of writeTargets(seg)) {
        const text = segmentPath(w, seg) ?? w.text.replace(/\\/g, '/');
        if (endsWithSettings(text)) return deny('self', 'writing the project settings would switch the hook off', SELF_INSTEAD);
      }
      if (seg.argv.length && !seg.argv[0].dynamic && commandName(seg.argv[0]) === 'claude' && claudeSwitch(seg.argv))
        return deny('self', 'this claude command could switch the guard off', SELF_INSTEAD);
    }
    const command = shellCommand(input);
    if (command !== null) for (const call of forgeCalls(command)) {
      const a = call.replace(CWD_FLAG, ' ');
      if (/^\s*infinite\s+start\b/.test(a) && !/(?:^|\s)--profile\b/.test(a)) return deny('self', 'infinite start without --profile would replace this run', SELF_INSTEAD);
    }
    return null;
  },
};

// ---- files ----------------------------------------------------------------------------------------------------------

export const filesRule: GuardRule = {
  id: 'files',
  check(input, ctx) {
    if (!ctx.autonomous) return null;
    const instead = `work inside ${ctx.autonomous.worktree} or ${ctx.autonomous.tmp}, naming each file (a target the hook cannot see is never touched)`;
    if (FILE_TOOLS.includes(input.tool_name)) {
      for (const p of targetPaths(input, ctx)) if (!insideRoots(p, ctx)) return deny('files', `${p} is outside the run's roots`, instead);
      return null;
    }
    const segs = bashSegments(input, ctx);
    if (!segs) return null;
    for (const seg of segs) {
      for (const w of writeTargets(seg)) {
        const p = segmentPath(w, seg);
        if (p === null) return deny('files', `unknown target: ${w.text || 'a path the shell hides'}`, instead);
        if (!insideRoots(p, ctx)) return deny('files', `${p} is outside the run's roots`, instead);
      }
      if (seg.dynamicArgs && seg.argv.length && !seg.argv[0].dynamic && FILE_WRITER_SET.has(commandName(seg.argv[0])))
        return deny('files', `unknown target: ${commandName(seg.argv[0])} writes files the hook cannot see`, instead);
    }
    return null;
  },
};

// ---- install --------------------------------------------------------------------------------------------------------

const hasSep = (t: string): boolean => t.includes('/') || t.includes('\\');

/** A flag in `flags` whose value (space form or `=`) resolves inside the run's roots. */
function flagInside(seg: Segment, ctx: GuardCtx, flags: readonly string[]): boolean {
  const a = seg.argv;
  for (let k = 0; k < a.length; k++) {
    const t = a[k].text;
    for (const f of flags) {
      if (t === f && a[k + 1]) { const p = segmentPath(a[k + 1], seg); if (p && insideRoots(p, ctx)) return true; }
      else if (t.startsWith(f + '=')) { const p = segmentPath(valWord(a[k], f.length + 1), seg); if (p && insideRoots(p, ctx)) return true; }
    }
  }
  return false;
}

const envInside = (seg: Segment, ctx: GuardCtx, key: string): boolean => {
  const w = seg.env[key];
  if (!w) return false;
  const p = segmentPath(w, seg);
  return !!p && insideRoots(p, ctx);
};

/** The segment before a pip install activates a virtualenv inside the roots (source …/activate, …/Activate.ps1). */
function activatesEnv(prev: Segment, ctx: GuardCtx): boolean {
  if (!prev.argv.length) return false;
  const n = commandName(prev.argv[0]);
  if ((n === 'source' || n === '.') && prev.argv[1]) { const p = segmentPath(prev.argv[1], prev); return !!p && insideRoots(p, ctx); }
  if (/(?:^|[\\/])activate(?:\.ps1|\.bat|\.sh|\.csh|\.fish)?$/i.test(prev.argv[0].text)) { const p = segmentPath(prev.argv[0], prev); return !!p && insideRoots(p, ctx); }
  return false;
}

/** A pip/python-pip install allowed because it stays inside the worktree; --user is never allowed. */
function pipInside(seg: Segment, ctx: GuardCtx, segs: Segment[], idx: number): boolean {
  const a = seg.argv.map(w => w.text);
  if (a.includes('--user')) return false;
  if (hasSep(seg.argv[0].text)) { const p = segmentPath(seg.argv[0], seg); if (p && insideRoots(p, ctx)) return true; }
  if (flagInside(seg, ctx, ['--target', '-t', '--prefix'])) return true;
  return idx > 0 && activatesEnv(segs[idx - 1], ctx);
}

const playwrightInstall = (seg: Segment): boolean => {
  const pi = seg.argv.findIndex(w => commandName(w) === 'playwright');
  return pi >= 0 && seg.argv.slice(pi + 1).some(w => w.text === 'install');
};

const isDownloader = (seg: Segment): boolean => seg.argv.length > 0 && (DOWNLOADERS.has(commandName(seg.argv[0])) || seg.argv.some(w => /downloadstring/i.test(w.text)));

/** A download segment piped into, or passing a dynamic word to, an interpreter (H7). */
function downloadAndRun(segs: Segment[]): boolean {
  if (!segs.some(isDownloader)) return false;
  return segs.some((s, i) => s.argv.length > 0 && INTERPRETERS.has(commandName(s.argv[0]))
    && ((s.after === '|' && i > 0 && isDownloader(segs[i - 1])) || s.argv.some(w => w.dynamic)));
}

/** Whether a single segment is a global install. */
function installs(seg: Segment, ctx: GuardCtx, segs: Segment[], idx: number): boolean {
  if (!seg.argv.length || seg.argv[0].dynamic) return false;
  const name = commandName(seg.argv[0]), a = seg.argv.slice(1).map(w => w.text);
  if (name === 'sudo') return true;
  if (name === 'npm' || name === 'pnpm' || name === 'yarn' || name === 'bun') {
    if (a.includes('-g') || a.includes('--global') || a.includes('--location=global') || a.some((t, k) => t === '--location' && a[k + 1] === 'global')) return true;
    if (name === 'yarn' && a[0] === 'global') return true;
    return name === 'npm' && a[0] === 'link' && a.slice(1).every(t => t.startsWith('-'));
  }
  if (/^pip[0-9.]*$/.test(name) && a.includes('install')) return !pipInside(seg, ctx, segs, idx);
  if (/^(?:python[0-9.]*|py)$/.test(name)) { const mi = a.indexOf('-m'); if (mi >= 0 && a[mi + 1] === 'pip' && a.includes('install')) return !pipInside(seg, ctx, segs, idx); }
  if (name === 'uv' && a[0] === 'tool' && a[1] === 'install') return true;
  if (name === 'uv' && a[0] === 'pip' && a[1] === 'install' && a.includes('--system')) return true;
  if (name === 'pipx' && a[0] === 'install') return true;
  if (PKG_SYSTEMS.has(name)) { const sub = a.find(t => !t.startsWith('-')); return !!sub && PKG_VERBS.has(sub); }
  if (name === 'cargo' && a[0] === 'install') return !flagInside(seg, ctx, ['--root']);
  if (name === 'go' && a[0] === 'install') return !envInside(seg, ctx, 'GOBIN');
  if (name === 'gem' && a[0] === 'install') return !flagInside(seg, ctx, ['--install-dir', '-i']);
  if (name === 'bundle' && a[0] === 'install') return !flagInside(seg, ctx, ['--path']) && !envInside(seg, ctx, 'BUNDLE_PATH');
  if (name === 'dotnet' && a[0] === 'tool' && a[1] === 'install') return a.includes('-g') || a.includes('--global');
  if (name === 'dotnet' && a[0] === 'workload' && a[1] === 'install') return true;
  if (name === 'rustup' || name === 'msiexec') return true;
  if ((name === 'conda' || name === 'mamba' || name === 'micromamba') && ['install', 'create', 'update', 'remove'].includes(a[0])) return true;
  if (['nvm', 'volta', 'fnm', 'asdf', 'sdk', 'pyenv', 'rbenv', 'deno'].includes(name) && a[0] === 'install') return true;
  if ((name === 'mise' || name === 'rtx') && (a[0] === 'install' || (a[0] === 'use' && a.includes('-g')))) return true;
  if (name === 'corepack' && a[0] === 'enable') return true;
  if (PS_INSTALL.has(name)) return true;
  return playwrightInstall(seg) && !envInside(seg, ctx, 'PLAYWRIGHT_BROWSERS_PATH');
}

export const installRule: GuardRule = {
  id: 'install',
  check(input, ctx) {
    if (!ctx.autonomous) return null;
    const segs = bashSegments(input, ctx);
    if (!segs) return null;
    if (downloadAndRun(segs)) return deny('install', 'a downloaded script would run on this machine', INSTALL_INSTEAD);
    for (let i = 0; i < segs.length; i++) if (installs(segs[i], ctx, segs, i)) return deny('install', `${commandName(segs[i].argv[0])} installs outside the worktree`, INSTALL_INSTEAD);
    return null;
  },
};

// ---- git ------------------------------------------------------------------------------------------------------------

/** The branch a ref or refspec points at: drop a leading `+`, keep the part after the last `:`, drop refs/heads/. */
function destBranch(text: string): string {
  let d = text.replace(/^\+/, '');
  const c = d.lastIndexOf(':');
  if (c >= 0) d = d.slice(c + 1);
  return d.replace(/^refs\/heads\//, '');
}

function configWrites(rest: Word[]): boolean {
  const reads = ['--get', '--get-all', '--get-regexp', '--get-urlmatch', '--list', '-l'];
  if (rest.some(w => reads.includes(w.text))) return false;
  const first = rest.find(w => !w.text.startsWith('-'))?.text;
  return !(first && ['get', 'list', 'get-all', 'get-regexp', 'get-urlmatch'].includes(first));
}

function gitSeg(seg: Segment, ctx: GuardCtx): GuardVerdict | null {
  const argv = seg.argv;
  const auto = ctx.autonomous!;
  const instead = `commit on ${auto.branch}; integrating into ${auto.protectedBranches.join('/')} is the person's call, and the run never pushes`;
  const D = (what: string) => deny('git', what, instead);
  // global options before the subcommand
  let i = 1, cDir: Word | null = null, workTree: Word | null = null, gitDirOpt = false;
  const cflags: string[] = [];
  while (i < argv.length && argv[i].text.startsWith('-')) {
    const w = argv[i], t = w.text, eq = t.indexOf('='), key = eq >= 0 ? t.slice(0, eq) : t;
    if (key === '-C') { cDir = eq >= 0 ? valWord(w, eq + 1) : argv[i + 1] ?? null; i += eq >= 0 ? 1 : 2; continue; }
    if (key === '-c') { cflags.push(eq >= 0 ? t.slice(eq + 1) : argv[i + 1]?.text ?? ''); i += eq >= 0 ? 1 : 2; continue; }
    if (key === '--work-tree') { workTree = eq >= 0 ? valWord(w, eq + 1) : argv[i + 1] ?? null; i += eq >= 0 ? 1 : 2; continue; }
    if (key === '--git-dir') { gitDirOpt = true; i += eq >= 0 ? 1 : 2; continue; }
    i += GIT_VALUED.has(key) && eq < 0 ? 2 : 1;
  }
  const sub = argv[i]?.text.toLowerCase() ?? '';
  const rest = argv.slice(i + 1);
  const operands = rest.filter(w => !w.text.startsWith('-'));
  const opTexts = operands.map(w => w.text);
  const hasDashDash = rest.some(w => w.text === '--');
  const isProtected = (t: string) => auto.protectedBranches.includes(destBranch(t));
  const isKnown = (t: string) => auto.branches.includes(destBranch(t));
  // the directory git runs in
  const wtW = seg.env.GIT_WORK_TREE ?? workTree, gdEnv = seg.env.GIT_DIR;
  const dir = wtW ? segmentPath(wtW, seg) : cDir ? segmentPath(cDir, seg) : (gitDirOpt || gdEnv) ? null : seg.cwd;
  const dirOk = dir !== null && insideRoots(dir, ctx);

  if (sub === 'push') return D('git push sends commits off this machine');
  for (const cf of cflags) { const k = cf.split('=')[0].toLowerCase(); if (k.startsWith('alias.') || k === 'core.sshcommand' || k === 'core.hookspath' || k === 'core.fsmonitor') return D(`git -c ${cf} changes how git runs`); }
  // a protected branch as a destination
  if ((sub === 'checkout' || sub === 'switch') && !hasDashDash && operands.length <= 1 && operands.some(w => isProtected(w.text))) return D(`checking out ${auto.protectedBranches.join('/')} would move off the run's branch`);
  if (sub === 'worktree' && opTexts[0] === 'add') {
    if (rest.some(w => w.text === '-f' || w.text === '--force')) return D('git worktree add --force overwrites a branch');
    const created = flagValues(rest, ['-b', '-B'], 'bash').map(w => w.text);
    if (operands.slice(1).some(w => isProtected(w.text)) || created.some(isProtected)) return D('a worktree on a protected branch');
  }
  if (sub === 'rebase' && operands[1] && isProtected(operands[1].text)) return D('rebasing a protected branch moves it');
  if (sub === 'fetch' && operands.slice(1).some(w => w.text.includes(':') && isProtected(w.text))) return D('this fetch would write a protected branch');
  if (sub === 'update-ref' && operands.some(w => isProtected(w.text))) return D('update-ref on a protected branch');
  if (sub === 'branch' && rest.some(w => /^-(?:f|m|M|c|C)$/.test(w.text)) && operands[0] && isProtected(operands[0].text)) return D('moving a protected branch');
  // deleting branches, tags and history
  if (sub === 'branch' && rest.some(w => /^(?:-d|-D|--delete|-m)$/.test(w.text)) && operands.some(w => !isKnown(w.text))) return D("deleting a branch that is not the run's");
  if (sub === 'update-ref' && rest.some(w => w.text === '-d') && operands.some(w => !isKnown(w.text) && !isProtected(w.text))) return D("update-ref -d of a branch that is not the run's");
  if (sub === 'tag' && rest.some(w => w.text === '-d' || w.text === '-f')) return D('git tag -d/-f rewrites a tag');
  if (sub === 'filter-branch' || sub === 'filter-repo' || sub === 'replace') return D('a history rewrite');
  // state the clone shares
  if (sub === 'stash' && opTexts[0] !== 'list' && opTexts[0] !== 'show') return D('git stash uses the stash the clone shares');
  if (sub === 'config' && configWrites(rest)) return D('git config writes settings the clone shares');
  if (sub === 'remote' && ['add', 'remove', 'rm', 'set-url', 'rename'].includes(opTexts[0])) return D('changing a remote');
  if (sub === 'gc') return D('git gc rewrites the object store');
  if (sub === 'reflog' && opTexts[0] === 'expire') return D('reflog expire drops recovery state');
  if (sub === 'worktree' && opTexts[0] === 'remove') { const p = operands[1] ? segmentPath(operands[1], seg) : null; if (p === null || !insideRoots(p, ctx)) return D('git worktree remove outside the roots'); }
  if (sub === 'worktree' && opTexts[0] === 'prune' && !dirOk) return D('git worktree prune outside the roots');
  // the commands that must run inside the roots
  const dirRestricted = GIT_DIR_CMDS.has(sub) || ((sub === 'checkout' || sub === 'switch') && (hasDashDash || operands.length > 1));
  if (dirRestricted && !dirOk) return D(`git ${sub} runs outside the run's roots`);
  return null;
}

export const gitRule: GuardRule = {
  id: 'git',
  check(input, ctx) {
    if (!ctx.autonomous) return null;
    const segs = bashSegments(input, ctx);
    if (!segs) return null;
    for (const seg of segs) {
      if (!seg.argv.length || seg.argv[0].dynamic || commandName(seg.argv[0]) !== 'git') continue;
      const v = gitSeg(seg, ctx);
      if (v) return v;
    }
    return null;
  },
};
