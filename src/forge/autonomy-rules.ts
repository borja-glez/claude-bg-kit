// Plan 6b-1, Task 4: the first four autonomy rules. In an autonomous run (ctx.autonomous not null) a PreToolUse hook
// (Task 7) runs these on every Bash, PowerShell, Edit, Write and NotebookEdit call; an attended session gets null from
// each. They deny, before it happens: switching the guard off (self), writes and deletes outside the run's roots or whose
// target is unknown (files), global installs (install), and git that pushes, moves a protected branch or touches state the
// clone shares (git). The lists below are the readable reference the spec asks for; names compare through commandName.
import path from 'node:path';
import type { GuardCtx, GuardInput, GuardRule, GuardVerdict } from './guard.js';
import { CWD_FLAG, FILE_TOOLS, forgeCalls, shellCommand, targetPaths } from './guard.js';
import { commandName, GIT_VALUED, type Dialect, type Segment, type Word } from './shell-words.js';
import { bashSegments, deny, insideRoots, psParams, segmentPath } from './autonomy-shared.js';

// ---- lists ----------------------------------------------------------------------------------------------------------

// FILE_WRITERS (H4): commands that create, delete, overwrite, move or link a file. fsutil hardlink, sed -i and find -delete write only in a form writeTargets reads.
export const FILE_WRITERS: readonly string[] = [
  'rm', 'rmdir', 'unlink', 'shred', 'truncate', 'del', 'erase', 'rd', 'remove-item', 'ri', 'clear-content', 'clc', 'mv', 'move', 'move-item', 'mi', 'ren', 'rename-item', 'rni',
  'cp', 'copy', 'xcopy', 'robocopy', 'copy-item', 'cpi', 'ln', 'mklink', 'tee', 'tee-object', 'set-content', 'sc', 'add-content', 'ac', 'out-file', 'set-item', 'si', 'new-item', 'ni',
  'export-csv', 'epcsv', 'export-clixml', 'chmod', 'chown', 'icacls', 'attrib', 'dd', 'install', 'patch', 'rsync', 'tar', 'unzip', '7z', 'expand-archive', 'start-bitstransfer',
  'sort', 'fsutil', 'sed', 'gsed', 'perl', 'ruby', 'find', 'touch', 'mkdir',
];
const FILE_WRITER_SET = new Set(FILE_WRITERS);
// Copy and move-like writers whose only target is the destination (the last operand, the second for robocopy, or the -t directory).
const COPY_LIKE = new Set(['cp', 'copy', 'xcopy', 'robocopy', 'rsync', 'install']);
// Writers each of whose non-switch operands is a target.
const POSITIONAL = new Set(['rm', 'rmdir', 'unlink', 'shred', 'truncate', 'del', 'erase', 'rd', 'mv', 'move', 'ren', 'chmod', 'chown', 'attrib', 'touch', 'mkdir', 'tee']);
// Archive, download and copy-to-disk writers whose target an option (OUTPUT_FLAGS) or their cwd names, never a source operand.
const ARCHIVE = new Set(['curl', 'wget', 'tar', 'unzip', '7z', 'dd', 'sort', 'patch']);
// In-place editors: a writer only with -i; their script arguments (-e, -f, a bare script) are not targets (M13).
const SCRIPT_INPLACE = new Set(['sed', 'gsed', 'perl', 'ruby']);
// A `/switch` is never a target in the cmd dialect, nor (a single-segment one) after these cmd builtins in any dialect (M13); `/c/x` in Bash is a path.
const SLASH_SWITCH = new Set(['del', 'erase', 'rd', 'copy', 'xcopy', 'robocopy', 'move', 'attrib']);

// OUTPUT_FLAGS (H4): the readable reference of the option that names where each non-positional writer writes.
export const OUTPUT_FLAGS: Record<string, readonly string[]> = {
  curl: ['-o', '--output', '-O', '--remote-name'], wget: ['-O', '--output-document', '-P', '--directory-prefix'],
  tar: ['-C', '--directory'], unzip: ['-d'], '7z': ['-o'], dd: ['of='], sort: ['-o', '--output'], patch: ['-d', '-o'],
  'new-item': ['-Path', '-Target', '-Value'], 'expand-archive': ['-DestinationPath'], 'start-bitstransfer': ['-Destination'],
  'invoke-webrequest': ['-OutFile'], 'copy-item': ['-Destination'], cp: ['-t', '--target-directory'], mv: ['-t', '--target-directory'], install: ['-t', '--target-directory'],
};

