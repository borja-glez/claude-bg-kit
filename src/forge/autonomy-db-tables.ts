// Plan 6b-1, Task 6 (fix 1, T6-SPLIT): the database rule's data: each client's option table, the migrators, the package
// managers' script words, the docker subcommands and the SQL keyword lists. Data only: the logic is in autonomy-db.ts (and
// autonomy-docker.ts for containers), which re-exports the brief's lists from here.
import { DOCKER_CP, T, type OptTable } from './autonomy-tables.js';
import type { ResourceKind } from './resources.js';

// ---- clients ----------------------------------------------------------------------------------------------------------

export const DB_CLIENT_NAMES = ['psql', 'pg_restore', 'dropdb', 'createdb', 'mysql', 'mariadb', 'mysqladmin', 'sqlite3', 'mongosh', 'mongo', 'redis-cli'] as const;
export type DbClient = (typeof DB_CLIENT_NAMES)[number];
export const DB_CLIENTS: ReadonlySet<string> = new Set(DB_CLIENT_NAMES);

export type Family = 'pg' | 'mysql' | 'sqlite' | 'mongo' | 'redis';
export const KIND: Readonly<Record<Family, ResourceKind>> = { pg: 'postgres', mysql: 'mysql', sqlite: 'sqlite', mongo: 'mongo', redis: 'redis' };
/**
 * A client: its option table, the options whose value it runs inline, those that read SQL from a file, those that only
 * print and exit, and those that write a client-side file (T6-SQL-FILES: allowed only on a literal path inside the roots).
 */
export interface Client { family: Family; table: OptTable; sql: readonly string[]; files: readonly string[]; info: readonly string[]; out: readonly string[] }

/** sqlite3 reads each option with one dash or two. */
const dashes = (spec: string): string => spec.split(/\s+/).filter(Boolean).flatMap(t => [t, `-${t}`]).join(' ');

const PG_CONN = '-h= --host= -p= --port= -U= --username= -w --no-password -W --password';
const PSQL = T(`${PG_CONN} -a --echo-all -A --no-align -b --echo-errors -c= --command= --csv -d= --dbname= -e --echo-queries -E --echo-hidden -f= --file=
  -F= --field-separator= -H --html -l --list -L= --log-file= -n --no-readline -o= --output= -P= --pset= -q --quiet -R= --record-separator= -s --single-step
  -S --single-line -t --tuples-only -T= --table-attr= -v= --set= --variable= -V --version -x --expanded -X --no-psqlrc -z --field-separator-zero -0
  --record-separator-zero -1 --single-transaction -? --help?`);
const PG_RESTORE = T(`${PG_CONN} --role= -a --data-only -c --clean -C --create -d= --dbname= -e --exit-on-error -f= --file= -F= --format= -I= --index=
  -j= --jobs= -l --list -L= --use-list= -n= --schema= -N= --exclude-schema= -O --no-owner -P= --function= -s --schema-only -S= --superuser= -t= --table=
  -T= --trigger= -v --verbose -V --version -x --no-privileges --no-acl -1 --single-transaction --disable-triggers --enable-row-security --if-exists
  --no-comments --no-data-for-failed-tables --no-publications --no-security-labels --no-subscriptions --no-table-access-method --no-tablespaces --section=
  --strict-names --transaction-size= --use-set-session-authorization --filter= -? --help`);
const DROPDB = T(`${PG_CONN} -e --echo -f --force -i --interactive -V --version --if-exists -? --help --maintenance-db=`);
const CREATEDB = T(`${PG_CONN} -D= --tablespace= -e --echo -E= --encoding= -l= --locale= --lc-collate= --lc-ctype= --builtin-locale= --icu-locale=
  --icu-rules= --locale-provider= -O= --owner= -S= --strategy= -T= --template= -V --version -? --help --maintenance-db=`);
// mysql 8 / MariaDB; `--delimiter` is left out on purpose: a new delimiter would hide statements from the `;` split.
const MYSQL_COMMON = `-u= --user= -p? --password? -h= --host= -P= --port= -S= --socket= --protocol= -V --version -? --help -C --compress --connect-timeout=
  --ssl-mode= --ssl-ca= --ssl-capath= --ssl-cert= --ssl-key= --ssl-cipher= --tls-version= --default-character-set= --skip-ssl --ssl --get-server-public-key
  --server-public-key-path= --default-auth= --plugin-dir= --enable-cleartext-plugin --no-defaults --print-defaults --defaults-file= --defaults-extra-file=
  --defaults-group-suffix= --login-path= --compression-algorithms= --zstd-compression-level=`;
