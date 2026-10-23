// Plan 6b-1, Task 4 (fix 2, T4-FAILCLOSED): the write-target parser the `files` and `self` rules use. The direction is
// fail-closed: a write-class segment's words are all candidate targets, and a word is EXEMPTED only when the command's own
// option table positively identifies it as a source, content or script. An option the table does not know cancels every
// exemption, so a parsing miss becomes a deny with a clear reason, not a hole. Pure: reads no file, starts no process.
import path from 'node:path';
import { commandName, type Dialect, type Segment, type Word } from './shell-words.js';
import { segmentPath } from './autonomy-shared.js';

/** What a write-class segment would write: the words to judge as targets. `writer` is false when the segment is no writer. */
export interface WriteInfo { writer: boolean; targets: Word[] }

const word = (text: string, dynamic = false): Word => ({ text, dynamic, glob: false });
const val = (w: Word, from: number): Word => ({ text: w.text.slice(from), dynamic: w.dynamic, glob: false });
const CWD = word('.'); // a write into the segment's own directory

// ---- bash / cmd ------------------------------------------------------------------------------------------------------

// Writers whose every non-option operand is a target (delete, move, in-place metadata, create-empty).
const ALL = new Set(['rm', 'rmdir', 'unlink', 'shred', 'truncate', 'del', 'erase', 'rd', 'mv', 'move', 'ren', 'chmod', 'chown', 'chgrp', 'attrib', 'touch', 'mkdir', 'tee']);
const COPY = new Set(['cp', 'copy', 'xcopy', 'install']); // sources read, the destination (last operand or -t) written
const SLASH_SWITCH = new Set(['del', 'erase', 'rd', 'copy', 'xcopy', 'robocopy', 'move', 'attrib']);
const RSYNC_VALUED = new Set(['--exclude', '--include', '--exclude-from', '--include-from', '--files-from', '--filter', '-f', '-e', '--rsh', '--chmod', '--chown', '--log-file',
  '--out-format', '--compare-dest', '--copy-dest', '--link-dest', '--backup-dir', '--suffix', '--temp-dir', '-T', '--partial-dir', '--bwlimit', '--timeout', '--port', '--max-size', '--min-size', '--block-size', '-B']);

/** A switch, not an operand: a `-flag`, or a single-segment `/switch` in cmd or after a cmd builtin (in Bash `/c/x` keeps its path). */
function isSwitch(w: Word, name: string, d: Dialect): boolean {
  const t = w.text;
  if (t.startsWith('-')) return true;
  if (!t.startsWith('/')) return false;
  if (d === 'cmd') return t.length > 1;
  return SLASH_SWITCH.has(name) && !t.slice(1).includes('/');
}

const operandsOf = (args: Word[], name: string, d: Dialect): Word[] => args.filter(w => !isSwitch(w, name, d));

/** The -t/--target-directory value of a cp/install/mv (space, `=`, glued, or at the end of a short bundle; any case). */
function targetDir(args: Word[]): Word | null {
  for (let k = 0; k < args.length; k++) {
    const t = args[k].text;
    if (t === '-t' || t === '--target-directory') return args[k + 1] ?? null;
    if (t.startsWith('--target-directory=')) return val(args[k], '--target-directory='.length);
    const g = /^-([A-Za-z]*)t(.*)$/.exec(t);
    if (g && !t.startsWith('--')) return g[2] ? val(args[k], t.length - g[2].length) : args[k + 1] ?? null;
  }
  return null;
}

