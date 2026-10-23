// Plan 6b-1, Task 4: the first four autonomy rules. In an autonomous run (ctx.autonomous not null) a PreToolUse hook
// (Task 7) runs these on every Bash, PowerShell, Edit, Write and NotebookEdit call; an attended session gets null from
// each. Fix 2 (T4-FAILCLOSED): the rules judge every word that could be a target and exempt only what they understand;
// an unknown option cancels exemptions; a writer in an outside or unknown cwd denies. The heavy write-target parsing is in
// autonomy-parse.ts; the readable command lists live here. They deny: switching the guard off (self), writes outside the
// run's roots or whose target is unknown (files), global installs (install), and dangerous git (git).
import type { GuardCtx, GuardInput, GuardRule, GuardVerdict } from './guard.js';
import { CWD_FLAG, FILE_TOOLS, forgeCalls, shellCommand, targetPaths } from './guard.js';
import { commandName, GIT_VALUED, type Segment, type Word } from './shell-words.js';
import { bashSegments, deny, insideRoots, segmentPath } from './autonomy-shared.js';
import { copyEnds, newItemName, writeInfo } from './autonomy-parse.js';

// A write target kept for compatibility with the review probes; the rules read writeInfo directly.
export function writeTargets(seg: Segment): Word[] { return writeInfo(seg).targets; }

export const SETTINGS_FILES: readonly string[] = ['.claude/settings.json', '.claude/settings.local.json'];
const SETTINGS_RE = /(?:^|[\\/])settings(?:\.local)?\.json$/i;

// CLAUDE_SWITCHES (H5): the claude subcommands and flags that would switch the guard off.
export const CLAUDE_SWITCHES = {
  subs: { plugin: ['disable', 'uninstall', 'install', 'update', 'marketplace'], config: ['set', 'add', 'remove'], mcp: ['add', 'add-json', 'remove'] } as Record<string, string[]>,
  flags: ['--settings', '--setting-sources', '--dangerously-skip-permissions'],
};

// Package systems: skip the manager's own options, then allow only a read verb (apk, pacman and zypper use their own verbs).
const PKG_SYSTEMS = new Set(['apt', 'apt-get', 'dnf', 'yum', 'brew', 'choco', 'winget', 'scoop', 'port', 'snap', 'flatpak', 'pkg', 'emerge', 'nix-env']);
const PKG_READ = new Set(['search', 'list', 'info', 'show', 'query', 'policy', 'outdated', 'doctor', 'view', 'cat', 'home', 'deps', 'leaves', 'desc', 'files', 'provides']);
const PS_INSTALL = new Set(['install-module', 'install-package', 'install-psresource', 'install-script', 'update-module', 'uninstall-module']);
const DOWNLOADERS = new Set(['curl', 'wget', 'iwr', 'irm', 'invoke-webrequest', 'invoke-restmethod']);
const DOWNLOAD_RE = /\b(?:curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod|downloadstring|downloadfile)\b/i;
const isInterpreter = (name: string): boolean =>
  /^(?:sh|bash|zsh|dash|ksh|fish|pwsh|powershell|iex|invoke-expression|node|ruby|perl|deno|bun|python[0-9.]*|node[0-9.]*)$/.test(name);
const isShell = (name: string): boolean => /^(?:sh|bash|zsh|dash|ksh|fish|pwsh|powershell)$/.test(name);

// git global switches (valued ones are shared GIT_VALUED); a global option in neither means the subcommand cannot be read → deny.
const GIT_GLOBAL_SWITCH = new Set(['--no-pager', '-p', '-P', '--paginate', '--bare', '--literal-pathspecs', '--no-literal-pathspecs', '--glob-pathspecs', '--noglob-pathspecs',
  '--icase-pathspecs', '--no-replace-objects', '--no-optional-locks', '--no-advice', '--html-path', '--man-path', '--info-path', '--version', '--help', '-h', '--no-lazy-fetch', '--no-commit-graph']);