const MYSQL_T = T(`${MYSQL_COMMON} -D= --database= -e= --execute= -B --batch -N --skip-column-names --column-names -s --silent -t --table -v --verbose
  -E --vertical -f --force -A --no-auto-rehash --auto-rehash -H --html -X --xml -r --raw -n --unbuffered -q --quick -U --safe-updates --i-am-a-dummy -I
  -w --wait -c --comments --skip-comments -L --skip-line-numbers --line-numbers -o --one-database --init-command= --max-allowed-packet= --net-buffer-length=
  --show-warnings --binary-mode --binary-as-hex --local-infile? --pager? --no-pager --skip-pager --tee= --no-tee --sigint-ignore --reconnect --skip-reconnect
  --syslog -j`);
const MYSQLADMIN = T(`${MYSQL_COMMON} -f --force -s --silent -v --verbose -w? --wait? -c= --count= -i= --sleep= -r --relative -E --vertical
  --shutdown-timeout= -b --no-beep`);
const SQLITE_T = T(dashes(`-append -ascii -bail -batch -box -column -cmd= -csv -deserialize -echo -init= -header -noheader -help -html -interactive
  -json -line -list -markdown -maxsize= -memtrace -mmap= -newline= -nofollow -nonce= -nullvalue= -quote -readonly -safe -separator= -stats -table -tabs
  -version -vfs= -zip -utf8 -no-rowid-in-view`));
const MONGO_T = T(`--host= --port= -u= --username= -p= --password= --authenticationDatabase= --authenticationMechanism= --awsIamSessionToken=
  --gssapiServiceName= --sspiHostnameCanonicalization= --sspiRealmOverride= --quiet --nodb --norc --shell --eval= -f= --file= --json? --retryWrites? --tls
  --tlsCAFile= --tlsCertificateKeyFile= --tlsCertificateKeyFilePassword= --tlsAllowInvalidCertificates --tlsAllowInvalidHostnames --tlsCertificateSelector=
  --tlsCRLFile= --tlsDisabledProtocols= --tlsFIPSMode --tlsUseSystemCA --apiVersion= --apiStrict --apiDeprecationErrors --verbose --version -h --help
  --build-info --csfleLibraryPath= --cryptSharedLibPath= --keyVaultNamespace= --awsAccessKeyId= --awsSecretAccessKey= --awsSessionToken= --oidcFlows=
  --oidcRedirectUri= --oidcTrustedEndpoint --oidcIdTokenAsAccessToken --skipStartupWarnings --ssl --sslCAFile= --sslPEMKeyFile= --sslAllowInvalidCertificates
  --sslAllowInvalidHostnames --disableImplicitSessions --zstdCompressionLevel=`);
// redis-cli: its connection and output options and the read modes; --pipe, --eval, --cluster, --rdb and the rest are left out (they write, or are unknown).
const REDIS_T = T(`-h= -p= -s= -a= --user= --pass= --askpass -u= -r= -i= -n= -2 -3 -x -X= -d= -D= -e -c -t= --tls --sni= --cacert= --cacertdir= --insecure
  --tls-ciphers= --tls-ciphersuites= --cert= --key= --raw --no-raw --quoted-input --csv --json --quoted-json --show-pushes= --verbose --no-auth-warning --help
  --version -v --scan --pattern= --count= --quoted-pattern= --bigkeys --memkeys --memkeys-samples= --hotkeys --stat --latency --latency-history --latency-dist`);
export const REDIS_READ = new Set(['GET', 'MGET', 'KEYS', 'SCAN', 'INFO', 'PING', 'TTL', 'TYPE', 'EXISTS', 'HGET', 'HGETALL', 'LRANGE', 'SMEMBERS', 'ZRANGE']);
export const REDIS_READ_MODES = ['--scan', '--bigkeys', '--memkeys', '--hotkeys', '--stat', '--latency', '--latency-history', '--latency-dist'];
export const MYSQLADMIN_READ = new Set(['ping', 'status', 'version', 'variables', 'processlist', 'extended-status']);