/** tar's mode and its `-f` archive and `-C` directory, read from bundles (`-zxvf`), `xzf`, long forms and glued values. */
function tarParse(args: Word[]): { mode: 'x' | 'c' | 'a' | 'other'; archive: Word | null; dir: Word | null } {
  let mode: 'x' | 'c' | 'a' | 'other' = 'other', archive: Word | null = null, dir: Word | null = null;
  for (let k = 0; k < args.length; k++) {
    const t = args[k].text;
    if (t === '--extract' || t === '--get') mode = mode === 'other' ? 'x' : mode;
    else if (t === '--create') mode = mode === 'other' ? 'c' : mode;
    else if (/^(--append|--update|--concatenate)$/.test(t)) mode = mode === 'other' ? 'a' : mode;
    else if (t.startsWith('--file=')) archive = val(args[k], 7);
    else if (t === '--file') archive = args[k + 1] ?? null;
    else if (t.startsWith('--directory=')) dir = val(args[k], 12);
    else if (t === '--directory' || t === '-C') dir = args[k + 1] ?? null;
    else if (/^-C/.test(t)) dir = val(args[k], 2); // -C<dir> glued
    else {
      // a mode bundle, dashed (-zxvf) or bare first word (xzf); `f`/`C` take the rest of the bundle or the next word as value
      const body = t.startsWith('-') ? t.slice(1) : (k === 0 && /^[a-zA-Z]/.test(t) ? t : null);
      if (body === null) continue;
      let vi = -1, which = '';
      for (let j = 0; j < body.length; j++) { if (body[j] === 'f' || body[j] === 'C') { vi = j; which = body[j]; break; } if (!/[a-zA-Z]/.test(body[j])) { vi = -2; break; } }
      if (vi === -2) continue; // not a mode bundle (a real operand)
      const letters = vi >= 0 ? body.slice(0, vi + 1) : body, rest = vi >= 0 ? body.slice(vi + 1) : '';
      if (mode === 'other') { if (/x/.test(letters)) mode = 'x'; else if (/c/.test(letters)) mode = 'c'; else if (/[ru]/.test(letters)) mode = 'a'; }
      if (which === 'f') archive = rest ? word(rest, args[k].dynamic) : args[k + 1] ?? null;
      else if (which === 'C') dir = rest ? word(rest, args[k].dynamic) : args[k + 1] ?? null;
    }
  }
  return { mode, archive, dir };
}

/**
 * The in-place flag and file operands of a sed/perl/ruby edit, one letter parser driving both (FC2). sed: `e`,`f` are scripts
 * and `l` takes a value (all consume the glued rest or the next word); `i` is in-place and the rest of the bundle is its
 * suffix. perl: `e`,`E` are scripts; `i` is in-place (rest is the suffix); `l`,`0` take only glued octal digits.
 */
function sedParse(args: Word[], perl: boolean): { inPlace: boolean; files: Word[] } {
  let inPlace = false, sawScript = false; const files: Word[] = []; const skipNext = new Set<number>();
  const scriptLetters = perl ? 'eE' : 'ef', valueLetters = perl ? 'eE' : 'efl';
  for (let k = 0; k < args.length; k++) {
    if (skipNext.has(k)) continue;
    const t = args[k].text;
    if (t === '--') { for (const w of args.slice(k + 1)) files.push(w); break; }
    if (t === '--in-place' || t.startsWith('--in-place=')) { inPlace = true; continue; }
    if (t === '--expression' || t === '--file') { sawScript = true; skipNext.add(k + 1); continue; }
    if (/^--(?:expression|file)=/.test(t)) { sawScript = true; continue; }
    if (t.startsWith('--')) continue;
    if (t.startsWith('-') && t.length > 1) {
      const letters = t.slice(1);
      for (let j = 0; j < letters.length; j++) {
        const c = letters[j];
        if (c === 'i') { inPlace = true; break; } // the rest of the bundle is the suffix
        if (perl && (c === 'l' || c === '0')) { let m = j + 1; while (m < letters.length && /[0-7]/.test(letters[m])) m++; j = m - 1; continue; } // glued octal only
        if (valueLetters.includes(c)) { if (scriptLetters.includes(c)) sawScript = true; if (j === letters.length - 1) skipNext.add(k + 1); break; } // value = glued rest or next word
      }
      continue;
    }
    files.push(args[k]);
  }
  if (!sawScript && files.length) files.shift(); // with no -e/-f the first operand is the script
  return { inPlace, files };
}