// Subcommands that write the work tree or move a ref: judged by their directory.
const GIT_DIR_CMDS = new Set(['merge', 'rebase', 'reset', 'cherry-pick', 'revert', 'commit', 'pull', 'am', 'clean', 'restore', 'rm', 'mv', 'checkout', 'switch', 'apply', 'read-tree', 'checkout-index', 'sparse-checkout', 'stash']);
// git subcommands the self rule treats as writing the work tree (a settings pathspec there switches the hook off).
const GIT_WRITE_TREE = new Set(['checkout', 'restore', 'reset', 'stash', 'apply', 'am', 'merge', 'pull', 'cherry-pick', 'revert', 'mv', 'rm', 'read-tree', 'checkout-index', 'switch']);

const SELF_INSTEAD = 'the guard stays on for this whole conversation, also after the run stops (`FORGE stop` ends the run, never the guard); record what you needed as not done, and the person does it in a new conversation';
const INSTALL_INSTEAD = 'install inside the worktree: node_modules, a .venv, or a tools folder of the worktree with PLAYWRIGHT_BROWSERS_PATH and the like';

const valWord = (w: Word, from: number): Word => ({ text: w.text.slice(from), dynamic: w.dynamic, glob: false });
const hasSep = (t: string): boolean => t.includes('/') || t.includes('\\');
const URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

/** Judge one candidate target word: inside the roots (ok), outside, or a target the hook cannot know (unknown). A URL is no path. */
function judge(w: Word, seg: Segment, ctx: GuardCtx): 'ok' | 'outside' | 'unknown' {
  if (w.dynamic) return 'unknown';
  if (URL_RE.test(w.text)) return 'ok';
  const p = segmentPath(w, seg);
  if (p === null) return 'unknown';
  return insideRoots(p, ctx) ? 'ok' : 'outside';
}

// ---- files ----------------------------------------------------------------------------------------------------------

export const filesRule: GuardRule = {
  id: 'files',
  check(input, ctx) {
    if (!ctx.autonomous) return null;
    const instead = `work inside ${ctx.autonomous.worktree} or ${ctx.autonomous.tmp}, naming each file (a target the hook cannot see is never touched)`;
    const outside = (p: string) => deny('files', `${p} is outside the run's roots`, instead);
    const unknown = (what: string) => deny('files', `unknown target: ${what}`, instead);
    if (FILE_TOOLS.includes(input.tool_name)) {
      for (const p of targetPaths(input, ctx)) if (!insideRoots(p, ctx)) return outside(p);
      return null;
    }
    const segs = bashSegments(input, ctx);
    if (!segs) return null;
    for (const seg of segs) {
      // T4-DYNAMIC-CMD: a command the shell names judges its own arguments.
      if (seg.argv.length && seg.argv[0].dynamic) {
        for (const w of seg.argv.slice(1)) {
          if (w.text.startsWith('-')) continue;
          const r = judge(w, seg, ctx);
          if (r === 'outside') return outside(segmentPath(w, seg) ?? w.text);
          if (r === 'unknown') return unknown(w.text || 'a path the shell hides');
        }
        if (seg.dynamicArgs) return unknown('a command the shell hides runs on files the hook cannot see');
        continue;
      }
      const info = writeInfo(seg);
      const redirs = seg.redirects.filter(r => r.op === '>' || r.op === '>>').map(r => r.target);
      if (!info.writer && redirs.length === 0) continue;
      // A write-class segment's directory must be inside the roots, whatever its operands.
      if (seg.cwd === null) return unknown('a command whose working directory the hook cannot see');
      if (!insideRoots(seg.cwd, ctx)) return outside(seg.cwd);
      if (info.writer && seg.dynamicArgs) return unknown(`${commandName(seg.argv[0])} runs on files the hook cannot see`);
      for (const w of [...redirs, ...info.targets]) {
        const r = judge(w, seg, ctx);
        if (r === 'unknown') return unknown(w.text || 'a path the shell hides');
        if (r === 'outside') return outside(segmentPath(w, seg) ?? w.text);
      }
    }
    return null;
  },
};

// ---- self -----------------------------------------------------------------------------------------------------------

/** A path that ends in one of the settings files, read with `/`, without case on win32/darwin, win32 trailing dots, spaces and NTFS streams stripped first. */
function endsWithSettings(p: string, platform: NodeJS.Platform = process.platform): boolean {
  const win = platform === 'win32', fold = win || platform === 'darwin';
  let s = p.replace(/\\/g, '/');
  if (win) s = s.split('/').map(seg => seg.replace(/:.*$/, '').replace(/[. ]+$/, '')).join('/');
  if (fold) s = s.toLowerCase();
  return SETTINGS_FILES.some(f => { const suf = fold ? f.toLowerCase() : f; return s === suf || s.endsWith('/' + suf); });
}

