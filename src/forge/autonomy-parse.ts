// Plan 6b-1, Task 4 (fix 2, T4-FAILCLOSED): the write-target parser the `files` and `self` rules use. The direction is
// fail-closed: a write-class segment's words are all candidate targets, and a word is EXEMPTED only when the command's own
// option table positively identifies it as a source, content or script. An option the table does not know cancels every
// exemption (FC3: the bash tables live in autonomy-tables.ts, the cmdlet tables below), so a parsing miss becomes a deny
// with a clear reason, not a hole. Pure: reads no file, starts no process.
import path from 'node:path';
import { commandName, type Dialect, type Segment, type Word } from './shell-words.js';
import { segmentPath } from './autonomy-shared.js';
import { BASH_TABLES, DD_KEYS, scan, type Scan } from './autonomy-tables.js';

/** What a write-class segment would write: the words to judge as targets. `writer` is false when the segment is no writer. */
export interface WriteInfo { writer: boolean; targets: Word[] }

const word = (text: string, dynamic = false): Word => ({ text, dynamic, glob: false });
const val = (w: Word, from: number): Word => ({ text: w.text.slice(from), dynamic: w.dynamic, glob: false });
const NONE: WriteInfo = { writer: false, targets: [] };

// ---- bash / cmd ------------------------------------------------------------------------------------------------------

// Commands whose `/x` words are switches in every dialect (an unknown command's `/x` in bash is a path: plainOperands).
const SLASH_SWITCH = new Set(Object.keys(BASH_TABLES).filter(n => Object.keys(BASH_TABLES[n].opts).some(k => k.startsWith('/'))));
// Writers whose every operand is a target (delete, move, in-place metadata, create-empty, link).
const ALL_OPERANDS = new Set(['rm', 'rmdir', 'unlink', 'shred', 'truncate', 'del', 'erase', 'rd', 'mv', 'move', 'ren', 'rename', 'attrib', 'touch', 'mkdir', 'md', 'tee', 'mklink']);
// curl's options that name a file it writes (FC5); -O/-J/--remote-name-all and --output-dir write into a directory.
const CURL_OUT = ['-o', '--output', '-D', '--dump-header', '-c', '--cookie-jar', '--trace', '--trace-ascii', '--stderr', '--libcurl', '--etag-save', '--hsts', '--alt-svc', '--ssl-sessions'];
const CURL_CWD = ['-O', '--remote-name', '-J', '--remote-header-name', '--remote-name-all'];
const WGET_OUT = ['-o', '--output-file', '-a', '--append-output', '--rejected-log', '--save-cookies', '--hsts-file', '--warc-file', '--warc-tempdir'];
const TAR_OUT = ['-g', '--listed-incremental', '--index-file'];
const RSYNC_OUT = ['--log-file', '--backup-dir', '--partial-dir', '--temp-dir', '-T', '--write-batch', '--only-write-batch'];
const ROBOCOPY_OUT = ['/log:', '/log+:', '/unilog:', '/unilog+:', '/save:'];

/** A switch, not an operand: a `-flag`, or a single-segment `/switch` in cmd or after a command that takes them (in Bash `/c/x` keeps its path). */
function isSwitch(w: Word, name: string, d: Dialect): boolean {
  const t = w.text;
  if (t.startsWith('-')) return true;
  if (!t.startsWith('/')) return false;
  if (d === 'cmd') return t.length > 1;
  return SLASH_SWITCH.has(name) && !t.slice(1).includes('/');
}

/** Whether a segment's command is one the write-target parser knows (a writer table or a PowerShell cmdlet), even if this call writes nothing. */
export function knownWriteCommand(seg: Segment): boolean {
  if (!seg.argv.length) return false;
  const name = commandName(seg.argv[0]);
  return seg.dialect === 'powershell' ? isPsCmdlet(name) : BASH_TABLES[name] !== undefined || name === 'fsutil';
}

const notStdout = (ws: Word[]): Word[] => ws.filter(w => w.text !== '-');
const CHMOD_MODE = /^-[rwxXstugo]+$/;

/** The scan of a bash writer's arguments: tar's old-style first word is a bundle, chmod's `-w`-like mode is an operand. */
function scanArgs(name: string, args: Word[], d: Dialect): { sc: Scan; mode: Word | null } {
  let mode: Word | null = null;
  if (name === 'tar' && args.length && /^[A-Za-z]+$/.test(args[0].text)) args = [word('-' + args[0].text, args[0].dynamic), ...args.slice(1)];
  if (name === 'chmod' && !args.some(w => w.text.startsWith('--reference'))) { const k = args.findIndex(w => CHMOD_MODE.test(w.text)); if (k >= 0) { mode = args[k]; args = [...args.slice(0, k), ...args.slice(k + 1)]; } }
  return { sc: scan(args, BASH_TABLES[name], d), mode };
}