// curl's options that name a file it writes (FC5); -O/-J/--output-dir write into the segment's directory.
const CURL_FILE = new Set(['-o', '--output', '-D', '--dump-header', '-c', '--cookie-jar', '--trace', '--trace-ascii', '--stderr', '--libcurl', '--etag-save', '--hsts', '--alt-svc']);
const CURL_FILE_EQ = ['--output', '--dump-header', '--cookie-jar', '--trace', '--trace-ascii', '--stderr', '--libcurl', '--etag-save', '--hsts', '--alt-svc'];

/** curl writes only with an output option; its target is the named file or, for -O/-J/--output-dir, the directory it writes into. */
function curlTargets(args: Word[]): Word[] | null {
  const out: Word[] = []; let writer = false;
  for (let k = 0; k < args.length; k++) {
    const t = args[k].text;
    if (CURL_FILE.has(t)) { writer = true; if (args[k + 1]) out.push(args[k + 1]); }
    else if (CURL_FILE_EQ.some(f => t.startsWith(f + '='))) { writer = true; out.push(val(args[k], t.indexOf('=') + 1)); }
    else if (t === '--output-dir') { writer = true; if (args[k + 1]) out.push(args[k + 1]); out.push(CWD); }
    else if (t.startsWith('--output-dir=')) { writer = true; out.push(val(args[k], 13)); out.push(CWD); }
    else if (t === '--remote-name' || t === '--remote-header-name') { writer = true; out.push(CWD); }
    else if (t.startsWith('-') && /^[A-Za-z]/.test(t[1] ?? '')) { const g = /^-([A-Za-z]*)o(.*)$/.exec(t); if (g) { writer = true; out.push(g[2] ? val(args[k], t.length - g[2].length) : args[k + 1] ?? CWD); } else if (/^-[A-Za-z]*[OJ]/.test(t)) { writer = true; out.push(CWD); } }
  }
  return writer ? out : null;
}

/** The targets of wget (always a writer): its download (-O/-P else cwd) and its log file (-o/-a) (FC5). */
function wgetTargets(args: Word[]): Word[] {
  const out: Word[] = []; let download: Word | null = CWD;
  for (let k = 0; k < args.length; k++) {
    const t = args[k].text;
    if (t === '-O' || t === '--output-document') { const v = args[k + 1]; download = v && v.text !== '-' ? v : null; }
    else if (t.startsWith('--output-document=')) { const v = val(args[k], 18); download = v.text !== '-' ? v : null; }
    else if (t === '-P' || t === '--directory-prefix') download = args[k + 1] ?? CWD;
    else if (t.startsWith('--directory-prefix=')) download = val(args[k], 19);
    else if (t === '-o' || t === '--output-file' || t === '-a' || t === '--append-output') { if (args[k + 1]) out.push(args[k + 1]); }
    else if (t.startsWith('--output-file=') || t.startsWith('--append-output=')) out.push(val(args[k], t.indexOf('=') + 1));
    else { const g = t.startsWith('-') && /^[A-Za-z]/.test(t[1] ?? '') ? /^-([A-Za-z]*)O(.*)$/.exec(t) : null; if (g) download = g[2] ? (g[2] !== '-' ? val(args[k], t.length - g[2].length) : null) : (args[k + 1] && args[k + 1].text !== '-' ? args[k + 1] : null); }
  }
  if (download) out.push(download);
  return out;
}

// Every command bashWrite knows (so a known downloader/archiver with no write option is not mistaken for an unknown command).
const KNOWN_BASH = new Set([...ALL, ...COPY, 'robocopy', 'rsync', 'tar', 'unzip', '7z', 'dd', 'sort', 'curl', 'wget', 'patch', 'sed', 'gsed', 'perl', 'ruby', 'find', 'icacls', 'ln', 'mklink', 'fsutil']);

/** Whether a segment's command is one the write-target parser knows (a writer table or a PowerShell cmdlet), even if this call writes nothing. */
export function knownWriteCommand(seg: Segment): boolean {
  if (!seg.argv.length) return false;
  const name = commandName(seg.argv[0]);
  return seg.dialect === 'powershell' ? isPsCmdlet(name) : KNOWN_BASH.has(name);
}