// The PowerShell writer cmdlets and which parameters (plus positionals) name a target; read by name so no other parameter's value is judged.
const PS_WRITERS: Record<string, { params: readonly string[]; pos: 'first' | 'second' | 'all' | 'none' }> = {};
const regPs = (names: string[], params: string[], pos: 'first' | 'second' | 'all' | 'none') => { for (const n of names) PS_WRITERS[n] = { params, pos }; };
regPs(['remove-item', 'ri', 'rd', 'del', 'erase'], ['path', 'literalpath'], 'all');
regPs(['clear-content', 'clc', 'set-content', 'sc', 'add-content', 'ac', 'set-item', 'si', 'export-csv', 'epcsv', 'export-clixml', 'rename-item', 'rni', 'ren'], ['path', 'literalpath'], 'first');
regPs(['out-file', 'tee-object'], ['filepath', 'literalpath'], 'first');
regPs(['new-item', 'ni'], ['path', 'target', 'value'], 'first');
regPs(['move-item', 'mi'], ['path', 'literalpath', 'destination'], 'all');
regPs(['copy-item', 'cpi'], ['destination'], 'second');
regPs(['start-bitstransfer', 'expand-archive'], ['destination', 'destinationpath'], 'second');
regPs(['invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm'], ['outfile'], 'none');

export const SETTINGS_FILES: readonly string[] = ['.claude/settings.json', '.claude/settings.local.json'];
const SETTINGS_RE = /(?:^|[\\/])settings(?:\.local)?\.json$/i;

// CLAUDE_SWITCHES (H5): the claude subcommands and flags that would switch the guard off.
export const CLAUDE_SWITCHES = {
  subs: { plugin: ['disable', 'uninstall', 'install', 'update', 'marketplace'], config: ['set', 'add', 'remove'], mcp: ['add', 'add-json', 'remove'] } as Record<string, string[]>,
  flags: ['--settings', '--setting-sources', '--dangerously-skip-permissions'],
};

// Package systems whose write subcommands are a global install (sudo is always one; apk, pacman and zypper use their own verbs).
const PKG_SYSTEMS = new Set(['brew', 'choco', 'winget', 'scoop', 'apt', 'apt-get', 'dnf', 'yum', 'snap', 'port']);
const PKG_VERBS = new Set(['install', 'upgrade', 'uninstall', 'remove', 'update', 'reinstall', 'tap', 'link', 'unlink', 'cleanup', 'autoremove', 'purge']);
const PS_INSTALL = new Set(['install-module', 'install-package', 'install-psresource', 'install-script', 'update-module', 'uninstall-module']);
// Download-and-run (H7): a downloader piped into, or feeding a dynamic word to, an interpreter.
const DOWNLOADERS = new Set(['curl', 'wget', 'iwr', 'irm', 'invoke-webrequest', 'invoke-restmethod']);
const DOWNLOAD_RE = /\b(?:curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod|downloadstring)\b/i;
const INTERPRETERS = new Set(['sh', 'bash', 'zsh', 'dash', 'fish', 'pwsh', 'powershell', 'iex', 'invoke-expression', 'python', 'node', 'ruby', 'perl']);
const isInterpreter = (name: string): boolean => INTERPRETERS.has(name) || /^python[0-9.]*$/.test(name) || /^node[0-9.]*$/.test(name);

const GIT_DIR_CMDS = new Set(['merge', 'rebase', 'reset', 'cherry-pick', 'revert', 'commit', 'pull', 'am', 'clean', 'restore', 'rm', 'mv']);
const REBASE_VALUED = new Set(['--onto', '-s', '--strategy', '-X', '--strategy-option', '-x', '--exec', '-C', '--whitespace', '-S', '--gpg-sign']);
const RSYNC_VALUED = new Set(['--exclude', '--include', '--exclude-from', '--include-from', '--files-from', '--filter', '-f', '-e', '--rsh', '--chmod', '--chown', '--log-file',
  '--out-format', '--compare-dest', '--copy-dest', '--link-dest', '--backup-dir', '--suffix', '--temp-dir', '-T', '--partial-dir', '--bwlimit', '--timeout', '--port', '--max-size', '--min-size', '--block-size', '-B']);

const SELF_INSTEAD = 'the guard stays on for this whole conversation, also after the run stops (`FORGE stop` ends the run, never the guard); record what you needed as not done, and the person does it in a new conversation';
const INSTALL_INSTEAD = 'install inside the worktree: node_modules, a .venv, or a tools folder of the worktree with PLAYWRIGHT_BROWSERS_PATH and the like';

