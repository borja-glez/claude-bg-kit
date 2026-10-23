// Plan 6b-1, final fix (T6-MACHINE-RULE; final review I3 and m2): the ninth autonomy rule, `machine`. Besides files and
// databases, a run never reaches what is the person's on this machine: their processes (a kill by name, by process group
// or of every process; a kill of a pid the run started stays allowed), their services (a stop, restart, enable, disable or
// mask), the machine's power, and their user-level setup (environment variables, scheduled jobs, the registry, the package
// managers' config). git's config is the git rule's: it already denies every config write, so it is judged in one place.
// Pure: reads no file, starts no process. Listed last in AUTONOMY_RULES and re-exported from autonomy-rules.ts.
import type { GuardRule, GuardVerdict } from './guard.js';
import { commandName, type Segment, type Word } from './shell-words.js';
import { bashSegments, deny } from './autonomy-shared.js';
import { scan, T } from './autonomy-tables.js';

const INSTEAD = 'this reaches processes, services or settings outside the run; stop what the run started by its pid, and keep settings inside the worktree';

const lower = (w: Word | undefined): string => w?.text.toLowerCase() ?? '';
/** The words of a call that are no option (`-x`, `/x`), lower-cased: where its verbs are. */
const plain = (args: Word[]): string[] => args.filter(w => !/^[-/]/.test(w.text)).map(w => w.text.toLowerCase());
/** Whether a typed PowerShell parameter (`-Na`, `-Name:x`) is a prefix of one of `names`. */
const psParam = (w: Word, names: readonly string[]): boolean => {
  const m = /^-([A-Za-z]+)(?::|$)/.exec(w.text);
  return !!m && names.some(n => n.startsWith(m[1].toLowerCase()));
};

// ---- processes ------------------------------------------------------------------------------------------------------