function bashWrite(seg: Segment): WriteInfo {
  const name = commandName(seg.argv[0]), args = seg.argv.slice(1), d = seg.dialect;
  const none: WriteInfo = { writer: false, targets: [] };
  if (ALL.has(name)) { let targets = operandsOf(args, name, d); if ((name === 'chown' || name === 'chgrp') && targets.length) targets = targets.slice(1); if (name === 'mv' || name === 'move') { const td = targetDir(args); if (td) targets.push(td); } return { writer: true, targets }; }
  if (name === 'icacls') { const op = operandsOf(args, name, d)[0]; return { writer: true, targets: op ? [op] : [] }; }
  if (name === 'ln' || name === 'mklink') {
    const ops = operandsOf(args, name, d), targets = [...ops];
    // a symlink's target is relative to the link's own folder, not the segment cwd (judge it there too)
    if (name === 'ln' && ops.length >= 2 && !ops[0].dynamic && !ops[ops.length - 1].dynamic) {
      const lp = segmentPath(ops[ops.length - 1], seg);
      if (lp) { const abs = segmentPath(ops[0], { ...seg, cwd: path.dirname(lp) }); if (abs) targets.push(word(abs)); }
    }
    return { writer: true, targets };
  }
  if (name === 'fsutil') { if (seg.argv[1]?.text.toLowerCase() !== 'hardlink') return none; return { writer: true, targets: operandsOf(args.slice(1), name, d).filter(w => w.text.toLowerCase() !== 'create') }; }
  if (COPY.has(name)) {
    const ops = operandsOf(args, name, d), td = targetDir(args);
    const link = args.some(w => /^-[A-Za-z]*[ls]/.test(w.text) && !w.text.startsWith('--')) || args.some(w => w.text === '--link' || w.text === '--symbolic-link'); // a copy through a link reaches the sources
    if (link) return { writer: true, targets: td ? [td, ...ops] : ops };
    if (td) return { writer: true, targets: [td] };
    return { writer: true, targets: ops.length ? [ops[ops.length - 1]] : [] };
  }
  if (name === 'robocopy') { const ops = operandsOf(args, name, d); const move = args.some(w => /^\/MOVE?$/i.test(w.text)); const t: Word[] = []; if (ops[1]) t.push(ops[1]); if (move && ops[0]) t.push(ops[0]); return { writer: true, targets: t }; }
  if (name === 'rsync') {
    const ops: Word[] = []; for (let k = 0; k < args.length; k++) { if (RSYNC_VALUED.has(args[k].text)) { k++; continue; } if (!isSwitch(args[k], name, d)) ops.push(args[k]); }
    const move = args.some(w => w.text === '--remove-source-files');
    return { writer: true, targets: move ? ops : ops.length ? [ops[ops.length - 1]] : [] };
  }
  if (name === 'tar') { const { mode, archive, dir } = tarParse(args); if (mode === 'x') return { writer: true, targets: dir ? [dir] : [] }; if (mode === 'c' || mode === 'a') return { writer: true, targets: archive ? [archive] : [] }; return none; }
  if (name === 'unzip') { for (let k = 0; k < args.length; k++) { if (args[k].text === '-d') return { writer: true, targets: args[k + 1] ? [args[k + 1]] : [] }; if (args[k].text.startsWith('-d') && args[k].text.length > 2) return { writer: true, targets: [val(args[k], 2)] }; } return { writer: true, targets: [] }; }
  if (name === '7z') { const sub = (args[0]?.text ?? '').toLowerCase(); if (/^x|^e/.test(sub)) { const o = args.find(w => /^-o./.test(w.text)); return { writer: true, targets: o ? [val(o, 2)] : [] }; } if (/^(a|u|d)/.test(sub)) { const op = operandsOf(args.slice(1), name, d)[0]; return { writer: true, targets: op ? [op] : [] }; } return none; }
  if (name === 'dd') { for (const w of args) if (/^of=/.test(w.text)) return { writer: true, targets: [val(w, 3)] }; return none; }
  if (name === 'sort') { for (let k = 0; k < args.length; k++) { const t = args[k].text; if (t === '-o' || t === '--output') return { writer: true, targets: args[k + 1] ? [args[k + 1]] : [] }; if (t.startsWith('--output=')) return { writer: true, targets: [val(args[k], 9)] }; const g = /^-([a-z]*)o(.*)$/.exec(t); if (g && !t.startsWith('--')) return { writer: true, targets: g[2] ? [val(args[k], t.length - g[2].length)] : args[k + 1] ? [args[k + 1]] : [] }; } return none; }
  if (name === 'curl') { const t = curlTargets(args); return t ? { writer: true, targets: t } : none; }
  if (name === 'wget') return { writer: true, targets: wgetTargets(args) };
  if (name === 'patch') { const t: Word[] = []; for (let k = 0; k < args.length; k++) { const w = args[k].text; if (w === '-o' || w === '-d' || w === '--output' || w === '--directory') { if (args[k + 1]) t.push(args[k + 1]); } else if (/^(--output=|--directory=)/.test(w)) t.push(val(args[k], w.indexOf('=') + 1)); else if (/^-[od]./.test(w)) t.push(val(args[k], 2)); } const op = operandsOf(args, name, d)[0]; if (op) t.push(op); return { writer: true, targets: t }; }
  if (name === 'sed' || name === 'gsed' || name === 'perl' || name === 'ruby') { const { inPlace, files } = sedParse(args, name === 'perl' || name === 'ruby'); return inPlace ? { writer: true, targets: files } : none; }
  if (name === 'find') {
    const fpAt = args.findIndex(w => /^-(?:fprint0?|fprintf|fls)$/.test(w.text));
    if (!args.some(w => w.text === '-delete') && fpAt < 0) return none;
    const targets: Word[] = [];
    if (fpAt >= 0 && args[fpAt + 1]) targets.push(args[fpAt + 1]);
    let k = 0; while (k < args.length && /^-[HLPOD]/.test(args[k].text)) k += /^-[OD]$/.test(args[k].text) ? 2 : 1;
    for (; k < args.length; k++) { const t = args[k].text; if (t.startsWith('-') || t.startsWith('(') || t === '!') break; targets.push(args[k]); }
    return { writer: true, targets };
  }
  return none;
}

