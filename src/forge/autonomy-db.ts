// Plan 6b-1, Task 6: the `database` rule. An autonomous run reads any database; it writes only a database, container,
// volume or compose project it registered (FORGE resource add) on a local host, or a SQLite file inside its worktree.
// Fail-closed (T6-FAILCLOSED, the lesson of Tasks 4 and 5): a write is allowed only when its target is positively one of
// those. Each client is read with its own option table (`scan`): an option outside it cancels the «this only reads» answer
// and makes the target unknown; a word only the shell knows is unknown; SQL that acts past the registered target (another
// database, a reconnect, a server program or file, the whole cluster) is unknown too, and so is SQL that touches a file
// outside the run's roots (T6-SQL-FILES). A migration's target is read only from where the tool reads it (T6-MIGRATOR-TARGET);
// a database script's is never known (T6-SCRIPT-TARGET). Launchers are Task 5's effectiveCommand (T6-LAUNCHER-REUSE),
// the commands a container runs autonomy-shared.ts's containerSegments (T6-CONTAINER-INNER), the docker reading
// autonomy-docker.ts and the data autonomy-db-tables.ts. An MCP tool is judged by the SQL it is given (H9). Pure: reads no
// file, starts no process, opens no connection. It never imports autonomy-rules.ts, which lists it in AUTONOMY_RULES.
import type { GuardCtx, GuardInput, GuardRule, GuardVerdict } from './guard.js';
import { confinedIn } from './guard.js';
import { dbPrefix, dockerPrefix, isLocalHost, type ResourceKind } from './resources.js';
import { commandName, isNullSink, type Segment, type Word } from './shell-words.js';
import { bashSegments, deny, envUnknown, insideRoots, markEnvUnknown, mcpWords, resolvePwd, segmentPath, withContainers } from './autonomy-shared.js';
import { head, scan, type Scan } from './autonomy-tables.js';
import { effectiveCommand, MANAGERS, MCP_READ_FIRST, MCP_WRITE_WORDS, type Eff } from './autonomy-net.js';
import { dockerFinding } from './autonomy-docker.js';
import {
  CLIENTS, DB_CLIENTS, DB_GLUED, DB_TOOL_READ_LAST, DB_TOOL_WRITES, DB_WORDS, DOCKER_HOSTS, FOR_LOCK, GOOSE_DRIVERS, GOOSE_T, INFO_WORDS, INTERPRETERS, KIND, MAKES, MCP_DB_WORDS,
  META_READ, MIGRATORS, MONGO_REACH, MYSQL_ANYWHERE, MYSQL_STATEMENT, MYSQLADMIN_READ, PG_ANYWHERE, PG_STATEMENT, PM_OWN_COMMANDS, PM_RUN, PSQL_FILE_META,
  PSQL_SAFE_META, QUERY_FIELDS, READ_KEYWORDS, READ_START, REDIS_READ, REDIS_READ_MODES, SCHEME_KIND, SIDE_EFFECTS, SQL_FIELDS, SQL_SHAPES, SQLITE_FILE_DOT,
  SQLITE_REACH, SQLITE_SAFE_DOT, WITH_WRITES, type Client, type DbClient, type Migrator,
} from './autonomy-db-tables.js';
import { COMPOSE_CLIS, CONTAINER_CLIS } from './autonomy-tables.js';

// The brief's lists, kept in autonomy-db-tables.ts (T6-SPLIT).
export { DB_CLIENTS, MIGRATORS, PM_OWN_COMMANDS, DB_WORDS, DB_GLUED, DOCKER_DESTROYERS } from './autonomy-db-tables.js';

// ---- SQL as each server reads it ------------------------------------------------------------------------------------

// How a server reads quotes and comments: backslash escapes, dollar quotes, `#` comments, `--` needing a space after it,
// nested block comments, MySQL's executable `/*!` comments, backquoted and bracketed identifiers, and psql's meta commands
// (a backslash command takes the rest of its line as it is).
interface SqlDialect { bs: boolean; dollar: boolean; hash: boolean; dashSpace: boolean; nested: boolean; bang: boolean; tick: boolean; bracket: boolean; meta: boolean }
const PG: SqlDialect = { bs: false, dollar: true, hash: false, dashSpace: false, nested: true, bang: false, tick: false, bracket: false, meta: true };
const MYSQL: SqlDialect = { bs: true, dollar: false, hash: true, dashSpace: true, nested: false, bang: true, tick: true, bracket: false, meta: false };
const SQLITE: SqlDialect = { bs: false, dollar: false, hash: false, dashSpace: false, nested: false, bang: false, tick: true, bracket: true, meta: false };
/** SQL is read as each of these servers reads it, so a quote or a comment one of them reads differently cannot hide a write. */
const SQL_DIALECTS: readonly SqlDialect[] = [PG, MYSQL, SQLITE];

/** The index after the quote that closes the one at i (a doubled quote is part of the text); -1 when it never closes. */
function quoteEnd(s: string, i: number, q: string, bs: boolean): number {
  for (let j = i + 1; j < s.length; j++) {
    if (bs && s[j] === '\\') { j++; continue; }
    if (s[j] !== q) continue;
    if (q !== ']' && s[j + 1] === q) { j++; continue; }
    return j + 1;
  }
  return -1;
}

/** The index just past the end of the block comment opened at i; -1 when it never closes. */
function commentEnd(s: string, i: number, nested: boolean): number {
  let depth = 1;
  for (let j = i + 2; j < s.length - 1; j++) {
    if (s[j] === '*' && s[j + 1] === '/') { if (--depth === 0) return j + 2; j++; }
    else if (nested && s[j] === '/' && s[j + 1] === '*') { depth++; j++; }
  }
  return -1;
}

/** The SQL as one server reads it: a comment or a string literal becomes a space, a quoted identifier its own text; null when one never closes, or MySQL would run a comment (`/*!`). */
function sqlCode(sql: string, d: SqlDialect): string | null {
  let out = '';
  for (let i = 0; i < sql.length;) {
    const c = sql[i], n = sql[i + 1] ?? '';
    if (d.meta && c === '\\' && /[A-Za-z!?]/.test(n)) {
      const nl = sql.indexOf('\n', i), sep = sql.indexOf('\\\\', i + 1);
      const e = Math.min(nl < 0 ? sql.length : nl, sep < 0 ? sql.length : sep);
      out += sql.slice(i, e); i = e; continue;
    }
    if (c === "'" || (c === '"' && d.bs)) {
      const e = quoteEnd(sql, i, c, d.bs);
      if (e < 0) return null;
      out += ' '; i = e; continue;
    }
    if (c === '"' || (c === '`' && d.tick) || (c === '[' && d.bracket)) {
      const e = quoteEnd(sql, i, c === '[' ? ']' : c, false);
      if (e < 0) return null;
      out += ` ${sql.slice(i + 1, e - 1)} `; i = e; continue;
    }
    if (c === '$' && d.dollar && !/[\w$]/.test(sql[i - 1] ?? '')) {
      const tag = /^\$(?:[A-Za-z_]\w*)?\$/.exec(sql.slice(i));
      if (tag) {
        const e = sql.indexOf(tag[0], i + tag[0].length);
        if (e < 0) return null;
        out += ' '; i = e + tag[0].length; continue;
      }
    }
    if ((c === '-' && n === '-' && (!d.dashSpace || /^\s?$/.test(sql[i + 2] ?? ''))) || (c === '#' && d.hash)) {
      const e = sql.indexOf('\n', i);
      out += ' '; i = e < 0 ? sql.length : e; continue;
    }
    if (c === '/' && n === '*') {
      if (d.bang && sql[i + 2] === '!') return null;
      const e = commentEnd(sql, i, d.nested);
      if (e < 0) return null;
      out += ' '; i = e; continue;
    }
    out += c; i++;
  }
  return out;
}