const PG_INFO = ['-V', '--version', '-?', '--help'];
const MYSQL_INFO = ['-V', '--version', '-?', '-I', '--help'];
const MYSQL_CLIENT: Client = { family: 'mysql', table: MYSQL_T, sql: ['-e', '--execute', '--init-command'], files: [], info: MYSQL_INFO, out: ['--tee'] };
const MONGO_CLIENT: Client = { family: 'mongo', table: MONGO_T, sql: ['--eval'], files: ['-f', '--file'], info: ['--version', '-h', '--help', '--build-info'], out: [] };
export const CLIENTS: Readonly<Record<DbClient, Client>> = {
  psql: { family: 'pg', table: PSQL, sql: ['-c', '--command'], files: ['-f', '--file'], info: PG_INFO, out: ['-o', '--output', '-L', '--log-file'] },
  pg_restore: { family: 'pg', table: PG_RESTORE, sql: [], files: [], info: PG_INFO, out: [] },
  dropdb: { family: 'pg', table: DROPDB, sql: [], files: [], info: PG_INFO, out: [] },
  createdb: { family: 'pg', table: CREATEDB, sql: [], files: [], info: PG_INFO, out: [] },
  mysql: MYSQL_CLIENT, mariadb: MYSQL_CLIENT,
  mysqladmin: { family: 'mysql', table: MYSQLADMIN, sql: [], files: [], info: MYSQL_INFO, out: [] },
  sqlite3: { family: 'sqlite', table: SQLITE_T, sql: ['-cmd', '--cmd'], files: ['-init', '--init'], info: ['-version', '--version', '-help', '--help'], out: [] },
  mongosh: MONGO_CLIENT, mongo: MONGO_CLIENT,
  'redis-cli': { family: 'redis', table: REDIS_T, sql: [], files: [], info: ['--version', '-v', '--help'], out: [] },
};

// ---- migrators (M15, T6-MORE-MIGRATORS, T6-MIGRATOR-URLS, T6-MIGRATOR-TARGET) ---------------------------------------

/**
 * A migration CLI. `write` and `safe` are read against its command words joined by spaces (options and `--` left out,
 * lower-cased; `true`: every call). `urls`: its options whose literal value is the target (T6-MIGRATOR-URLS). `env`: the
 * variables it reads its target from by design (T6-MIGRATOR-TARGET b). prisma and goose are read by their own forms.
 */
