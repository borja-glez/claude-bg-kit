// Plan 6b-1, Task 4: the first four autonomy rules. In an autonomous run (ctx.autonomous not null) a PreToolUse hook
// (Task 7) runs these on every Bash, PowerShell, Edit, Write and NotebookEdit call; an attended session gets null from
// each. Fix 2 (T4-FAILCLOSED): the rules judge every word that could be a target and exempt only what they understand;
// an unknown option cancels exemptions; a writer in an outside or unknown cwd denies. The heavy write-target parsing is in
// autonomy-parse.ts (its option tables in autonomy-tables.ts); the readable command lists live here. They deny: switching
// the guard off (self), writes outside the run's roots or whose target is unknown (files), global installs (install), and
// dangerous git — refs, the work tree outside the roots, and the config, remotes and object store the clone shares (git).
import type { GuardCtx, GuardInput, GuardRule, GuardVerdict } from './guard.js';
import { CWD_FLAG, FILE_TOOLS, forgeCalls, shellCommand, targetPaths } from './guard.js';
import { commandName, GIT_VALUED, isNullSink, type Segment, type Word } from './shell-words.js';
import { bashSegments, deny, insideRoots, segmentPath } from './autonomy-shared.js';
import { copyEnds, isPsPipeItem, knownWriteCommand, newItemName, plainOperands, writeInfo } from './autonomy-parse.js';

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

// T4-UNKNOWN-CMD: commands that never write a file (judged as readers). Anything else not in a writer table is a fail-closed writer.
const READ_BASH = new Set(['cat', 'less', 'more', 'head', 'tail', 'ls', 'dir', 'tree', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'fd', 'wc', 'diff', 'cmp', 'comm', 'stat', 'file', 'du', 'df',
  'which', 'where', 'type', 'command', 'realpath', 'readlink', 'basename', 'dirname', 'jq', 'yq', 'sha1sum', 'sha256sum', 'sha512sum', 'md5sum', 'cksum', 'hexdump', 'xxd', 'od', 'strings',
  'echo', 'printf', 'test', '[', 'true', 'false', 'cd', 'pushd', 'popd', 'pwd', 'env', 'printenv', 'date', 'sleep', 'uname', 'whoami', 'id', 'hostname', 'ps', 'cut', 'uniq', 'tr', 'column',
  'nl', 'fold', 'paste', 'rev', 'tac', 'seq', 'man', 'help', 'findstr']);
// PowerShell verbs that only read; their cmdlets (and the read names below) never write.
const PS_READ_VERBS = new Set(['get', 'test', 'resolve', 'select', 'measure', 'format', 'compare', 'find', 'search', 'show', 'read', 'join', 'split', 'sort', 'group', 'where', 'foreach',
  'convertto', 'convertfrom', 'wait', 'enter', 'exit']);
// `Out-` only for the cmdlets that never write a file: Out-File and Out-Printer stay writers.
const PS_READ_NAMES = new Set(['write-host', 'write-output', 'write-verbose', 'write-warning', 'write-error', 'write-information', 'write-debug', 'write-progress', 'out-host', 'out-string',
  'out-null', 'out-default', 'out-gridview', 'ogv', 'start-sleep', 'push-location', 'pop-location', 'set-location', 'sl', 'cd', 'ls', 'dir', 'gci', 'gc', 'cat', 'gi', 'gp', 'gm', 'select',
  'where', 'foreach', 'sort', 'group', 'measure', 'ft', 'fl', 'echo', 'write', 'oss', 'gcm', 'gbp', 'gl']);

/** Whether a segment's command only reads (so it is not a fail-closed writer). */
function isReadCommand(seg: Segment): boolean {
  const name = commandName(seg.argv[0]);
  if (seg.dialect === 'powershell') return PS_READ_NAMES.has(name) || PS_READ_VERBS.has(name.split('-')[0]);
  return READ_BASH.has(name);
}