/** Every candidate of a scan, no exemption: operands, option values and the words of unknown options (FC3 cancel). */
const allCandidates = (sc: Scan): Word[] => [...sc.ops, ...sc.vals.map(v => v.w), ...sc.stray];

function bashWrite(seg: Segment): WriteInfo {
  const name = commandName(seg.argv[0]), args = seg.argv.slice(1), d = seg.dialect;
  if (name === 'fsutil') return { writer: true, targets: args.slice(2).filter(w => !isSwitch(w, name, d)) }; // fsutil <object> <verb> <paths…>
  if (!BASH_TABLES[name]) return NONE;
  const { sc, mode } = scanArgs(name, args, d);
  const W = (targets: Word[]): WriteInfo => ({ writer: true, targets });
  if (name === 'dd') {
    // dd's `key=value` operands: `of` is written, an unknown key cancels like an unknown option (every value is then judged)
    const values: Word[] = [], out: Word[] = []; let unknown = sc.unknown;
    for (const w of sc.ops) { const m = /^([a-z]+)=(.*)$/s.exec(w.text); if (!m || !DD_KEYS.has(m[1])) unknown = true; const v = m ? val(w, m[1].length + 1) : w; values.push(v); if (m?.[1] === 'of') out.push(v); }
    return unknown ? W([...values, ...sc.vals.map(v => v.w), ...sc.stray]) : out.length ? W(out) : NONE;
  }
  if (sc.unknown) return W(allCandidates(sc)); // FC3 / T4-FC5-CATCHALL: an unknown option cancels every exemption
  const ops = sc.ops;
  const V = (...keys: string[]): Word[] => sc.vals.filter(v => keys.includes(v.key)).map(v => v.w);
  const has = (...keys: string[]): boolean => keys.some(k => sc.flags.has(k));
  const last = (): Word[] => (ops.length ? [ops[ops.length - 1]] : []);
  if (ALL_OPERANDS.has(name)) return W([...ops, ...V('-t', '--target-directory')]);
  if (name === 'chmod' || name === 'chown' || name === 'chgrp') return W(has('--reference') || mode ? ops : ops.slice(1)); // the mode / owner operand is no path
  if (name === 'icacls') return W([...ops.slice(0, 1), ...V('/save')]);
  if (name === 'ln') {
    const targets = [...ops, ...V('-t', '--target-directory')];
    // a symlink's target is relative to the link's own folder, not the segment cwd (judge it there too)
    if (ops.length >= 2 && !ops[0].dynamic && !ops[ops.length - 1].dynamic) {
      const lp = segmentPath(ops[ops.length - 1], seg);
      if (lp) { const abs = segmentPath(ops[0], { ...seg, cwd: path.dirname(lp) }); if (abs) targets.push(word(abs)); }
    }
    return W(targets);
  }
  if (name === 'cp' || name === 'install') {
    const td = V('-t', '--target-directory');
    const link = name === 'cp' && has('-l', '--link', '-s', '--symbolic-link'); // a copy through a link reaches the sources
    if (link || (name === 'install' && has('-d', '--directory'))) return W([...td, ...ops]);
    return W(td.length ? td : last());
  }
  if (name === 'copy' || name === 'xcopy') return W(name === 'xcopy' ? ops.slice(1, 2) : last());
  if (name === 'robocopy') return W([...ops.slice(1, 2), ...(has('/mov', '/move') ? ops.slice(0, 1) : []), ...V(...ROBOCOPY_OUT)]);
  if (name === 'rsync') return W([...(has('--remove-source-files') ? ops : last()), ...V(...RSYNC_OUT)]);
  if (name === 'tar') {
    const out = V(...TAR_OUT);
    if (has('-x', '--extract', '--get')) return W([...V('-C', '--directory'), ...out]);
    if (has('-c', '--create', '-r', '--append', '-u', '--update', '-A', '--catenate', '--concatenate', '--delete')) return W([...notStdout(V('-f', '--file')), ...out]);
    return out.length ? W(out) : NONE;
  }
  if (name === 'unzip') return W(V('-d'));
  if (name === '7z') {
    const sub = (ops[0]?.text ?? '').toLowerCase(), work = V('-w').filter(w => w.text);
    if (sub === 'x' || sub === 'e') return W([...V('-o'), ...work]);
    if (['a', 'u', 'd', 'rn'].includes(sub)) return W([...ops.slice(1, 2), ...work]);
    if (['l', 't', 'h', 'i', 'b'].includes(sub)) return work.length ? W(work) : NONE;
    return W([...ops, ...work]);
  }
  if (name === 'sort') { const t = [...V('-o', '--output'), ...V('-T', '--temporary-directory')]; return t.length ? W(t) : NONE; }
  if (name === 'curl') {
    const out = notStdout(V(...CURL_OUT)), dir = V('--output-dir');
    return out.length || dir.length || has(...CURL_CWD) ? W([...out, ...dir]) : NONE;
  }
  if (name === 'wget') {
    const o = notStdout(V('-O', '--output-document')), p = V('-P', '--directory-prefix');
    const download = has('-O', '--output-document') ? o : p;
    return W([...download, ...V(...WGET_OUT)]);
  }
  if (name === 'patch') return W([...V('-o', '--output', '-d', '--directory', '-r', '--reject-file'), ...ops.slice(0, 1)]);
  if (name === 'sed' || name === 'gsed' || name === 'perl' || name === 'ruby') {
    // sed/perl/ruby -i: the script is the -e/-f value, else the first operand; the other operands are the files edited in place
    const perl = name === 'perl' || name === 'ruby';
    if (!has('-i', '--in-place')) return NONE;
    const script = perl ? has('-e', '-E') : has('-e', '--expression', '-f', '--file');
    return W(script ? ops : ops.slice(1));
  }
  if (name === 'find') {
    const starts = ops.filter(w => !/^[()!,]$/.test(w.text));
    const out = [...V('-fprint', '-fprint0', '-fls'), ...V('-fprintf').slice(0, 1)];
    if (!has('-delete') && !out.length) return NONE;
    return W([...(has('-delete') ? starts : []), ...out]);
  }
  return W(ops);
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
const itemP: Record<string, PK> = { filter: 'v', include: 'v', exclude: 'v', force: 'w', credential: 'v', usetransaction: 'w' };
// The documented parameter sets of PowerShell 7.4 and Windows PowerShell 5.1 (T4-PS-TABLES), provider dynamic parameters included.
const webP: Record<string, PK> = {
  uri: 's', outfile: 'p', infile: 's', method: 'v', custommethod: 'v', body: 'v', form: 'v', headers: 'v', contenttype: 'v', credential: 'v', authentication: 'v', token: 'v',
  certificate: 'v', certificatethumbprint: 'v', sslprotocol: 'v', useragent: 'v', websession: 'v', sessionvariable: 'v', proxy: 'v', proxycredential: 'v', transferencoding: 'v',
  timeoutsec: 'v', connectiontimeoutseconds: 'v', operationtimeoutseconds: 'v', maximumredirection: 'v', maximumretrycount: 'v', retryintervalsec: 'v', httpversion: 'v', unixsocket: 'v',
  usebasicparsing: 'w', usedefaultcredentials: 'w', allowunencryptedauthentication: 'w', skipcertificatecheck: 'w', disablekeepalive: 'w', skipheadervalidation: 'w',
  allowinsecureredirect: 'w', preserveauthorizationonredirect: 'w', preservehttpmethodonredirect: 'w', noproxy: 'w', proxyusedefaultcredentials: 'w', passthru: 'w', resume: 'w', skiphttperrorcheck: 'w',
};
const PS_CMDLETS: Record<string, Spec> = {
  'remove-item': P({ ...pathP, ...itemP, recurse: 'w', stream: 'v' }, ['p']),
  'clear-content': P({ ...pathP, ...itemP, stream: 'v' }, ['p']),
  'set-content': P({ ...pathP, ...itemP, value: 'c', encoding: 'v', nonewline: 'w', stream: 'v', asbytestream: 'w', passthru: 'w' }, ['p', 'c']),
  'add-content': P({ ...pathP, ...itemP, value: 'c', encoding: 'v', nonewline: 'w', stream: 'v', asbytestream: 'w', passthru: 'w' }, ['p', 'c']),
  'set-item': P({ ...pathP, ...itemP, value: 'c', passthru: 'w', type: 'v', options: 'v' }, ['p', 'c']),
  'out-file': P({ filepath: 'p', literalpath: 'p', path: 'p', inputobject: 'c', encoding: 'v', width: 'v', append: 'w', force: 'w', nonewline: 'w', noclobber: 'w' }, ['p']),
  'tee-object': P({ filepath: 'p', literalpath: 'p', path: 'p', inputobject: 'c', variable: 'v', encoding: 'v', append: 'w' }, ['p']),
  'new-item': P({ path: 'p', name: 'p', value: 'c', target: 'c', itemtype: 'v', type: 'v', force: 'w', credential: 'v', usetransaction: 'w', options: 'v' }, ['p'], { itemType: true }),
  'export-csv': P({ ...pathP, inputobject: 'c', delimiter: 'v', encoding: 'v', notypeinformation: 'w', includetypeinformation: 'w', append: 'w', force: 'w', noclobber: 'w', usequotes: 'v', quotefields: 'v', useculture: 'w', noheader: 'w' }, ['p']),
  'export-clixml': P({ ...pathP, inputobject: 'c', depth: 'v', encoding: 'v', force: 'w', noclobber: 'w' }, ['p']),
  'copy-item': P({ path: 's', literalpath: 's', pspath: 's', lp: 's', destination: 'p', ...itemP, recurse: 'w', container: 'w', passthru: 'w', fromsession: 'v', tosession: 'v' }, ['s', 'p']),
  'move-item': P({ ...pathP, destination: 'p', ...itemP, passthru: 'w' }, ['p', 'p']),
  'rename-item': P({ ...pathP, newname: 'v', force: 'w', passthru: 'w', credential: 'v', usetransaction: 'w' }, ['p', 'v']),
  'expand-archive': P({ path: 's', literalpath: 's', destinationpath: 'p', force: 'w', passthru: 'w' }, ['s', 'p']),
  'compress-archive': P({ path: 's', literalpath: 's', destinationpath: 'p', compressionlevel: 'v', update: 'w', force: 'w', passthru: 'w' }, ['s', 'p']),
  'start-bitstransfer': P({
    source: 's', destination: 'p', transfertype: 'v', priority: 'v', credential: 'v', displayname: 'v', description: 'v', authentication: 'v', customheaders: 'v', httpmethod: 'v',
    notifycmdline: 'v', notifyflags: 'v', proxyauthentication: 'v', proxybypass: 'v', proxycredential: 'v', proxylist: 'v', proxyusage: 'v', retryinterval: 'v', retrytimeout: 'v',
    securityflags: 'v', transferpolicy: 'v', certstorelocation: 'v', certstorename: 'v', certhash: 'v', certsubjectname: 'v', asynchronous: 'w', dynamic: 'w', suspended: 'w', usestoredcredential: 'v',
  }, ['s', 'p']),
  'invoke-webrequest': P(webP, ['s'], { always: false, writerParam: 'outfile' }),
  'invoke-restmethod': P({ ...webP, followrellink: 'w', maximumfollowrellink: 'v', responseheadersvariable: 'v', statuscodevariable: 'v' }, ['s'], { always: false, writerParam: 'outfile' }),
};

/** Resolve a typed PowerShell parameter name (or unambiguous prefix) against this cmdlet's parameters and the common ones. */
function resolveParam(spec: Spec, nm: string): string | null {
  if (spec.params[nm] !== undefined) return nm;
  if (COMMON[nm] !== undefined) return nm;
  const keys = [...Object.keys(spec.params), ...Object.keys(COMMON)].filter(k => k.startsWith(nm));
  return keys.length === 1 ? keys[0] : null;
}
const kindOf = (spec: Spec, p: string): PK => spec.params[p] ?? COMMON[p];

/** One positional of a bound cmdlet call: a plain argument, a splat (`@name`), or the glued value of a parameter the cmdlet does not have. */
interface PsPositional { w: Word; from: 'arg' | 'splat' | 'unknown' }
/** A cmdlet call bound to its parameters: the last value of each, every binding in order, the parameters seen, the positionals, and whether one was unknown. */
interface PsBound { named: Record<string, Word>; pairs: { p: string; v: Word }[]; seen: Set<string>; positionals: PsPositional[]; unknown: boolean }
/**
 * The one PowerShell parameter binder (M3: psWrite and readWebRequest share it). `-Name value` and `-Name:value`, the name
 * case-folded and resolved as an unambiguous prefix of this cmdlet's parameters or the common ones; a switch takes no value;
 * an unknown parameter is read as a switch (its glued value kept as a positional) and marks the call `unknown`.
 */
function bindParams(spec: Spec, args: Word[]): PsBound {
  const named: Record<string, Word> = {}, pairs: { p: string; v: Word }[] = [], seen = new Set<string>(), positionals: PsPositional[] = [];
  let unknown = false;
  const bind = (p: string, v: Word) => { named[p] = v; pairs.push({ p, v }); };
  for (let k = 0; k < args.length; k++) {
    const w = args[k], t = w.text;
    if (w.dynamic && /^@/.test(t)) { positionals.push({ w, from: 'splat' }); continue; } // a splat @name hides parameters
    const glued = /^-([A-Za-z][\w-]*):(.*)$/s.exec(t);
    if (glued) {
      const p = resolveParam(spec, glued[1].toLowerCase()), v = word(glued[2], w.dynamic);
      if (p) { seen.add(p); bind(p, v); } else { unknown = true; positionals.push({ w: v, from: 'unknown' }); }
      continue;
    }
    const bare = /^-([A-Za-z][\w-]*)$/.exec(t);
    if (bare) {
      const p = resolveParam(spec, bare[1].toLowerCase());
      if (!p) { unknown = true; continue; } // an unknown parameter is read as a switch and cancels exemptions
      seen.add(p);
      if (kindOf(spec, p) === 'w') continue;
      const nx = args[k + 1];
      if (nx && !nx.text.startsWith('-')) { bind(p, nx); k++; }
      continue;
    }
    positionals.push({ w, from: 'arg' });
  }
  return { named, pairs, seen, positionals, unknown };
}

function psWrite(seg: Segment): WriteInfo {
  const canon = PS_ALIAS[commandName(seg.argv[0])] ?? commandName(seg.argv[0]);
  const spec = PS_CMDLETS[canon];
  if (!spec) return NONE;
  const b = bindParams(spec, seg.argv.slice(1));
  const named = b.named, positionals = b.positionals.map(x => x.w), cancel = b.unknown;
  const hasWriterParam = spec.writerParam !== undefined && b.seen.has(spec.writerParam);
  const writer = spec.always || hasWriterParam || (spec.writerParam !== undefined && cancel);
  if (!writer) return NONE;
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

/** What Invoke-WebRequest / Invoke-RestMethod would do over the network (Task 5 reuses Task 4's cmdlet reading, T5-LESSONS 5). */
export interface WebReq { uri: Word | null; method: string; methodDynamic: boolean; hasBody: boolean; dynamicOther: boolean; unknownParam: boolean }
const WEB_CMDLETS = new Set(['invoke-webrequest', 'invoke-restmethod']);
/** Read a web-request segment with the cmdlet's own parameter set (abbreviation, `-Name:Value`, case, common parameters), or null when it is not one. */
export function readWebRequest(seg: Segment): WebReq | null {
  if (!seg.argv.length) return null;
  const canon = PS_ALIAS[commandName(seg.argv[0])] ?? commandName(seg.argv[0]);
  if (!WEB_CMDLETS.has(canon)) return null;
  const b = bindParams(PS_CMDLETS[canon], seg.argv.slice(1));
  let uri: Word | null = null, method = '', methodDynamic = false, hasBody = false;
  for (const { p, v } of b.pairs) {
    if (p === 'method' || p === 'custommethod') { if (v.dynamic) methodDynamic = true; else method = v.text.toUpperCase(); }
    else if (p === 'body' || p === 'form' || p === 'infile') hasBody = true;
    else if (p === 'uri') uri = v;
  }
  const args = b.positionals.filter(x => x.from === 'arg').map(x => x.w);
  if (!uri && args.length) uri = args[0];
  // a splat, or a dynamic positional other than the URI, hides what the call sends
  const dynamicOther = b.positionals.some(x => x.from === 'splat') || args.some(w => w !== uri && w.dynamic);
  return { uri, method, methodDynamic, hasBody, dynamicOther, unknownParam: b.unknown };
}

/** What a write-class segment would write. In the powershell dialect a known cmdlet is read by psWrite; an external command (robocopy, tar, …) by bashWrite. */
export function writeInfo(seg: Segment): WriteInfo {
  if (!seg.argv.length || seg.argv[0].dynamic) return NONE;
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
  if (!['ln', 'robocopy', 'rsync', 'cp', 'install', 'mv', 'move', 'copy', 'xcopy'].includes(name)) return null;
  const { sc } = scanArgs(name, args, d), ops = sc.ops;
  if (name === 'robocopy' || name === 'xcopy') return ops[1] ? { dest: ops[1], sources: [ops[0]] } : null;
  const td = sc.vals.find(v => v.key === '-t' || v.key === '--target-directory')?.w ?? null;
  const dest = td ?? (ops.length ? ops[ops.length - 1] : null);
  return dest ? { dest, sources: td ? ops : ops.slice(0, -1) } : null;
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