/** A claude call that would switch the guard off: a settings subcommand anywhere, or a switch flag (also `=` glued) (H5). */
function claudeSwitch(argv: Word[]): boolean {
  const a = argv.map(w => w.text);
  if (a.some(t => CLAUDE_SWITCHES.flags.some(f => t === f || t.startsWith(f + '=')) || /^--permission-mode[=\s]*bypasspermissions$/i.test(t))) return true;
  if (a.some((t, k) => t === '--permission-mode' && /^bypasspermissions$/i.test(a[k + 1] ?? ''))) return true;
  for (let k = 1; k < a.length; k++) { const acts = CLAUDE_SWITCHES.subs[a[k]]; if (acts && acts.includes(a[k + 1] ?? '')) return true; }
  return false;
}

/** Whether a write-class segment would create or overwrite a project settings file (also a copy/move/link into a `.claude` directory). */
function writesSettings(seg: Segment): boolean {
  for (const t of writeInfo(seg).targets) { const p = segmentPath(t, seg) ?? t.text.replace(/\\/g, '/'); if (endsWithSettings(p)) return true; }
  const ce = copyEnds(seg);
  if (ce) {
    const destP = (segmentPath(ce.dest, seg) ?? ce.dest.text).replace(/\\/g, '/').replace(/\/+$/, '');
    if ((destP === '.claude' || destP.endsWith('/.claude')) && ce.sources.some(s => SETTINGS_RE.test(s.text.replace(/\\/g, '/')))) return true;
  }
  const ni = newItemName(seg);
  return !!ni && endsWithSettings(ni.text);
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
      for (const r of seg.redirects) if ((r.op === '>' || r.op === '>>') && endsWithSettings(segmentPath(r.target, seg) ?? r.target.text.replace(/\\/g, '/'))) return deny('self', 'writing the project settings would switch the hook off', SELF_INSTEAD);
      if (!seg.argv.length || seg.argv[0].dynamic) continue;
      const name = commandName(seg.argv[0]);
      if (name === 'git') {
        const g = gitParse(seg);
        if (GIT_WRITE_TREE.has(g.sub) && g.allOperands.some(w => endsWithSettings(w.text.replace(/\\/g, '/')))) return deny('self', 'restoring the project settings would switch the hook off', SELF_INSTEAD);
      } else if (writesSettings(seg)) return deny('self', 'writing the project settings would switch the hook off', SELF_INSTEAD);
      if (name === 'claude' && claudeSwitch(seg.argv)) return deny('self', 'this claude command could switch the guard off', SELF_INSTEAD);
    }
    const command = shellCommand(input);
    if (command !== null) for (const call of forgeCalls(command)) {
      const a = call.replace(CWD_FLAG, ' ');
      if (/^\s*infinite\s+start\b/.test(a) && !/(?:^|\s)--profile(?=\s|=|$)/.test(a)) return deny('self', 'infinite start without --profile would replace this run', SELF_INSTEAD);
    }
    return null;
  },
};

// ---- install --------------------------------------------------------------------------------------------------------

/** A flag in `flags` whose value (space form or `=`) resolves inside the roots, or 'dynamic' when the value cannot be read. */
function flagInside(seg: Segment, ctx: GuardCtx, flags: readonly string[]): 'inside' | 'outside' | 'dynamic' | 'missing' {
  const a = seg.argv;
  for (let k = 0; k < a.length; k++) {
    const t = a[k].text;
    for (const f of flags) {
      const v = t === f ? a[k + 1] : t.startsWith(f + '=') ? valWord(a[k], f.length + 1) : null;
      if (v) { if (v.dynamic) return 'dynamic'; const p = segmentPath(v, seg); return p && insideRoots(p, ctx) ? 'inside' : 'outside'; }
    }
  }
  return 'missing';
}

function envInside(seg: Segment, ctx: GuardCtx, key: string): 'inside' | 'outside' | 'dynamic' | 'missing' {
  const w = seg.env[key];
  if (!w) return 'missing';
  if (w.dynamic) return 'dynamic';
  const p = segmentPath(w, seg);
  return p && insideRoots(p, ctx) ? 'inside' : 'outside';
}

