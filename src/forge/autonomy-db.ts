// Plan 6b-1, Task 6: the `database` rule. An autonomous run reads any database; it writes only a database, container,
// volume or compose project it registered (FORGE resource add) on a local host, or a SQLite file inside its worktree.
// Fail-closed (T6-FAILCLOSED, the lesson of Tasks 4 and 5): a write is allowed only when its target is positively one of
// those. Each client is read with its own option table (`scan`): an option outside it cancels the «this only reads» answer
// and makes the target unknown; a word only the shell knows is unknown; SQL that acts past the registered target (another
// database, a reconnect, a server program or file, the whole cluster) is unknown too. A migration or a database script
// names its database only through the DATABASE_URL of its own segment (M15: also behind a launcher, read by Task 5's
// effectiveCommand, T6-LAUNCHER-REUSE); an MCP tool is judged by the SQL it is given (H9). Pure: reads no file, starts no
// process, opens no connection. It never imports autonomy-rules.ts, which lists it in AUTONOMY_RULES.
import path from 'node:path';
import type { GuardCtx, GuardInput, GuardRule, GuardVerdict } from './guard.js';
import { confinedIn } from './guard.js';
import { dbPrefix, dockerPrefix, isLocalHost, type ResourceKind } from './resources.js';
import { commandName, type Dialect, type Segment, type Word } from './shell-words.js';
import { bashSegments, deny, mcpWords, segmentPath } from './autonomy-shared.js';
import { scan, type OptKind, type OptTable, type Scan } from './autonomy-tables.js';
import { effectiveCommand, type Eff } from './autonomy-net.js';

// ---- the lists (brief, Interfaces) ----------------------------------------------------------------------------------

const DB_CLIENT_NAMES = ['psql', 'pg_restore', 'dropdb', 'createdb', 'mysql', 'mariadb', 'mysqladmin', 'sqlite3', 'mongosh', 'mongo', 'redis-cli'] as const;
type DbClient = (typeof DB_CLIENT_NAMES)[number];
export const DB_CLIENTS: ReadonlySet<string> = new Set(DB_CLIENT_NAMES);

const DJANGO = /^(?:migrate|flush|loaddata|sqlflush)$/;
const TYPEORM = /^(?:migration|schema):/;
/**
 * The migration CLIs, each with the command word that makes a call of it a migration (`true`: every call). Spellings of one
 * CLI share its entry: django-admin and `python -m django` are manage.py; sequelize-cli and typeorm's ts-node bins too.
 */
export const MIGRATORS: Readonly<Record<string, RegExp | true>> = {
  prisma: /^(?:migrate|db)$/, rails: /^db:/, rake: /^db:/, knex: /^(?:migrate|seed):/, sequelize: /^db:/, 'sequelize-cli': /^db:/,
  typeorm: TYPEORM, 'typeorm-ts-node-commonjs': TYPEORM, 'typeorm-ts-node-esm': TYPEORM, 'drizzle-kit': /^(?:push|migrate|drop)(?::|$)/,
  alembic: /^(?:upgrade|downgrade)$/, 'manage.py': DJANGO, 'django-admin': DJANGO, django: DJANGO,
  flyway: true, liquibase: true, dbmate: true, goose: true, migrate: true,
};

/** The commands of pnpm, yarn and bun that are not a script: any other first word runs the script (or the bin) of that name. */
export const PM_OWN_COMMANDS: ReadonlySet<string> = new Set(['install', 'i', 'add', 'remove', 'rm', 'uninstall', 'update', 'up', 'upgrade', 'link',
  'unlink', 'list', 'ls', 'outdated', 'why', 'audit', 'publish', 'pack', 'init', 'create', 'exec', 'dlx', 'x', 'run', 'run-script', 'store', 'config',
  'info', 'view', 'login', 'logout', 'whoami', 'global', 'cache', 'patch', 'import', 'rebuild', 'prune', 'dedupe', 'bin', 'root', 'setup', 'env', 'fetch',
  'licenses', 'test', 't', 'start']);

// H8: the words of a database script's name.
export const DB_WORDS = new Set(['db', 'database', 'migrate', 'migration', 'migrations', 'seed', 'seeds', 'drop', 'reset', 'truncate', 'wipe', 'purge', 'flush', 'fixtures']);
export const DB_GLUED = /^(?:db|database)(?:reset|drop|seeds?|migrate|push|wipe|sync)$|^(?:reset|drop|seed|migrate|wipe)(?:db|database)$/;

/** The docker/podman subcommands that destroy or reach into a container or volume: each name they act on must be the run's; prune always denies. */
export const DOCKER_DESTROYERS: readonly string[] = ['rm', 'container rm', 'volume rm', 'volume prune', 'container prune', 'system prune', 'compose down', 'stop', 'kill', 'exec'];
// The same subcommands by their other names: docker's aliases and the `container` group.
const DOCKER_ALIAS: ReadonlyMap<string, string> = new Map([['container remove', 'container rm'], ['volume remove', 'volume rm'], ['container stop', 'stop'],
  ['container kill', 'kill'], ['container exec', 'exec']]);
// compose subcommands judged like `compose down`, by the project they act on (its containers are the project's).
const COMPOSE_DESTROYERS = new Set(['down', 'rm', 'stop', 'kill', 'exec']);
const DESTROY_WORDS = new Set(['rm', 'remove', 'prune', 'stop', 'kill', 'exec', 'down']);
const DOCKERS = new Set(['docker', 'podman', 'docker-compose', 'podman-compose']);

// ---- SQL as each server reads it ------------------------------------------------------------------------------------

// How a server reads quotes and comments: backslash escapes, dollar quotes, `#` comments, `--` needing a space after it,
// nested block comments, MySQL's executable `/*!` comments, and backquoted and bracketed identifiers.
interface SqlDialect { bs: boolean; dollar: boolean; hash: boolean; dashSpace: boolean; nested: boolean; bang: boolean; tick: boolean; bracket: boolean }
const PG: SqlDialect = { bs: false, dollar: true, hash: false, dashSpace: false, nested: true, bang: false, tick: false, bracket: false };
const MYSQL: SqlDialect = { bs: true, dollar: false, hash: true, dashSpace: true, nested: false, bang: true, tick: true, bracket: false };
const SQLITE: SqlDialect = { bs: false, dollar: false, hash: false, dashSpace: false, nested: false, bang: false, tick: true, bracket: true };
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