const KILL_BY_NAME = new Set(['pkill', 'killall', 'killall5', 'skill']);
const STOP_PROCESS = new Set(['stop-process', 'spps']);
// The commands that pick processes by name: a kill given their pids is a kill by name (`kill $(pgrep node)`).
const LISTERS = new Set(['pgrep', 'pidof', 'ps', 'get-process', 'gps', 'tasklist']);
const LISTER_IN = /(?:^|[\s(|;&`])(?:pgrep|pidof|ps|get-process|gps|tasklist)(?=[\s|;&)`]|$)/i;

/** Whether a pipeline feeds this segment from a command that lists processes (`pgrep node | xargs kill`). */
function fedByLister(segs: Segment[], i: number): boolean {
  for (let j = i; j > 0 && segs[j].after === '|'; j--) if (segs[j - 1].argv.length && LISTERS.has(commandName(segs[j - 1].argv[0]))) return true;
  return false;
}

/** A kill's targets past its signal option (`-9`, `-KILL`, `-s SIG`, `-n NUM`) and `--`; null for a listing (`-l`, `-L`). */
function killTargets(args: Word[]): Word[] | null {
  const t0 = args[0]?.text ?? '';
  if (t0 === '-l' || t0 === '-L') return null;
  let i = t0 === '-s' || t0 === '-n' ? 2 : t0.length > 1 && t0.startsWith('-') && t0 !== '--' ? 1 : 0;
  if (args[i]?.text === '--') i++;
  return args.slice(i);
}

/** What a kill (bash's, util-linux's or MSYS's) reaches past the run's own pids; null when every target is a pid or a job. */
function kill(seg: Segment, segs: Segment[], i: number): string | null {
  const targets = killTargets(seg.argv.slice(1));
  if (!targets) return null;
  if (seg.dynamicArgs && fedByLister(segs, i)) return 'kill is given the pids of a search by name, which may be the person\'s processes';
  for (const w of targets) {
    if (w.dynamic) { if (LISTER_IN.test(w.text)) return 'kill is given the pids of a search by name, which may be the person\'s processes'; continue; }
    if (/^-\d+$/.test(w.text) || w.text === '0') return `kill ${w.text} signals a whole process group or every process of the person`;
    if (!/^\d+$/.test(w.text) && !w.text.startsWith('%')) return `kill ${w.text} signals processes by name, which may be the person's`;
  }
  return null;
}

/** Stop-Process by name, by the objects a pipeline or -InputObject hands it, or by ids a search by name found. */
function stopProcess(seg: Segment): string | null {
  if (seg.after === '|') return 'Stop-Process fed by a pipeline stops the processes it is handed, which may be the person\'s';
  for (const w of seg.argv.slice(1)) {
    if (psParam(w, ['name', 'processname', 'inputobject'])) return `Stop-Process ${w.text} stops processes by name, which may be the person's`;
    if (w.dynamic && LISTER_IN.test(w.text)) return 'Stop-Process is given the ids of a search by name, which may be the person\'s processes';
  }
  return null;
}

// ---- services and power ---------------------------------------------------------------------------------------------

// systemctl's options (systemd 256), for finding its verb; an option outside them hides which word the verb is.
const SYSTEMCTL = T(`-H= --host= -M= --machine= -C= --capsule= -t= --type= --state= -p= --property= -P= -a --all -r --recursive --reverse --after --before
  --with-dependencies -l --full --value --show-types --job-mode= -T --show-transaction -i --ignore-inhibitors -s= --signal= --kill-whom= --kill-value= --what= -f --force
  --message= --now --root= --image= --image-policy= --runtime --preset-mode= -n= --lines= -o= --output= --firmware-setup --plain --timestamp= --mkdir --marked --read-only
  --drop-in= --when= --user --system --global -q --quiet --no-block --wait --no-wall --no-reload --no-ask-password --no-pager --no-legend --legend= --check-inhibitors=
  --failed --dry-run -h --help --version`);
// The systemctl verbs that read, start or reload; any other (stop, restart, kill, enable, disable, mask, isolate, poweroff, edit…) changes a service or the machine.
const SYSTEMCTL_OK = new Set(['status', 'show', 'cat', 'help', 'list-units', 'list-unit-files', 'list-sockets', 'list-timers', 'list-jobs', 'list-dependencies',
  'list-machines', 'list-automounts', 'list-paths', 'is-active', 'is-enabled', 'is-failed', 'is-system-running', 'get-default', 'show-environment', 'start', 'reload',
  'daemon-reload', 'reset-failed', 'whoami']);
const SERVICE_OK = new Set(['status', 'start', 'reload', 'help']);
const PG_STOP = new Set(['stop', 'restart', 'kill', 'register', 'unregister']);
const SC_WRITES = new Set(['stop', 'pause', 'config', 'delete', 'create', 'failure', 'control', 'sdset']);
const LAUNCHCTL_WRITES = new Set(['unload', 'bootout', 'load', 'bootstrap', 'remove', 'stop', 'kill', 'disable', 'enable', 'submit']);
const PS_SERVICES = new Set(['stop-service', 'spsv', 'restart-service', 'set-service', 'suspend-service', 'remove-service', 'new-service']);
const POWER = new Set(['shutdown', 'reboot', 'poweroff', 'halt', 'stop-computer', 'restart-computer']);

/** What a service or power command does to the machine; null when it only reads or starts. */
function service(name: string, seg: Segment): string | null {
  const args = seg.argv.slice(1), ws = plain(args);
  if (POWER.has(name)) return `${name} powers off or restarts this machine`;
  if (PS_SERVICES.has(name)) return `${seg.argv[0].text} changes a service of this machine`;
  if (name === 'systemctl') {
    const sc = scan(args, SYSTEMCTL, seg.dialect), verb = sc.ops[0];
    if (sc.unknown) return 'systemctl has an option the hook does not know, so the verb it runs cannot be read';
    return verb && (verb.dynamic || !SYSTEMCTL_OK.has(lower(verb))) ? `systemctl ${verb.text} changes a service of this machine, or the machine` : null;
  }
  if (name === 'service' && ws[1] !== undefined && !SERVICE_OK.has(ws[1])) return `service ${ws[0]} ${ws[1]} changes a service of this machine`;
  if ((name === 'pg_ctl' || name === 'pg_ctlcluster') && ws.some(w => PG_STOP.has(w))) return `${name} ${ws.find(w => PG_STOP.has(w))} acts on a database server of this machine`;
  if ((name === 'net' || name === 'net1') && (ws[0] === 'stop' || ws[0] === 'pause')) return `net ${ws[0]} changes a service of this machine`;
  // in PowerShell `sc` is Set-Content; sc.exe is the service tool
  const scExe = seg.dialect !== 'powershell' || /\.exe$/i.test(seg.argv[0].text);
  if (name === 'sc' && scExe && SC_WRITES.has(ws[0] ?? '')) return `sc ${ws[0]} changes a service of this machine`;
  if (name === 'launchctl' && LAUNCHCTL_WRITES.has(ws[0] ?? '')) return `launchctl ${ws[0]} changes a service of this machine`;
  if (name === 'brew' && ws[0] === 'services' && ['stop', 'restart', 'kill'].includes(ws[1] ?? '')) return `brew services ${ws[1]} changes a service of this machine`;
  return null;
}

// ---- persistence and user-level settings ----------------------------------------------------------------------------

const CRONTAB = T('-u= -l -r -e -i -s -n= -c -T -V --help --version');
const REG_WRITES = new Set(['add', 'delete', 'import', 'copy', 'restore', 'load', 'unload']);
const SCHTASKS_WRITES = /^[/-](?:create|delete|change|run|end)$/i;
const PS_TASKS = new Set(['register-scheduledtask', 'unregister-scheduledtask', 'set-scheduledtask', 'start-scheduledtask', 'stop-scheduledtask', 'enable-scheduledtask',
  'disable-scheduledtask']);
const PMS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const CONFIG_WRITES = new Set(['set', 'delete', 'rm', 'del', 'unset', 'edit', 'fix']);
// The package managers' options that take a value, so the word after them is not read as their command.
const PM_VALUED = new Set(['--location', '-L', '--userconfig', '--globalconfig', '--prefix', '-C', '--dir', '--cwd', '-w', '--workspace', '--filter', '-F', '--registry',
  '--cache', '--loglevel']);
const SET_ENV = /\[(?:system\.)?environment\]::setenvironmentvariable\s*\(([\s\S]*)\)/i;

/** The arguments of a .NET call's text, split at the commas outside quotes and brackets. */
function callArgs(inner: string): string[] {
  const out: string[] = [];
  let depth = 0, quote = '', cur = '';
  for (const c of inner) {
    if (quote) { if (c === quote) quote = ''; cur += c; continue; }
    if (c === "'" || c === '"') quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** `[Environment]::SetEnvironmentVariable(name, value, target)` with a target that is not the process (User, Machine, or one only the shell knows). */
function setsUserEnv(seg: Segment): boolean {
  return seg.argv.some(w => {
    const m = SET_ENV.exec(w.text);
    if (!m) return false;
    const target = callArgs(m[1])[2];
    return target !== undefined && !/^(?:['"]process['"]|\[(?:system\.)?environmentvariabletarget\]::process)$/i.test(target);
  });
}

/** A package manager's command words, past its own options and their values. */
function pmWords(args: Word[]): string[] {
  const out: string[] = [];
  for (let k = 0; k < args.length; k++) { const t = args[k].text; if (PM_VALUED.has(t)) { k++; continue; } if (!t.startsWith('-')) out.push(t.toLowerCase()); }
  return out;
}
const projectScoped = (args: Word[]): boolean => args.some((w, k) => w.text === '--local' || /^--location=project$/i.test(w.text)
  || ((w.text === '--location' || w.text === '-L') && lower(args[k + 1]) === 'project'));

/** pip's arguments, also behind `python -m pip`; null when the call is no pip. */
function pipArgs(name: string, args: Word[]): Word[] | null {
  if (/^pip[0-9.]*$/.test(name)) return args;
  if (!/^(?:python[0-9.]*|py)$/.test(name)) return null;
  const m = args.findIndex(w => w.text === '-m' || /^-mpip[0-9.]*$/.test(w.text));
  if (m < 0) return null;
  if (args[m].text !== '-m') return args.slice(m + 1);
  return /^pip[0-9.]*$/.test(lower(args[m + 1])) ? args.slice(m + 2) : null;
}

/** What a call changes of the person's user-level setup; null when it reads, or keeps the setting inside the run. */
function setting(name: string, seg: Segment): string | null {
  const args = seg.argv.slice(1), ws = plain(args);
  if (name === 'setx') return 'setx sets an environment variable of the person that outlives the run';
  if (name === 'crontab') { const sc = scan(args, CRONTAB, seg.dialect); return sc.unknown || !sc.flags.has('-l') || sc.ops.length ? 'crontab changes the person\'s scheduled jobs' : null; }
  if (name === 'reg' && REG_WRITES.has(ws[0] ?? '')) return `reg ${ws[0]} changes the registry`;
  if (name === 'schtasks') { const w = args.find(x => SCHTASKS_WRITES.test(x.text)); if (w) return `schtasks ${w.text} changes the person's scheduled tasks`; }
  if (PS_TASKS.has(name)) return `${seg.argv[0].text} changes the person's scheduled tasks`;
  if (PMS.has(name)) {
    const pw = pmWords(args);
    const writes = ((pw[0] === 'config' || pw[0] === 'c') && CONFIG_WRITES.has(pw[1] ?? '')) || (name === 'npm' && pw[0] === 'set');
    if (writes && !projectScoped(args)) return `${name} config writes the person's ${name} settings`;
  }
  const pip = pipArgs(name, args);
  if (pip) {
    const pw = plain(pip), ci = pw.indexOf('config');
    if (ci >= 0 && ['set', 'unset', 'edit'].includes(pw[ci + 1] ?? '') && !pip.some(w => w.text === '--site')) return 'pip config writes the person\'s pip settings';
  }
  return null;
}

// ---- the rule -------------------------------------------------------------------------------------------------------

/** What one segment reaches of the person's processes, services or settings; null when nothing. */
function reach(segs: Segment[], i: number): string | null {
  const seg = segs[i];
  if (!seg.argv.length) return null;
  // a .NET call is a word the shell evaluates: read it before the dynamic-name skip
  if (seg.dialect === 'powershell' && setsUserEnv(seg)) return 'SetEnvironmentVariable with a User or Machine target changes the person\'s environment';
  if (seg.argv[0].dynamic) return null;
  const name = commandName(seg.argv[0]), ps = seg.dialect === 'powershell';
  if (KILL_BY_NAME.has(name)) return `${name} stops processes by name, which may be the person's`;
  if (name === 'taskkill') { const w = seg.argv.slice(1).find(x => /^[/-](?:im|fi)$/i.test(x.text)); if (w) return `taskkill ${w.text} stops processes by name or filter, which may be the person's`; }
  if (STOP_PROCESS.has(name) || (ps && name === 'kill')) { const s = stopProcess(seg); if (s || STOP_PROCESS.has(name)) return s; }
  if (name === 'kill') { const k = kill(seg, segs, i); if (k) return k; }
  return service(name, seg) ?? setting(name, seg);
}

export const machineRule: GuardRule = {
  id: 'machine',
  check(input, ctx): GuardVerdict | null {
    if (!ctx.autonomous) return null;
    const segs = bashSegments(input, ctx);
    if (!segs) return null;
    for (let i = 0; i < segs.length; i++) { const what = reach(segs, i); if (what) return deny('machine', what, INSTEAD); }
    return null;
  },
};