// ---- write targets --------------------------------------------------------------------------------------------------

const valWord = (w: Word, from: number): Word => ({ text: w.text.slice(from), dynamic: w.dynamic, glob: false });
const cwdWord = (): Word => ({ text: '.', dynamic: false, glob: false });

/** A switch, not a path: a `-flag`, or a single-segment `/switch` in cmd or after a cmd builtin — in Bash `/c/x` keeps its path (M13, plan-mandated). */
function isSwitch(w: Word, name: string, dialect: Dialect): boolean {
  const t = w.text;
  if (t.startsWith('-')) return true;
  if (!t.startsWith('/')) return false;
  if (dialect === 'cmd') return t.length > 1;
  return SLASH_SWITCH.has(name) && !t.slice(1).includes('/');
}

/** The values of any of `flags`: space form, `=` glued, glued after a short `-x`, or a short flag at the end of a bundle (`-fsSLo f`); PowerShell flags match without case. */
function flagValues(args: Word[], flags: readonly string[], dialect: Dialect): Word[] {
  const out: Word[] = [];
  for (let k = 0; k < args.length; k++) {
    const t = args[k].text;
    for (const f of flags) {
      const short = f.length === 2 && f.startsWith('-') && f[1] !== '-';
      if (t === f || (dialect !== 'bash' && t.toLowerCase() === f.toLowerCase())) { if (args[k + 1]) out.push(args[k + 1]); break; }
      if (t.startsWith(f + '=')) { out.push(valWord(args[k], f.length + 1)); break; }
      if (short && t.startsWith(f) && t.length > 2) { out.push(valWord(args[k], 2)); break; }
      if (short && /^-[A-Za-z]+$/.test(t) && t.endsWith(f[1]) && args[k + 1]) { out.push(args[k + 1]); break; }
    }
  }
  return out;
}

/** The target the in-place editors write (M13): the operands, the script of `-e`/`-f`/`--expression=` dropped, the first operand too when no script flag is present. */
function sedTargets(args: Word[]): Word[] {
  const exact = (t: string) => ['-e', '--expression', '-f', '--file'].includes(t);
  const hasScript = args.some(w => exact(w.text) || /^--(?:expression|file)=/.test(w.text) || /^-[A-Za-z]*[ef]$/.test(w.text));
  const inPlace = args.some(w => w.text === '--in-place' || w.text.startsWith('--in-place=') || (/^-[A-Za-z]*i/.test(w.text) && !w.text.startsWith('--')));
  if (!inPlace) return [];
  const operands: Word[] = [];
  for (let k = 0; k < args.length; k++) {
    if (exact(args[k].text)) { k++; continue; }
    if (args[k].text.startsWith('-')) continue;
    operands.push(args[k]);
  }
  if (!hasScript) operands.shift();
  return operands;
}

/** tar's mode letter: 'x' extract, 'c' create, else 'other'. */
function tarMode(args: Word[]): 'x' | 'c' | 'other' {
  for (const w of args) {
    if (w.text === '--extract' || w.text === '--get') return 'x';
    if (w.text === '--create') return 'c';
    const m = /^-?([cxtru])[a-z]*$/.exec(w.text);
    if (m) return /x/.test(w.text) ? 'x' : /c/.test(w.text) ? 'c' : 'other';
  }
  return 'other';
}

/** The archive a create-tar writes: its `-f`/`--file` value, or the file glued in a mode bundle ending in `f`. */
function tarArchive(args: Word[]): Word | null {
  for (let k = 0; k < args.length; k++) {
    const t = args[k].text;
    if (t === '-f' || t === '--file') return args[k + 1] ?? null;
    if (t.startsWith('--file=')) return valWord(args[k], 7);
    if (/^-[A-Za-z]*f$/.test(t)) return args[k + 1] ?? null;
  }
  return null;
}