const READ_START = new Set(['select', 'show', 'explain', 'describe', 'with']);
const WITH_WRITES = /\b(?:insert|update|delete|merge|truncate|drop|alter|create|grant|revoke|copy|call|do)\b/;
const FOR_LOCK = /\bfor\s+(?:no\s+key\s+)?update\b|\bfor\s+(?:key\s+)?share\b|\block\s+in\s+share\s+mode\b/;
// The functions a SELECT calls for their effect (M5): the brief's list, then the families they belong to (every dblink
// call, the large-object functions, the advisory locks) and the sqlite shell's file and extension functions.
const SIDE_EFFECTS = new RegExp(String.raw`\b(?:pg_terminate_backend|pg_cancel_backend|setval|nextval|lo_unlink|lo_import|lo_export|dblink_exec|pg_reload_conf`
  + String.raw`|set_config|pg_advisory_lock|dblink\w*|lo_\w+|pg_(?:try_)?advisory\w*|writefile|load_extension)\s*\(`);
// psql's `\d…` and `\l`, sqlite's `.tables` and `.schema`, with arguments on their own line and no other client command.
const META_READ = /^(?:\\(?:d[a-z+]*|l\+?|list\+?)|\.(?:tables|schema))(?:[ \t][^\\\n]*)?$/;

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

// ---- the clients and their option tables (T6-FAILCLOSED) ------------------------------------------------------------

/** An option table from a space-separated spec: a trailing `=` takes a value (glued, after `=` or the next word), `?` only a glued one. */
function opts(spec: string): OptTable {
  const o: Record<string, OptKind> = {};
  for (const tok of spec.split(/\s+/).filter(Boolean)) {
    const mark = tok.length > 2 && /[=?]$/.test(tok) ? tok.slice(-1) : '';
    o[mark ? tok.slice(0, -1) : tok] = mark === '=' ? 'v' : mark === '?' ? 'g' : 'w';
  }
  return { opts: o };
}
/** sqlite3 reads each option with one dash or two. */
const dashes = (spec: string): string => spec.split(/\s+/).filter(Boolean).flatMap(t => [t, `-${t}`]).join(' ');

const PG_CONN = '-h= --host= -p= --port= -U= --username= -w --no-password -W --password';
const PSQL = opts(`${PG_CONN} -a --echo-all -A --no-align -b --echo-errors -c= --command= --csv -d= --dbname= -e --echo-queries -E --echo-hidden -f= --file=
  -F= --field-separator= -H --html -l --list -L= --log-file= -n --no-readline -o= --output= -P= --pset= -q --quiet -R= --record-separator= -s --single-step
  -S --single-line -t --tuples-only -T= --table-attr= -v= --set= --variable= -V --version -x --expanded -X --no-psqlrc -z --field-separator-zero -0
  --record-separator-zero -1 --single-transaction -? --help?`);
const PG_RESTORE = opts(`${PG_CONN} --role= -a --data-only -c --clean -C --create -d= --dbname= -e --exit-on-error -f= --file= -F= --format= -I= --index=
  -j= --jobs= -l --list -L= --use-list= -n= --schema= -N= --exclude-schema= -O --no-owner -P= --function= -s --schema-only -S= --superuser= -t= --table=
  -T= --trigger= -v --verbose -V --version -x --no-privileges --no-acl -1 --single-transaction --disable-triggers --enable-row-security --if-exists
  --no-comments --no-data-for-failed-tables --no-publications --no-security-labels --no-subscriptions --no-table-access-method --no-tablespaces --section=
  --strict-names --transaction-size= --use-set-session-authorization --filter= -? --help`);
const DROPDB = opts(`${PG_CONN} -e --echo -f --force -i --interactive -V --version --if-exists -? --help --maintenance-db=`);
const CREATEDB = opts(`${PG_CONN} -D= --tablespace= -e --echo -E= --encoding= -l= --locale= --lc-collate= --lc-ctype= --builtin-locale= --icu-locale=
  --icu-rules= --locale-provider= -O= --owner= -S= --strategy= -T= --template= -V --version -? --help --maintenance-db=`);
// mysql 8 / MariaDB; `--delimiter` is left out on purpose: a new delimiter would hide statements from the `;` split.
const MYSQL_COMMON = `-u= --user= -p? --password? -h= --host= -P= --port= -S= --socket= --protocol= -V --version -? --help -C --compress --connect-timeout=
  --ssl-mode= --ssl-ca= --ssl-capath= --ssl-cert= --ssl-key= --ssl-cipher= --tls-version= --default-character-set= --skip-ssl --ssl --get-server-public-key
  --server-public-key-path= --default-auth= --plugin-dir= --enable-cleartext-plugin --no-defaults --print-defaults --defaults-file= --defaults-extra-file=
  --defaults-group-suffix= --login-path= --compression-algorithms= --zstd-compression-level=`;
const MYSQL_T = opts(`${MYSQL_COMMON} -D= --database= -e= --execute= -B --batch -N --skip-column-names --column-names -s --silent -t --table -v --verbose
  -E --vertical -f --force -A --no-auto-rehash --auto-rehash -H --html -X --xml -r --raw -n --unbuffered -q --quick -U --safe-updates --i-am-a-dummy -I
  -w --wait -c --comments --skip-comments -L --skip-line-numbers --line-numbers -o --one-database --init-command= --max-allowed-packet= --net-buffer-length=
  --show-warnings --binary-mode --binary-as-hex --local-infile? --pager? --no-pager --skip-pager --tee= --no-tee --sigint-ignore --reconnect --skip-reconnect
  --syslog -j`);
const MYSQLADMIN = opts(`${MYSQL_COMMON} -f --force -s --silent -v --verbose -w? --wait? -c= --count= -i= --sleep= -r --relative -E --vertical
  --shutdown-timeout= -b --no-beep`);
const SQLITE_T = opts(dashes(`-append -ascii -bail -batch -box -column -cmd= -csv -deserialize -echo -init= -header -noheader -help -html -interactive
  -json -line -list -markdown -maxsize= -memtrace -mmap= -newline= -nofollow -nonce= -nullvalue= -quote -readonly -safe -separator= -stats -table -tabs
  -version -vfs= -zip -utf8 -no-rowid-in-view`));