// ---- PowerShell ------------------------------------------------------------------------------------------------------

type PK = 'p' | 's' | 'c' | 'v' | 'w'; // path target, source, content, valued (exempt), switch
// Common parameters every cmdlet accepts; a valued one consumes its value, a switch does not.
const COMMON: Record<string, PK> = {
  erroraction: 'v', ea: 'v', warningaction: 'v', wa: 'v', informationaction: 'v', infa: 'v', errorvariable: 'v', ev: 'v', warningvariable: 'v', wv: 'v',
  informationvariable: 'v', iv: 'v', outvariable: 'v', ov: 'v', outbuffer: 'v', ob: 'v', pipelinevariable: 'v', pv: 'v', progressaction: 'v', proga: 'v', verbose: 'w', debug: 'w', whatif: 'w', confirm: 'w',
};
const PS_ALIAS: Record<string, string> = {
  rm: 'remove-item', rmdir: 'remove-item', del: 'remove-item', erase: 'remove-item', ri: 'remove-item', rd: 'remove-item',
  cp: 'copy-item', copy: 'copy-item', cpi: 'copy-item', mv: 'move-item', move: 'move-item', mi: 'move-item', ni: 'new-item',
  sc: 'set-content', ac: 'add-content', clc: 'clear-content', rni: 'rename-item', ren: 'rename-item', si: 'set-item', tee: 'tee-object', epcsv: 'export-csv',
  iwr: 'invoke-webrequest', irm: 'invoke-restmethod', curl: 'invoke-webrequest', wget: 'invoke-webrequest',
};
interface Spec { params: Record<string, PK>; pos: PK[]; always: boolean; writerParam?: string; itemType?: boolean }
const P = (params: Record<string, PK>, pos: PK[], extra: Partial<Spec> = {}): Spec => ({ params, pos, always: true, ...extra });
const pathP: Record<string, PK> = { path: 'p', literalpath: 'p', pspath: 'p', lp: 'p' };
const PS_CMDLETS: Record<string, Spec> = {
  'remove-item': P({ ...pathP, filter: 'v', include: 'v', exclude: 'v', recurse: 'w', force: 'w', stream: 'v', credential: 'v', progress: 'w' }, ['p']),
  'clear-content': P({ ...pathP, filter: 'v', include: 'v', exclude: 'v', force: 'w', stream: 'v', credential: 'v' }, ['p']),
  'set-content': P({ ...pathP, value: 'c', encoding: 'v', filter: 'v', include: 'v', exclude: 'v', force: 'w', nonewline: 'w', stream: 'v', credential: 'v', asbytearray: 'w', asbytestream: 'w', passthru: 'w', raw: 'w', readcount: 'v', usetransaction: 'w' }, ['p', 'c']),
  'add-content': P({ ...pathP, value: 'c', encoding: 'v', filter: 'v', include: 'v', exclude: 'v', force: 'w', nonewline: 'w', stream: 'v', credential: 'v', asbytestream: 'w', passthru: 'w', usetransaction: 'w' }, ['p', 'c']),
  'set-item': P({ ...pathP, value: 'c', force: 'w', filter: 'v', include: 'v', exclude: 'v', credential: 'v' }, ['p', 'c']),
  'out-file': P({ filepath: 'p', literalpath: 'p', path: 'p', inputobject: 'c', encoding: 'v', width: 'v', append: 'w', force: 'w', nonewline: 'w', noclobber: 'w' }, ['p']),
  'tee-object': P({ filepath: 'p', literalpath: 'p', inputobject: 'c', append: 'w' }, ['p']),
  'new-item': P({ path: 'p', name: 'p', value: 'c', target: 'c', itemtype: 'v', force: 'w', credential: 'v', type: 'v' }, ['p'], { itemType: true }),
  'export-csv': P({ ...pathP, inputobject: 'c', delimiter: 'v', encoding: 'v', notypeinformation: 'w', append: 'w', force: 'w', noclobber: 'w', usequotes: 'v', includetypeinformation: 'w', usecultures: 'w' }, ['p']),
  'export-clixml': P({ ...pathP, inputobject: 'c', depth: 'v', encoding: 'v', force: 'w', noclobber: 'w' }, ['p']),
  'copy-item': P({ path: 's', literalpath: 's', pspath: 's', lp: 's', destination: 'p', recurse: 'w', force: 'w', filter: 'v', include: 'v', exclude: 'v', container: 'w', passthru: 'w', credential: 'v' }, ['s', 'p']),
  'move-item': P({ ...pathP, destination: 'p', force: 'w', filter: 'v', include: 'v', exclude: 'v', passthru: 'w', credential: 'v' }, ['p', 'p']),
  'rename-item': P({ ...pathP, newname: 'v', force: 'w', passthru: 'w', credential: 'v' }, ['p', 'v']),
  'expand-archive': P({ path: 's', literalpath: 's', destinationpath: 'p', force: 'w', passthru: 'w' }, ['s', 'p']),
  'compress-archive': P({ path: 's', literalpath: 's', destinationpath: 'p', compressionlevel: 'v', update: 'w', force: 'w' }, ['s', 'p']),
  'start-bitstransfer': P({ source: 's', destination: 'p', transfertype: 'v', priority: 'v', credential: 'v', displayname: 'v' }, ['s', 'p']),
  'invoke-webrequest': P({ uri: 's', outfile: 'p', infile: 's', method: 'v', body: 'v', headers: 'v', contenttype: 'v', credential: 'v', form: 'v', sessionvariable: 'v', websession: 'v', useragent: 'v', maximumretrycount: 'v', retryintervalsec: 'v', timeoutsec: 'v', usebasicparsing: 'w', passthru: 'w' }, ['s'], { always: false, writerParam: 'outfile' }),
  'invoke-restmethod': P({ uri: 's', outfile: 'p', infile: 's', method: 'v', body: 'v', headers: 'v', contenttype: 'v', credential: 'v', form: 'v', timeoutsec: 'v' }, ['s'], { always: false, writerParam: 'outfile' }),
};