/** The segment before a pip install activates a virtualenv inside the roots (source …/activate, …/Activate.ps1). */
function activatesEnv(prev: Segment, ctx: GuardCtx): boolean {
  if (!prev.argv.length) return false;
  const n = commandName(prev.argv[0]);
  if ((n === 'source' || n === '.') && prev.argv[1]) { if (!/(?:^|[\\/])activate(?:\.\w+)?$/i.test(prev.argv[1].text)) return false; const p = segmentPath(prev.argv[1], prev); return !!p && insideRoots(p, ctx); }
  if (/(?:^|[\\/])activate(?:\.ps1|\.bat|\.sh|\.csh|\.fish)?$/i.test(prev.argv[0].text)) { const p = segmentPath(prev.argv[0], prev); return !!p && insideRoots(p, ctx); }
  return false;
}

function pipInside(seg: Segment, ctx: GuardCtx, segs: Segment[], idx: number): boolean {
  const a = seg.argv.map(w => w.text);
  if (a.includes('--user')) return false;
  if (hasSep(seg.argv[0].text)) { const p = segmentPath(seg.argv[0], seg); if (p && insideRoots(p, ctx)) return true; }
  if (flagInside(seg, ctx, ['--target', '-t', '--prefix']) === 'inside') return true;
  return idx > 0 && activatesEnv(segs[idx - 1], ctx);
}

const playwrightInstall = (seg: Segment): boolean => {
  const pi = seg.argv.findIndex(w => commandName(w).replace(/@.*$/, '') === 'playwright');
  return pi >= 0 && seg.argv.slice(pi + 1).some(w => w.text === 'install');
};

const isDownloader = (seg: Segment): boolean => seg.argv.length > 0 && (DOWNLOADERS.has(commandName(seg.argv[0])) || seg.argv.some(w => /downloadstring|downloadfile/i.test(w.text)));

/** The word an interpreter reads its program from (the -c/-e string or the script operand), or null when it reads stdin. */
function programSlot(seg: Segment): Word | null {
  const name = commandName(seg.argv[0]), args = seg.argv.slice(1), shell = isShell(name);
  if (name === 'iex' || name === 'invoke-expression') return args.find(w => !w.text.startsWith('-')) ?? null;
  const word = (t: string): Word => ({ text: t, dynamic: false, glob: false });
  let dashS = false;
  for (let k = 0; k < args.length; k++) {
    const t = args[k].text;
    if (t === '-') return null; // an explicit stdin; the words after it are the script's own arguments
    if (shell && (t === '-c' || t === '--command')) return args[k + 1] ?? word('');
    if (!shell && /^(?:-e|-E|--eval|-c|-m|-p)$/.test(t)) return args[k + 1] ?? word('');
    if (shell && t === '-s') { dashS = true; continue; }
    if (!t.startsWith('-')) { if (shell && dashS) continue; return args[k]; }
  }
  return null;
}
const readsStdin = (seg: Segment): boolean => programSlot(seg) === null;

/** Download-and-run (H7): a downloader piped into an interpreter that reads stdin, or an interpreter whose program slot is a `$(…)`/dynamic download. */
function downloadAndRun(segs: Segment[]): boolean {
  const anyDownloader = segs.some(isDownloader);
  if (!anyDownloader) return false;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (!s.argv.length || !isInterpreter(commandName(s.argv[0]))) continue;
    if (readsStdin(s) && s.after === '|') { for (let j = i - 1; j >= 0; j--) { if (isDownloader(segs[j])) return true; if (segs[j].after !== '|') break; } }
    const prog = programSlot(s);
    if (prog && prog.dynamic && (DOWNLOAD_RE.test(prog.text) || anyDownloader)) return true;
  }
  return false;
}

/** Whether a system package manager's command is an install/change (not a read): skip its global options, then look at the verb. */
function pkgInstalls(name: string, a: string[]): boolean {
  if (name === 'pacman') return a.some(t => /^-S(?![sih])|^-R|^-U/.test(t)); // -S sync, -R remove, -U upgrade (not -Ss/-Si/-Sh search/info)
  if (name === 'apk') { const v = a.find(t => !t.startsWith('-')); return !!v && !PKG_READ.has(v); }
  const v = a.find(t => !t.startsWith('-'));
  return !!v && !PKG_READ.has(v) && !/^--/.test(v);
}