/** The text in every server's reading, lower-cased; null when one of them cannot read it. */
function sqlCodes(sql: string): string[] | null {
  const codes = SQL_DIALECTS.map(d => sqlCode(sql, d)?.toLowerCase() ?? null);
  return codes.every((c): c is string => c !== null) ? codes : null;
}

/** The statements of a server's reading: split at `;` and at the `\g`/`\G` that ends one in psql and mysql. */
const statements = (code: string): string[] => code.split(/;|\\g(?![a-z])/);

function readStatement(st: string): boolean {
  const s = st.trim();
  if (!s || META_READ.test(s)) return true;
  if (s.includes('\\')) return false; // any other client command (\c, \!, \o, \gexec, \copy…)
  const first = /^[a-z_]+/.exec(s)?.[0] ?? '';
  if (!READ_START.has(first)) return false;
  if (/\binto\b/.test(s) || FOR_LOCK.test(s) || SIDE_EFFECTS.test(s)) return false;
  if (first === 'explain' && /\banaly[sz]e\b/.test(s)) return false; // EXPLAIN ANALYZE runs the statement
  return !(first === 'with' && WITH_WRITES.test(s));
}

/**
 * Whether SQL only reads: after its comments and literals, each statement starts with select, show, explain, describe or
 * with, or is a `\d…`, `\l`, `.tables` or `.schema` meta command; and none (M5) writes through INTO, FOR UPDATE/SHARE,
 * EXPLAIN ANALYZE, a data-changing CTE or a function with effects. Read as Postgres, MySQL and SQLite each read it.
 */
export function isReadSql(sql: string): boolean {
  const codes = sqlCodes(sql);
  return codes !== null && codes.every(code => statements(code).every(readStatement));
}

/** H8: a script whose name (lower-cased, split at `:` `.` `_` `/` `-`, and `\` for a Windows path) says it writes a database. */
export function isDbScript(name: string): boolean {
  const words = name.toLowerCase().split(/[:._/\\-]+/).filter(Boolean);
  if (words.some(w => DB_WORDS.has(w) || DB_GLUED.test(w) || w.startsWith('migrat'))) return true;
  return (words.includes('schema') || words.includes('db')) && words.some(w => w === 'sync' || w === 'push' || w === 'drop');
}

// ---- verdicts -------------------------------------------------------------------------------------------------------

// What else to do, by the kind of deny (T6-H8-COST, T6-COMPOSE-VOLUMES, T6-MIGRATOR-TARGET).
const MIGRATOR_FORMS = "a migration's database is read from its URL option (migrate -database, flyway -url, liquibase, drizzle-kit, sequelize-cli, atlas and "
  + 'prisma db execute --url, dbmate --url, diesel and sqlx --database-url, goose\'s DSN), from DATABASE_URL for rails, rake, dbmate, diesel and sqlx, '
  + "and from DATABASE_URL with DIRECT_URL (and SHADOW_DATABASE_URL for migrate dev) for prisma; any other migrator is the person's to run";
const HINTS = {
  // T6-H8-COST and T6-SCRIPT-TARGET: run the tool itself, its target visible
  script: `run the tool directly when the script only generates or inspects, and with its target visible on the command when it writes: ${MIGRATOR_FORMS}`,
  volumes: "remove the run's volumes by name with docker volume rm",
  // final fix I2 (T6-PRIVILEGED)
  host: 'run the container without host access: no --privileged or --device, no host --pid, --ipc, --uts, --userns or --cgroupns, no --cap-add of ALL, SYS_ADMIN, '
    + 'SYS_PTRACE, SYS_MODULE, SYS_RAWIO or DAC_READ_SEARCH, and no unconfined --security-opt',
  migrator: MIGRATOR_FORMS,
} as const;
type Hint = keyof typeof HINTS;
const instead = (ctx: GuardCtx, hint?: Hint): string => {
  const id = ctx.autonomous?.runId ?? '';
  const base = `register what you create with FORGE resource add (a name that starts with ${dbPrefix(id)} or ${dockerPrefix(id)}), then use that name; a script whose target you cannot see is never run`;
  return hint ? `${base}; ${HINTS[hint]}` : base;
};
const D = (ctx: GuardCtx, what: string, hint?: Hint): GuardVerdict => deny('database', what, instead(ctx, hint));
const U = (ctx: GuardCtx, what: string, hint?: Hint): GuardVerdict => D(ctx, `unknown target: ${what}`, hint);

type Target = { kind: ResourceKind; name: string; host: string | null };
/** A host of this machine for the database rule: a local host, or the name a container uses for the machine (T6-CONTAINER-INNER). */
const dbLocal = (h: string): boolean => isLocalHost(h) || DOCKER_HOSTS.has(h.toLowerCase());

/** Whether a target is the run's: a registered resource of its kind (a sqlite file by its path), or a sqlite file inside the worktree (confinedIn, B1). */
function owned(t: Target, ctx: GuardCtx): boolean {
  const a = ctx.autonomous!;
  if (t.kind === 'sqlite') {
    return (a.worktree !== '' && confinedIn(t.name, a.worktree)) || a.resources.some(r => r.kind === 'sqlite' && confinedIn(t.name, r.name) && confinedIn(r.name, t.name));
  }
  return a.resources.some(r => r.kind === t.kind && r.name === t.name);
}

function targetVerdict(t: Target, ctx: GuardCtx, hint?: Hint): GuardVerdict | null {
  if (t.host !== null && !dbLocal(t.host)) return D(ctx, `${t.kind} ${t.name} on ${t.host} is not on this machine`, hint);
  return owned(t, ctx) ? null : D(ctx, `${t.kind} ${t.name} is not one the run registered`, hint);
}

/** A client-side file (T6-SQL-FILES): null when it is a literal path inside the run's roots (or a null sink, or one under `$PWD`, T6-PWD); else what is wrong with it. */
function clientFile(word: Word, seg: Segment, ctx: GuardCtx): string | null {
  const w = resolvePwd(word, seg);
  if (w.dynamic) return 'a file only the shell names';
  if (w.text.startsWith('|')) return 'a shell command';
  if (isNullSink(w.text, seg.dialect)) return null;
  const p = segmentPath(w, seg);
  return p !== null && insideRoots(p, ctx) ? null : `${p ?? w.text}, outside the run's roots`;
}