/** The targets of curl, wget, tar, unzip, 7z, dd, sort and patch: the option value or, for a download/extract into the cwd, the cwd. */
function archiveTargets(name: string, args: Word[], seg: Segment): Word[] {
  const out: Word[] = [];
  if (name === 'curl') { out.push(...flagValues(args, ['-o', '--output'], seg.dialect)); if (args.some(w => w.text === '--remote-name' || /^-[A-Za-z]*O$/.test(w.text))) out.push(cwdWord()); return out; }
  if (name === 'wget') { const o = flagValues(args, ['-O', '--output-document'], seg.dialect); if (o.length) return o; const p = flagValues(args, ['-P', '--directory-prefix'], seg.dialect); out.push(p[0] ?? cwdWord()); return out; }
  if (name === 'tar') { const m = tarMode(args); if (m === 'x') { const c = flagValues(args, ['-C', '--directory'], seg.dialect); out.push(c[0] ?? cwdWord()); } else if (m === 'c') { const f = tarArchive(args); if (f) out.push(f); } return out; }
  if (name === 'unzip') { const d = flagValues(args, ['-d'], seg.dialect); out.push(d[0] ?? cwdWord()); return out; }
  if (name === '7z') { const extract = /^[xe]$/i.test(args[0]?.text ?? ''); if (extract) { const o = args.find(w => /^-o./.test(w.text)); out.push(o ? valWord(o, 2) : cwdWord()); } else { const op = args.slice(1).find(w => !w.text.startsWith('-')); if (op) out.push(op); } return out; }
  if (name === 'dd') { for (const w of args) if (/^of=/.test(w.text)) out.push(valWord(w, 3)); return out; }
  if (name === 'sort') { out.push(...flagValues(args, ['-o', '--output'], seg.dialect)); return out; }
  if (name === 'patch') { out.push(...flagValues(args, ['-o', '-d'], seg.dialect)); const op = args.find(w => !w.text.startsWith('-')); if (op) out.push(op); return out; }
  return out;
}

/** The -t/--target-directory value of a cp/install, in its space, `=` and short-bundle (`-rt dir`, `-tdir`) forms. */
function targetDir(args: Word[]): Word | null {
  for (let k = 0; k < args.length; k++) {
    const t = args[k].text;
    if (t === '-t' || t === '--target-directory') return args[k + 1] ?? null;
    if (t.startsWith('--target-directory=')) return valWord(args[k], '--target-directory='.length);
    const g = /^-([a-z]*)t(.*)$/.exec(t);
    if (g && !t.startsWith('--')) return g[2] ? valWord(args[k], t.length - g[2].length) : args[k + 1] ?? null;
  }
  return null;
}

function copyTargets(name: string, args: Word[], seg: Segment): Word[] {
  if (name === 'robocopy') { const ops = args.filter(w => !isSwitch(w, name, seg.dialect)); return ops[1] ? [ops[1]] : []; }
  if (name === 'rsync') {
    const ops: Word[] = [];
    for (let k = 0; k < args.length; k++) { const t = args[k].text; if (RSYNC_VALUED.has(t)) { k++; continue; } if (!isSwitch(args[k], name, seg.dialect)) ops.push(args[k]); }
    return ops.length ? [ops[ops.length - 1]] : [];
  }
  const td = targetDir(args);
  if (td) return [td];
  const ops = args.filter(w => !isSwitch(w, name, seg.dialect));
  return ops.length ? [ops[ops.length - 1]] : [];
}

/** A PowerShell parameter's value, by its name or an unambiguous abbreviation of it (`-OutF` → outfile). */
function psParam(named: Record<string, Word>, full: string): Word | undefined {
  if (named[full]) return named[full];
  for (const [k, v] of Object.entries(named)) if (k.length >= 2 && full.startsWith(k)) return v;
  return undefined;
}

/** The targets of a PowerShell writer cmdlet, read by parameter name (item 4): never any other parameter's value. */
function psTargets(name: string, seg: Segment): Word[] {
  const spec = PS_WRITERS[name];
  const { named, positionals } = psParams(seg.argv.slice(1));
  const out: Word[] = [];
  for (const p of spec.params) { const v = psParam(named, p); if (v && v.text) out.push(v); }
  if (spec.pos === 'first' && positionals[0]) out.push(positionals[0]);
  else if (spec.pos === 'second' && positionals[1]) out.push(positionals[1]);
  else if (spec.pos === 'all') out.push(...positionals);
  return out;
}