/** Whether a single segment is a global install; `unknown` marks a deny whose destination could not be read. */
function installs(seg: Segment, ctx: GuardCtx, segs: Segment[], idx: number): false | { unknown: boolean } {
  if (!seg.argv.length || seg.argv[0].dynamic) return false;
  const name = commandName(seg.argv[0]), a = seg.argv.slice(1).map(w => w.text);
  const yes = { unknown: false }, unk = { unknown: true };
  const root = (flags: string[]): false | { unknown: boolean } => { const r = flagInside(seg, ctx, flags); return r === 'inside' ? false : r === 'dynamic' ? unk : yes; };
  if (name === 'sudo') return yes;
  if (name === 'npm' || name === 'pnpm' || name === 'yarn' || name === 'bun') {
    if (a.includes('-g') || a.includes('--global') || a.includes('--location=global') || a.some((t, k) => t === '--location' && a[k + 1] === 'global')) return yes;
    if (name === 'yarn' && a[0] === 'global') return yes;
    if (name === 'npm' && a[0] === 'link' && a.slice(1).every(t => t.startsWith('-'))) return yes;
    return playwrightInstall(seg) ? (envInside(seg, ctx, 'PLAYWRIGHT_BROWSERS_PATH') === 'inside' ? false : envInside(seg, ctx, 'PLAYWRIGHT_BROWSERS_PATH') === 'dynamic' ? unk : yes) : false;
  }
  if (/^pip[0-9.]*$/.test(name) && a.includes('install')) return pipInside(seg, ctx, segs, idx) ? false : yes;
  if (/^(?:python[0-9.]*|py)$/.test(name)) { const mi = a.indexOf('-m'); if (mi >= 0 && a[mi + 1] === 'pip' && a.includes('install')) return pipInside(seg, ctx, segs, idx) ? false : yes; }
  if (name === 'uv' && a[0] === 'tool' && a[1] === 'install') return yes;
  if (name === 'uv' && a[0] === 'pip' && a[1] === 'install' && a.includes('--system')) return yes;
  if (name === 'pipx' && a[0] === 'install') return yes;
  if (PKG_SYSTEMS.has(name) || name === 'apk' || name === 'pacman' || name === 'zypper') {
    if (name === 'zypper') { const v = a.find(t => !t.startsWith('-')); return !!v && ['in', 'install', 'rm', 'remove', 'up', 'update', 'dup', 'patch'].includes(v) ? yes : false; }
    return pkgInstalls(name, a) ? yes : false;
  }
  if (name === 'cargo' && a[0] === 'install') return root(['--root']);
  if (name === 'go' && a[0] === 'install') { const r = envInside(seg, ctx, 'GOBIN'); return r === 'inside' ? false : r === 'dynamic' ? unk : yes; }
  if (name === 'gem' && a[0] === 'install') return root(['--install-dir', '-i']);
  if (name === 'bundle' && a[0] === 'install') { if (flagInside(seg, ctx, ['--path']) === 'inside' || envInside(seg, ctx, 'BUNDLE_PATH') === 'inside') return false; return flagInside(seg, ctx, ['--path']) === 'dynamic' || envInside(seg, ctx, 'BUNDLE_PATH') === 'dynamic' ? unk : yes; }
  if (name === 'dotnet' && a[0] === 'tool' && a[1] === 'install') return a.includes('-g') || a.includes('--global') ? yes : false;
  if (name === 'dotnet' && a[0] === 'workload' && a[1] === 'install') return yes;
  if (name === 'rustup' || name === 'msiexec') return yes;
  if (name === 'conda' || name === 'mamba' || name === 'micromamba') return ['install', 'create', 'update', 'remove'].includes(a[0]) || (a[0] === 'env' && ['create', 'update', 'remove'].includes(a[1])) ? yes : false;
  if (name === 'deno' && a[0] === 'install') return a.includes('-g') || a.includes('--global') || a.slice(1).some(t => !t.startsWith('-')) ? yes : false;
  if (['nvm', 'volta', 'fnm', 'asdf', 'sdk', 'pyenv', 'rbenv'].includes(name) && a[0] === 'install') return yes;
  if ((name === 'mise' || name === 'rtx') && (a[0] === 'install' || (a[0] === 'use' && (a.includes('-g') || a.includes('--global'))))) return yes;
  if (name === 'corepack' && a[0] === 'enable') return yes;
  if (PS_INSTALL.has(name)) return yes;
  return playwrightInstall(seg) ? (envInside(seg, ctx, 'PLAYWRIGHT_BROWSERS_PATH') === 'inside' ? false : envInside(seg, ctx, 'PLAYWRIGHT_BROWSERS_PATH') === 'dynamic' ? unk : yes) : false;
}