/** Resolve a typed PowerShell parameter name (or unambiguous prefix) against this cmdlet's parameters and the common ones. */
function resolveParam(spec: Spec, nm: string): string | null {
  if (spec.params[nm] !== undefined) return nm;
  if (COMMON[nm] !== undefined) return nm;
  const keys = [...Object.keys(spec.params), ...Object.keys(COMMON)].filter(k => k.startsWith(nm));
  return keys.length === 1 ? keys[0] : null;
}
const kindOf = (spec: Spec, p: string): PK => spec.params[p] ?? COMMON[p];

function psWrite(seg: Segment): WriteInfo {
  const canon = PS_ALIAS[commandName(seg.argv[0])] ?? commandName(seg.argv[0]);
  const spec = PS_CMDLETS[canon];
  if (!spec) return { writer: false, targets: [] };
  const args = seg.argv.slice(1);
  const named: Record<string, Word> = {};
  const positionals: Word[] = [];
  let cancel = false, hasWriterParam = false;
  for (let k = 0; k < args.length; k++) {
    const w = args[k], t = w.text;
    const glued = /^-([A-Za-z][\w-]*):(.*)$/s.exec(t);
    if (glued) { const p = resolveParam(spec, glued[1].toLowerCase()); if (p) { named[p] = word(glued[2], w.dynamic); if (p === spec.writerParam) hasWriterParam = true; } else { cancel = true; positionals.push(word(glued[2], w.dynamic)); } continue; }
    const bare = /^-([A-Za-z][\w-]*)$/.exec(t);
    if (bare) {
      const p = resolveParam(spec, bare[1].toLowerCase());
      if (!p) { cancel = true; continue; } // an unknown parameter is read as a switch and cancels exemptions
      if (p === spec.writerParam) hasWriterParam = true;
      if (kindOf(spec, p) === 'w') continue;
      const nx = args[k + 1];
      if (nx && !nx.text.startsWith('-')) { named[p] = nx; k++; }
      continue;
    }
    positionals.push(w);
  }
  const writer = spec.always || hasWriterParam || (spec.writerParam !== undefined && cancel);
  if (!writer) return { writer: false, targets: [] };
  const itemTypeTarget = spec.itemType ? itemLinks(named) : false;
  const targets: Word[] = [];
  const take = (kind: PK, w: Word) => { if (cancel || kind === 'p' || (itemTypeTarget && kind === 'c')) targets.push(w); };
  for (const [p, w] of Object.entries(named)) take(kindOf(spec, p), w);
  // positional slots, by kind: a named parameter consumes a slot of its own kind, the rest fill the remaining slots in order.
  const slots = [...spec.pos];
  for (const p of Object.keys(named)) { const idx = slots.indexOf(kindOf(spec, p)); if (idx >= 0) slots.splice(idx, 1); }
  positionals.forEach((w, i) => take(slots[i] ?? slots[slots.length - 1] ?? spec.pos[spec.pos.length - 1] ?? 'p', w));
  return { writer: true, targets };
}