export interface Migrator { write: RegExp | true; safe?: RegExp; urls?: readonly string[]; env?: readonly string[] }
const W = (alts: string): RegExp => new RegExp(String.raw`(?:^| )(?:${alts})(?= |$)`);
const DJANGO: Migrator = { write: W('migrate|flush|loaddata|sqlflush') };
const TYPEORM: Migrator = { write: W(String.raw`(?:migration|schema):\S+`), safe: W('migration:(?:create|generate|show)') };
const SEQUELIZE: Migrator = { write: W(String.raw`db:\S+`), safe: W('migration:generate'), urls: ['--url'] };
const RAILS: Migrator = { write: W(String.raw`db:\S+`), env: ['DATABASE_URL'] };
export const MIGRATORS: Readonly<Record<string, Migrator>> = {
  prisma: { write: W('migrate|db'), safe: W('migrate (?:status|diff)|db pull'), urls: ['--url'] },
  rails: RAILS, rake: RAILS,
  knex: { write: W(String.raw`(?:migrate|seed):\S+`), safe: W('migrate:(?:make|status|list)|seed:make') },
  sequelize: SEQUELIZE, 'sequelize-cli': SEQUELIZE,
  typeorm: TYPEORM, 'typeorm-ts-node-commonjs': TYPEORM, 'typeorm-ts-node-esm': TYPEORM,
  'drizzle-kit': { write: W(String.raw`(?:push|migrate|drop)(?::\S+)?`), urls: ['--url'] },
  alembic: { write: W('upgrade|downgrade') },
  'manage.py': DJANGO, 'django-admin': DJANGO, django: DJANGO,
  flyway: { write: true, urls: ['-url'] }, liquibase: { write: true, urls: ['--url'] },
  dbmate: { write: true, safe: W('new|n|status'), urls: ['--url', '-u'], env: ['DATABASE_URL'] },
  goose: { write: true }, migrate: { write: true, urls: ['-database'] },
  flask: { write: W('db (?:upgrade|downgrade|migrate|stamp)') },
  artisan: { write: W(String.raw`migrate(?::\S+)?|db:\S+`), safe: W('make:migration|migrate:status') },
  dotnet: { write: W(String.raw`ef(?: \S+)* (?:database (?:update|drop)|migrations remove)`) },
  'dotnet-ef': { write: W('database (?:update|drop)|migrations remove') },
  mix: { write: W(String.raw`ecto\.\S+`), safe: W(String.raw`ecto\.gen\.\S+`) },
  sqlx: { write: W(String.raw`migrate (?:run|revert)|database \S+`), urls: ['--database-url', '-D'], env: ['DATABASE_URL'] },
  diesel: { write: W(String.raw`migration (?:run|revert|redo)|database \S+`), urls: ['--database-url'], env: ['DATABASE_URL'] },
  atlas: { write: W('schema (?:apply|clean)|migrate apply'), urls: ['--url', '-u'] },
};
// goose: its options, and the drivers whose DSN the rule reads (the kind of database each one is).
export const GOOSE_T = T('-dir= -table= -env= -certfile= -ssl-cert= -ssl-key= -timeout= -v -h -s -allow-missing -no-versioning -no-color -version');
export const GOOSE_DRIVERS: ReadonlyMap<string, ResourceKind> = new Map([['postgres', 'postgres'], ['pgx', 'postgres'], ['redshift', 'postgres'],
  ['mysql', 'mysql'], ['tidb', 'mysql'], ['sqlite3', 'sqlite'], ['sqlite', 'sqlite']]);
export const INFO_WORDS = /^(?:--?help|-h|--?version|-v|-V|help|version)$/;

// Interpreters that run a script file, whose name is then the command (`python manage.py`, `ruby bin/rails`, `php artisan`):
// the family, its options that take a value, and those that run code given inline (no script file then).
export const INTERPRETERS: ReadonlyArray<[RegExp, ReadonlySet<string>, ReadonlySet<string>]> = [
  [/^(?:python[0-9.]*|py)$/, new Set(['-W', '-X']), new Set(['-c', '-m'])],
  [/^ruby$/, new Set(['-r', '-I', '-C', '-E', '-F']), new Set(['-e'])],
  [/^node[0-9.]*$/, new Set(['-r', '--require', '--import', '--loader', '--experimental-loader', '-C', '--conditions', '--input-type']), new Set(['-e', '--eval', '-p', '--print'])],
  [/^php[0-9.]*$/, new Set(['-c', '-d', '-z']), new Set(['-r', '-a'])],
];

// ---- package scripts (H8, I1, m1) -------------------------------------------------------------------------------------

/** The commands of pnpm, yarn and bun that are not a script: any other first word runs the script (or the bin) of that name. */
export const PM_OWN_COMMANDS: ReadonlySet<string> = new Set(['install', 'i', 'add', 'remove', 'rm', 'uninstall', 'update', 'up', 'upgrade', 'link',
  'unlink', 'list', 'ls', 'outdated', 'why', 'audit', 'publish', 'pack', 'init', 'create', 'exec', 'dlx', 'x', 'run', 'run-script', 'store', 'config',
  'info', 'view', 'login', 'logout', 'whoami', 'global', 'cache', 'patch', 'import', 'rebuild', 'prune', 'dedupe', 'bin', 'root', 'setup', 'env', 'fetch',
  'licenses', 'test', 't', 'start']);