/** The words a segment writes: its write redirections and, by the command, its file operands (T4: a dynamic argv[0] is judged by its non-flag args). */
export function writeTargets(seg: Segment): Word[] {
  const out: Word[] = [];
  for (const r of seg.redirects) if (r.op === '>' || r.op === '>>') out.push(r.target);
  const argv = seg.argv;
  if (!argv.length) return out;
  if (argv[0].dynamic) { for (const w of argv.slice(1)) if (!w.text.startsWith('-')) out.push(w); return out; }
  const name = commandName(argv[0]), args = argv.slice(1);
  if (seg.dialect === 'powershell' && PS_WRITERS[name]) { out.push(...psTargets(name, seg)); return out; }
  if (ARCHIVE.has(name)) { out.push(...archiveTargets(name, args, seg)); return out; }
  if (name === 'ln' || name === 'mklink') {
    const ops = args.filter(w => !isSwitch(w, name, seg.dialect));
    for (const w of ops) out.push(w);
    if (name === 'ln' && ops.length >= 2 && !ops[0].dynamic) {
      const link = ops[ops.length - 1];
      if (!link.dynamic) { const lp = segmentPath(link, seg); if (lp) { const abs = segmentPath(ops[0], { ...seg, cwd: path.dirname(lp) }); if (abs) out.push({ text: abs, dynamic: false, glob: false }); } }
    }
    return out;
  }
  if (name === 'find') {
    if (args.some(w => w.text === '-delete')) { let k = 0; while (k < args.length && /^-[HLPOD]/.test(args[k].text)) k += /^-[OD]/.test(args[k].text) && args[k].text.length === 2 ? 2 : 1; for (; k < args.length; k++) { const t = args[k].text; if (t.startsWith('-') || t.startsWith('(') || t === '!') break; out.push(args[k]); } }
    return out;
  }
  if (SCRIPT_INPLACE.has(name)) { out.push(...sedTargets(args)); return out; }
  if (name === 'icacls') { const op = args.find(w => !isSwitch(w, name, seg.dialect)); if (op) out.push(op); return out; }
  if (name === 'fsutil') { if (args[0]?.text.toLowerCase() === 'hardlink') for (const w of args.slice(1)) if (!isSwitch(w, name, seg.dialect) && w.text.toLowerCase() !== 'create') out.push(w); return out; }
  if (COPY_LIKE.has(name)) { out.push(...copyTargets(name, args, seg)); return out; }
  if (POSITIONAL.has(name)) { for (const w of args) if (!isSwitch(w, name, seg.dialect)) out.push(w); return out; }
  return out;
}

// ---- self -----------------------------------------------------------------------------------------------------------

/** A path that ends in one of the settings files, read with `/`, without case on win32/darwin, with win32's trailing dots, spaces and NTFS streams stripped first. */
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