export const installRule: GuardRule = {
  id: 'install',
  check(input, ctx) {
    if (!ctx.autonomous) return null;
    const segs = bashSegments(input, ctx);
    if (!segs) return null;
    if (downloadAndRun(segs)) return deny('install', 'a downloaded script would run on this machine', INSTALL_INSTEAD);
    for (let i = 0; i < segs.length; i++) {
      const r = installs(segs[i], ctx, segs, i);
      if (r) return deny('install', r.unknown ? `unknown target: where ${commandName(segs[i].argv[0])} installs cannot be read` : `${commandName(segs[i].argv[0])} installs outside the worktree`, INSTALL_INSTEAD);
    }
    return null;
  },
};

// ---- git ------------------------------------------------------------------------------------------------------------

interface GitParse {
  sub: string; rest: Word[]; operands: Word[]; allOperands: Word[]; cflags: string[]; dir: string | null; dirKnown: boolean;
  gitDirValue: Word | null; gitDirSet: boolean; unknownGlobal: boolean;
}

/** git's global options (composing -C over the cwd, work tree, git dir and -c), its subcommand and operands. */
function gitParse(seg: Segment): GitParse {
  const argv = seg.argv;
  let i = 1, workTree: Word | null = null, gitDirValue: Word | null = null, gitDirSet = false, unknownGlobal = false;
  const cDirs: Word[] = [], cflags: string[] = [];
  while (i < argv.length && argv[i].text.startsWith('-')) {
    const w = argv[i], t = w.text, eq = t.indexOf('='), key = eq >= 0 ? t.slice(0, eq) : t;
    if (key === '-C') { cDirs.push(eq >= 0 ? valWord(w, eq + 1) : argv[i + 1] ?? { text: '', dynamic: true, glob: false }); i += eq >= 0 ? 1 : 2; continue; }
    if (key === '-c') { cflags.push(eq >= 0 ? t.slice(eq + 1) : argv[i + 1]?.text ?? ''); i += eq >= 0 ? 1 : 2; continue; }
    if (key === '--config-env') { const v = eq >= 0 ? t.slice(eq + 1) : argv[i + 1]?.text ?? ''; cflags.push(v.split('=')[0]); i += eq >= 0 ? 1 : 2; continue; }
    if (key === '--work-tree') { workTree = eq >= 0 ? valWord(w, eq + 1) : argv[i + 1] ?? null; i += eq >= 0 ? 1 : 2; continue; }
    if (key === '--git-dir') { gitDirSet = true; gitDirValue = eq >= 0 ? valWord(w, eq + 1) : argv[i + 1] ?? null; i += eq >= 0 ? 1 : 2; continue; }
    if (GIT_VALUED.includes(key)) { i += eq >= 0 ? 1 : 2; continue; }
    if (!GIT_GLOBAL_SWITCH.has(key)) unknownGlobal = true;
    i++;
  }
  for (const [k, v] of Object.entries(seg.env)) if (/^GIT_CONFIG_KEY_\d+$/.test(k) || k === 'GIT_CONFIG_PARAMETERS') cflags.push(v.text);
  const sub = argv[i]?.text.toLowerCase() ?? '';
  const rest = argv.slice(i + 1);
  // `--` is a pathspec separator only for the subcommands that restore files; elsewhere it only ends options.
  const sepAt = ['checkout', 'switch', 'restore', 'reset', 'stash'].includes(sub) ? rest.findIndex(w => w.text === '--') : -1;
  const before = sepAt >= 0 ? rest.slice(0, sepAt) : rest;
  const operands = before.filter(w => w.text !== '--' && !w.text.startsWith('-'));
  const allOperands = rest.filter(w => w.text !== '--' && !w.text.startsWith('-'));
  let base: string | null = seg.cwd;
  for (const c of cDirs) { if (base === null) break; base = c.dynamic || !c.text ? null : segmentPath(c, { ...seg, cwd: base }); }
  const wtW = workTree ?? seg.env.GIT_WORK_TREE ?? null;
  const dir = wtW ? segmentPath(wtW, { ...seg, cwd: base }) : (gitDirSet || seg.env.GIT_DIR) ? null : base;
  return { sub, rest, operands, allOperands, cflags, dir, dirKnown: dir !== null, gitDirValue: gitDirValue ?? seg.env.GIT_DIR ?? null, gitDirSet: gitDirSet || !!seg.env.GIT_DIR, unknownGlobal };
}

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