// Each manager's run verbs, and whether a bare first word runs a script (pnpm, yarn, bun); its own options are autonomy-net's MANAGERS (one list).
export const PM_RUN: ReadonlyMap<string, { run: ReadonlySet<string>; bare: boolean }> = new Map([
  ['npm', { run: new Set(['run', 'run-script', 'rum', 'urn']), bare: false }], ['pnpm', { run: new Set(['run', 'run-script']), bare: true }],
  ['yarn', { run: new Set(['run']), bare: true }], ['bun', { run: new Set(['run']), bare: true }],
]);
// H8: the words of a database script's name.
export const DB_WORDS = new Set(['db', 'database', 'migrate', 'migration', 'migrations', 'seed', 'seeds', 'drop', 'reset', 'truncate', 'wipe', 'purge', 'flush', 'fixtures']);
export const DB_GLUED = /^(?:db|database)(?:reset|drop|seeds?|migrate|push|wipe|sync)$|^(?:reset|drop|seed|migrate|wipe)(?:db|database)$/;
const set = (s: string): ReadonlySet<string> => new Set(s.split(/\s+/).filter(Boolean));
// make, just, task and turbo: their options that take a value; every other word (not a VAR=value) is a target or task (turbo's `run` aside).
export const MAKES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['make', set(`-C --directory -f --file --makefile -I --include-dir -o --old-file --assume-old -W --what-if --new-file --assume-new -l --load-average
    -O --output-sync --eval --jobserver-style`)],
  ['just', set('-f --justfile -d --working-directory --shell --shell-arg --dotenv-filename --dotenv-path --color --chooser --command-color --list-heading --list-prefix')],
  ['task', set('-t --taskfile -d --dir -o --output -c --color --interval -C --concurrency')],
  ['turbo', set(`--filter -F --concurrency --cache-dir --env-mode --log-order --output-logs --graph --summarize --profile --team --token --api --cwd --heap
    --log-prefix --cache --affected-base`)],
]);

// ---- containers ---------------------------------------------------------------------------------------------------------

/** The docker/podman/nerdctl subcommands that destroy or reach into a container or volume: each name they act on must be the run's. */
export const DOCKER_DESTROYERS: readonly string[] = ['rm', 'container rm', 'volume rm', 'volume prune', 'container prune', 'system prune', 'compose down', 'stop', 'kill', 'exec'];
// The same subcommands by their other names: docker's aliases, the `container` group, podman's pods (m7).
export const DOCKER_ALIAS: ReadonlyMap<string, string> = new Map([['container remove', 'container rm'], ['volume remove', 'volume rm'], ['container stop', 'stop'],
  ['container kill', 'kill'], ['container exec', 'exec'], ['pod rm', 'pod rm'], ['pod remove', 'pod rm']]);
// Always denied: they delete every container or volume they find (prune, podman system reset).
export const DOCKER_ALWAYS: ReadonlySet<string> = new Set(['volume prune', 'container prune', 'system prune', 'system reset', 'pod prune']);
// compose subcommands judged by the project they act on; `up` too when it renews the anonymous volumes (I3).
export const COMPOSE_DESTROYERS: ReadonlySet<string> = new Set(['down', 'rm', 'stop', 'kill', 'exec', 'run']);
export const DESTROY_WORDS: ReadonlySet<string> = new Set(['rm', 'remove', 'prune', 'stop', 'kill', 'exec', 'down', 'run', 'create', 'cp', 'reset', 'up']);
export const DOCKER_SUB: ReadonlyMap<string, OptTable> = new Map([
  ['rm', T('-f --force -l --link -v --volumes --help')], ['stop', T('-t= --time= --timeout= -s= --signal= --help')], ['kill', T('-s= --signal= --help')],
  ['exec', T(`-d --detach --detach-keys= -e= --env= --env-file= -i --interactive --privileged -t --tty -u= --user= -w= --workdir= --help -l --latest
    --preserve-fds= --preserve-fd=`)],
  ['volume rm', T('-f --force --help')], ['pod rm', T('-f --force -i --ignore -t= --time= --pod-id-file= --help')],
  ['cp', DOCKER_CP],
]);
/** The names a container uses for the machine it runs on: for the database rule a local host, so the database name must still be registered. */
export const DOCKER_HOSTS: ReadonlySet<string> = new Set(['host.docker.internal', 'gateway.docker.internal', '172.17.0.1']);

// ---- SQL ----------------------------------------------------------------------------------------------------------------