/** The words of a meta command's arguments (quotes honored); null when the shell (backquotes) or a psql variable (`:var`) supplies one. */
function metaArgs(s: string, vars: boolean): Word[] | null {
  if (s.includes('`') || (vars && /:['"]?[A-Za-z_]/.test(s))) return null;
  return [...s.matchAll(/'((?:[^']|'')*)'|"((?:[^"]|"")*)"|(\S+)/g)].map(m => ({ text: m[1] !== undefined ? m[1].replace(/''/g, "'") : m[2] ?? m[3], dynamic: false, glob: false }));
}

// ---- the clients ----------------------------------------------------------------------------------------------------

/** A client call read with its table: `cmd` is redis-cli's command and its arguments; `sql` what the client runs inline (sqlite3's SQL arguments, redis-cli's command). */
interface ClientCall { name: DbClient; c: Client; sc: Scan; unknown: boolean; cmd: Word[]; sql: Word[] }
function clientCall(seg: Segment): ClientCall | null {
  if (!seg.argv.length || seg.argv[0].dynamic) return null;
  const name = commandName(seg.argv[0]);
  if (!DB_CLIENTS.has(name)) return null;
  const c = CLIENTS[name as DbClient], args = seg.argv.slice(1);
  // redis-cli reads its options up to the command; the others read them anywhere
  const h = name === 'redis-cli' ? head(args, c.table, seg.dialect) : { at: args.length, unknown: false };
  const sc = scan(args.slice(0, h.at), c.table, seg.dialect), cmd = args.slice(h.at);
  const inline = sc.vals.filter(v => c.sql.includes(v.key)).map(v => v.w);
  const sql = name === 'sqlite3' ? [...sc.ops.slice(1), ...inline] : name === 'redis-cli' ? cmd : inline;
  return { name: name as DbClient, c, sc, unknown: sc.unknown || h.unknown, cmd, sql };
}

/** K200: the SQL words a database client runs inline (not redis-cli's command), which the files rule leaves to this rule. */
export function inlineSqlWords(seg: Segment): Word[] {
  const k = clientCall(seg);
  return k && k.c.family !== 'redis' ? k.sql : [];
}

const readWord = (w: Word): boolean => !w.dynamic && isReadSql(w.text);
/** A file option (`-f`, sqlite3's `-init`) or PSQLRC (m4: it runs a file like -f). */
const fileOption = (k: ClientCall, seg: Segment): boolean => k.c.files.some(f => k.sc.flags.has(f)) || (k.name === 'psql' && !!seg.env.PSQLRC);
/** M5: SQL the hook does not see feeds the client: a file option, PSQLRC, a `<` redirect or a pipe. */
const fedUnseen = (k: ClientCall, seg: Segment): boolean => fileOption(k, seg) || seg.after === '|' || seg.redirects.some(r => r.op === '<');

/** Whether a client call only reads: it prints and exits, or (M5: with no file, `<` or pipe feeding it) all it runs inline reads. */
function clientReads(k: ClientCall, seg: Segment): boolean {
  const { c, sc, sql } = k;
  if (k.unknown) return false;
  // m3: sqlite3 runs -init and -cmd (and its SQL) before it prints its version
  if (c.info.some(f => sc.flags.has(f)) && !(k.name === 'sqlite3' && (fileOption(k, seg) || sql.length))) return true;
  // an operand only the shell knows may expand to more options (`$MORE` = `-c "drop table t"`); `$PWD` is a path (T6-PWD)
  if (sc.ops.some(w => resolvePwd(w, seg).dynamic)) return false;
  if (fedUnseen(k, seg)) return false;
  switch (k.name) {
    case 'psql': return sql.length ? sql.every(readWord) : sc.flags.has('-l') || sc.flags.has('--list');
    case 'pg_restore': return sc.flags.has('-l') || sc.flags.has('--list'); // lists the archive
    case 'dropdb': case 'createdb': return false;
    case 'mysqladmin': return sc.ops.length > 0 && sc.ops.every(w => !w.dynamic && MYSQLADMIN_READ.has(w.text.toLowerCase()));
    // mongosh runs JavaScript, not SQL: only its own `show <what>` helpers read
    case 'mongosh': case 'mongo': return sql.length > 0 && sql.every(w => !w.dynamic && w.text.split(/[;\n]/).every(s => !s.trim() || /^show\s+\w+$/i.test(s.trim())));
    case 'redis-cli': return k.cmd.length ? !k.cmd[0].dynamic && REDIS_READ.has(k.cmd[0].text.toUpperCase()) : REDIS_READ_MODES.some(f => sc.flags.has(f));
    default: return sql.length > 0 && sql.every(readWord); // mysql, mariadb, sqlite3
  }
}

// ---- where a client connects ----------------------------------------------------------------------------------------

/** Where a call connects: the database names it may use and every host it may reach (none: this machine). */
interface Conn { kind: ResourceKind; names: string[]; hosts: string[] }

/** The host of a host spec (`h`, `h:port`, `[v6]:port`, a bare IPv6 literal); null for a Unix socket (a path, or Linux's abstract `@name`): this machine. */
function hostOf(spec: string): string | null {
  if (/^[/@]/.test(spec)) return null;
  if (spec.startsWith('[')) return spec.slice(0, spec.indexOf(']') + 1);
  return (spec.match(/:/g) ?? []).length > 1 ? spec : spec.replace(/:\d*$/, '');
}

interface DbUrl { kind: ResourceKind | null; given: boolean; hosts: string[]; ports: string[]; db: string; params: Map<string, string> }
/** A database URL (`scheme://[user@]host[:port][,host…]/db?params`, also with a `+driver` or a `jdbc:` prefix); null when the text is none or does not decode. */
function parseUrl(text: string): DbUrl | null {
  const m = /^(?:jdbc:)?([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?/i.exec(text);
  if (!m) return null;
  try {
    const scheme = m[1].toLowerCase(), base = scheme === 'mongodb+srv' ? 'mongodb' : scheme.split('+')[0];
    const specs = m[2].slice(m[2].lastIndexOf('@') + 1).split(',').map(decodeURIComponent).filter(Boolean);
    const params = new Map<string, string>();
    for (const kv of (m[4] ?? '').split('&').filter(Boolean)) {
      const e = kv.indexOf('=');
      params.set(decodeURIComponent(e < 0 ? kv : kv.slice(0, e)).toLowerCase(), decodeURIComponent(e < 0 ? '' : kv.slice(e + 1)));
    }
    return {
      kind: SCHEME_KIND.get(base) ?? null, given: specs.length > 0, params, db: decodeURIComponent(m[3].replace(/^\//, '')),
      hosts: specs.map(hostOf).filter((h): h is string => !!h), ports: specs.map(s => /:(\d+)$/.exec(s)?.[1]).filter((p): p is string => !!p),
    };
  } catch { return null; }
}

/** A libpq conninfo string (`key=value key='quoted value'`); null when it does not parse. */
function conninfo(text: string): Map<string, string> | null {
  const out = new Map<string, string>(), re = /\s*([A-Za-z_]+)\s*=\s*(?:'((?:[^'\\]|\\.)*)'|([^\s']*))/y;
  for (let i = 0; i < text.length && /\S/.test(text.slice(i));) {
    re.lastIndex = i;
    const m = re.exec(text);
    if (!m) return null;
    out.set(m[1].toLowerCase(), m[2] !== undefined ? m[2].replace(/\\(.)/g, '$1') : m[3]);
    i = re.lastIndex;
  }
  return out;
}

/**
 * Where a client call connects, from its options, its operands and its segment's environment (brief: -d/--dbname,
 * -D/--database, the first operand, a postgres/mysql/mongodb/redis URL, -h/--host, PGDATABASE/PGHOST; sqlite3's file;
 * redis-cli's -p, 6379 by default). 'unknown' when an option is outside the table or the shell hides a word; null when the
 * call touches no database (pg_restore without -d writes a script).
 */
function clientConn(k: ClientCall, seg: Segment): Conn | 'unknown' | null {
  const { name, sc } = k, env = seg.env;
  // an option outside the table, arguments xargs or find -exec add, or an operand only the shell knows (it may hold a -d or -h)
  if (k.unknown || seg.dynamicArgs || sc.ops.some(w => resolvePwd(w, seg).dynamic)) return 'unknown';
  const vals = (...keys: string[]): Word[] => sc.vals.filter(v => keys.includes(v.key)).map(v => v.w);
  const conn: Conn = { kind: KIND[k.c.family], names: [], hosts: [] };
  let hostGiven = false;
  /** Adds the hosts of a host word (a comma list); false when the shell hides it. */
  const host = (w: Word | string): boolean => {
    if (typeof w !== 'string' && w.dynamic) return false;
    hostGiven = true;
    for (const s of (typeof w === 'string' ? w : w.text).split(',')) { const h = hostOf(s); if (h) conn.hosts.push(h); }
    return true;
  };
  const named = (w: Word): boolean => { if (w.dynamic) return false; conn.names.push(w.text); return true; };
  /** A postgres database word: a name, a conninfo string or a URI (their host, hostaddr and dbname; `nameIt` false reads only the hosts). */
  const pgWord = (w: Word, nameIt = true): boolean => {
    if (w.dynamic) return false;
    let kv: Map<string, string> | null;
    if (/^postgres(?:ql)?:\/\//i.test(w.text)) {
      const u = parseUrl(w.text);
      if (!u) return false;
      if (u.given) hostGiven = true;
      conn.hosts.push(...u.hosts);
      if (u.db && nameIt) conn.names.push(u.db);
      kv = u.params;
    } else if (w.text.includes('=')) kv = conninfo(w.text);
    else return nameIt ? named(w) : true;
    if (!kv || kv.has('service')) return false; // a service file names the host and the database
    for (const key of ['host', 'hostaddr']) { const v = kv.get(key); if (v !== undefined && !host(v)) return false; }
    const db = kv.get('dbname');
    if (db !== undefined && nameIt) { if (/=|:\/\//.test(db)) return false; conn.names.push(db); }
    return true;
  };
  switch (k.c.family) {
    case 'pg': {
      if (env.PGSERVICE || env.PGSERVICEFILE || envUnknown(seg)) return 'unknown'; // a service or env file names the host and the database
      if (name === 'pg_restore' && (sc.flags.has('-C') || sc.flags.has('--create'))) return 'unknown'; // the archive names the database it creates
      const ds = name === 'psql' || name === 'pg_restore' ? vals('-d', '--dbname') : [];
      if (name === 'pg_restore' && !ds.length) return null;
      if (!vals('-h', '--host').every(host)) return 'unknown';
      for (const w of ds.length ? ds : sc.ops.slice(0, 1)) if (!pgWord(w)) return 'unknown';
      // m5: dropdb's and createdb's maintenance database may be a conninfo or URL whose host is where they connect
      for (const w of vals('--maintenance-db')) if (!pgWord(w, false)) return 'unknown';
      if (!conn.names.length && env.PGDATABASE && !pgWord(env.PGDATABASE)) return 'unknown';
      if (!hostGiven && env.PGHOST && !host(env.PGHOST)) return 'unknown';
      if (env.PGHOSTADDR && !host(env.PGHOSTADDR)) return 'unknown'; // hostaddr is where libpq connects, whatever the host
      break;
    }
    case 'mysql': {
      if (envUnknown(seg) || ['--login-path', '--defaults-file', '--defaults-extra-file', '--defaults-group-suffix'].some(f => sc.flags.has(f))) return 'unknown';
      if (!vals('-h', '--host').every(host)) return 'unknown';
      if (!hostGiven && env.MYSQL_HOST && !host(env.MYSQL_HOST)) return 'unknown';
      if (name !== 'mysqladmin') {
        // mysql reads its positional database after the options, so it wins over -D: both are judged
        for (const w of [...vals('-D', '--database'), ...sc.ops.slice(0, 1)]) if (!named(w)) return 'unknown';
        break;
      }
      // mysqladmin: create/drop name a database; a read command names none; any other command acts on the whole server
      for (let i = 0; i < sc.ops.length; i++) {
        const w = sc.ops[i], cmd = w.dynamic ? '' : w.text.toLowerCase();
        if (MYSQLADMIN_READ.has(cmd)) continue;
        if ((cmd === 'create' || cmd === 'drop') && sc.ops[i + 1] && named(sc.ops[i + 1])) { i++; continue; }
        return 'unknown';
      }
      break;
    }
    case 'sqlite': {
      // no file (memory, or stdin), a URI filename, or a path the shell hides ($PWD aside, T6-PWD): unknown
      const f = sc.ops[0] && resolvePwd(sc.ops[0], seg);
      if (!f || f.dynamic || f.glob || /^file:/i.test(f.text) || f.text === ':memory:') return 'unknown';
      const p = segmentPath(f, seg);
      if (p === null) return 'unknown';
      conn.names.push(p);
      break;
    }
    case 'mongo': {
      if (sc.flags.has('--nodb')) return 'unknown';
      /** A mongo address: a URI, `host[:port]/db`, a bare db name, or (for --host) `[set/]host[:port],…`. A `.js` operand is a script. */
      const addr = (w: Word, isHost: boolean): boolean => {
        if (w.dynamic) return false;
        const t = w.text;
        if (/^mongodb(?:\+srv)?:\/\//i.test(t)) {
          const u = parseUrl(t);
          if (!u) return false;
          conn.hosts.push(...u.hosts);
          if (u.db) conn.names.push(u.db);
          return true;
        }
        if (isHost) return host(t.replace(/^[^/]*\//, ''));
        if (/\.js$/i.test(t)) return true;
        const slash = t.indexOf('/');
        if (slash >= 0) { if (t.slice(slash + 1)) conn.names.push(t.slice(slash + 1)); return host(t.slice(0, slash)); }
        return /[:.]/.test(t) ? host(t) : named(w);
      };
      if (!vals('--host').every(w => addr(w, true))) return 'unknown';
      if (sc.ops[0] && !addr(sc.ops[0], false)) return 'unknown';
      break;
    }
    case 'redis': {
      if (sc.flags.has('-s')) return 'unknown'; // a Unix socket: which server cannot be read
      if (!vals('-h').every(host)) return 'unknown';
      for (const w of vals('-u')) {
        const u = w.dynamic ? null : parseUrl(w.text);
        if (!u || u.kind !== 'redis') return 'unknown';
        conn.hosts.push(...u.hosts);
        conn.names.push(...(u.ports.length ? u.ports.map(p => String(Number(p))) : ['6379']));
      }
      for (const w of vals('-p')) { if (w.dynamic || !/^\d+$/.test(w.text)) return 'unknown'; conn.names.push(String(Number(w.text))); }
      if (!conn.names.length) conn.names.push('6379');
      break;
    }
  }
  return conn;
}

/** One database, with the first host that is not this machine (else the first host given); 'unknown' when the call names none or several. */
function toTarget(c: Conn): Target | 'unknown' {
  const names = [...new Set(c.names)];
  if (names.length !== 1) return 'unknown';
  return { kind: c.kind, name: names[0], host: c.hosts.find(h => !dbLocal(h)) ?? c.hosts[0] ?? null };
}

/** The target of a client (`DB_CLIENTS`): what it connects to, 'unknown' when it cannot be read, null when the segment is no database call. */
export function dbTarget(seg: Segment): { kind: ResourceKind; name: string; host: string | null } | 'unknown' | null {
  const k = clientCall(seg);
  const c = k ? clientConn(k, seg) : null;
  return c === null || c === 'unknown' ? c : toTarget(c);
}

// ---- SQL that acts past a registered target, or touches a file (T6-FAILCLOSED, T6-SQL-FILES, I2) ---------------------

const ownsDb = (kind: ResourceKind, name: string, own: string, ctx: GuardCtx): boolean =>
  name === own.toLowerCase() || (ctx.autonomous?.resources ?? []).some(r => r.kind === kind && r.name === name);

/** A CREATE/DROP/ALTER DATABASE that names a database the run did not register, or any other mention of a database (GRANT … ON DATABASE, database()). */
function namesOther(code: string, ddl: RegExp, word: RegExp, kind: ResourceKind, own: string, ctx: GuardCtx): boolean {
  for (const m of code.matchAll(ddl)) if (!ownsDb(kind, m[1], own, ctx)) return true;
  return word.test(code.replace(ddl, ' '));
}

/** psql's meta commands in the Postgres reading (case kept): display ones pass; a file one passes on a literal path inside the roots; any other acts past. */
function pgMetas(raw: string, seg: Segment, ctx: GuardCtx): boolean {
  for (const m of raw.matchAll(/\\([A-Za-z]+\+?|[^A-Za-z\s])([^\n\\]*)/g)) {
    const name = m[1].toLowerCase();
    if (PSQL_SAFE_META.test(name)) continue;
    if (!PSQL_FILE_META.has(name)) return true;
    const a = metaArgs(m[2], true);
    if (!a) return true;
    let f: Word | undefined;
    if (name === 'copy') {
      // \copy … from|to <file> | program '<command>' | stdin | stdout | pstdin | pstdout
      const i = a.reduce((last, w, j) => (/^(?:from|to)$/i.test(w.text) ? j : last), -1), next = a[i + 1]?.text.toLowerCase() ?? '';
      if (i < 0 || next === 'program') return true;
      if (/^p?std(?:in|out)$/.test(next)) continue;
      f = a[i + 1];
    } else f = name === 'lo_export' ? a[1] : a[0];
    if (!f) { if (['o', 'out', 'g', 'gx'].includes(name)) continue; return true; }
    if (clientFile(f, seg, ctx)) return true;
  }
  return false;
}

/** A server-side COPY: one whose last FROM/TO names a file or a program, not STDIN/STDOUT (T6-SQL-FILES). */
function serverCopy(st: string): boolean {
  if (!/^copy\b/.test(st)) return false;
  const ms = [...st.matchAll(/\b(?:to|from)\b\s*([a-z]*)/g)], last = ms[ms.length - 1];
  return !!last && !/^std(?:in|out)$/.test(last[1]);
}

function pgReaches(code: string, own: string, ctx: GuardCtx): boolean {
  if (namesOther(code, /\b(?:create|drop|alter)\s+database\s+(?:if\s+(?:not\s+)?exists\s+)?([^\s;(]+)/g, /\bdatabase\b/, 'postgres', own, ctx)) return true;
  return PG_ANYWHERE.test(code) || code.split(';').some(s => { const st = s.trim(); return PG_STATEMENT.test(st) || serverCopy(st); });
}

/**
 * I2 (T6-MYSQL-QUALIFIERS): in a statement that is not a read, every `<ident>.<ident>` qualifier reaches past unless its
 * first part is the connection's database, another registered mysql database, a table the statement references, or an
 * alias it declares (`<table> [AS] <alias>` after from, join, update, into, using or a comma).
 */
function qualifiesPast(s: string, own: string, ctx: GuardCtx): boolean {
  const declared = new Set<string>();
  const decl = /(?:\b(?:from|join|update|into|table|tables|truncate|using|straight_join)\b|,)\s*(?:[a-z0-9_$]+\s*\.\s*)?([a-z0-9_$]+)(?!\s*\.)(?:\s+(?:as\s+)?([a-z0-9_$]+)(?!\s*\.))?/g;
  for (const m of s.matchAll(decl)) { declared.add(m[1]); if (m[2]) declared.add(m[2]); }
  for (const m of s.matchAll(/(?<![\w$]|\.\s*)([a-z0-9_$]+)(?=\s*\.\s*[a-z0-9_$*`])/g)) {
    if (!/^\d+$/.test(m[1]) && !declared.has(m[1]) && !ownsDb('mysql', m[1], own, ctx)) return true;
  }
  return false;
}

function mysqlReaches(code: string, own: string, ctx: GuardCtx): boolean {
  if (/\\(?!g(?![a-z]))/.test(code)) return true; // a client command other than \g and \G (\u, \r, \!, \. …)
  if (namesOther(code, /\b(?:create|drop|alter)\s+(?:database|schema)\s+(?:if\s+(?:not\s+)?exists\s+)?([^\s;(]+)/g, /\b(?:database|schema)\b/, 'mysql', own, ctx)) return true;
  for (const st of code.split(';')) {
    for (const line of st.split('\n').map(x => x.trim())) {
      const use = /^use\s+([^\s;]+)/.exec(line);
      if ((use && !ownsDb('mysql', use[1], own, ctx)) || MYSQL_STATEMENT.test(line)) return true;
    }
    if (!readStatement(st) && qualifiesPast(st, own, ctx)) return true;
  }
  return MYSQL_ANYWHERE.test(code);
}

/** sqlite3's dot commands: display ones pass; a file one passes on a literal path inside the roots; any other (.shell, .load, .open…) acts past. */
function sqliteDots(text: string, seg: Segment, ctx: GuardCtx): boolean {
  for (const line of text.split('\n')) {
    const m = /^\s*\.(\w+)(.*)$/.exec(line);
    if (!m) continue;
    const dot = m[1].toLowerCase();
    if (SQLITE_SAFE_DOT.has(dot)) continue;
    const a = SQLITE_FILE_DOT.has(dot) ? metaArgs(m[2], false) : null;
    if (!a || a.some(w => /^-[xe]$/.test(w.text))) return true; // .once -x / -e open a program
    const files = a.filter(w => !w.text.startsWith('-'));
    const f = dot === 'backup' || dot === 'save' ? files[files.length - 1] : files[0];
    if (!f) { if (dot === 'output' || dot === 'once') continue; return true; }
    if (clientFile(f, seg, ctx)) return true;
  }
  return false;
}

/** Whether what a client runs on a registered target may act past it; SQL only the shell knows may. Files and stdin are not seen (mongosh scripts aside, I2). */
function reachesPast(k: ClientCall, t: Target, seg: Segment, ctx: GuardCtx): boolean {
  if (k.sql.some(w => w.dynamic)) return true;
  const texts = k.sql.map(w => w.text), fam = k.c.family;
  // a mongosh script file is JavaScript the hook cannot read, and JavaScript switches databases at will
  if (fam === 'mongo') return k.c.files.some(f => k.sc.flags.has(f)) || k.sc.ops.some(w => /\.js$/i.test(w.text)) || texts.some(s => MONGO_REACH.test(s));
  if (fam === 'redis') return texts.some(s => /\bmigrate\b/i.test(s)); // MIGRATE writes a key into another server
  for (const s of texts) {
    if (fam === 'sqlite' && sqliteDots(s, seg, ctx)) return true;
    const codes = sqlCodes(s);
    if (codes === null) return true;
    if (fam === 'pg' && (pgMetas(sqlCode(s, PG)!, seg, ctx) || codes.some(code => pgReaches(code, t.name, ctx)))) return true;
    if (fam === 'mysql' && codes.some(code => mysqlReaches(code, t.name, ctx))) return true;
    if (fam === 'sqlite' && codes.some(code => SQLITE_REACH.test(code))) return true;
  }
  return false;
}

/** m9: SQL that only creates or drops databases, by name ([] when it is anything else); clientVerdict judges by them only under N1. */
function ddlNames(k: ClientCall): string[] {
  if ((k.c.family !== 'pg' && k.c.family !== 'mysql') || !k.sql.length || k.sql.some(w => w.dynamic)) return [];
  const re = k.c.family === 'pg' ? /^(?:create|drop)\s+database\s+(?:if\s+(?:not\s+)?exists\s+)?([^\s;(]+)/ : /^(?:create|drop)\s+(?:database|schema)\s+(?:if\s+(?:not\s+)?exists\s+)?([^\s;(]+)/;
  const names = new Set<string>();
  for (const w of k.sql) {
    const codes = sqlCodes(w.text);
    if (!codes) return [];
    for (const st of codes.flatMap(statements).map(s => s.trim()).filter(Boolean)) {
      const m = re.exec(st);
      if (!m) return [];
      names.add(m[1]);
    }
  }
  return [...names];
}

function clientVerdict(seg: Segment, ctx: GuardCtx): GuardVerdict | null {
  const k = clientCall(seg);
  if (!k) return null;
  // T6-SQL-FILES: a client-side output file (psql -o/-L, mysql --tee) only inside the run's roots
  for (const v of k.unknown ? [] : k.sc.vals.filter(x => k.c.out.includes(x.key))) {
    const bad = clientFile(v.w, seg, ctx);
    if (bad) return U(ctx, `${k.name} ${v.key} writes ${bad}`);
  }
  if (clientReads(k, seg)) return null;
  const c = clientConn(k, seg);
  if (c === null) return null;
  // m9 and N1: SQL that only creates or drops databases, each a registered one on a local host, with nothing unseen feeding
  // the client, is judged by those names; anything else (a -f file, PSQLRC, `<`, a pipe) is judged by the connection's target
  const ddl = c === 'unknown' || fedUnseen(k, seg) ? [] : ddlNames(k);
  if (c !== 'unknown' && ddl.length) {
    const host = c.hosts.find(h => !dbLocal(h)) ?? c.hosts[0] ?? null;
    if (ddl.every(name => !targetVerdict({ kind: c.kind, name, host }, ctx))) return null;
  }
  const t = c === 'unknown' ? c : toTarget(c);
  if (t === 'unknown') return U(ctx, `${k.name} writes to a database the hook cannot read`);
  return targetVerdict(t, ctx) ?? (reachesPast(k, t, seg, ctx) ? U(ctx, `what ${k.name} is given acts past ${t.name}, or touches a file outside the run's roots`) : null);
}

// ---- migrations, database scripts and their URLs (M15, H8, T6-MIGRATOR-TARGET, T6-MIGRATOR-URLS) -----------------------

/** A go-sql-driver MySQL DSN (`user:pass@tcp(host:3306)/db?…`), as host and database; null when it is not one. */
function mysqlDsn(text: string): { host: string | null; db: string } | null {
  const m = /^(?:[^@/]*@)?(?:(\w+)\(([^)]*)\))?\/([^?]*)/.exec(text);
  if (!m) return null;
  return { host: m[1] === 'unix' ? null : m[2] ? hostOf(m[2]) : null, db: m[3] };
}

/** Where a URL (or a goose DSN of `kind`) points: the run's own SQLite path inside the worktree, a target, or 'unknown'. */
function urlTarget(text: string, seg: Segment, ctx: GuardCtx, kind?: ResourceKind): Target | 'inside' | 'unknown' {
  const lite = kind === 'sqlite' ? [text, text] : /^(?:file|sqlite3?):(.*)$/i.exec(text);
  if (lite) {
    let p: string;
    try { p = decodeURIComponent(lite[1].replace(/^\/\/(?:localhost)?(?=\/)/i, '').split(/[?#]/)[0]); } catch { return 'unknown'; }
    if (!p) return 'unknown';
    const wt = ctx.autonomous!.worktree;
    // a relative path that cannot climb, from a cwd inside the worktree, stays inside (Prisma reads it from its schema's folder)
    if (!/^(?:[\\/]|[A-Za-z]:)/.test(p) && !p.split(/[\\/]/).includes('..') && seg.cwd !== null && wt !== '' && confinedIn(seg.cwd, wt)) return 'inside';
    const abs = segmentPath({ text: p, dynamic: false, glob: false }, seg);
    return abs === null ? 'unknown' : { kind: 'sqlite', name: abs, host: null };
  }
  const u = parseUrl(text);
  if (!u && kind === 'mysql') {
    const d = mysqlDsn(text);
    return d && d.db ? { kind: 'mysql', name: d.db, host: d.host } : 'unknown';
  }
  if (!u && kind === 'postgres' && text.includes('=')) {
    const kv = conninfo(text);
    if (!kv || kv.has('service') || !kv.get('dbname')) return 'unknown';
    const hosts = ['host', 'hostaddr'].flatMap(k => (kv.get(k) ?? '').split(',')).map(h => (h ? hostOf(h) : null)).filter((h): h is string => !!h);
    return toTarget({ kind: 'postgres', names: [kv.get('dbname')!], hosts });
  }
  if (!u || !u.kind || u.params.has('service')) return 'unknown';
  const conn: Conn = { kind: u.kind, names: [], hosts: [...u.hosts] };
  for (const key of ['host', 'hostaddr']) for (const s of (u.params.get(key) ?? '').split(',')) { const h = s ? hostOf(s) : null; if (h) conn.hosts.push(h); }
  if (u.kind === 'redis') conn.names.push(...(u.ports.length ? u.ports.map(p => String(Number(p))) : ['6379']));
  else for (const d of [u.db, u.params.get('dbname') ?? '']) if (d) conn.names.push(d);
  return toTarget(conn);
}

/** Judges the URLs a call's target is read from; `via` names where they came from, `kind` reads a non-URL DSN. */
function urlVerdict(seg: Segment, ctx: GuardCtx, what: string, urls: Word[], via: string, hint: Hint, kind?: ResourceKind): GuardVerdict | null {
  if (!urls.length) return U(ctx, `${what}, and only ${via} on the command itself says which database`, hint);
  for (const u of urls) {
    if (u.dynamic) return U(ctx, `${what}, on the database ${via} only the shell knows names`, hint);
    const t = urlTarget(u.text, seg, ctx, kind);
    if (t === 'inside') continue;
    if (t === 'unknown') return U(ctx, `${what}, on a database ${via} does not let the hook read`, hint);
    const v = targetVerdict(t, ctx, hint);
    if (v) return v;
  }
  return null;
}
const envWords = (seg: Segment, keys: readonly string[]): Word[] => keys.map(k => seg.env[k]).filter((w): w is Word => !!w);
const flagValues = (args: Word[], flag: string): Word[] => args.flatMap((w, i) =>
  w.text === flag ? (args[i + 1] ? [args[i + 1]] : []) : w.text.startsWith(`${flag}=`) ? [{ ...w, text: w.text.slice(flag.length + 1) }] : []);
/** A call's command words (options and `--` left out) joined, lower-cased, and whether one is only known to the shell. */
const cmdWords = (args: Word[]): { joined: string; dynamic: boolean } => {
  const ws = args.filter(w => w.text !== '--' && !w.text.startsWith('-'));
  return { joined: ws.map(w => w.text.toLowerCase()).join(' '), dynamic: ws.some(w => w.dynamic) };
};

/** Whether a call of a MIGRATORS CLI migrates: its words match `write` and not `safe` (a word only the shell knows may), unless it only prints help (`--help` anywhere) or its version. */
function isMigration(name: string, args: Word[]): boolean {
  if (!Object.hasOwn(MIGRATORS, name)) return false;
  const m: Migrator = MIGRATORS[name];
  if (args.some(w => w.text === '--help') || (args.length > 0 && args.every(w => INFO_WORDS.test(w.text)))) return false;
  const { joined, dynamic } = cmdWords(args);
  if (dynamic) return true;
  return (m.write === true || m.write.test(joined)) && !m.safe?.test(joined);
}

/**
 * T6-MIGRATOR-TARGET: a migration's database is known only from (a) its explicit literal URL option, (b) DATABASE_URL on the
 * segment for the tools that read it as their target (rails, rake, dbmate, diesel, sqlx), (c) for prisma migrate|db,
 * DATABASE_URL and DIRECT_URL on the segment (and SHADOW_DATABASE_URL for migrate dev), or goose's `<driver> <dsn>`.
 * Any other migrator reads code the hook cannot (settings.py, knexfile, alembic env.py…): unknown target.
 */
function migratorVerdict(run: Eff, seg: Segment, ctx: GuardCtx): GuardVerdict | null {
  const m = MIGRATORS[run.name], what = `${run.name} migrates a database`, args = run.args;
  const urls = (m.urls ?? []).flatMap(k => flagValues(args, k));
  const envUnk = envUnknown(seg);
  if (run.name === 'goose') {
    const sc = scan(args, GOOSE_T, seg.dialect), kind = GOOSE_DRIVERS.get(sc.ops[0]?.text.toLowerCase() ?? '');
    if (sc.unknown || !kind || !sc.ops[1]) return U(ctx, `${what}, and goose's driver and DSN cannot be read`, 'migrator');
    return urlVerdict(seg, ctx, what, [sc.ops[1]], "goose's DSN", 'migrator', kind);
  }
  if (run.name === 'prisma' && !urls.length) {
    const need = ['DATABASE_URL', 'DIRECT_URL', ...(/(?:^| )migrate dev(?: |$)/.test(cmdWords(args).joined) ? ['SHADOW_DATABASE_URL'] : [])];
    const missing = need.filter(k => !seg.env[k]);
    if (envUnk) return U(ctx, `${what}, and an env file the hook cannot read sets its URLs`, 'migrator');
    if (missing.length) return U(ctx, `${what}, and ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not on the command itself`, 'migrator');
    return urlVerdict(seg, ctx, what, envWords(seg, need), need.join(' and '), 'migrator');
  }
  const fromEnv = envUnk ? [] : envWords(seg, m.env ?? []);
  if (!urls.length && !fromEnv.length) return U(ctx, `${what}, and the hook cannot read which database it migrates`, 'migrator');
  return urlVerdict(seg, ctx, what, [...urls, ...fromEnv], 'its URL', 'migrator');
}

/** Interpreters running a script file: the script names the command (`python manage.py`, `ruby bin/rails`, `php artisan`). */
function scriptOf(name: string, args: Word[]): Eff | null {
  const it = INTERPRETERS.find(([re]) => re.test(name));
  if (!it) return null;
  for (let i = 0; i < args.length; i++) {
    const t = args[i].text;
    if (it[1].has(t)) { i++; continue; }
    if (it[2].has(t)) return null;
    if (t.startsWith('-')) continue;
    return args[i].dynamic ? null : { name: commandName(args[i]), args: args.slice(i + 1) };
  }
  return null;
}

/** T6-SUPABASE-LOCAL: the supabase commands that write the local stack's database (reset, push, migration up|down|repair, stop --no-backup). */
function supabaseWrites(args: Word[]): boolean {
  const ws = args.filter(w => !w.text.startsWith('-')).map(w => w.text.toLowerCase());
  const noBackup = args.some(w => w.text === '--no-backup');
  return (ws.includes('db') && (ws.includes('reset') || ws.includes('push'))) || (ws.includes('stop') && noBackup)
    || (ws.includes('migration') && ['up', 'down', 'repair'].some(x => ws.includes(x)));
}

/**
 * The indexes of the words a package manager may run as a script (H8): the word after `run|run-script` (m1: also after
 * `--`), and for pnpm, yarn and bun a first word that is not one of PM_OWN_COMMANDS. The manager's own options are
 * autonomy-net's MANAGERS (I1); one outside them is read both ways (a switch, or an option with a value).
 */
function pmScripts(name: string, args: Word[], i = 0, run = false, budget = 4): number[] {
  const m = MANAGERS.get(name)!, pm = PM_RUN.get(name)!;
  for (; i < args.length; i++) {
    const w = args[i], t = w.text;
    if (t === '--') continue;
    if (t.length > 1 && t.startsWith('-')) {
      const eq = t.indexOf('='), key = eq > 0 ? t.slice(0, eq) : t;
      if (m.valued.has(key)) { if (eq < 0) i++; continue; }
      if (m.switches.has(key) || eq > 0) continue;
      if (budget === 0) return args.map((_, j) => j).filter(j => j > i && !args[j].text.startsWith('-'));
      return [...pmScripts(name, args, i + 1, run, budget - 1), ...pmScripts(name, args, i + 2, run, budget - 1)];
    }
    if (w.dynamic) return [i];
    const lw = t.toLowerCase();
    if (!run && pm.run.has(lw)) { run = true; continue; }
    if (!run && m.skip.has(lw)) { i += m.skip.get(lw)!; continue; }
    if (!run && (!pm.bare || PM_OWN_COMMANDS.has(lw))) return [];
    return [i];
  }
  return [];
}

/** make, just, task and turbo targets: every word that is not an option, its value or a VAR=value (m1: `--` is skipped; turbo's `run` is no task). */
function targetsOf(name: string, args: Word[], valued: ReadonlySet<string>): Word[] {
  const out: Word[] = [];
  for (let i = 0; i < args.length; i++) {
    const w = args[i];
    if (w.text === '--' || (name === 'turbo' && w.text === 'run')) continue;
    if (w.text.startsWith('-')) { if (valued.has(w.text)) i++; continue; }
    if (!w.dynamic && /^[A-Za-z_]\w*=/.test(w.text)) continue;
    out.push(w);
  }
  return out;
}

// ---- MCP tools (H9, T6-H9-SEARCH, m6) -------------------------------------------------------------------------------

/** The text of a query from its first word on, past blanks, `;`, `(` and comments; `*` when a comment never closes. */
function leadText(text: string): string {
  let s = text;
  for (;;) {
    s = s.replace(/^[\s;(]+/, '');
    if (s.startsWith('--') || s.startsWith('#')) { const e = s.indexOf('\n'); s = e < 0 ? '' : s.slice(e + 1); continue; }
    if (s.startsWith('/*')) { const e = s.indexOf('*/'); if (e < 0) return '*'; s = s.slice(e + 2); continue; }
    return s.toLowerCase();
  }
}
/** T6-H9-SEARCH (b): a query is SQL when it starts with a read keyword, or with a write keyword in that keyword's grammar. */
function sqlShaped(text: string): boolean {
  const s = leadText(text), lw = /^[a-z]+/.exec(s)?.[0] ?? '';
  return s === '*' || READ_KEYWORDS.has(lw) || !!SQL_SHAPES.get(lw)?.test(s);
}
/** m6: the strings of fields named as SQL, through nested arrays and objects (depth 4). */
function sqlFields(v: unknown, key: string, depth: number, out: { key: string; text: string }[]): void {
  if (depth > 4) return;
  if (typeof v === 'string') { if (SQL_FIELDS.has(key) || QUERY_FIELDS.has(key)) out.push({ key, text: v }); return; }
  if (Array.isArray(v)) { for (const x of v) sqlFields(x, key, depth + 1, out); return; }
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) sqlFields(x, k.toLowerCase(), depth + 1, out);
}

/** An MCP tool given SQL that writes (a sql/statement field; a query field when the tool's name or the text says SQL), or a database server's tool whose name says it writes. */
function mcpVerdict(input: GuardInput, ctx: GuardCtx): GuardVerdict | null {
  const name = input.tool_name, all = name.split('__').flatMap(p => mcpWords(p)), tool = mcpWords(name);
  const dbNamed = all.some(w => MCP_DB_WORDS.has(w)), search = all.some(w => w === 'search' || w === 'docs');
  const fields: { key: string; text: string }[] = [];
  sqlFields(input.tool_input, '', 0, fields);
  for (const { key, text } of fields) {
    const sql = SQL_FIELDS.has(key) || dbNamed || (!search && sqlShaped(text));
    if (sql && !isReadSql(text)) return U(ctx, `${name} is given SQL that writes, on a database the hook cannot see`);
  }
  // a database server's tool that takes no SQL and whose name says it changes data (migrate-reset, drop-database, delete)
  if (!fields.length && dbNamed && tool.some(w => MCP_WRITE_WORDS.has(w) || DB_TOOL_WRITES.has(w)) && !MCP_READ_FIRST.has(tool[0])
    && !DB_TOOL_READ_LAST.has(tool[tool.length - 1])) {
    return U(ctx, `${name} changes a database the hook cannot see`);
  }
  return null;
}

// ---- the rule -------------------------------------------------------------------------------------------------------

const DOCKERS = new Set([...CONTAINER_CLIS, ...COMPOSE_CLIS]);
const DYNAMIC: Word = { text: '', dynamic: true, glob: false };

function dbSeg(seg: Segment, ctx: GuardCtx): GuardVerdict | null {
  if (!seg.argv.length || seg.argv[0].dynamic) return null;
  const eff = effectiveCommand(seg);
  if (eff === null || 'cancel' in eff) return null; // T6-LAUNCHER-REUSE: a runner the hook cannot read is network's to deny
  const { name } = eff;
  // the arguments xargs or find -exec add are one more word only the shell knows (`docker ps -aq | xargs docker rm -f`)
  const args = seg.dynamicArgs ? [...eff.args, DYNAMIC] : eff.args;
  // m2: the NAME=value pairs an env wrapper sets reach the command; an env file it loads makes the environment unknown
  const s: Segment = { ...seg, env: { ...seg.env, ...eff.env }, argv: [{ text: name, dynamic: false, glob: false }, ...args] };
  if (eff.envFile || envUnknown(seg)) markEnvUnknown(s);
  if (DB_CLIENTS.has(name)) return clientVerdict(s, ctx);
  if (DOCKERS.has(name)) {
    const f = dockerFinding(name, args, s, ctx);
    return f ? (f.unknown ? U(ctx, f.what, f.hint) : D(ctx, f.what, f.hint)) : null;
  }
  const run = scriptOf(name, args) ?? { name, args };
  if (isMigration(run.name, run.args)) return migratorVerdict(run, s, ctx);
  if (name === 'supabase' && supabaseWrites(args)) return urlVerdict(s, ctx, 'supabase changes a database', flagValues(args, '--db-url'), '--db-url', 'migrator');
  const make = MAKES.get(name);
  const cands = PM_RUN.has(name) ? pmScripts(name, args).map(i => ({ w: args[i], rest: args.slice(i + 1) })) : make ? targetsOf(name, args, make).map(w => ({ w, rest: [] })) : [];
  for (const { w, rest } of cands) {
    if (w.dynamic) return U(ctx, `${name} runs a script whose name only the shell knows`, 'script');
    // a migrator's bin given its words (pnpm/yarn/bun <bin> …, m1 `npm run prisma -- migrate …`), or a script whose name says database
    const bin = commandName(w);
    if (PM_RUN.has(name) && rest.length && isMigration(bin, rest)) return migratorVerdict({ name: bin, args: rest }, s, ctx);
    // T6-SCRIPT-TARGET: what a database script runs, and which config it reads, the hook cannot see; no env makes it known
    if (isDbScript(w.text)) return U(ctx, `${name} ${w.text} looks like a database script, and the hook cannot see what it runs or which database it reads`, 'script');
  }
  return null;
}

/** m9: `$env:NAME = 'value'` in PowerShell: the name and its value (a value holding `$` or a backtick is one only the shell knows). */
function psEnvSet(seg: Segment): [string, Word] | null {
  if (seg.dialect !== 'powershell' || !seg.argv.length) return null;
  const a = seg.argv, m = /^\$env:([A-Za-z_]\w*)(?:=([\s\S]*))?$/i.exec(a[0].text);
  if (!m) return null;
  if (m[2] !== undefined) return a.length === 1 ? [m[1], { text: m[2], dynamic: /[$`]/.test(m[2]), glob: false }] : null;
  return a.length === 3 && a[1].text === '=' ? [m[1], a[2]] : null;
}

export const databaseRule: GuardRule = {
  id: 'database',
  check(input: GuardInput, ctx: GuardCtx): GuardVerdict | null {
    if (!ctx.autonomous) return null;
    if (input.tool_name.startsWith('mcp__')) return mcpVerdict(input, ctx);
    const segs = bashSegments(input, ctx);
    if (!segs) return null;
    let ps: Record<string, Word> | null = null;
    for (const seg of segs) {
      const set = psEnvSet(seg);
      if (set) { ps ??= {}; Object.defineProperty(ps, set[0], { value: set[1], enumerable: true, writable: true, configurable: true }); continue; }
      // T6-CONTAINER-INNER: the commands a container runs are judged too, in their own environment
      for (const x of withContainers(ps ? { ...seg, env: { ...ps, ...seg.env } } : seg)) { const v = dbSeg(x, ctx); if (v) return v; }
    }
    return null;
  },
};