// git global switches (valued ones are shared GIT_VALUED); a global option in neither means the subcommand cannot be read → deny.
const GIT_GLOBAL_SWITCH = new Set(['--no-pager', '-p', '-P', '--paginate', '--bare', '--literal-pathspecs', '--no-literal-pathspecs', '--glob-pathspecs', '--noglob-pathspecs',
  '--icase-pathspecs', '--no-replace-objects', '--no-optional-locks', '--no-advice', '--html-path', '--man-path', '--info-path', '--version', '-v', '--help', '-h', '--no-lazy-fetch', '--no-commit-graph']);
// git subcommands that only read (GD1): every other subcommand is judged by its directory.
const GIT_READ = new Set(['status', 'log', 'diff', 'show', 'rev-parse', 'ls-files', 'ls-tree', 'cat-file', 'blame', 'grep', 'describe', 'shortlog', 'help', 'version', 'var', 'for-each-ref',
  'show-ref', 'name-rev', 'count-objects', 'rev-list', 'merge-base', 'check-ignore', 'check-attr', 'cherry', 'range-diff', 'annotate', 'verify-commit', 'verify-tag', 'whatchanged', 'ls-remote', 'cherry-pick-dry']);
// git subcommands the self rule treats as writing the work tree (a settings pathspec there switches the hook off).
const GIT_WRITE_TREE = new Set(['checkout', 'restore', 'reset', 'stash', 'apply', 'am', 'merge', 'pull', 'cherry-pick', 'revert', 'mv', 'rm', 'read-tree', 'checkout-index', 'switch']);

const SELF_INSTEAD = 'the guard stays on for this whole conversation, also after the run stops (`FORGE stop` ends the run, never the guard); record what you needed as not done, and the person does it in a new conversation';
const INSTALL_INSTEAD = 'install inside the worktree: node_modules, a .venv, or a tools folder of the worktree with PLAYWRIGHT_BROWSERS_PATH and the like';

const valWord = (w: Word, from: number): Word => ({ text: w.text.slice(from), dynamic: w.dynamic, glob: false });
const hasSep = (t: string): boolean => t.includes('/') || t.includes('\\');
// A URL's scheme is two or more letters (FC1): a one-letter scheme is a drive, so `E://repo/x` is a path, not a URL.
const URL_RE = /^[a-z][a-z0-9+.-]+:\/\//i;

/**
 * A relative word that cannot leave its directory: no root, home, drive, UNC or provider-drive prefix and no segment equal to
 * `..` (Go's `./...` is no `..`). Under an in-root cwd such a word is inside by construction (T4-FAILCLOSED 1).
 */
function relativeInside(text: string): boolean {
  if (!text || /^[\\/~]/.test(text) || /^[A-Za-z]+:/.test(text)) return false;
  return !text.split(/[\\/]/).some(s => s === '..');
}