export const READ_START = new Set(['select', 'show', 'explain', 'describe', 'with']);
export const WITH_WRITES = /\b(?:insert|update|delete|merge|truncate|drop|alter|create|grant|revoke|copy|call|do)\b/;
export const FOR_LOCK = /\bfor\s+(?:no\s+key\s+)?update\b|\bfor\s+(?:key\s+)?share\b|\block\s+in\s+share\s+mode\b/;
// The functions a SELECT calls for their effect (M5): the brief's list, then the families they belong to (every dblink
// call, the large-object functions, the advisory locks), pg_file_write (m4) and the sqlite shell's file and extension functions.
export const SIDE_EFFECTS = new RegExp(String.raw`\b(?:pg_terminate_backend|pg_cancel_backend|setval|nextval|lo_unlink|lo_import|lo_export|dblink_exec`
  + String.raw`|pg_reload_conf|set_config|pg_advisory_lock|dblink\w*|lo_\w+|pg_(?:try_)?advisory\w*|pg_file_write|writefile|load_extension)\s*\(`);
// psql's `\d…` and `\l`, sqlite's `.tables` and `.schema`, with arguments on their own line and no other client command.
export const META_READ = /^(?:\\(?:d[a-z+]*|l\+?|list\+?)|\.(?:tables|schema))(?:[ \t][^\\\n]*)?$/;

// psql meta commands that only show or set display options; those that read or write a client file (T6-SQL-FILES, judged by
// their path); any other (\!, \c, \gexec, \e, \cd…) acts past the database.
export const PSQL_SAFE_META = /^(?:d[a-z]*\+?|l\+?|list\+?|x|timing|pset|set|unset|echo|qecho|warn|conninfo|encoding|q|quit|a|t|f|h|help|\?|errverbose)$/;
export const PSQL_FILE_META: ReadonlySet<string> = new Set(['copy', 'o', 'out', 'w', 'write', 'g', 'gx', 'i', 'ir', 'include', 'include_relative', 'lo_import', 'lo_export']);
// Postgres, per statement: other servers (foreign data wrappers, subscriptions) and the whole cluster (roles, settings).
export const PG_STATEMENT = new RegExp([String.raw`^(?:create|alter|drop)\s+(?:subscription|server|role|user|group|tablespace)\b`,
  String.raw`^(?:create|alter|drop)\s+user\s+mapping\b`, String.raw`^import\s+foreign\b`, String.raw`^alter\s+system\b`, String.raw`^reassign\s+owned\b`,
  String.raw`^create\s+extension\b[\s\S]*\b(?:dblink|postgres_fdw|file_fdw|adminpack|plsh|pl\w+u)\b`].join('|'));
// Postgres, anywhere: calls that reach another database, session or server file, languages with the server's shell, and
// EXECUTE (dynamic SQL in a DO or function body, m4; GRANT EXECUTE aside).
export const PG_ANYWHERE = new RegExp(String.raw`\b(?:dblink\w*|pg_(?:terminate|cancel)_backend|pg_reload_conf|lo_(?:import|export)|pg_file_write)\s*\(`
  + String.raw`|\blanguage\s+(?:plpython\w*|plperlu|pltclu|plsh)\b|(?<!\b(?:grant|revoke)\s+(?:\w+\s*,\s*)*)\bexecute\b`);
// MySQL, per line: client commands (connect, source, system, tee…) and server-wide statements.
export const MYSQL_STATEMENT = new RegExp(String.raw`^(?:connect|source|system|tee|delimiter|kill|shutdown|clone|grant|revoke|flush|purge|reset|install|uninstall`
  + String.raw`|(?:create|drop|alter|rename)\s+user|set\s+(?:global|persist)|(?:start|stop|change)\s+(?:replica|slave|master|replication|group_replication))\b`);