const MONGO_T = opts(`--host= --port= -u= --username= -p= --password= --authenticationDatabase= --authenticationMechanism= --awsIamSessionToken=
  --gssapiServiceName= --sspiHostnameCanonicalization= --sspiRealmOverride= --quiet --nodb --norc --shell --eval= -f= --file= --json? --retryWrites? --tls
  --tlsCAFile= --tlsCertificateKeyFile= --tlsCertificateKeyFilePassword= --tlsAllowInvalidCertificates --tlsAllowInvalidHostnames --tlsCertificateSelector=
  --tlsCRLFile= --tlsDisabledProtocols= --tlsFIPSMode --tlsUseSystemCA --apiVersion= --apiStrict --apiDeprecationErrors --verbose --version -h --help
  --build-info --csfleLibraryPath= --cryptSharedLibPath= --keyVaultNamespace= --awsAccessKeyId= --awsSecretAccessKey= --awsSessionToken= --oidcFlows=
  --oidcRedirectUri= --oidcTrustedEndpoint --oidcIdTokenAsAccessToken --skipStartupWarnings --ssl --sslCAFile= --sslPEMKeyFile= --sslAllowInvalidCertificates
  --sslAllowInvalidHostnames --disableImplicitSessions --zstdCompressionLevel=`);
// redis-cli: its connection and output options and the read modes; --pipe, --eval, --cluster, --rdb and the rest are left out (they write, or are unknown).
const REDIS_T = opts(`-h= -p= -s= -a= --user= --pass= --askpass -u= -r= -i= -n= -2 -3 -x -X= -d= -D= -e -c -t= --tls --sni= --cacert= --cacertdir= --insecure
  --tls-ciphers= --tls-ciphersuites= --cert= --key= --raw --no-raw --quoted-input --csv --json --quoted-json --show-pushes= --verbose --no-auth-warning --help
  --version -v --scan --pattern= --count= --quoted-pattern= --bigkeys --memkeys --memkeys-samples= --hotkeys --stat --latency --latency-history --latency-dist`);
const REDIS_READ = new Set(['GET', 'MGET', 'KEYS', 'SCAN', 'INFO', 'PING', 'TTL', 'TYPE', 'EXISTS', 'HGET', 'HGETALL', 'LRANGE', 'SMEMBERS', 'ZRANGE']);
const REDIS_READ_MODES = ['--scan', '--bigkeys', '--memkeys', '--hotkeys', '--stat', '--latency', '--latency-history', '--latency-dist'];
const MYSQLADMIN_READ = new Set(['ping', 'status', 'version', 'variables', 'processlist', 'extended-status']);

type Family = 'pg' | 'mysql' | 'sqlite' | 'mongo' | 'redis';
const KIND: Readonly<Record<Family, ResourceKind>> = { pg: 'postgres', mysql: 'mysql', sqlite: 'sqlite', mongo: 'mongo', redis: 'redis' };
/** A client: its option table, the options whose value it runs inline, those that read SQL from a file, and those that only print and exit. */
interface Client { family: Family; table: OptTable; sql: readonly string[]; files: readonly string[]; info: readonly string[] }
const PG_INFO = ['-V', '--version', '-?', '--help'];
const MYSQL_INFO = ['-V', '--version', '-?', '-I', '--help'];
const MYSQL_CLIENT: Client = { family: 'mysql', table: MYSQL_T, sql: ['-e', '--execute', '--init-command'], files: [], info: MYSQL_INFO };
const MONGO_CLIENT: Client = { family: 'mongo', table: MONGO_T, sql: ['--eval'], files: ['-f', '--file'], info: ['--version', '-h', '--help', '--build-info'] };
const CLIENTS: Readonly<Record<DbClient, Client>> = {
  psql: { family: 'pg', table: PSQL, sql: ['-c', '--command'], files: ['-f', '--file'], info: PG_INFO },
  pg_restore: { family: 'pg', table: PG_RESTORE, sql: [], files: [], info: PG_INFO },
  dropdb: { family: 'pg', table: DROPDB, sql: [], files: [], info: PG_INFO },
  createdb: { family: 'pg', table: CREATEDB, sql: [], files: [], info: PG_INFO },
  mysql: MYSQL_CLIENT, mariadb: MYSQL_CLIENT,
  mysqladmin: { family: 'mysql', table: MYSQLADMIN, sql: [], files: [], info: MYSQL_INFO },
  sqlite3: { family: 'sqlite', table: SQLITE_T, sql: ['-cmd', '--cmd'], files: ['-init', '--init'], info: ['-version', '--version', '-help', '--help'] },
  mongosh: MONGO_CLIENT, mongo: MONGO_CLIENT,
  'redis-cli': { family: 'redis', table: REDIS_T, sql: [], files: [], info: ['--version', '-v', '--help'] },
};

/**
 * The options before a command's first operand, read with its table: the operand's index, and whether an option outside
 * the table came first. A word only the shell knows may be options too (`docker $FLAGS rm`): it counts as an unknown one.
 */
function head(args: Word[], table: OptTable, d: Dialect): { at: number; unknown: boolean } {
  let unknown = false;
  for (let i = 0; i < args.length; i++) {
    const t = args[i].text;
    if (args[i].dynamic) { unknown = true; continue; }
    if (t === '--') return { at: i + 1, unknown };
    if (t.length < 2 || !t.startsWith('-')) return { at: i, unknown };
    const sc = scan(args.slice(i, i + 2), table, d);
    if (sc.unknown) unknown = true;
    if (sc.vals.some(v => v.w === args[i + 1])) i++;
  }
  return { at: args.length, unknown };
}

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

const readWord = (w: Word): boolean => !w.dynamic && isReadSql(w.text);