/** Judge one candidate target word: inside the roots (ok), outside, or a target the hook cannot know (unknown). A URL or a null sink is no path. */
function judge(w: Word, seg: Segment, ctx: GuardCtx): 'ok' | 'outside' | 'unknown' {
  if (w.dynamic) return 'unknown';
  if (URL_RE.test(w.text) || isNullSink(w.text, seg.dialect)) return 'ok';
  if (seg.cwd !== null && relativeInside(w.text) && insideRoots(seg.cwd, ctx)) return 'ok';
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
    const judgeAll = (ws: Word[], seg: Segment): GuardVerdict | null => {
      for (const w of ws) { const r = judge(w, seg, ctx); if (r === 'outside') return outside(segmentPath(w, seg) ?? w.text); if (r === 'unknown') return unknown(w.text || 'a path the shell hides'); }
      return null;
    };
    const cwdDeny = (seg: Segment): GuardVerdict | null => seg.cwd === null ? unknown('a command whose working directory the hook cannot see') : !insideRoots(seg.cwd, ctx) ? outside(seg.cwd) : null;
    if (FILE_TOOLS.includes(input.tool_name)) {
      for (const p of targetPaths(input, ctx)) if (!insideRoots(p, ctx)) return outside(p);
      return null;
    }
    const segs = bashSegments(input, ctx);
    if (!segs) return null;
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      const redirs = seg.redirects.filter(r => r.op === '>' || r.op === '>>').map(r => r.target);
      // T4-DYNAMIC-CMD: a command whose name only the shell knows judges every non-flag argument (and a flag's glued = value) and its redirections.
      if (seg.argv.length && seg.argv[0].dynamic) {
        const cands: Word[] = [];
        for (const w of seg.argv.slice(1)) { if (w.text.startsWith('-')) { const eq = w.text.indexOf('='); if (eq >= 0) cands.push(valWord(w, eq + 1)); } else cands.push(w); }
        const v = judgeAll([...cands, ...redirs], seg); if (v) return v;
        if (seg.dynamicArgs) return unknown('a command the shell hides runs on files the hook cannot see');
        continue;
      }
      const name = commandName(seg.argv[0] ?? { text: '', dynamic: false, glob: false });
      if (name === 'git') continue; // git is the git rule's domain
      const info = writeInfo(seg);
      if (info.writer) {
        const cv = cwdDeny(seg); if (cv) return cv;
        // T4-PIPE-FED: a PowerShell item cmdlet fed by a pipe acts on the upstream pipeline's paths.
        if (seg.after === '|' && i > 0 && isPsPipeItem(seg)) {
          const up = segs[i - 1];
          if (up.argv.length && up.argv[0].dynamic) return unknown('a piped command the shell hides');
          const v = judgeAll(plainOperands(up), up); if (v) return v;
        }
        if (seg.dynamicArgs) return unknown(`${name} runs on files the hook cannot see`);
        const v = judgeAll([...info.targets, ...redirs], seg); if (v) return v;
      } else if (redirs.length) {
        const v = cwdDeny(seg) ?? judgeAll(redirs, seg); if (v) return v;
      } else if (!isReadCommand(seg) && !knownWriteCommand(seg) && name !== 'cmd') {
        // T4-UNKNOWN-CMD: a command in no table and not a reader is a fail-closed writer; an interpreter's script (first operand) is read, not written. `cmd` is a wrapper (its nested command is a separate segment).
        let cands = plainOperands(seg);
        if (isInterpreter(name)) cands = cands.slice(1);
        const v = cwdDeny(seg) ?? judgeAll(cands, seg); if (v) return v;
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

/** Whether a path names the project's `.claude` directory, or anything under it (FC6). */
function isClaudeDest(text: string): boolean {
  const s = text.replace(/\\/g, '/').replace(/\/+$/, '');
  return s === '.claude' || s.endsWith('/.claude') || s.startsWith('.claude/') || s.includes('/.claude/');
}

/** Whether a write-class segment would create or overwrite the project settings, or write into the `.claude` directory. */
function writesSettings(seg: Segment): boolean {
  for (const t of writeInfo(seg).targets) { const txt = t.text.replace(/\\/g, '/'); if (isClaudeDest(txt)) return true; if (endsWithSettings(segmentPath(t, seg) ?? txt)) return true; }
  const ce = copyEnds(seg);
  if (ce) {
    if (isClaudeDest(ce.dest.text)) return true;
    const destIsDir = /[\\/]$/.test(ce.dest.text) || ce.dest.text === '.' || isClaudeDest(ce.dest.text);
    if (destIsDir && ce.sources.some(s => /(?:^|[\\/])\.claude$/.test(s.text.replace(/\\/g, '/').replace(/\/+$/, '')) || SETTINGS_RE.test(s.text.replace(/\\/g, '/')))) return true;
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
      for (const r of seg.redirects) if (r.op === '>' || r.op === '>>') { const txt = segmentPath(r.target, seg) ?? r.target.text.replace(/\\/g, '/'); if (endsWithSettings(txt) || isClaudeDest(r.target.text)) return deny('self', 'writing the project settings would switch the hook off', SELF_INSTEAD); }
      if (!seg.argv.length || seg.argv[0].dynamic) continue;
      const name = commandName(seg.argv[0]);
      if (name === 'git') {
        const g = gitParse(seg);
        if (GIT_WRITE_TREE.has(g.sub) && g.allOperands.some(w => endsWithSettings(w.text.replace(/\\/g, '/')) || isClaudeDest(w.text))) return deny('self', 'restoring the project settings would switch the hook off', SELF_INSTEAD);
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

// DL1: the valued options of each interpreter family (their value is not the program); an unknown option of node/python reads stdin.
const SHELL_VALUED = new Set(['-o', '+o', '-O', '+O', '--rcfile', '--init-file']);
const NODE_VALUED = new Set(['-r', '--require', '--import', '--loader', '--experimental-loader', '--input-type', '--conditions', '-C', '--max-old-space-size']);
const PY_VALUED = new Set(['-W', '-X', '--check-hash-based-pycs']);
const RB_VALUED = new Set(['-r', '-I', '-C', '-e', '-E', '-K']);

/** The word an interpreter reads its program from (the -c/-e string or the script operand), or null when it reads stdin. */
function programSlot(seg: Segment): Word | null {
  const name = commandName(seg.argv[0]), args = seg.argv.slice(1), shell = isShell(name);
  if (name === 'iex' || name === 'invoke-expression') return args.find(w => !w.text.startsWith('-')) ?? null;
  const word = (t: string): Word => ({ text: t, dynamic: false, glob: false });
  const valued = shell ? SHELL_VALUED : /^node/.test(name) ? NODE_VALUED : /^(?:ruby|perl)/.test(name) ? RB_VALUED : PY_VALUED;
  let dashS = false;
  for (let k = 0; k < args.length; k++) {
    const t = args[k].text;
    if (t === '-') return null; // explicit stdin; the words after it are the script's own arguments
    if (shell && (t === '-c' || t === '--command')) return args[k + 1] ?? word('');
    if (!shell && /^(?:-e|-E|--eval|-c|-m|-p)$/.test(t)) return args[k + 1] ?? word('');
    if (shell && t === '-s') { dashS = true; continue; }
    if (valued.has(t)) { k++; continue; } // skip the value of a known valued option
    if (!t.startsWith('-')) { if (shell && dashS) continue; return args[k]; } // a script operand
    if (!shell) return null; // node/python: an option outside the table reads stdin
    // a shell switch (-e, -x, -l, …): keep scanning
  }
  return null;
}
const readsStdin = (seg: Segment): boolean => programSlot(seg) === null;
const baseName = (t: string): string => t.slice(Math.max(t.lastIndexOf('/'), t.lastIndexOf('\\')) + 1);

/** Download-and-run (H7, T4-DLRUN): a downloader piped into a stdin-interpreter, an interpreter whose program slot is a dynamic/nested download, or a downloaded file run later (T4-DL-FILE). */
function downloadAndRun(segs: Segment[]): boolean {
  const downloaderOnLine = segs.some(s => s.argv.some(w => DOWNLOAD_RE.test(w.text)));
  if (downloaderOnLine) for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (!s.argv.length || !isInterpreter(commandName(s.argv[0]))) continue;
    if (readsStdin(s) && s.after === '|') { for (let j = i - 1; j >= 0; j--) { if (isDownloader(segs[j])) return true; if (segs[j].after !== '|') break; } }
    const prog = programSlot(s);
    if (prog && prog.dynamic) return true; // a nested or variable download fed to the interpreter
  }
  // T4-DL-FILE: a downloaded output file executed later on the same line.
  const names = new Set<string>();
  for (const s of segs) if (isDownloader(s)) for (const t of writeInfo(s).targets) { const b = baseName(t.text).toLowerCase(); if (b && b !== '.') names.add(b); }
  if (names.size) for (const s of segs) {
    if (!s.argv.length) continue;
    const n = commandName(s.argv[0]);
    if (names.has(baseName(s.argv[0].text).toLowerCase())) return true; // ./downloaded
    if ((n === 'source' || n === '.' || isInterpreter(n)) && s.argv.slice(1).some(w => names.has(baseName(w.text).toLowerCase()))) return true;
  }
  return false;
}

/** Whether a system package manager's command is an install/change (not a read): skip its global options, then look at the verb. */
function pkgInstalls(name: string, a: string[]): boolean {
  // FC9: pacman reads only with -Q…/-Ss/-Si/-Sl/-Sg/-F…/--query/--files/-h/--help/-V/--version; anything else installs.
  if (name === 'pacman') { const read = a.some(t => /^-Q/.test(t) || /^-S[silg]/.test(t) || /^-F/.test(t) || ['--query', '--files', '-h', '--help', '-V', '--version'].includes(t)); return !read; }
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
  if (name === 'deno' && a[0] === 'install') return a.includes('-g') || a.includes('--global') ? yes : false; // FC11: deno 2 install <pkg> is local
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

// git config's option forms: the read ones, the write ones, and the valued options whose value is not a key.
const CONFIG_READ = ['--get', '--get-all', '--get-regexp', '--get-urlmatch', '--list', '-l', '--show-origin', '--show-scope', '--show-names'];
const CONFIG_WRITE = ['--add', '--replace-all', '--unset', '--unset-all', '--rename-section', '--remove-section', '-e', '--edit'];
const CONFIG_VALUED = ['-f', '--file', '--blob', '--type', '--default', '--comment'];

/** T4-GIT-SHARED: a git config form that writes — anything but --get*, --list/-l, --show-*, the get/list subcommands or a single-key read. */
function configWrites(rest: Word[]): boolean {
  const a = rest.map(w => w.text);
  if (a.some(t => CONFIG_WRITE.includes(t))) return true;
  if (a.some(t => CONFIG_READ.includes(t) || CONFIG_READ.some(r => t.startsWith(r + '=')))) return false;
  const operands: Word[] = [];
  for (let k = 0; k < rest.length; k++) { const t = rest[k].text; if (CONFIG_VALUED.includes(t)) { k++; continue; } if (!t.startsWith('-')) operands.push(rest[k]); }
  const first = operands[0]?.text;
  if (first && ['get', 'list', 'get-all', 'get-regexp', 'get-urlmatch'].includes(first)) return false;
  if (first && ['set', 'unset', 'rename-section', 'remove-section', 'edit'].includes(first)) return true;
  return operands.length !== 1 || operands[0].dynamic; // one literal key is a read; a key and a value is a write
}
// T4-GIT-SHARED: the subcommands and forms that change state the person's checkout shares (config, remotes, worktree admin, the object store, the reflog).
const REMOTE_WRITE = new Set(['add', 'remove', 'rm', 'rename', 'set-url', 'set-head', 'set-branches', 'prune', 'update']);
const WORKTREE_ADMIN = new Set(['prune', 'lock', 'unlock', 'move', 'repair']);
const STORE_WRITE = new Set(['gc', 'prune', 'repack', 'maintenance', 'replace', 'filter-branch', 'filter-repo']);

/** The branch a checkout/switch creates and whether it is a forced create (-B / switch -C / --force-create) (T4-OWN-BRANCHES). */
function createdBranchFlag(rest: Word[], operands: Word[]): { word: Word | null; force: boolean } | null {
  for (let k = 0; k < rest.length; k++) {
    const t = rest[k].text;
    if (t === '--create' || t === '--force-create') return { word: rest[k + 1] ?? null, force: t === '--force-create' };
    const lg = /^--(create|force-create)=(.*)$/.exec(t);
    if (lg) return { word: valWord(rest[k], t.length - lg[2].length), force: lg[1] === 'force-create' };
    const g = /^-([A-Za-z]*)([bBcC])(.*)$/.exec(t);
    if (g && !t.startsWith('--')) return { word: g[3] ? valWord(rest[k], t.length - g[3].length) : operands[0] ?? null, force: g[2] === 'B' || g[2] === 'C' };
  }
  return null;
}

/** Whether a non-read git subcommand must be judged by its directory (GD1): the pure readers and the read forms of the dual subcommands are not. */
function gitDirRestricted(sub: string, operands: Word[], rest: Word[]): boolean {
  if (GIT_READ.has(sub)) return false;
  if (sub === 'worktree') return operands[0]?.text !== 'list';
  if (sub === 'stash') return !(operands[0] && (operands[0].text === 'list' || operands[0].text === 'show'));
  if (sub === 'remote') return !(operands.length === 0 || operands[0]?.text === 'show' || operands[0]?.text === 'get-url');
  if (sub === 'config') return configWrites(rest);
  if (sub === 'reflog') return !(operands.length === 0 || operands[0].text === 'show' || operands[0].text === 'exists'); // expire / delete deny earlier (T4-GIT-SHARED)
  // refs are shared by every worktree: the protected and own-branch checks judge these, not the directory
  if (sub === 'branch' || sub === 'tag' || sub === 'symbolic-ref' || sub === 'notes' || sub === 'fetch' || sub === 'update-ref') return false;
  return true;
}

function gitSeg(seg: Segment, ctx: GuardCtx): GuardVerdict | null {
  const auto = ctx.autonomous!;
  if (Object.keys(seg.env).some(k => k === 'GIT_CONFIG_PARAMETERS' || k === 'GIT_CONFIG_COUNT' || /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(k)))
    return deny('git', 'git config set through the environment changes how git runs', `commit on ${auto.branch}; the run never changes git's config`);
  const g = gitParse(seg);
  const instead = `commit on ${auto.branch}; integrating into ${auto.protectedBranches.join('/')} is the person's call, and the run never pushes`;
  const D = (what: string) => deny('git', what, instead);
  const U = (what: string) => deny('git', `unknown target: ${what}`, instead);
  const { sub, rest, operands } = g;
  const prot = auto.protectedBranches.join('/');
  const isProtected = (t: string) => auto.protectedBranches.includes(destBranch(t));
  // T4-OWN-BRANCHES-AMEND: the run's own branches are ctx.branches (run, execution and task/<T> branches) plus names under `<branch>/` or `<branch>-`.
  const ownsBranch = (t: string) => { const b = destBranch(t); return b === auto.branch || auto.branches.includes(b) || b.startsWith(auto.branch + '/') || b.startsWith(auto.branch + '-'); };
  const refDyn = (ws: Word[]) => ws.some(w => w.dynamic);
  /** A protected target (deny), a dynamic one (unknown), or one that is not the run's (deny): used by every destructive branch/ref op (T4-OWN-BRANCHES). */
  const ownCheck = (ws: Word[], verb: string): GuardVerdict | null => {
    if (refDyn(ws)) return U('a branch name the hook cannot read');
    for (const w of ws) if (isProtected(w.text)) return D(`${verb} a protected branch`);
    for (const w of ws) if (!ownsBranch(w.text)) return D(`${w.text} is not the run's branch`);
    return null;
  };

  if (g.unknownGlobal) return U('a git global option the hook does not know hides the command');
  if (sub === 'push') return D('git push sends commits off this machine');
  for (const cf of g.cflags) { const k = cf.replace(/^'/, '').split('=')[0].toLowerCase(); if (k.startsWith('alias.') || k === 'core.sshcommand' || k === 'core.hookspath' || k === 'core.fsmonitor') return D(`git -c ${cf} changes how git runs`); }
  if (sub === 'checkout' || sub === 'switch') {
    const cb = createdBranchFlag(rest, operands);
    if (cb) { if (cb.word?.dynamic) return U('a branch name the hook cannot read'); if (cb.word && isProtected(cb.word.text)) return D(`creating ${prot} would move it`); if (cb.force && cb.word && !ownsBranch(cb.word.text)) return D(`${cb.word.text} is not the run's branch`); }
    else { const sep = rest.some(w => w.text === '--'); if (!sep && operands.length <= 1) { if (refDyn(operands)) return U('a branch name the hook cannot read'); if (operands.some(w => isProtected(w.text))) return D(`checking out ${prot} would move off the run's branch`); } }
  }
  if (sub === 'worktree' && operands[0]?.text === 'add') {
    if (rest.some(w => w.text === '-f' || w.text === '--force')) return D('git worktree add --force overwrites a branch');
    const created = [...branchFlagValues(rest, ['-b', '-B']), ...operands.slice(1).filter(w => !w.text.includes('/') && !w.text.includes('\\') || isProtected(w.text))];
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
  if ((sub === 'fetch' || sub === 'pull') && operands.some(w => w.text.includes(':') && isProtected(w.text))) return D('this fetch would write a protected branch');
  if (sub === 'update-ref') {
    if (rest.some(w => w.text === '--stdin')) return U('git update-ref --stdin writes refs the hook cannot see');
    const v = ownCheck(operands.slice(0, 1), 'update-ref on'); if (v) return v;
  }
  if (sub === 'symbolic-ref' && operands.length >= 2) { const v = ownCheck([operands[1]], 'pointing a ref at'); if (v) return v; }
  if (sub === 'branch') {
    const short = (re: RegExp) => rest.some(w => re.test(w.text) && !w.text.startsWith('--'));
    const del = rest.some(w => w.text === '--delete') || short(/^-[A-Za-z]*[dD]/);
    const move = rest.some(w => w.text === '--move' || w.text === '--copy') || short(/^-[A-Za-z]*[mMcC]/);
    const force = rest.some(w => w.text === '--force') || short(/^-[A-Za-z]*[fMCD]/);
    if (del) { const v = ownCheck(operands, 'deleting'); if (v) return v; }
    else if (move) {
      // `branch -m [old] new`: the source is renamed (own it), the destination is a new name unless forced (then it may be overwritten: own it too); never a protected one
      if (refDyn(operands)) return U('a branch name the hook cannot read');
      if (operands.some(w => isProtected(w.text))) return D('moving a protected branch');
      const v = ownCheck(force ? operands : operands.slice(0, -1), 'moving'); if (v) return v;
    } else if (force) { const v = ownCheck(operands.slice(0, 1), 'moving'); if (v) return v; } // `branch -f name [start]`: the start point is a read
  }
  if (sub === 'tag' && rest.some(w => w.text === '--delete' || w.text === '--force' || (/^-[A-Za-z]*[df]/.test(w.text) && !w.text.startsWith('--')))) return D('git tag -d/-f rewrites a tag');
  if (sub === 'stash' && operands[0] && operands[0].text !== 'list' && operands[0].text !== 'show' && ['drop', 'clear', 'pop', 'apply', 'push', 'store', 'create', 'branch'].includes(operands[0].text)) return D('git stash uses the stash the clone shares');
  if (sub === 'stash' && !operands[0]) return D('git stash uses the stash the clone shares');
  // T4-GIT-SHARED: the config and the object store are shared with the person's checkout; these change how git behaves for them or drop objects they could still recover.
  const shared = `commit on ${auto.branch}; the config, remotes and object store are shared with the person's checkout, so record what you needed as not done`;
  const S = (what: string) => deny('git', what, shared);
  if (sub === 'config' && configWrites(rest)) return S('git config writes settings the clone shares');
  if (sub === 'remote' && REMOTE_WRITE.has(operands[0]?.text ?? '')) return S(`git remote ${operands[0].text} changes the remotes the clone shares`);
  if (sub === 'worktree' && WORKTREE_ADMIN.has(operands[0]?.text ?? '')) return S(`git worktree ${operands[0].text} changes the worktree list the clone shares`);
  if (sub === 'reflog' && (operands[0]?.text === 'expire' || operands[0]?.text === 'delete')) return S(`reflog ${operands[0].text} drops recovery state`);
  if (sub === 'filter-branch' || sub === 'filter-repo' || sub === 'replace') return S('a history rewrite');
  if (STORE_WRITE.has(sub)) return S(`git ${sub} rewrites the object store`);
  if (sub === 'worktree' && operands[0]?.text === 'remove') { const p = operands[1] ? segmentPath(operands[1], seg) : null; if (p === null) return U('git worktree remove of a path the hook cannot see'); if (!insideRoots(p, ctx)) return S('git worktree remove outside the roots'); }
  // GD1/GD2: a non-read subcommand runs inside the roots, its explicit git dir inside, and its path operands inside.
  if (gitDirRestricted(sub, operands, rest)) {
    if (g.gitDirSet) { if (!g.gitDirValue || g.gitDirValue.dynamic) return U('an explicit git dir the hook cannot read'); const p = segmentPath(g.gitDirValue, seg); if (p === null) return U('an explicit git dir the hook cannot read'); if (!insideRoots(p, ctx)) return D(`${p} is outside the run's roots`); }
    if (!g.dirKnown) return U(`git ${sub} runs where the hook cannot see`);
    if (!insideRoots(g.dir!, ctx)) return D(`git ${sub} runs outside the run's roots`);
    for (let k = 0; k < operands.length; k++) { if (sub === 'clone' && k === 0) continue; const r = judge(operands[k], seg, ctx); if (r === 'outside') return D(`${segmentPath(operands[k], seg) ?? operands[k].text} is outside the run's roots`); if (r === 'unknown') return U(operands[k].text || 'a path the hook cannot see'); }
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