/** New-Item writes a link target (not content) when its item type is a link, or is missing or dynamic. */
function itemLinks(named: Record<string, Word>): boolean {
  const it = named['itemtype'] ?? named['type'];
  if (!it) return true;
  if (it.dynamic) return true;
  return /^(symboliclink|hardlink|junction)$/i.test(it.text);
}

const isPsCmdlet = (name: string): boolean => PS_CMDLETS[PS_ALIAS[name] ?? name] !== undefined;

/** What a write-class segment would write. In the powershell dialect a known cmdlet is read by psWrite; an external command (robocopy, tar, …) by bashWrite. */
export function writeInfo(seg: Segment): WriteInfo {
  if (!seg.argv.length || seg.argv[0].dynamic) return { writer: false, targets: [] };
  return seg.dialect === 'powershell' && isPsCmdlet(commandName(seg.argv[0])) ? psWrite(seg) : bashWrite(seg);
}

/** A copy/move/link destination and its sources, for the self rule's `.claude` check (null when the command is not one of those). */
export function copyEnds(seg: Segment): { dest: Word; sources: Word[] } | null {
  const name = commandName(seg.argv[0]), args = seg.argv.slice(1), d = seg.dialect;
  if (seg.dialect === 'powershell') {
    const canon = PS_ALIAS[name] ?? name;
    if (!['copy-item', 'move-item'].includes(canon)) return null;
    const info = psWrite(seg);
    const dest = info.targets[info.targets.length - 1];
    return dest ? { dest, sources: seg.argv.slice(1).filter(w => !w.text.startsWith('-') && w !== dest) } : null;
  }
  if (name === 'ln') { const ops = operandsOf(args, name, d); return ops.length >= 2 ? { dest: ops[ops.length - 1], sources: ops.slice(0, -1) } : null; }
  if (name === 'robocopy') { const ops = operandsOf(args, name, d); return ops[1] ? { dest: ops[1], sources: [ops[0]] } : null; }
  if (name === 'rsync') { const ops: Word[] = []; for (let k = 0; k < args.length; k++) { if (RSYNC_VALUED.has(args[k].text)) { k++; continue; } if (!isSwitch(args[k], name, d)) ops.push(args[k]); } return ops.length ? { dest: ops[ops.length - 1], sources: ops.slice(0, -1) } : null; }
  if (COPY.has(name) || name === 'mv' || name === 'move') {
    const td = targetDir(args), ops = operandsOf(args, name, d);
    const dest = td ?? (ops.length ? ops[ops.length - 1] : null);
    return dest ? { dest, sources: td ? ops : ops.slice(0, -1) } : null;
  }
  return null;
}