/** The branch a checkout/switch creates: the -b/-B/-c/-C/--create/--force-create value (glued or next) or the first operand. */
function createdBranch(rest: Word[], operands: Word[]): Word | null {
  for (let k = 0; k < rest.length; k++) {
    const t = rest[k].text;
    if (/^(--create|--force-create)$/.test(t)) return rest[k + 1] ?? null;
    const lg = /^--(?:create|force-create)=(.*)$/.exec(t);
    if (lg) return valWord(rest[k], t.length - lg[1].length);
    const g = /^-[A-Za-z]*[bBcC](.*)$/.exec(t);
    if (g && !t.startsWith('--')) return g[1] ? valWord(rest[k], t.length - g[1].length) : operands[0] ?? null;
  }
  return null;
}
const createsBranch = (rest: Word[]): boolean => rest.some(w => /^(--create|--force-create)(=|$)/.test(w.text) || (/^-[A-Za-z]*[bBcC]/.test(w.text) && !w.text.startsWith('--')));

function gitSeg(seg: Segment, ctx: GuardCtx): GuardVerdict | null {
  const auto = ctx.autonomous!;
  const g = gitParse(seg);
  const instead = `commit on ${auto.branch}; integrating into ${auto.protectedBranches.join('/')} is the person's call, and the run never pushes`;
  const D = (what: string) => deny('git', what, instead);
  const U = (what: string) => deny('git', `unknown target: ${what}`, instead);
  const { sub, rest, operands } = g;
  const isProtected = (t: string) => auto.protectedBranches.includes(destBranch(t));
  const isKnown = (t: string) => auto.branches.includes(destBranch(t));
  const refDyn = (ws: Word[]) => ws.some(w => w.dynamic);

  if (g.unknownGlobal) return U('a git global option the hook does not know hides the command');
  if (sub === 'push') return D('git push sends commits off this machine');
  for (const cf of g.cflags) { const k = cf.replace(/^'/, '').split('=')[0].toLowerCase(); if (k.startsWith('alias.') || k === 'core.sshcommand' || k === 'core.hookspath' || k === 'core.fsmonitor') return D(`git ${cf} changes how git runs`); }
  if (g.gitDirSet && GIT_DIR_CMDS.has(sub)) { if (!g.gitDirValue || g.gitDirValue.dynamic) return U('an explicit git dir the hook cannot read'); const p = segmentPath(g.gitDirValue, seg); if (p === null) return U('an explicit git dir the hook cannot read'); if (!insideRoots(p, ctx)) return D(`${p} is outside the run's roots`); }
  if (sub === 'checkout' || sub === 'switch') {
    if (createsBranch(rest)) { const c = createdBranch(rest, operands); if (c?.dynamic) return U('a branch name the hook cannot read'); if (c && isProtected(c.text)) return D(`creating ${auto.protectedBranches.join('/')} would move it`); }
    else { const sep = rest.some(w => w.text === '--'); if (!sep && operands.length <= 1) { if (refDyn(operands)) return U('a branch name the hook cannot read'); if (operands.some(w => isProtected(w.text))) return D(`checking out ${auto.protectedBranches.join('/')} would move off the run's branch`); } }
  }
  if (sub === 'worktree' && operands[0]?.text === 'add') {
    if (rest.some(w => w.text === '-f' || w.text === '--force')) return D('git worktree add --force overwrites a branch');
    const created = [...branchFlagValues(rest, ['-b', '-B']), ...operands.slice(1)];
    if (created.some(w => w.dynamic)) return U('a branch name the hook cannot read');
    if (created.some(w => isProtected(w.text))) return D('a worktree on a protected branch');
  }
  if (sub === 'rebase') {
    const root = rest.some(w => w.text === '--root');
    const pos: Word[] = [];
    for (let k = 0; k < rest.length; k++) { const t = rest[k].text; if (t === '--onto' || t === '-s' || t === '--strategy' || t === '-X' || t === '--strategy-option' || t === '-x' || t === '--exec' || t === '-C') { k++; continue; } if (!t.startsWith('-')) pos.push(rest[k]); }
    const branch = root ? pos[pos.length - 1] : pos.length >= 2 ? pos[pos.length - 1] : null;
    if (branch?.dynamic) return U('a branch name the hook cannot read');
    if (branch && isProtected(branch.text)) return D('rebasing a protected branch moves it');
  }
  if (sub === 'fetch' && operands.slice(1).some(w => w.text.includes(':') && isProtected(w.text))) return D('this fetch would write a protected branch');
  if (sub === 'update-ref') {
    if (rest.some(w => w.text === '--stdin')) return U('git update-ref --stdin writes refs the hook cannot see');
    if (refDyn(operands)) return U('a ref the hook cannot read');
    if (operands.some(w => isProtected(w.text))) return D('update-ref on a protected branch');
    if (rest.some(w => w.text === '-d') && operands.some(w => !isKnown(w.text) && !isProtected(w.text))) return D("update-ref -d of a branch that is not the run's");
  }
  if (sub === 'branch') {
    const move = rest.some(w => /^(?:-f|--force|-m|-M|-c|-C|--move|--copy)$/.test(w.text));
    if (move) { if (refDyn(operands)) return U('a branch name the hook cannot read'); if (operands.some(w => isProtected(w.text))) return D('moving a protected branch'); }
    if (rest.some(w => /^(?:-d|-D|--delete)$/.test(w.text)) && operands.some(w => !isKnown(w.text))) return D("deleting a branch that is not the run's");
  }
  if (sub === 'tag' && rest.some(w => /^(?:-d|--delete)$/.test(w.text) || (/^-[A-Za-z]*f/.test(w.text) && !w.text.startsWith('--')) || w.text === '--force')) return D('git tag -d/-f rewrites a tag');
  if (sub === 'filter-branch' || sub === 'filter-repo' || sub === 'replace') return D('a history rewrite');
  if (sub === 'stash' && operands[0]?.text !== 'list' && operands[0]?.text !== 'show') return D('git stash uses the stash the clone shares');
  if (sub === 'config' && configWrites(rest)) return D('git config writes settings the clone shares');
  if (sub === 'remote' && ['add', 'remove', 'rm', 'set-url', 'rename'].includes(operands[0]?.text ?? '')) return D('changing a remote');
  if (sub === 'gc') return D('git gc rewrites the object store');
  if (sub === 'reflog' && operands[0]?.text === 'expire') return D('reflog expire drops recovery state');
  if (sub === 'worktree' && operands[0]?.text === 'remove') { const p = operands[1] ? segmentPath(operands[1], seg) : null; if (p === null) return U('git worktree remove of a path the hook cannot see'); if (!insideRoots(p, ctx)) return D('git worktree remove outside the roots'); }
  if (sub === 'worktree' && operands[0]?.text === 'prune') { if (!g.dirKnown) return U('git worktree prune where the hook cannot see'); if (!insideRoots(g.dir!, ctx)) return D('git worktree prune outside the roots'); }
  // the subcommands that write the work tree or move a ref must run inside the roots
  if (GIT_DIR_CMDS.has(sub) && !(sub === 'stash' && (operands[0]?.text === 'list' || operands[0]?.text === 'show'))) {
    if (!g.dirKnown) return U(`git ${sub} runs where the hook cannot see`);
    if (!insideRoots(g.dir!, ctx)) return D(`git ${sub} runs outside the run's roots`);
  }
  return null;
}

/** The branch values of -b/-B for worktree add (space, glued or `=`). */
function branchFlagValues(rest: Word[], flags: readonly string[]): Word[] {
  const out: Word[] = [];
  for (let k = 0; k < rest.length; k++) { const t = rest[k].text; for (const f of flags) { if (t === f && rest[k + 1]) out.push(rest[k + 1]); else if (t.startsWith(f) && t.length > f.length && !t.startsWith('--')) out.push(valWord(rest[k], f.length)); } }
  return out;
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