// MySQL, anywhere: server-side files (INTO OUTFILE|DUMPFILE, LOAD DATA INFILE), FEDERATED tables, global variables.
export const MYSQL_ANYWHERE = /\b(?:outfile|dumpfile|infile|federated)\b|@@global\b/;
export const SQLITE_REACH = /\battach\b|\bvacuum\b[^;]*\binto\b|\bwritefile\s*\(|\bload_extension\s*\(/;
export const MONGO_REACH = /getSiblingDB|\bgetDB\b|getMongo|\bMongo\s*\(|\bconnect\s*\(|adminCommand|\buse\s+\w|shutdownServer|\bload\s*\(|applyOps|\$out\b|\$merge\b|copyDatabase|cloneDatabase/i;
// sqlite3 dot commands that show or format; those that read or write a client file (judged by their path); any other
// (.shell, .system, .load, .open, .read, …) acts past the open file.
export const SQLITE_SAFE_DOT: ReadonlySet<string> = new Set(['tables', 'schema', 'mode', 'headers', 'header', 'dump', 'indexes', 'indices', 'fullschema', 'width',
  'nullvalue', 'separator', 'timer', 'changes', 'echo', 'bail', 'print', 'show', 'databases', 'stats', 'eqp', 'quit', 'exit', 'help', 'dbinfo', 'version', 'parameter']);
export const SQLITE_FILE_DOT: ReadonlySet<string> = new Set(['output', 'once', 'backup', 'save', 'import']);

export const SCHEME_KIND: ReadonlyMap<string, ResourceKind> = new Map([['postgres', 'postgres'], ['postgresql', 'postgres'], ['mysql', 'mysql'],
  ['mariadb', 'mysql'], ['mongodb', 'mongo'], ['redis', 'redis'], ['rediss', 'redis']]);

// ---- MCP (H9, T6-H9-SEARCH, m6) -------------------------------------------------------------------------------------------

// H9's words, plus the other database servers and ORMs whose MCP tools change data by name (prisma's migrate-reset, D60).
export const MCP_DB_WORDS = new Set(['sql', 'postgres', 'postgresql', 'pg', 'mysql', 'sqlite', 'db', 'database', 'supabase', 'neon', 'mongo', 'mongodb', 'redis',
  'bigquery', 'snowflake', 'prisma', 'mariadb', 'planetscale', 'turso', 'libsql', 'clickhouse', 'duckdb', 'cockroach', 'cockroachdb']);
export const SQL_FIELDS: ReadonlySet<string> = new Set(['sql', 'statement', 'statements']);
export const QUERY_FIELDS: ReadonlySet<string> = new Set(['query', 'queries']);
// Words a database server's tool name uses to change data, besides mcp-write's write words.
export const DB_TOOL_WRITES: ReadonlySet<string> = new Set(['migrate', 'drop', 'truncate', 'flush', 'wipe', 'seed', 'del', 'reset', 'delete']);
// T6-H9-SEARCH (b): a query field is SQL when it starts with a read keyword (judged by isReadSql, so a read passes), or with a
// write keyword followed by that keyword's grammar; a natural-language search (`delete button broken`) fits none.
export const READ_KEYWORDS: ReadonlySet<string> = new Set(['select', 'with', 'explain', 'show', 'describe']);
const OBJECTS = 'table|index|view|database|schema|sequence|function|procedure|trigger|extension|type|role|user|materialized|unique|or';
export const SQL_SHAPES: ReadonlyMap<string, RegExp> = new Map([
  ['delete', /^delete\s+(?:(?:low_priority|quick|ignore)\s+)*from\b/], ['insert', /^insert\s+(?:(?:low_priority|delayed|high_priority|ignore)\s+)*into\b/],
  ['merge', /^merge\s+into\b/], ['update', /^update\s+(?:(?:low_priority|ignore|only)\s+)*[\w."`$[\]]+(?:\s+(?:as\s+)?\w+)?\s+set\b/],
  ['create', new RegExp(`^create\\s+(?:${OBJECTS})\\b`)], ['drop', new RegExp(`^drop\\s+(?:${OBJECTS})\\b`)], ['alter', new RegExp(`^alter\\s+(?:${OBJECTS})\\b`)],
  ['truncate', /^truncate\s+(?:table\b|[\w."`$]+\s*(?:$|[;,]))/], ['grant', /^grant\b[\s\S]*\son\s/], ['revoke', /^revoke\b[\s\S]*\son\s/],
  ['copy', /^copy\b[\s\S]*\s(?:from|to)\s/], ['call', /^call\s+[\w.$]+\s*\(/], ['do', /^do\s+\$/], ['set', /^set\s+[\w.@$]+\s*(?:=|to\b)/],
  ...['begin', 'commit', 'vacuum', 'reindex'].map(k => [k, new RegExp(`^${k}\\s*(?:$|;|(?:transaction|work|full|analyze|table|index|database)\\b)`)] as [string, RegExp]),
]);