/** The non-flag, non-dynamic operand words of a segment (what T4-UNKNOWN-CMD judges for a command in no table). */
export function plainOperands(seg: Segment): Word[] {
  const name = commandName(seg.argv[0]);
  return seg.argv.slice(1).filter(w => !isSwitch(w, name, seg.dialect) && !w.dynamic);
}

// PowerShell cmdlets whose pipeline input is the items (paths) they act on (deleted, moved, renamed) — not content (T4-PIPE-FED).
const PS_PIPE_ITEM = new Set(['remove-item', 'move-item', 'rename-item', 'clear-content', 'set-item']);
export function isPsPipeItem(seg: Segment): boolean {
  return seg.dialect === 'powershell' && seg.argv.length > 0 && PS_PIPE_ITEM.has(PS_ALIAS[commandName(seg.argv[0])] ?? commandName(seg.argv[0]));
}

/** New-Item's -Path joined to -Name, for the self rule (so `-Path .claude -Name settings.local.json` is seen). */
export function newItemName(seg: Segment): Word | null {
  if (seg.dialect !== 'powershell' || (PS_ALIAS[commandName(seg.argv[0])] ?? commandName(seg.argv[0])) !== 'new-item') return null;
  let p: Word | undefined, nm: Word | undefined;
  const args = seg.argv.slice(1);
  for (let k = 0; k < args.length; k++) {
    const glued = /^-([A-Za-z][\w-]*):(.*)$/s.exec(args[k].text);
    let pname: string | null = null, value: Word | undefined;
    if (glued) { pname = glued[1].toLowerCase(); value = word(glued[2], args[k].dynamic); }
    else { const bare = /^-([A-Za-z][\w-]*)$/.exec(args[k].text); if (bare && args[k + 1]) { pname = bare[1].toLowerCase(); value = args[k + 1]; } }
    if (!pname || !value) continue;
    const res = resolveParam(PS_CMDLETS['new-item'], pname);
    if (res === 'path') p = value;
    else if (res === 'name') nm = value;
  }
  if (p && nm) return word(p.text.replace(/[\\/]+$/, '') + '/' + nm.text, p.dynamic || nm.dynamic);
  return null;
}