/** A copy or move whose resulting file is a settings file: a settings-named source into a `.claude` directory. */
function copyIntoClaude(seg: Segment): boolean {
  const name = commandName(seg.argv[0]);
  if (!(COPY_LIKE.has(name) || name === 'move-item' || name === 'mi')) return false;
  const ops = seg.argv.slice(1).filter(w => !isSwitch(w, name, seg.dialect) && !w.dynamic);
  if (ops.length < 2) return false;
  const dest = ops[ops.length - 1].text.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!(dest === '.claude' || dest.endsWith('/.claude'))) return false;
  return ops.slice(0, -1).some(w => SETTINGS_RE.test(w.text.replace(/\\/g, '/')));
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
      for (const w of writeTargets(seg)) { const text = segmentPath(w, seg) ?? w.text.replace(/\\/g, '/'); if (endsWithSettings(text)) return deny('self', 'writing the project settings would switch the hook off', SELF_INSTEAD); }
      if (copyIntoClaude(seg)) return deny('self', 'copying a settings file into .claude would switch the hook off', SELF_INSTEAD);
      if (seg.argv.length && !seg.argv[0].dynamic && commandName(seg.argv[0]) === 'git') {
        const dd = seg.argv.findIndex(w => w.text === '--');
        if (dd >= 0 && seg.argv.slice(dd + 1).some(w => SETTINGS_RE.test(w.text.replace(/\\/g, '/')))) return deny('self', 'restoring the project settings would switch the hook off', SELF_INSTEAD);
      }
      if (seg.argv.length && !seg.argv[0].dynamic && commandName(seg.argv[0]) === 'claude' && claudeSwitch(seg.argv)) return deny('self', 'this claude command could switch the guard off', SELF_INSTEAD);
    }
    const command = shellCommand(input);
    if (command !== null) for (const call of forgeCalls(command)) {
      const a = call.replace(CWD_FLAG, ' ');
      if (/^\s*infinite\s+start\b/.test(a) && !/(?:^|\s)--profile(?=\s|=|$)/.test(a)) return deny('self', 'infinite start without --profile would replace this run', SELF_INSTEAD);
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
      if (seg.dynamicArgs && seg.argv.length && (seg.argv[0].dynamic || FILE_WRITER_SET.has(commandName(seg.argv[0]))))
        return deny('files', `unknown target: ${seg.argv[0].dynamic ? 'a command the shell hides' : commandName(seg.argv[0])} writes files the hook cannot see`, instead);
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

const envInside = (seg: Segment, ctx: GuardCtx, key: string): boolean => { const w = seg.env[key]; if (!w) return false; const p = segmentPath(w, seg); return !!p && insideRoots(p, ctx); };

/** The segment before a pip install activates a virtualenv inside the roots: `source …/activate` or `…/Activate.ps1` (the brief: an activate script, not any sourced file). */
function activatesEnv(prev: Segment, ctx: GuardCtx): boolean {
  if (!prev.argv.length) return false;
  const n = commandName(prev.argv[0]);
  if ((n === 'source' || n === '.') && prev.argv[1]) { if (!/(?:^|[\\/])activate(?:\.\w+)?$/i.test(prev.argv[1].text)) return false; const p = segmentPath(prev.argv[1], prev); return !!p && insideRoots(p, ctx); }
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
  const pi = seg.argv.findIndex(w => commandName(w).replace(/@.*$/, '') === 'playwright');
  return pi >= 0 && seg.argv.slice(pi + 1).some(w => w.text === 'install');
};

const isDownloader = (seg: Segment): boolean => seg.argv.length > 0 && (DOWNLOADERS.has(commandName(seg.argv[0])) || seg.argv.some(w => /downloadstring/i.test(w.text)));

/** An interpreter segment reads its program from stdin: iex from the pipeline, or a shell/interpreter with no -c/-e/-m and no script-file operand. */
function readsStdin(seg: Segment): boolean {
  const name = commandName(seg.argv[0]);
  if (name === 'iex' || name === 'invoke-expression') return true;
  for (const w of seg.argv.slice(1)) {
    const t = w.text;
    if (t === '-c' || t === '--command' || t === '-e' || t === '-m' || /^-[A-Za-z]*[cem]$/.test(t)) return false;
    if (!t.startsWith('-') && t !== '-') return false;
  }
  return true;
}

/** Download-and-run (H7): a downloader piped into an interpreter that reads stdin, or an interpreter one of whose own arguments is a `$(…)`/`<(…)` that downloads. */
function downloadAndRun(segs: Segment[]): boolean {
  if (!segs.some(isDownloader)) return false;
  return segs.some((s, i) => s.argv.length > 0 && isInterpreter(commandName(s.argv[0]))
    && ((s.after === '|' && i > 0 && isDownloader(segs[i - 1]) && readsStdin(s)) || s.argv.some(w => w.dynamic && DOWNLOAD_RE.test(w.text))));
}

/** Whether a single segment is a global install. */
function installs(seg: Segment, ctx: GuardCtx, segs: Segment[], idx: number): boolean {
  if (!seg.argv.length || seg.argv[0].dynamic) return false;
  const name = commandName(seg.argv[0]), a = seg.argv.slice(1).map(w => w.text);
  if (name === 'sudo') return true;
  if (name === 'npm' || name === 'pnpm' || name === 'yarn' || name === 'bun') {
    if (a.includes('-g') || a.includes('--global') || a.includes('--location=global') || a.some((t, k) => t === '--location' && a[k + 1] === 'global')) return true;
    if (name === 'yarn' && a[0] === 'global') return true;
    if (!(name === 'npm' && a[0] === 'link' && a.slice(1).every(t => t.startsWith('-')))) return playwrightInstall(seg) && !envInside(seg, ctx, 'PLAYWRIGHT_BROWSERS_PATH');
    return true;
  }
  if (/^pip[0-9.]*$/.test(name) && a.includes('install')) return !pipInside(seg, ctx, segs, idx);
  if (/^(?:python[0-9.]*|py)$/.test(name)) { const mi = a.indexOf('-m'); if (mi >= 0 && a[mi + 1] === 'pip' && a.includes('install')) return !pipInside(seg, ctx, segs, idx); }
  if (name === 'uv' && a[0] === 'tool' && a[1] === 'install') return true;
  if (name === 'uv' && a[0] === 'pip' && a[1] === 'install' && a.includes('--system')) return true;
  if (name === 'pipx' && a[0] === 'install') return true;
  if (name === 'apk') return ['add', 'del', 'upgrade', 'fix'].includes(a[0]);
  if (name === 'pacman') return a.some(t => /^-S|^-R|^-U/.test(t));
  if (name === 'zypper') { const v = a.find(t => !t.startsWith('-')); return !!v && ['in', 'install', 'rm', 'remove', 'up', 'update', 'dup', 'patch'].includes(v); }
  if (PKG_SYSTEMS.has(name)) { const sub = a.find(t => !t.startsWith('-')); return !!sub && PKG_VERBS.has(sub); }
  if (name === 'cargo' && a[0] === 'install') return !flagInside(seg, ctx, ['--root']);
  if (name === 'go' && a[0] === 'install') return !envInside(seg, ctx, 'GOBIN');
  if (name === 'gem' && a[0] === 'install') return !flagInside(seg, ctx, ['--install-dir', '-i']);
  if (name === 'bundle' && a[0] === 'install') return !flagInside(seg, ctx, ['--path']) && !envInside(seg, ctx, 'BUNDLE_PATH');
  if (name === 'dotnet' && a[0] === 'tool' && a[1] === 'install') return a.includes('-g') || a.includes('--global');
  if (name === 'dotnet' && a[0] === 'workload' && a[1] === 'install') return true;
  if (name === 'rustup' || name === 'msiexec') return true;
  if (name === 'conda' || name === 'mamba' || name === 'micromamba') return ['install', 'create', 'update', 'remove'].includes(a[0]) || (a[0] === 'env' && ['create', 'update', 'remove'].includes(a[1]));
  if (name === 'deno' && a[0] === 'install') return a.includes('-g') || a.includes('--global') || a.slice(1).some(t => !t.startsWith('-'));
  if (['nvm', 'volta', 'fnm', 'asdf', 'sdk', 'pyenv', 'rbenv'].includes(name) && a[0] === 'install') return true;
  if ((name === 'mise' || name === 'rtx') && (a[0] === 'install' || (a[0] === 'use' && (a.includes('-g') || a.includes('--global'))))) return true;
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
  const argv = seg.argv, auto = ctx.autonomous!;
  const instead = `commit on ${auto.branch}; integrating into ${auto.protectedBranches.join('/')} is the person's call, and the run never pushes`;
  const D = (what: string) => deny('git', what, instead);
  const U = (what: string) => deny('git', `unknown target: ${what}`, instead);
  // global options before the subcommand
  let i = 1, workTree: Word | null = null, gitDirOpt = false;
  const cDirs: Word[] = [], cflags: string[] = [];
  while (i < argv.length && argv[i].text.startsWith('-')) {
    const w = argv[i], t = w.text, eq = t.indexOf('='), key = eq >= 0 ? t.slice(0, eq) : t;
    if (key === '-C') { cDirs.push(eq >= 0 ? valWord(w, eq + 1) : argv[i + 1] ?? { text: '', dynamic: true, glob: false }); i += eq >= 0 ? 1 : 2; continue; }
    if (key === '-c') { cflags.push(eq >= 0 ? t.slice(eq + 1) : argv[i + 1]?.text ?? ''); i += eq >= 0 ? 1 : 2; continue; }
    if (key === '--config-env') { const v = eq >= 0 ? t.slice(eq + 1) : argv[i + 1]?.text ?? ''; cflags.push(v.split('=')[0]); i += eq >= 0 ? 1 : 2; continue; }
    if (key === '--work-tree') { workTree = eq >= 0 ? valWord(w, eq + 1) : argv[i + 1] ?? null; i += eq >= 0 ? 1 : 2; continue; }
    if (key === '--git-dir') { gitDirOpt = true; i += eq >= 0 ? 1 : 2; continue; }
    i += GIT_VALUED.includes(key) && eq < 0 ? 2 : 1;
  }
  for (const [k, v] of Object.entries(seg.env)) if (/^GIT_CONFIG_KEY_\d+$/.test(k)) cflags.push(v.text);
  const sub = argv[i]?.text.toLowerCase() ?? '';
  const rest = argv.slice(i + 1);
  const ddIdx = rest.findIndex(w => w.text === '--');
  const hasDashDash = ddIdx >= 0;
  const operands = (hasDashDash ? rest.slice(0, ddIdx) : rest).filter(w => !w.text.startsWith('-'));
  const opTexts = operands.map(w => w.text);
  const isProtected = (t: string) => auto.protectedBranches.includes(destBranch(t));
  const isKnown = (t: string) => auto.branches.includes(destBranch(t));
  // the directory git runs in: compose -C over the cwd, then --work-tree/GIT_WORK_TREE; --git-dir/GIT_DIR without a work tree is unknown (overrides -C)
  let base = seg.cwd;
  for (const c of cDirs) { if (base === null) break; base = c.dynamic || !c.text ? null : segmentPath(c, { ...seg, cwd: base }); }
  const wtW = workTree ?? seg.env.GIT_WORK_TREE ?? null;
  const dir = wtW ? segmentPath(wtW, { ...seg, cwd: base }) : (gitDirOpt || seg.env.GIT_DIR) ? null : base;
  const dirKnown = dir !== null;
  const dirOk = dirKnown && insideRoots(dir, ctx);

  if (sub === 'push') return D('git push sends commits off this machine');
  for (const cf of cflags) { const k = cf.split('=')[0].toLowerCase(); if (k.startsWith('alias.') || k === 'core.sshcommand' || k === 'core.hookspath' || k === 'core.fsmonitor') return D(`git -c ${cf} changes how git runs`); }
  if (sub === 'checkout' || sub === 'switch') {
    const creates = rest.some(w => /^-(?:b|B|c|C)$/.test(w.text));
    if (creates) { const t = flagValues(rest, ['-b', '-B', '-c', '-C'], 'bash')[0] ?? operands[0]; if (t && isProtected(t.text)) return D(`creating ${auto.protectedBranches.join('/')} would move it`); }
    else if (!hasDashDash && operands.length <= 1 && operands.some(w => isProtected(w.text))) return D(`checking out ${auto.protectedBranches.join('/')} would move off the run's branch`);
  }
  if (sub === 'worktree' && opTexts[0] === 'add') {
    if (rest.some(w => w.text === '-f' || w.text === '--force')) return D('git worktree add --force overwrites a branch');
    if (operands.slice(1).some(w => isProtected(w.text)) || flagValues(rest, ['-b', '-B'], 'bash').some(w => isProtected(w.text))) return D('a worktree on a protected branch');
  }
  if (sub === 'rebase') {
    const pos: Word[] = [];
    for (let k = 0; k < rest.length; k++) { if (REBASE_VALUED.has(rest[k].text)) { k++; continue; } if (!rest[k].text.startsWith('-')) pos.push(rest[k]); }
    if (pos.length >= 2 && isProtected(pos[pos.length - 1].text)) return D('rebasing a protected branch moves it');
  }
  if (sub === 'fetch' && operands.slice(1).some(w => w.text.includes(':') && isProtected(w.text))) return D('this fetch would write a protected branch');
  if (sub === 'update-ref') {
    if (rest.some(w => w.text === '--stdin')) return U('git update-ref --stdin writes refs the hook cannot see');
    if (operands.some(w => isProtected(w.text))) return D('update-ref on a protected branch');
    if (rest.some(w => w.text === '-d') && operands.some(w => !isKnown(w.text) && !isProtected(w.text))) return D("update-ref -d of a branch that is not the run's");
  }
  if (sub === 'branch') {
    if (rest.some(w => /^(?:-f|--force|-m|-M|-c|-C|--move|--copy)$/.test(w.text)) && operands.some(w => isProtected(w.text))) return D('moving a protected branch');
    if (rest.some(w => /^(?:-d|-D|--delete)$/.test(w.text)) && operands.some(w => !isKnown(w.text))) return D("deleting a branch that is not the run's");
  }
  if (sub === 'tag' && rest.some(w => /^(?:-d|--delete|-f|--force)$/.test(w.text))) return D('git tag -d/-f rewrites a tag');
  if (sub === 'filter-branch' || sub === 'filter-repo' || sub === 'replace') return D('a history rewrite');
  if (sub === 'stash' && opTexts[0] !== 'list' && opTexts[0] !== 'show') return D('git stash uses the stash the clone shares');
  if (sub === 'config' && configWrites(rest)) return D('git config writes settings the clone shares');
  if (sub === 'remote' && ['add', 'remove', 'rm', 'set-url', 'rename'].includes(opTexts[0])) return D('changing a remote');
  if (sub === 'gc') return D('git gc rewrites the object store');
  if (sub === 'reflog' && opTexts[0] === 'expire') return D('reflog expire drops recovery state');
  if (sub === 'worktree' && opTexts[0] === 'remove') { const p = operands[1] ? segmentPath(operands[1], seg) : null; if (p === null) return U('git worktree remove of a path the hook cannot see'); if (!insideRoots(p, ctx)) return D('git worktree remove outside the roots'); }
  if (sub === 'worktree' && opTexts[0] === 'prune') { if (!dirKnown) return U('git worktree prune where the hook cannot see'); if (!dirOk) return D('git worktree prune outside the roots'); }
  const dirRestricted = GIT_DIR_CMDS.has(sub) || ((sub === 'checkout' || sub === 'switch') && (hasDashDash || operands.length > 1) && !rest.some(w => /^-(?:b|B|c|C)$/.test(w.text)));
  if (dirRestricted) { if (!dirKnown) return U(`git ${sub} runs where the hook cannot see`); if (!dirOk) return D(`git ${sub} runs outside the run's roots`); }
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