/** Whether a client call only reads: it prints and exits, or (M5: with no file, `<` or pipe feeding it) all it runs inline reads. */
function clientReads(k: ClientCall, seg: Segment): boolean {
  const { c, sc, sql } = k;
  if (k.unknown) return false;
  if (c.info.some(f => sc.flags.has(f))) return true;
  // an operand only the shell knows may expand to more options (`$MORE` = `-c "drop table t"`)
  if (sc.ops.some(w => w.dynamic)) return false;
  if (seg.after === '|' || seg.redirects.some(r => r.op === '<') || c.files.some(f => sc.flags.has(f))) return false;
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
type Target = { kind: ResourceKind; name: string; host: string | null };

/** The host of a host spec (`h`, `h:port`, `[v6]:port`, a bare IPv6 literal); null for a Unix socket (a path, or Linux's abstract `@name`): this machine. */
function hostOf(spec: string): string | null {
  if (/^[/@]/.test(spec)) return null;
  if (spec.startsWith('[')) return spec.slice(0, spec.indexOf(']') + 1);
  return (spec.match(/:/g) ?? []).length > 1 ? spec : spec.replace(/:\d*$/, '');
}

interface DbUrl { kind: ResourceKind | null; given: boolean; hosts: string[]; ports: string[]; db: string; params: Map<string, string> }
const SCHEME_KIND: ReadonlyMap<string, ResourceKind> = new Map([['postgres', 'postgres'], ['postgresql', 'postgres'], ['mysql', 'mysql'],
  ['mariadb', 'mysql'], ['mongodb', 'mongo'], ['redis', 'redis'], ['rediss', 'redis']]);
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
  if (k.unknown || seg.dynamicArgs || sc.ops.some(w => w.dynamic)) return 'unknown';
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
  /** A postgres database word: a name, a conninfo string or a URI (their host, hostaddr and dbname). */
  const pgWord = (w: Word): boolean => {
    if (w.dynamic) return false;
    let kv: Map<string, string> | null;
    if (/^postgres(?:ql)?:\/\//i.test(w.text)) {
      const u = parseUrl(w.text);
      if (!u) return false;
      if (u.given) hostGiven = true;
      conn.hosts.push(...u.hosts);
      if (u.db) conn.names.push(u.db);
      kv = u.params;
    } else if (w.text.includes('=')) kv = conninfo(w.text);
    else return named(w);
    if (!kv || kv.has('service')) return false; // a service file names the host and the database
    for (const key of ['host', 'hostaddr']) { const v = kv.get(key); if (v !== undefined && !host(v)) return false; }
    const db = kv.get('dbname');
    if (db !== undefined) { if (/=|:\/\//.test(db)) return false; conn.names.push(db); }
    return true;
  };
  switch (k.c.family) {
    case 'pg': {
      if (env.PGSERVICE || env.PGSERVICEFILE) return 'unknown';
      if (name === 'pg_restore' && (sc.flags.has('-C') || sc.flags.has('--create'))) return 'unknown'; // the archive names the database it creates
      const ds = name === 'psql' || name === 'pg_restore' ? vals('-d', '--dbname') : [];
      if (name === 'pg_restore' && !ds.length) return null;
      if (!vals('-h', '--host').every(host)) return 'unknown';
      for (const w of ds.length ? ds : sc.ops.slice(0, 1)) if (!pgWord(w)) return 'unknown';
      if (!conn.names.length && env.PGDATABASE && !pgWord(env.PGDATABASE)) return 'unknown';
      if (!hostGiven && env.PGHOST && !host(env.PGHOST)) return 'unknown';
      if (env.PGHOSTADDR && !host(env.PGHOSTADDR)) return 'unknown'; // hostaddr is where libpq connects, whatever the host
      break;
    }
    case 'mysql': {
      if (['--login-path', '--defaults-file', '--defaults-extra-file', '--defaults-group-suffix'].some(f => sc.flags.has(f))) return 'unknown'; // an option file names the server
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
      // no file (memory, or stdin), a URI filename, or a path the shell hides: unknown
      const f = sc.ops[0];
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
  return { kind: c.kind, name: names[0], host: c.hosts.find(h => !isLocalHost(h)) ?? c.hosts[0] ?? null };
}

/** The target of a client (`DB_CLIENTS`): what it connects to, 'unknown' when it cannot be read, null when the segment is no database call. */
export function dbTarget(seg: Segment): { kind: ResourceKind; name: string; host: string | null } | 'unknown' | null {
  const k = clientCall(seg);
  const c = k ? clientConn(k, seg) : null;
  return c === null || c === 'unknown' ? c : toTarget(c);
}

// ---- SQL that acts past a registered target (T6-FAILCLOSED) ----------------------------------------------------------

// psql meta commands that only show or set display options; any other (\c, \!, \o, \g, \copy, \i, \gexec…) acts past the database.
const PSQL_SAFE_META = /^(?:d[a-z]*\+?|l\+?|list\+?|x|timing|pset|set|unset|echo|qecho|warn|conninfo|encoding|q|quit|a|t|f|h|help|\?|errverbose)$/;
// Postgres, per statement: other servers (foreign data wrappers, subscriptions), server programs and files, and the whole cluster (roles, settings).
const PG_STATEMENT = new RegExp([String.raw`^copy\b[^;]*\b(?:program|to\b(?!\s*stdout\b))`, String.raw`^(?:create|alter|drop)\s+(?:subscription|server|role|user|group|tablespace)\b`,
  String.raw`^(?:create|alter|drop)\s+user\s+mapping\b`, String.raw`^import\s+foreign\b`, String.raw`^alter\s+system\b`, String.raw`^reassign\s+owned\b`,
  String.raw`^create\s+extension\b[\s\S]*\b(?:dblink|postgres_fdw|file_fdw|adminpack|plsh|pl\w+u)\b`].join('|'));
// Postgres, anywhere: calls that reach another database or session, and languages with the server's shell.
const PG_ANYWHERE = /\b(?:dblink\w*|pg_(?:terminate|cancel)_backend|pg_reload_conf|lo_(?:import|export)|pg_file_write)\s*\(|\blanguage\s+(?:plpython\w*|plperlu|pltclu|plsh)\b/;
// MySQL, per statement: client commands (connect, source, system…) and server-wide statements.
const MYSQL_STATEMENT = new RegExp(String.raw`^(?:connect|source|system|tee|delimiter|kill|shutdown|clone|grant|revoke|flush|purge|reset|install|uninstall`
  + String.raw`|(?:create|drop|alter|rename)\s+user|set\s+(?:global|persist)|(?:start|stop|change)\s+(?:replica|slave|master|replication|group_replication))\b`);
const MYSQL_ANYWHERE = /\b(?:outfile|dumpfile|infile|federated)\b|@@global\b/;
const SQLITE_REACH = /\battach\b|\bvacuum\b[^;]*\binto\b|\bwritefile\s*\(|\bload_extension\s*\(/;
const MONGO_REACH = /getSiblingDB|\bgetDB\b|getMongo|\bMongo\s*\(|\bconnect\s*\(|adminCommand|\buse\s+\w|shutdownServer|\bload\s*\(|applyOps|\$out\b|\$merge\b|copyDatabase|cloneDatabase/i;
// sqlite3 dot commands that show, format or load into the open file; any other (.open, .shell, .output, .read, .backup…) acts past it.
const SQLITE_SAFE_DOT = new Set(['tables', 'schema', 'mode', 'headers', 'header', 'dump', 'indexes', 'indices', 'fullschema', 'width', 'nullvalue', 'separator',
  'timer', 'changes', 'echo', 'bail', 'print', 'show', 'databases', 'stats', 'eqp', 'quit', 'exit', 'help', 'import', 'dbinfo', 'version', 'parameter']);

const ownsDb = (kind: ResourceKind, name: string, own: string, ctx: GuardCtx): boolean =>
  name === own.toLowerCase() || (ctx.autonomous?.resources ?? []).some(r => r.kind === kind && r.name === name);

/** A CREATE/DROP/ALTER DATABASE that names a database the run did not register, or any other mention of a database (GRANT … ON DATABASE, database()). */
function namesOther(code: string, ddl: RegExp, word: RegExp, kind: ResourceKind, own: string, ctx: GuardCtx): boolean {
  for (const m of code.matchAll(ddl)) if (!ownsDb(kind, m[1], own, ctx)) return true;
  return word.test(code.replace(ddl, ' '));
}

function pgReaches(code: string, own: string, ctx: GuardCtx): boolean {
  if ([...code.matchAll(/\\([a-z]+\+?|[^a-z\s])/g)].some(m => !PSQL_SAFE_META.test(m[1]))) return true;
  if (namesOther(code, /\b(?:create|drop|alter)\s+database\s+(?:if\s+(?:not\s+)?exists\s+)?([^\s;(]+)/g, /\bdatabase\b/, 'postgres', own, ctx)) return true;
  return PG_ANYWHERE.test(code) || code.split(';').some(s => PG_STATEMENT.test(s.trim()));
}

function mysqlReaches(code: string, own: string, ctx: GuardCtx): boolean {
  if (/\\(?!g(?![a-z]))/.test(code)) return true; // a client command other than \g and \G (\u, \r, \!, \. …)
  if (namesOther(code, /\b(?:create|drop|alter)\s+(?:database|schema)\s+(?:if\s+(?:not\s+)?exists\s+)?([^\s;(]+)/g, /\b(?:database|schema)\b/, 'mysql', own, ctx)) return true;
  // a table named with its database (db.table) where a statement names its tables
  for (const m of code.matchAll(/\b(?:from|join|into|update|table|tables|truncate|to|exists)\s+([a-z0-9_$]+)\s*\.\s*[a-z0-9_$*]/g)) if (!ownsDb('mysql', m[1], own, ctx)) return true;
  for (const s of code.split(/[;\n]/).map(x => x.trim())) {
    const use = /^use\s+([^\s;]+)/.exec(s);
    if ((use && !ownsDb('mysql', use[1], own, ctx)) || MYSQL_STATEMENT.test(s)) return true;
  }
  return MYSQL_ANYWHERE.test(code);
}

/** Whether what a client runs on a registered target may act past it; SQL only the shell knows may. Files and stdin are not seen. */
function reachesPast(k: ClientCall, t: Target, ctx: GuardCtx): boolean {
  if (k.sql.some(w => w.dynamic)) return true;
  const texts = k.sql.map(w => w.text), fam = k.c.family;
  if (fam === 'mongo') return texts.some(s => MONGO_REACH.test(s));
  if (fam === 'redis') return texts.some(s => /\bmigrate\b/i.test(s)); // MIGRATE writes a key into another server
  for (const s of texts) {
    if (fam === 'sqlite' && s.split('\n').some(l => { const m = /^\s*\.(\w+)/.exec(l); return !!m && !SQLITE_SAFE_DOT.has(m[1].toLowerCase()); })) return true;
    const codes = sqlCodes(s);
    if (codes === null) return true;
    if (codes.some(code => (fam === 'pg' ? pgReaches(code, t.name, ctx) : fam === 'mysql' ? mysqlReaches(code, t.name, ctx) : SQLITE_REACH.test(code)))) return true;
  }
  return false;
}

// ---- verdicts -------------------------------------------------------------------------------------------------------

const instead = (ctx: GuardCtx): string => {
  const id = ctx.autonomous?.runId ?? '';
  return `register what you create with FORGE resource add (a name that starts with ${dbPrefix(id)} or ${dockerPrefix(id)}), then use that name; a script whose target you cannot see is never run`;
};
const D = (ctx: GuardCtx, what: string): GuardVerdict => deny('database', what, instead(ctx));
const U = (ctx: GuardCtx, what: string): GuardVerdict => D(ctx, `unknown target: ${what}`);

/** Whether a target is the run's: a registered resource of its kind (a sqlite file by its path), or a sqlite file inside the worktree (confinedIn, B1). */
function owned(t: Target, ctx: GuardCtx): boolean {
  const a = ctx.autonomous!;
  if (t.kind === 'sqlite') {
    return (a.worktree !== '' && confinedIn(t.name, a.worktree)) || a.resources.some(r => r.kind === 'sqlite' && confinedIn(t.name, r.name) && confinedIn(r.name, t.name));
  }
  return a.resources.some(r => r.kind === t.kind && r.name === t.name);
}

function targetVerdict(t: Target, ctx: GuardCtx): GuardVerdict | null {
  if (t.host !== null && !isLocalHost(t.host)) return D(ctx, `${t.kind} ${t.name} on ${t.host} is not on this machine`);
  return owned(t, ctx) ? null : D(ctx, `${t.kind} ${t.name} is not one the run registered`);
}

function clientVerdict(seg: Segment, ctx: GuardCtx): GuardVerdict | null {
  const k = clientCall(seg);
  if (!k || clientReads(k, seg)) return null;
  const c = clientConn(k, seg);
  if (c === null) return null;
  const t = c === 'unknown' ? c : toTarget(c);
  if (t === 'unknown') return U(ctx, `${k.name} writes to a database the hook cannot read`);
  return targetVerdict(t, ctx) ?? (reachesPast(k, t, ctx) ? U(ctx, `what ${k.name} is given acts past ${t.name}`) : null);
}

/** Where a DATABASE_URL (or --db-url) points: the run's own SQLite path inside the worktree, a target, or 'unknown'. */
function urlTarget(text: string, seg: Segment, ctx: GuardCtx): Target | 'inside' | 'unknown' {
  const lite = /^(?:file|sqlite3?):(.*)$/i.exec(text);
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
  if (!u || !u.kind || u.params.has('service')) return 'unknown';
  const conn: Conn = { kind: u.kind, names: [], hosts: [...u.hosts] };
  for (const key of ['host', 'hostaddr']) for (const s of (u.params.get(key) ?? '').split(',')) { const h = s ? hostOf(s) : null; if (h) conn.hosts.push(h); }
  if (u.kind === 'redis') conn.names.push(...(u.ports.length ? u.ports.map(p => String(Number(p))) : ['6379']));
  else for (const d of [u.db, u.params.get('dbname') ?? '']) if (d) conn.names.push(d);
  return toTarget(conn);
}

/** A migration or database script: its target is known only through the URL its own segment gives (DATABASE_URL, supabase's --db-url). */
function urlVerdict(seg: Segment, ctx: GuardCtx, what: string, urls: Word[], via: string): GuardVerdict | null {
  if (!urls.length) return U(ctx, `${what}, and only a ${via} on the command itself says which`);
  for (const u of urls) {
    if (u.dynamic) return U(ctx, `${what}, on the database a ${via} only the shell knows names`);
    const t = urlTarget(u.text, seg, ctx);
    if (t === 'inside') continue;
    if (t === 'unknown') return U(ctx, `${what}, on a database its ${via} does not let the hook read`);
    const v = targetVerdict(t, ctx);
    if (v) return v;
  }
  return null;
}
const envUrl = (seg: Segment): Word[] => (seg.env.DATABASE_URL ? [seg.env.DATABASE_URL] : []);

// ---- migrations and scripts (M15, H8, T6-SUPABASE-LOCAL) ------------------------------------------------------------

const INFO_WORDS = /^(?:--?help|-h|--?version|-v|-V|help|version)$/;
/** Whether a call of a MIGRATORS CLI migrates: a word before `--` matches its entry (a word only the shell knows may), unless it only prints help (`--help` anywhere) or its version. */
function isMigration(name: string, args: Word[]): boolean {
  if (!Object.hasOwn(MIGRATORS, name)) return false;
  const m = MIGRATORS[name];
  if (args.some(w => w.text === '--help') || (args.length > 0 && args.every(w => INFO_WORDS.test(w.text)))) return false;
  if (m === true) return true;
  const cut = args.findIndex(w => w.text === '--');
  return (cut < 0 ? args : args.slice(0, cut)).some(w => w.dynamic || (!w.text.startsWith('-') && m.test(w.text.toLowerCase())));
}

// Interpreters that run a script file, whose name is then the command (`python manage.py`, `ruby bin/rails`, `node node_modules/.bin/knex`):
// the family, its options that take a value, and those that run code given inline (no script file then).
const INTERPRETERS: ReadonlyArray<[RegExp, ReadonlySet<string>, ReadonlySet<string>]> = [
  [/^(?:python[0-9.]*|py)$/, new Set(['-W', '-X']), new Set(['-c', '-m'])],
  [/^ruby$/, new Set(['-r', '-I', '-C', '-E', '-F']), new Set(['-e'])],
  [/^node[0-9.]*$/, new Set(['-r', '--require', '--import', '--loader', '--experimental-loader', '-C', '--conditions', '--input-type']), new Set(['-e', '--eval', '-p', '--print'])],
];
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

/** T6-SUPABASE-LOCAL: `supabase db reset`, `supabase stop --no-backup`, `supabase migration up|down` (the local stack is the person's). */
function supabaseResets(args: Word[]): boolean {
  const ws = args.filter(w => !w.text.startsWith('-')).map(w => w.text.toLowerCase());
  const noBackup = args.some(w => w.text === '--no-backup');
  return (ws.includes('db') && ws.includes('reset')) || (ws.includes('stop') && noBackup) || (ws.includes('migration') && (ws.includes('up') || ws.includes('down')));
}
const flagValues = (args: Word[], flag: string): Word[] => args.flatMap((w, i) =>
  w.text === flag ? (args[i + 1] ? [args[i + 1]] : []) : w.text.startsWith(`${flag}=`) ? [{ ...w, text: w.text.slice(flag.length + 1) }] : []);

const words = (s: string): ReadonlySet<string> => new Set(s.split(/\s+/).filter(Boolean));
/** A package manager: its own options (with a value, and switches), its run verbs, whether a bare first word runs a script, and the words it skips (with how many words after them). */
interface Pm { valued: ReadonlySet<string>; switches: ReadonlySet<string>; run: ReadonlySet<string>; bare: boolean; skip: ReadonlyMap<string, number> }
const PMS: ReadonlyMap<string, Pm> = new Map([
  ['npm', { valued: words('-w --workspace --prefix -C --loglevel --script-shell --userconfig --globalconfig --cache --registry'),
    switches: words(`--workspaces -ws --include-workspace-root --if-present --ignore-scripts --foreground-scripts --silent -s -q --quiet -d --verbose
      --no-workspaces -y --yes --offline --prefer-offline --prefer-online`), run: words('run run-script rum urn'), bare: false, skip: new Map() }],
  ['pnpm', { valued: words('--filter -F --filter-prod -C --dir --workspace-concurrency --reporter --loglevel --resume-from --test-pattern --changed-files-ignore-pattern'),
    switches: words(`-r --recursive -w --workspace-root --if-present --parallel --stream --aggregate-output --silent -s --no-bail --bail --sequential --reverse
      --report-summary --shell-mode -c --include-workspace-root --fail-if-no-match --use-stderr`), run: words('run run-script'), bare: true, skip: new Map([['recursive', 0]]) }],
  ['yarn', { valued: words('--cwd --include --exclude -j --jobs --from --since'),
    switches: words(`-s --silent --verbose -A --all -R --recursive -p --parallel -i --interlaced -v -t --topological --topological-dev -W --worktree --no-private
      -n --dry-run --offline -T --top-level --binaries-only`), run: words('run'), bare: true, skip: new Map([['workspace', 1], ['workspaces', 0], ['foreach', 0]]) }],
  ['bun', { valued: words('--filter -F --cwd --elide-lines --shell -r --preload --env-file --tsconfig-override -c --config --conditions'),
    switches: words('--silent --if-present --bun -b --watch --hot --smol --no-install --no-clear-screen --no-env-file --workspaces --parallel --sequential'),
    run: words('run'), bare: true, skip: new Map() }],
]);

/**
 * The indexes of the words a package manager may run as a script (H8): the word after `run|run-script`, and for pnpm, yarn
 * and bun a first word that is not one of PM_OWN_COMMANDS. An option outside the manager's table is read both ways (a switch,
 * or an option with a value) so that the word after it is judged in both readings.
 */
function pmScripts(pm: Pm, args: Word[], i = 0, run = false, budget = 4): number[] {
  for (; i < args.length; i++) {
    const w = args[i], t = w.text;
    if (t === '--') return [];
    if (t.length > 1 && t.startsWith('-')) {
      const eq = t.indexOf('='), key = eq > 0 ? t.slice(0, eq) : t;
      if (pm.valued.has(key)) { if (eq < 0) i++; continue; }
      if (pm.switches.has(key) || eq > 0) continue;
      if (budget === 0) return args.map((_, j) => j).filter(j => j > i && !args[j].text.startsWith('-'));
      return [...pmScripts(pm, args, i + 1, run, budget - 1), ...pmScripts(pm, args, i + 2, run, budget - 1)];
    }
    if (w.dynamic) return [i];
    const lw = t.toLowerCase();
    if (!run && pm.run.has(lw)) { run = true; continue; }
    if (!run && pm.skip.has(lw)) { i += pm.skip.get(lw)!; continue; }
    if (!run && (!pm.bare || PM_OWN_COMMANDS.has(lw))) return [];
    return [i];
  }
  return [];
}

// make, just and task: their options that take a value; every other word before `--` (not a VAR=value) is a target.
const MAKES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['make', words(`-C --directory -f --file --makefile -I --include-dir -o --old-file --assume-old -W --what-if --new-file --assume-new -l --load-average
    -O --output-sync --eval --jobserver-style`)],
  ['just', words('-f --justfile -d --working-directory --shell --shell-arg --dotenv-filename --dotenv-path --color --chooser --command-color --list-heading --list-prefix')],
  ['task', words('-t --taskfile -d --dir -o --output -c --color --interval -C --concurrency')],
]);
function targetsOf(args: Word[], valued: ReadonlySet<string>): Word[] {
  const out: Word[] = [];
  for (let i = 0; i < args.length && args[i].text !== '--'; i++) {
    const w = args[i];
    if (w.text.startsWith('-')) { if (valued.has(w.text)) i++; continue; }
    if (!w.dynamic && /^[A-Za-z_]\w*=/.test(w.text)) continue;
    out.push(w);
  }
  return out;
}

// ---- containers, volumes and compose projects -----------------------------------------------------------------------

const DOCKER_GLOBAL = opts('--config= -c= --context= -D --debug -H= --host= -l= --log-level= --tls --tlscacert= --tlscert= --tlskey= --tlsverify -v --version -h --help');
const COMPOSE_GLOBAL = opts(`-f= --file= -p= --project-name= --project-directory= --env-file= --profile= --parallel= --ansi= --progress= --compatibility
  --dry-run --all-resources --verbose --no-ansi -v --version -h --help`);
const DOCKER_SUB: ReadonlyMap<string, OptTable> = new Map([
  ['rm', opts('-f --force -l --link -v --volumes --help')], ['stop', opts('-t= --time= --timeout= -s= --signal= --help')], ['kill', opts('-s= --signal= --help')],
  ['exec', opts('-d --detach --detach-keys= -e= --env= --env-file= -i --interactive --privileged -t --tty -u= --user= -w= --workdir= --help')],
  ['volume rm', opts('-f --force --help')],
]);

/** A container or volume name of the run: registered as that kind, or under a registered compose project (`<project>-…`, `<project>_…`). */
const dockerOwned = (name: string, kind: ResourceKind, ctx: GuardCtx): boolean => (ctx.autonomous?.resources ?? []).some(r =>
  (r.kind === kind && r.name === name) || (r.kind === 'compose' && (name === r.name || name.startsWith(`${r.name}-`) || name.startsWith(`${r.name}_`))));

function composeVerdict(args: Word[], seg: Segment, ctx: GuardCtx): GuardVerdict | null {
  const h = head(args, COMPOSE_GLOBAL, seg.dialect), sub = args[h.at]?.text.toLowerCase() ?? '';
  if (h.unknown) return args.some(w => COMPOSE_DESTROYERS.has(w.text.toLowerCase())) ? U(ctx, 'compose has an option the hook does not know') : null;
  if (!COMPOSE_DESTROYERS.has(sub)) return null;
  const sc = scan(args.slice(0, h.at), COMPOSE_GLOBAL, seg.dialect);
  const flag = (...keys: string[]): Word[] => sc.vals.filter(v => keys.includes(v.key)).map(v => v.w);
  let projects = flag('-p', '--project-name');
  if (!projects.length && seg.env.COMPOSE_PROJECT_NAME) projects = [seg.env.COMPOSE_PROJECT_NAME];
  if (!projects.length) {
    // the folder names the project, unless a compose file, a project folder or an env file elsewhere does
    if (flag('-f', '--file', '--project-directory', '--env-file').length || seg.cwd === null) return U(ctx, `compose ${sub} acts on a project the hook cannot name`);
    projects = [{ text: path.basename(seg.cwd).toLowerCase().replace(/[^a-z0-9_-]/g, '').replace(/^[-_]+/, ''), dynamic: false, glob: false }];
  }
  for (const p of projects) {
    if (p.dynamic) return U(ctx, `compose ${sub} acts on a project only the shell names`);
    if (!(ctx.autonomous?.resources ?? []).some(r => r.kind === 'compose' && r.name === p.text)) return D(ctx, `compose project ${p.text} is not one the run registered`);
  }
  return null;
}

function dockerVerdict(name: string, args: Word[], seg: Segment, ctx: GuardCtx): GuardVerdict | null {
  if (name.endsWith('-compose')) return composeVerdict(args, seg, ctx);
  const g = head(args, DOCKER_GLOBAL, seg.dialect), rest0 = args.slice(g.at);
  // an option the global table does not know hides which word is the subcommand
  if (g.unknown) return rest0.some(w => DESTROY_WORDS.has(w.text.toLowerCase())) ? U(ctx, `${name} has a global option the hook does not know`) : null;
  const w0 = rest0[0]?.text.toLowerCase() ?? '', w1 = rest0[1]?.text.toLowerCase() ?? '';
  if (w0 === 'compose') return composeVerdict(rest0.slice(1), seg, ctx);
  const two = `${w0} ${w1}`;
  const key = DOCKER_DESTROYERS.includes(two) ? two : DOCKER_ALIAS.get(two) ?? (DOCKER_DESTROYERS.includes(w0) ? w0 : null);
  if (key === null) return null;
  if (key.endsWith('prune')) return D(ctx, `${name} ${key} deletes containers or volumes the run did not register`);
  const rest = rest0.slice(key === w0 ? 1 : 2), kind: ResourceKind = key === 'volume rm' ? 'volume' : 'container';
  const table = DOCKER_SUB.get(key === 'container rm' ? 'rm' : key)!;
  let names: Word[];
  if (key === 'exec') {
    const h = head(rest, table, seg.dialect);
    if (h.unknown) return U(ctx, `${name} exec has an option the hook does not know`);
    names = rest.slice(h.at, h.at + 1);
  } else {
    const sc = scan(rest, table, seg.dialect);
    if (sc.unknown) return U(ctx, `${name} ${key} has an option the hook does not know`);
    names = sc.ops;
  }
  for (const w of names) {
    if (w.dynamic) return U(ctx, `${name} ${key} acts on a ${kind} only the shell names`);
    if (!dockerOwned(w.text, kind, ctx)) return D(ctx, `${kind} ${w.text} is not one the run registered`);
  }
  return null;
}

// ---- MCP tools (H9) -------------------------------------------------------------------------------------------------

const MCP_DB_WORDS = new Set(['sql', 'postgres', 'postgresql', 'pg', 'mysql', 'sqlite', 'db', 'database', 'supabase', 'neon', 'mongo', 'mongodb', 'redis', 'bigquery', 'snowflake']);
const SQL_START = new Set(['select', 'insert', 'update', 'delete', 'merge', 'with', 'create', 'drop', 'alter', 'truncate', 'grant', 'revoke', 'copy', 'call',
  'do', 'explain', 'show', 'describe', 'set', 'begin', 'commit', 'vacuum', 'reindex']);

/** The first word of a text past blanks, `;`, `(` and comments; `*` when a comment never closes. */
function leadWord(text: string): string {
  let s = text;
  for (;;) {
    s = s.replace(/^[\s;(]+/, '');
    if (s.startsWith('--') || s.startsWith('#')) { const e = s.indexOf('\n'); s = e < 0 ? '' : s.slice(e + 1); continue; }
    if (s.startsWith('/*')) { const e = s.indexOf('*/'); if (e < 0) return '*'; s = s.slice(e + 2); continue; }
    return /^[a-z]+/i.exec(s)?.[0].toLowerCase() ?? '';
  }
}
const strings = (v: unknown): string[] => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** An MCP tool given SQL that writes (a field named sql/statement, or a query field when the tool's name or the text says SQL): unknown target. */
function mcpVerdict(input: GuardInput, ctx: GuardCtx): GuardVerdict | null {
  const name = input.tool_name;
  const dbNamed = name.split('__').flatMap(p => mcpWords(p)).some(w => MCP_DB_WORDS.has(w));
  for (const [key, v] of Object.entries(input.tool_input)) {
    const k = key.toLowerCase(), always = k.includes('sql') || k === 'statement' || k === 'statements', query = k === 'query' || k === 'queries';
    if (!always && !query) continue;
    for (const s of strings(v)) {
      const sql = always || dbNamed || leadWord(s) === '*' || SQL_START.has(leadWord(s));
      if (sql && !isReadSql(s)) return U(ctx, `${name} is given SQL that writes, on a database the hook cannot see`);
    }
  }
  return null;
}

// ---- the rule -------------------------------------------------------------------------------------------------------

function dbSeg(seg: Segment, ctx: GuardCtx): GuardVerdict | null {
  if (!seg.argv.length || seg.argv[0].dynamic) return null;
  const eff = effectiveCommand(seg);
  if (eff === null || 'cancel' in eff) return null; // T6-LAUNCHER-REUSE: a runner the hook cannot read is network's to deny
  const { name } = eff;
  // the arguments xargs or find -exec add are one more word only the shell knows (`docker ps -aq | xargs docker rm -f`)
  const args = seg.dynamicArgs ? [...eff.args, { text: '', dynamic: true, glob: false }] : eff.args;
  const s: Segment = { ...seg, argv: [{ text: name, dynamic: false, glob: false }, ...args] };
  if (DB_CLIENTS.has(name)) return clientVerdict(s, ctx);
  if (DOCKERS.has(name)) return dockerVerdict(name, args, s, ctx);
  const run = scriptOf(name, args) ?? { name, args };
  if (isMigration(run.name, run.args)) return urlVerdict(seg, ctx, `${run.name} migrates a database`, envUrl(seg), 'DATABASE_URL');
  if (name === 'supabase' && supabaseResets(args)) return urlVerdict(seg, ctx, 'supabase resets a database', flagValues(args, '--db-url'), '--db-url');
  const pm = PMS.get(name), make = MAKES.get(name);
  const cands = pm ? pmScripts(pm, args).map(i => ({ w: args[i], rest: args.slice(i + 1) })) : make ? targetsOf(args, make).map(w => ({ w, rest: [] })) : [];
  for (const { w, rest } of cands) {
    if (w.dynamic) return U(ctx, `${name} runs a script whose name only the shell knows`);
    // a script whose name says database, or (pnpm/yarn/bun <bin>) a migrator's bin
    if (isDbScript(w.text) || (pm && isMigration(commandName(w), rest))) return urlVerdict(seg, ctx, `${name} ${w.text} looks like a database script`, envUrl(seg), 'DATABASE_URL');
  }
  return null;
}

export const databaseRule: GuardRule = {
  id: 'database',
  check(input: GuardInput, ctx: GuardCtx): GuardVerdict | null {
    if (!ctx.autonomous) return null;
    if (input.tool_name.startsWith('mcp__')) return mcpVerdict(input, ctx);
    const segs = bashSegments(input, ctx);
    if (!segs) return null;
    for (const seg of segs) { const v = dbSeg(seg, ctx); if (v) return v; }
    return null;
  },
};
