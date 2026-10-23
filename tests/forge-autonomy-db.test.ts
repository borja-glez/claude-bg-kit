import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { databaseRule, isReadSql, isDbScript, dbTarget } from '../src/forge/autonomy-db.js';
import { AUTONOMY_RULES, cloudRule, filesRule, networkRule } from '../src/forge/autonomy-rules.js';
import { WT, CTX, ATTENDED, withAuto, sh, bash, pwsh, mcp, B, P } from './helpers/autonomy.js';
import { evaluateGuard } from '../src/forge/guard.js';
import { dbPrefix, dockerPrefix } from '../src/forge/resources.js';
import { shellSegments } from '../src/forge/shell-words.js';

const AT = '2026-10-22T10:00:00.000Z';
const REG = withAuto({ resources: [
  { kind: 'postgres', name: 'fg_spike_x__main', host: 'localhost', at: AT }, { kind: 'container', name: 'fg-spike-x--db', host: null, at: AT },
  { kind: 'compose', name: 'fg-spike-x--stack', host: null, at: AT }, { kind: 'redis', name: '41379', host: null, at: AT },
] });

describe('isReadSql', () => {
  it('accepts reads and meta commands only', () => {
    expect(isReadSql('SELECT 1; select * from t')).toBe(true);
    expect(isReadSql('\\dt')).toBe(true);
    expect(isReadSql('with x as (select 1) select * from x')).toBe(true);
    expect(isReadSql('explain select * from t')).toBe(true);
    for (const w of ['DELETE FROM t', 'select 1; drop table t', 'UPDATE t SET a=1', 'insert into t values (1)', 'TRUNCATE t', 'alter table t add c int', 'with x as (delete from t returning *) select * from x'])
      expect(isReadSql(w), w).toBe(false);
  });
  it('a read that writes is a write (M5)', () => {
    for (const w of ['EXPLAIN ANALYZE DELETE FROM users', 'explain analyze update t set a=1', 'SELECT * INTO backup FROM users', "select * from t into outfile '/tmp/x'",
      'select pg_terminate_backend(pid) from pg_stat_activity', "select setval('s', 1)", 'select lo_unlink(1)', 'select * from t for update',
      'with x as (select 1) merge into t using x on true when not matched then insert values (1)', "select dblink_exec('drop table t')"]) expect(isReadSql(w), w).toBe(false);
  });
});

describe('isDbScript', () => {
  it('tells a database script by its words (H8)', () => {
    for (const n of ['db:reset', 'db.reset', 'dbreset', 'resetdb', 'db/reset', 'seeds', 'seed.js', 'schema:sync', 'migrate', 'migrations:run', 'db-reset', 'prisma:migrate'])
      expect(isDbScript(n), n).toBe(true);
    for (const n of ['build', 'test', 'dbt', 'test:schema', 'lint', 'start', 'dev', 'typecheck']) expect(isDbScript(n), n).toBe(false);
  });
});

describe('database', () => {
  it.each([
    B('dropdb prod'), B('psql -d prod -c "DELETE FROM users"'), B('psql postgres://db.example.com/fg_spike_x__main -c "drop table t"'), B('psql "$URL" -c "truncate t"'),
    B('npm run db:reset'), B('pnpm run migrate'), B('npx prisma migrate reset --force'), B('python manage.py flush'), B('docker rm -f postgres'), B('docker volume prune -f'),
    B('docker compose down -v'), B('psql -d fg_spike_x__main -h db.example.com -c "insert into t values (1)"'), B('redis-cli FLUSHALL'), B('mysql -e "drop database shop"'),
    // H8: each package manager's own script form, and the names DB_SCRIPT missed
    B('pnpm db:reset'), B('yarn db:reset'), B('bun db:reset'), B('npm run-script db:reset'), B('npm run db.reset'), B('npm run dbreset'), B('npm run seeds'),
    B('npm run schema:sync'), B('make db-reset'),
    // M5: a read that writes, a file next to the inline SQL; M15: migrators behind a launcher
    B('psql -d prod -c "EXPLAIN ANALYZE DELETE FROM users"'), B('psql -d prod -c "select 1" -f drop.sql'),
    B('pnpm exec prisma migrate reset --force'), B('yarn prisma db push --force-reset'), B('poetry run alembic downgrade base'), B('bundle exec rails db:drop'),
    // fix 1, rows the rulings change: T6-MIGRATOR-TARGET (prisma needs DIRECT_URL too), T6-COMPOSE-VOLUMES (down -v)
    B('DATABASE_URL=postgres://localhost/fg_spike_x__main npx prisma migrate reset --force'), B('docker compose -p fg-spike-x--stack down -v'),
  ])('denies a write on a database that is not the run\'s, or whose target is unknown: %s', (_, input) => {
    expect(databaseRule.check(input, REG)).toMatchObject({ decision: 'deny', rule: 'database' });
  });
  it.each([
    B('psql -d prod -c "select count(*) from users"'), B('psql -d fg_spike_x__main -h localhost -c "DROP TABLE t"'), B('dropdb fg_spike_x__main'),
    B(`sqlite3 ${sh(path.join(WT, 'dev.db'))} "delete from t"`),
    B('DATABASE_URL=postgres://localhost/fg_spike_x__main DIRECT_URL=postgres://localhost/fg_spike_x__main npx prisma migrate reset --force'),
    B('docker rm -f fg-spike-x--db'), B('docker compose -p fg-spike-x--stack down'), B('redis-cli -p 41379 FLUSHALL'), B('npm run build'), B('docker ps'),
    B('pnpm build'), B('yarn test'), B('npm run dbt'), B('npm run test:schema'),
  ])('allows %s', (_, input) => expect(databaseRule.check(input, REG)).toBeNull());
  it('judges the SQL of an MCP tool, and its query field only when it is SQL (H9)', () => {
    expect(databaseRule.check(mcp('mcp__postgres__query', { sql: 'DELETE FROM users' }), CTX)).toMatchObject({ decision: 'deny', rule: 'database' });
    expect(databaseRule.check(mcp('mcp__postgres__query', { sql: 'select 1' }), CTX)).toBeNull();
    expect(databaseRule.check(mcp('mcp__supabase__execute_sql', { query: 'DELETE FROM t' }), CTX)).toMatchObject({ decision: 'deny', rule: 'database' });
    expect(databaseRule.check(mcp('mcp__github__search_issues', { query: 'is:open label:bug' }), CTX)).toBeNull();
    expect(databaseRule.check(mcp('mcp__plugin_context7_context7__query-docs', { libraryId: '/x/y', query: 'react hooks' }), CTX)).toBeNull();
  });
});

describe('AUTONOMY_RULES', () => {
  it('holds the nine rules, self first and machine last, each id once', () => {
    expect(AUTONOMY_RULES.map(r => r.id)).toEqual(['self', 'files', 'install', 'git', 'network', 'cloud', 'mcp-write', 'database', 'machine']);
  });
});

// ---- beyond the brief's rows: the PowerShell dialect, and the fail-closed reading (T6-FAILCLOSED) ----------------------

// REG plus a mysql database, a mongo database and a volume of the run.
const MORE = withAuto({ resources: [
  { kind: 'postgres', name: 'fg_spike_x__main', host: 'localhost', at: AT }, { kind: 'mysql', name: 'fg_spike_x__shop', host: null, at: AT },
  { kind: 'mongo', name: 'fg_spike_x__docs', host: null, at: AT }, { kind: 'redis', name: '41379', host: null, at: AT },
  { kind: 'container', name: 'fg-spike-x--db', host: null, at: AT }, { kind: 'volume', name: 'fg-spike-x--pgdata', host: null, at: AT },
  { kind: 'compose', name: 'fg-spike-x--stack', host: null, at: AT },
] });
const DEV_DB = sh(path.join(WT, 'dev.db'));
const denies = (input: Parameters<typeof databaseRule.check>[0]) => expect(databaseRule.check(input, MORE)).toMatchObject({ decision: 'deny', rule: 'database' });
const allows = (input: Parameters<typeof databaseRule.check>[0]) => expect(databaseRule.check(input, MORE)).toBeNull();

describe('database · PowerShell (the dialect path)', () => {
  it.each([P('psql -c "DELETE FROM users"'), P('psql -d prod -c "drop table t"'), P('docker rm -f postgres'), P('npm run db:reset'), P('redis-cli FLUSHALL')])(
    'denies %s', (_, input) => denies(input));
  it.each([P('psql -d prod -c "select 1"'), P('docker rm -f fg-spike-x--db'), P('redis-cli -p 41379 FLUSHALL'), P('npm run build')])(
    'allows %s', (_, input) => allows(input));
});

describe('isReadSql · quotes and comments as each server reads them', () => {
  it('a literal or a comment every server agrees on hides nothing', () => {
    for (const r of ["select 'a; drop table t'", 'select 1 -- ; drop table t', 'select 1 /* ; drop table t */', 'SELECT * FROM t\\G', '\\dt public.*', '.schema t', 'show tables'])
      expect(isReadSql(r), r).toBe(true);
  });
  it('a quote or comment one server reads differently, or a client command, is a write', () => {
    for (const w of ['select 1 --; drop table t', "select $$it's$$; drop table t; select 'x'", "select \"it's\"; drop table t; select 'x'",
      "select `it's`; drop table t; select 'x'", "select [it's]; drop table t; select 'x'", "select 'a\\'; drop table t; --'", 'select 1 /*! ; drop table t */',
      "select 'never closed", 'select 1 \\gexec', '\\dt\n\\! rm -rf x', 'explain (analyze) delete from t', 'select * from t for no key update', "select writefile('/x', 'y')"])
      expect(isReadSql(w), w).toBe(false);
  });
});

describe('dbTarget', () => {
  const seg = (command: string) => shellSegments(command, WT, 'bash')[0];
  it('names the database a client connects to, or says it cannot', () => {
    expect(dbTarget(seg('psql "postgresql://u@localhost:5432/fg_spike_x__main" -c "drop table t"'))).toEqual({ kind: 'postgres', name: 'fg_spike_x__main', host: 'localhost' });
    expect(dbTarget(seg('redis-cli -h db.example.com -p 41379 FLUSHALL'))).toEqual({ kind: 'redis', name: '41379', host: 'db.example.com' });
    expect(dbTarget(seg('mysql -e "drop table t"'))).toBe('unknown');
    expect(dbTarget(seg('psql -d "$DB" -c "drop table t"'))).toBe('unknown');
    expect(dbTarget(seg('ls -la'))).toBeNull();
  });
});

describe('database · clients read with their option tables (T6-FAILCLOSED)', () => {
  it.each([
    // an option the client's table does not know cancels the read answer and the target
    B('psql --frobnicate -d prod -c "select 1"'), B('mysql --delimiter=// -e "select 1 // drop table t"'),
    // the target in every spelling: glued, `=`, positional, the segment's environment, conninfo, URI parameters, a service
    B('psql -dprod -c "drop table t"'), B('psql --dbname=prod -c "drop table t"'), B('mysql -Dshop -e "delete from t"'), B('mysql shop -e "delete from t"'),
    B('PGDATABASE=prod psql -c "drop table t"'), B('PGHOST=db.example.com psql -d fg_spike_x__main -c "drop table t"'),
    B('psql "host=db.example.com dbname=fg_spike_x__main" -c "drop table t"'), B('psql "postgresql:///fg_spike_x__main?host=db.example.com" -c "drop table t"'),
    B('psql "service=prod" -c "drop table t"'), B('psql -d fg_spike_x__main -c "$SQL"'),
    B('dropdb -h db.example.com fg_spike_x__main'), B('createdb'), B('pg_restore -C -c -d fg_spike_x__main prod.dump'), B('mysqladmin -f drop shop'),
    B('mongosh --eval "db.dropDatabase()"'), B('mongosh --eval "select = db.dropDatabase()"'), B('redis-cli -h db.example.com -p 41379 FLUSHALL'),
    B('redis-cli -s /tmp/redis.sock FLUSHALL'), B('sqlite3 /tmp/other.db "delete from t"'), B('sqlite3 file:dev.db "delete from t"'),
    // mysql's positional database wins over -D; xargs and find -exec add arguments the hook does not see
    B('mysql -D fg_spike_x__shop shop -e "drop table t"'), B(`find / -name '*.db' -exec sqlite3 {} "delete from t" \\;`), B('xargs psql -c "drop table t" < dbs.txt'),
    // a word only the shell knows may expand to options (another -c, -d or -h)
    B('psql -d prod -c "select 1" $MORE'), B('psql -d fg_spike_x__main $OPTS -c "drop table t"'), B('redis-cli $ARGS FLUSHALL'),
  ])('denies %s', (_, input) => denies(input));
  it.each([
    B('psql --version'), B('mysql -V'), B('sqlite3 -version'), B('redis-cli --version'), B('mongosh --help'), B('psql -l'), B('mysqladmin -h db.example.com ping'),
    B('psql -U postgres -h db.example.com -d prod -At -X -v ON_ERROR_STOP=1 -c "select count(*) from users"'),
    B('mysql -uroot -psecret -h 127.0.0.1 -P 3306 -N -B shop -e "show tables"'), B('redis-cli -h db.example.com GET session:1'), B("redis-cli --scan --pattern 'session:*'"),
    B('mongosh mongodb://db.example.com/prod --quiet --eval "show dbs"'), B('sqlite3 /tmp/other.db ".tables"'), B('sqlite3 /tmp/other.db "select * from t"'),
    B('pg_restore -l prod.dump'), B('pg_restore -f out.sql prod.dump'),
  ])('allows a read, or a call that only prints: %s', (_, input) => allows(input));
  it.each([
    B('psql "postgresql://postgres@localhost:5432/fg_spike_x__main" -c "drop table t"'), B('psql "host=localhost dbname=fg_spike_x__main" -c "drop table t"'),
    B('PGDATABASE=fg_spike_x__main psql -c "truncate t"'), B('psql -h /var/run/postgresql -d fg_spike_x__main -c "drop table t"'), B('createdb fg_spike_x__main'),
    B('mysql -uroot -proot -h 127.0.0.1 fg_spike_x__shop -e "delete from users where id = 1"'), B('mysqladmin create fg_spike_x__shop'),
    B('mongosh mongodb://localhost:27017/fg_spike_x__docs --eval "db.users.deleteMany({})"'), B('redis-cli -u redis://localhost:41379 FLUSHALL'),
    B(`sqlite3 ${DEV_DB} ".mode json" "delete from t"`), B(`sqlite3 ${DEV_DB} < schema.sql`),
  ])('allows a write on what the run registered: %s', (_, input) => allows(input));
  it.each([
    B('psql -d fg_spike_x__main -c "DROP DATABASE prod"'), B('psql -d fg_spike_x__main -c "\\c prod" -c "drop table t"'),
    B("psql -d fg_spike_x__main -c \"select dblink_exec('dbname=prod', 'drop table t')\""), B("psql -d fg_spike_x__main -c \"copy t to program 'rm -rf ~'\""),
    B('mysql -D fg_spike_x__shop -e "drop database shop"'), B('mysql fg_spike_x__shop -e "delete from shop.users"'), B('mysql fg_spike_x__shop -e "use shop; delete from users"'),
    B(`mongosh mongodb://localhost/fg_spike_x__docs --eval "db.getSiblingDB('prod').dropDatabase()"`), B('redis-cli -p 41379 MIGRATE db.example.com 6379 k 0 5000'),
    B(`sqlite3 ${DEV_DB} "attach '/x/prod.db' as p; delete from p.t"`), B(`sqlite3 ${DEV_DB} ".shell rm -rf x"`), B(`sqlite3 ${DEV_DB} "select writefile('/x/y', 'z')"`),
  ])('denies what acts past the registered target: %s', (_, input) => denies(input));
});

describe('database · migrations and scripts (M15, H8)', () => {
  it.each([
    // the script word wherever a package manager reads it; an unknown option before it is read both ways
    B('npm -w api run db:reset'), B('npm run --workspace=api db:reset'), B('npm --frobnicate api run db:reset'), B('pnpm --filter api db:reset'), B('pnpm -r run migrate'),
    B('yarn workspace api db:reset'), B('yarn workspaces foreach -A run db:reset'), B('bun run --filter api db:reset'), B('npm run "$SCRIPT"'),
    B('just db-reset'), B('task db:reset'), B('make -C api db-reset'),
    // migrators behind each launcher, and by their script path
    B('npx --yes prisma migrate reset --force'), B('./node_modules/.bin/prisma migrate reset --force'), B('python -m alembic downgrade base'),
    B('python3 -malembic downgrade base'), B('bunx prisma db push --force-reset'), B('uv run alembic downgrade base'), B('npx knex migrate:rollback --all'),
    B('npx sequelize-cli db:drop'), B('npx typeorm-ts-node-commonjs schema:drop -d src/ds.ts'), B('npx drizzle-kit push'), B('rake db:drop'), B('./bin/rails db:reset'),
    B('ruby bin/rails db:drop'), B('python -m django flush --noinput'), B('django-admin flush'), B('dbmate drop'), B('goose up'), B('flyway clean'),
    // a DATABASE_URL that is remote, not registered, only known to the shell, or a SQLite file outside the worktree
    B('DATABASE_URL=postgres://db.example.com/fg_spike_x__main npx prisma migrate reset --force'), B('DATABASE_URL=postgres://localhost/prod npx prisma migrate reset --force'),
    B('DATABASE_URL=$PROD_URL npx prisma migrate reset --force'), B('DATABASE_URL=file:../../other.db npx prisma migrate reset --force'),
    // T6-SUPABASE-LOCAL: the local supabase stack is the person's
    B('supabase db reset'), B('npx supabase db reset'), B('supabase stop --no-backup'), B('supabase migration down'),
    B('supabase db reset --db-url postgresql://postgres:postgres@127.0.0.1:54322/postgres'),
  ])('denies %s', (_, input) => denies(input));
  it.each([
    B('DATABASE_URL=file:./dev.db DIRECT_URL=file:./dev.db npx prisma migrate reset --force'), B('DATABASE_URL=postgresql://localhost:5432/fg_spike_x__main bundle exec rails db:migrate'),
    B('npm ci'), B('pnpm install'), B('yarn add -D prisma'), B('npx prisma generate'), B('make'), B('make build'), B('pnpm vitest run tests/db.test.ts'),
    B('supabase start'), B('supabase stop'), B('goose --version'), B('npx prisma migrate reset --help'), B('npm test'),
  ])('allows %s', (_, input) => allows(input));
});

describe('database · containers, volumes and compose projects', () => {
  it.each([
    B('docker container rm postgres'), B('docker volume rm pgdata'), B('docker system prune -af'), B('docker container prune'),
    B('docker exec postgres psql -U postgres -c "drop database shop"'), B('docker stop postgres'), B('docker rm -f $(docker ps -aq)'),
    B('docker compose exec db psql -c "drop database shop"'), B('docker compose -f ../other/compose.yml down'), B('COMPOSE_PROJECT_NAME=prod docker compose down'),
    B('docker-compose down -v'), B('podman rm -f postgres'), B('docker --frobnicate rm -f x'), B('docker exec --frobnicate fg-spike-x--db psql'),
    B('docker ps -aq | xargs docker rm -f'), B('echo db:reset | xargs npm run'), B('docker $FLAGS rm -f postgres'), B('docker compose -p fg-spike-x--stack $X down'),
    // fix 1: the command a registered container runs is judged too (T6-CONTAINER-INNER), and down -v is unknown (T6-COMPOSE-VOLUMES)
    B('docker exec -it fg-spike-x--db psql -U postgres -c "drop database shop"'), B('COMPOSE_PROJECT_NAME=fg-spike-x--stack docker compose down -v'),
  ])('denies %s', (_, input) => denies(input));
  it.each([
    B('docker exec -it fg-spike-x--db psql -U postgres -d fg_spike_x__main -c "drop table t"'), B('docker volume rm fg-spike-x--pgdata'), B('docker stop fg-spike-x--db'),
    B('docker compose -p fg-spike-x--stack exec db psql -d fg_spike_x__main -c "drop table t"'), B('docker rm -f fg-spike-x--stack-db-1'),
    B('docker volume rm fg-spike-x--stack_pgdata'), B('COMPOSE_PROJECT_NAME=fg-spike-x--stack docker compose down'), B('docker ps -a'), B('docker logs postgres'),
    B('docker volume ls'), B('docker compose up -d'),
  ])('allows %s', (_, input) => allows(input));
});

describe('database · MCP SQL fields (H9)', () => {
  it('reads every SQL field, and a query field when the server or its text is SQL', () => {
    denies(mcp('mcp__postgres__query', { query: '/* x */ DELETE FROM t' }));
    denies(mcp('mcp__acme__lookup', { query: ';delete from t' }));
    denies(mcp('mcp__neon__run_sql_transaction', { sqlStatements: ['select 1', 'drop table t'] }));
    denies(mcp('mcp__acme__exec', { statement: 'truncate t' }));
    allows(mcp('mcp__github__search_code', { query: 'db reset' }));
    allows(mcp('mcp__postgres__query', { sql: "select * from t where note = 'drop table'" }));
  });
});

describe('database · wiring', () => {
  it('says nothing for an attended session', () => expect(databaseRule.check(bash('dropdb prod'), ATTENDED)).toBeNull());
  it('leaves a runner it cannot read to network (T6-LAUNCHER-REUSE)', () => {
    const input = bash('npx --frobnicate prisma migrate reset --force');
    expect(databaseRule.check(input, MORE)).toBeNull();
    expect(networkRule.check(input, MORE)).toMatchObject({ decision: 'deny', rule: 'network' });
  });
  it('denies with the shared reason: unknown target, and the prefixes to register under', () => {
    const v = databaseRule.check(bash('npm run db:reset'), MORE) as { reason: string };
    expect(v.reason).toMatch(/^forge autonomy · database: unknown target/);
    expect(v.reason).toContain(dbPrefix('spike-x'));
    expect(v.reason).toContain(dockerPrefix('spike-x'));
  });
  it('is the rule that denies a database write when the eight run together', () => {
    expect(evaluateGuard(bash('dropdb prod'), MORE, AUTONOMY_RULES)).toMatchObject({ decision: 'deny', rule: 'database' });
    expect(evaluateGuard(bash('dropdb fg_spike_x__main'), MORE, AUTONOMY_RULES)).toEqual({ decision: 'allow' });
  });
});

// ---- fix round 1: the review's probes (task-6-review.md, w6b1-t6-review p1.ts/p2.ts), in the direction task-6-fix1.md rules ----

const OWN = 'DATABASE_URL=postgres://localhost/fg_spike_x__main';
type Row = [string, Parameters<typeof databaseRule.check>[0]];

describe('fix round 1 · review probe p1', () => {
  it.each<Row>([
    // I1: launchers past the manager's own options and workspace selectors; m1 `--`; m2 env wrappers, pipenv, turbo
    ['D1', bash('yarn exec prisma migrate reset --force')], ['D2', bash('pnpm --filter api exec prisma migrate reset --force')],
    ['D3', bash('pnpm -r exec prisma migrate reset --force')], ['D4', bash('yarn workspace api exec prisma migrate reset --force')],
    ['D5', bash('npm -w api exec prisma migrate reset --force')], ['D6', bash('npm exec -w api -- prisma migrate reset --force')], ['D7', bash('npm run -- db:reset')],
    ['D8', bash('npm run prisma -- migrate reset --force')], ['D9', bash('make -- db-reset')], ['D10', bash('npx -p prisma prisma migrate reset --force')],
    ['D11', bash('dotenv -e .env -- prisma migrate reset --force')], ['D12', bash('cross-env NODE_ENV=dev prisma migrate reset --force')],
    ['D13', bash('pipenv run alembic downgrade base')], ['D14', bash('turbo run db:reset')],
    ['D15', bash('env PGHOST=db.example.com psql -d fg_spike_x__main -c "drop table t"')],
    ['D17', bash('dropdb --maintenance-db="host=db.example.com dbname=postgres" fg_spike_x__main')], ['D18', bash('bunx --bun prisma migrate reset --force')],
    // I3, I4, m7: containers
    ['D20', bash('docker compose -p myapp run --rm db sh -c "rm -rf /var/lib/postgresql/data/*"')], ['D21', bash('docker compose run --rm app npx prisma migrate reset --force')],
    ['D22', bash('docker compose -p myapp up -d --force-recreate -V')], ['D23', bash('podman system reset -f')],
    ['D24', bash('docker cp x postgres:/var/lib/postgresql/data/pg_hba.conf')], ['D25', bash('docker run --rm --volumes-from postgres alpine rm -rf /var/lib/postgresql/data')],
    ['D26', bash('docker run --rm --network host postgres psql -h localhost -U postgres -d myapp -c "drop table users"')],
    ['D27', bash('docker run --rm postgres psql -h host.docker.internal -U postgres -d myapp -c "drop table users"')], ['D28', bash('docker compose --project-name=myapp down -v')],
    // m4, I2, m3, T6-SQL-FILES
    ['D31', bash(`psql -d prod -c "select pg_file_write('/x', 'y', false)"`)], ['D32', bash('mysql fg_spike_x__shop -e "drop table t, shop.users"')],
    ['D33', bash('mysql fg_spike_x__shop -e "insert shop.users values (1)"')], ['D34', bash('mysql fg_spike_x__shop -e "drop view shop.v"')],
    ['D35', bash('mysql fg_spike_x__shop -e "update ignore shop.users set a = 1"')], ['D36', bash('mysql fg_spike_x__shop -e "update t, shop.users u set u.a = 1"')],
    ['D37', bash('mysql fg_spike_x__shop -e "replace shop.users values (1)"')], ['D38', bash('mysql fg_spike_x__shop -e "call shop.wipe()"')],
    ['D39', bash('mysql fg_spike_x__shop -e "drop index i on shop.users"')], ['D40', bash('sqlite3 /tmp/other.db -cmd "delete from t" -version')],
    ['D41', bash('sqlite3 /tmp/other.db -init drop.sql -version')], ['D42', bash('PSQLRC=/tmp/forge-spike-x/rc psql -d prod -c "select 1"')],
    ['D43', bash('psql -d prod -c "select 1" -o /home/u/.bashrc')],
    ['D44', bash(`psql -d fg_spike_x__main -c "do \\$\\$ begin execute 'alter database prod rename to x'; end \\$\\$"`)],
    ['D45', bash('mysql -D fg_spike_x__shop -e "/* x */ use shop; delete from users"')],
    // T6-SUPABASE-LOCAL
    ['D50', bash('supabase db push --local')], ['D51', bash('supabase migration repair --status reverted 1 --local')],
    ['D52', bash('supabase db push --db-url postgresql://postgres:postgres@127.0.0.1:54322/postgres')],
    // MCP (m6, and a database server's tool that writes by name)
    ['D60', mcp('mcp__prisma__migrate-reset', { projectCWD: '/repo' })], ['D61', mcp('mcp__mongodb__drop-database', { database: 'prod' })],
    ['D62', mcp('mcp__redis__delete', { key: 'x' })], ['D63', mcp('mcp__sqlite__write_query', { query: 'delete from t' })],
    ['D64', mcp('mcp__acme__run', { queries: [{ sql: 'drop table t' }] })], ['D65', mcp('mcp__acme__run', { params: { sql: 'drop table t' } })],
    // PowerShell
    ['D70', pwsh('& psql -d prod -c "drop table t"')], ['D71', pwsh(`& 'C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe' -d prod -c "drop table t"`)],
    ['D72', pwsh(`$env:PGDATABASE='prod'; psql -c "drop table t"`)], ['D73', pwsh('docker ps -aq | ForEach-Object { docker rm -f $_ }')],
    ['D74', pwsh('docker ps -aq | % { docker rm -f $_ }')], ['D75', pwsh('Get-Content drop.sql | psql -d prod')], ['D76', pwsh('cmd /c "dropdb prod"')],
    ['D77', pwsh(`Invoke-Expression 'dropdb prod'`)], ['D78', pwsh(`psql -d prod -c 'drop table t'`)], ['D79', pwsh(`$n = 'postgres'; docker rm -f $n`)],
    ['D80', pwsh(`Start-Process psql -ArgumentList '-d prod -c "drop table t"'`)], ['D81', pwsh('yarn db:reset')], ['D82', pwsh('npx prisma migrate reset --force')],
    // relabelled by a ruling: K83, D90, D91, D94, D111 (T6-MIGRATOR-TARGET), D85 (T6-COMPOSE-VOLUMES), D114 (T6-EXTRAS)
    ['D83', pwsh(`$env:DATABASE_URL='postgres://localhost/fg_spike_x__main'; npx prisma migrate reset --force`)],
    ['D85', pwsh('docker compose -p fg-spike-x--stack down -v')], ['D90', bash(`${OWN}?schema=public npx prisma migrate dev`)],
    ['D91', bash(`${OWN} pnpm prisma migrate deploy`)], ['D94', bash('DATABASE_URL=file:./dev.db npx prisma db push')],
    ['D111', bash(`${OWN} python manage.py migrate`)], ['D114', bash('psql "$DATABASE_URL" -c "select 1"')],
    // fix 2, relabelled by T6-SCRIPT-TARGET: no env makes a database script's target known
    ['D92', bash(`${OWN} npm run db:migrate`)],
  ])('denies %s', (_, input) => denies(input));
  it.each<Row>([
    ['A66', mcp('mcp__acme__connect', { mysql_url: 'mysql://localhost/x' })], ['A84', pwsh('sqlite3 dev.db "delete from t"')],
    ['A86', pwsh('psql -d prod -c "select count(*) from users"')], ['A87', pwsh('docker logs -f postgres')],
    ['A93', bash('npx prisma generate && npx prisma studio')], ['A95', bash('sqlite3 dev.db "create table t(a int)"')],
    ['A96', bash('sqlite3 ./data/app.sqlite < schema.sql')], ['A97', bash(`docker ps -a --format '{{.Names}}' && docker inspect postgres && docker logs --tail 50 postgres`)],
    ['A98', bash('docker compose logs -f db; docker compose ps')], ['A99', bash('docker exec fg-spike-x--db pg_isready')],
    ['A100', bash('docker compose -p fg-spike-x--stack exec -T db psql -U postgres -c "select 1"')],
    ['A101', bash('npm run build && npm test && pnpm lint && yarn dev && bun test && npm run test:unit')],
    ['A102', bash('psql -h localhost -U postgres -d fg_spike_x__main -f migrations/001.sql')],
    ['A103', bash('psql "postgresql://postgres:postgres@127.0.0.1:54322/fg_spike_x__main" -f seed.sql')],
    ['A104', bash('mysql -h 127.0.0.1 -uroot fg_spike_x__shop < dump.sql')], ['A105', bash('redis-cli -p 41379 SET k v')],
    ['A106', bash('alembic revision --autogenerate -m x')], ['A107', bash('python manage.py makemigrations')], ['A108', bash('bin/rails generate migration AddX')],
    ['A109', bash('npx drizzle-kit generate')], ['A110', bash('docker compose up -d')], ['A112', bash('supabase start && supabase status')],
    ['A113', bash('pnpm exec prisma generate')], ['A115', bash('mongosh fg_spike_x__docs --eval "db.users.deleteMany({})"')],
    ['A116', bash('redis-cli -h 127.0.0.1 -p 41379 -n 2 FLUSHDB')],
    // relabelled by m9: commands that only generate files or read
    ['A117', bash('npx knex migrate:make add_x')], ['A118', bash('npx typeorm migration:create src/migrations/x')], ['A119', bash('dbmate new add_x')],
    ['A120', bash('npx prisma migrate status')],
  ])('allows %s', (_, input) => allows(input));
});

describe('fix round 1 · review probe p2', () => {
  const DEV = sh(path.join(WT, 'dev.db'));
  it.each<Row>([
    ['D202', bash('sqlite3 ~/prod.db -cmd "delete from t" -version')], ['D203', bash('sqlite3 ../../../prod.db -cmd "delete from t" -version')],
    ['D205', mcp('mcp__acme__query', { queries: [{ sql: 'drop table t' }] })], ['D206', mcp('mcp__acme__lookup', { input: { sql: 'drop table t' } })],
    ['D208', bash('pnpm --filter @app/db exec drizzle-kit push')], ['D209', bash('npm --prefix api exec prisma migrate reset --force')],
    ['D210', bash('yarn workspaces foreach -A exec prisma migrate reset --force')], ['D211', bash('bun --filter api x prisma migrate reset --force')],
    ['D218', bash(`bash -c "${OWN} npx prisma migrate deploy"`)], ['D222', bash('npm run db:studio')], ['D223', bash('docker compose up -d --renew-anon-volumes')],
    ['D224', bash('podman pod rm -f mypod')], ['D225', bash('docker container rm -f -v postgres')], ['D226', pwsh('npm -w api exec prisma migrate reset --force')],
    ['D227', pwsh('pnpm --filter api exec prisma migrate reset --force')],
  ])('denies %s', (_, input) => denies(input));
  it.each<Row>([
    ['A200', bash('mysql -D fg_spike_x__shop -e "/* x */ select 1"')], ['A204', bash(`sqlite3 ${DEV} -version`)],
    ['A207', bash('docker compose -p fg-spike-x--stack run --rm db psql -c "select 1"')],
    ['A212', bash('psql postgresql://localhost/fg_spike_x__main -v ON_ERROR_STOP=1 -f schema.sql')],
    ['A213', bash(`psql -d fg_spike_x__main -c 'create extension if not exists "uuid-ossp"'`)],
    ['A214', bash('mysql fg_spike_x__shop -e "update users u join orders o on o.uid = u.id set u.x = 1"')],
    ['A215', bash('psql -d fg_spike_x__main -c "grant select on t to anon"')], ['A216', bash('psql -d postgres -c "drop database fg_spike_x__main"')],
    ['A217', bash('mysql -D fg_spike_x__shop -e "select * from information_schema.tables"')], ['A219', bash('redis-cli -u redis://127.0.0.1:41379/0 FLUSHDB')],
    ['A220', bash('docker volume ls && docker volume inspect pgdata && docker compose config')], ['A221', bash('pg_dump -d prod -f /tmp/forge-spike-x/prod.sql')],
    ['A228', pwsh(`sqlite3 '${path.join(WT, 'dev.db')}' "delete from t"`)], ['A229', pwsh('npx prisma generate')],
  ])('allows %s', (_, input) => allows(input));
  it('K200: the files rule leaves a client\'s inline SQL to database, and still judges its output files', () => {
    expect(evaluateGuard(bash('mysql -D fg_spike_x__shop -e "/* x */ select 1"'), MORE, AUTONOMY_RULES)).toEqual({ decision: 'allow' });
    expect(filesRule.check(bash('psql -d prod -c "/* x */ select 1" -o /etc/out.txt'), MORE)).toMatchObject({ decision: 'deny', rule: 'files' });
  });
});

describe('fix round 1 · rulings beyond the probes', () => {
  const SHADOW = withAuto({ resources: [...MORE.autonomous!.resources, { kind: 'postgres', name: 'fg_spike_x__shadow', host: null, at: AT }] });
  const BOTH = `${OWN} DIRECT_URL=postgres://localhost/fg_spike_x__main`;
  it.each([
    // T6-MIGRATOR-URLS: a migrator's own literal URL option (and goose's DSN) names its target
    B('migrate -path db/migrations -database postgres://localhost/fg_spike_x__main up'), B('flyway -url=jdbc:postgresql://localhost:5432/fg_spike_x__main migrate'),
    B('liquibase --url=jdbc:mysql://localhost/fg_spike_x__shop update'), B('dbmate --url postgres://localhost/fg_spike_x__main up'), B(`${OWN} dbmate up`),
    B('goose postgres "host=localhost dbname=fg_spike_x__main" up'), B('goose mysql "root@tcp(127.0.0.1:3306)/fg_spike_x__shop" up'), B('goose sqlite3 ./dev.db up'),
    B('npx drizzle-kit push --url=postgres://localhost/fg_spike_x__main --dialect=postgresql'), B('npx sequelize-cli db:migrate --url mysql://root@127.0.0.1/fg_spike_x__shop'),
    B('atlas schema apply --url "postgres://localhost/fg_spike_x__main" --to file://schema.hcl'), B('diesel migration run --database-url postgres://localhost/fg_spike_x__main'),
    B(`${OWN} sqlx migrate run`), B('npx prisma db execute --url postgres://localhost/fg_spike_x__main --file x.sql'),
    // T6-MIGRATOR-TARGET (c): prisma with DATABASE_URL and DIRECT_URL on the segment, through cross-env too (m2), or PowerShell's $env: (m9)
    B(`${BOTH} npx prisma migrate deploy`), B('cross-env DATABASE_URL=postgres://localhost/fg_spike_x__main DIRECT_URL=postgres://localhost/fg_spike_x__main prisma migrate reset --force'),
    P(`$env:DATABASE_URL='postgres://localhost/fg_spike_x__main'; $env:DIRECT_URL='postgres://localhost/fg_spike_x__main'; npx prisma migrate reset --force`),
    // m9: generate-or-read subcommands, and a database created or dropped by a registered name
    B('npx sequelize-cli migration:generate --name x'), B('npx typeorm migration:show -d ds.ts'), B('npx knex migrate:status'), B('npx prisma db pull'),
    B('npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma'), B('dbmate status'), B('alembic current'), B('php artisan make:migration add_x'),
    B('dotnet ef migrations add Init'), B('mix ecto.gen.migration add_x'), B('psql -d postgres -c "create database fg_spike_x__main"'),
    // T6-DOCKER-MOUNTS: a registered volume, a bind inside the roots, a read-only bind, tmpfs
    B('docker run --rm -v fg-spike-x--pgdata:/data alpine ls /data'), B(`docker run --rm -v ${sh(WT)}/data:/data alpine ls /data`),
    B('docker run --rm -v /etc:/x:ro alpine cat /x/hosts'), B('docker run --rm --mount type=bind,source=/etc,target=/x,readonly alpine ls /x'),
    B('docker run --rm --tmpfs /cache --mount type=tmpfs,target=/t alpine ls'),
    // T6-SQL-FILES: client-side files inside the roots, STDIN/STDOUT copies
    B(`psql -d fg_spike_x__main -c "\\copy t to 'out.csv' csv"`), B('psql -d fg_spike_x__main -c "\\o out.txt" -c "select 1"'), B('psql -d fg_spike_x__main -c "copy t from stdin"'),
    B('psql -d prod -c "select 1" -o out.txt'), B('psql -d prod -c "select 1" -o /dev/null'), B('sqlite3 dev.db ".output out.txt" "select 1"'), B('sqlite3 dev.db ".import data.csv t"'),
    B('psql -d fg_spike_x__main -c "grant execute on function f() to app"'),
    // T6-H9-SEARCH: a natural-language query, or any query of a search or docs tool, is no SQL
    ['mcp delete button broken', mcp('mcp__acme__run', { query: 'delete button broken' })], ['mcp update docs', mcp('mcp__acme__run', { query: 'update docs for X' })],
    ['mcp search tool', mcp('mcp__github__search_issues', { query: 'delete from users' })], ['mcp docs tool', mcp('mcp__plugin_context7_context7__query-docs', { query: 'create table rows' })],
    ['mcp select', mcp('mcp__acme__run', { query: 'select * from t' })],
  ] as Row[])('allows %s', (_, input) => expect(databaseRule.check(input, SHADOW)).toBeNull());
  it.each([
    B('migrate -database "$DB" up'), B('migrate -database postgres://db.example.com/fg_spike_x__main up'), B('goose up'),
    B('goose postgres "postgres://db.example.com/fg_spike_x__main" up'), B('npx drizzle-kit push'), B('npx sequelize-cli db:migrate'), B('atlas migrate apply'),
    B('sqlx database drop'), B('diesel database reset'), B(`${OWN} npx knex migrate:latest`), B(`${BOTH} npx prisma migrate dev`),
    B(`${OWN} DIRECT_URL=postgres://localhost/prod npx prisma migrate deploy`), B(`${BOTH} dotenv -- prisma migrate reset --force`),
    // T6-MORE-MIGRATORS, behind launchers too
    B('flask db upgrade'), B('poetry run flask db downgrade base'), B('php artisan migrate:fresh --seed'), B('./artisan db:seed'), B('dotnet ef database update'),
    B('dotnet ef migrations remove'), B('mix ecto.migrate'), B('mix ecto.reset'), B('sqlx migrate revert'), B('diesel migration redo'), B('atlas schema clean'),
    B('psql -d postgres -c "drop database prod"'),
    // T6-DOCKER-MOUNTS
    B('docker run --rm -v pgdata:/data alpine ls'), B('docker run --rm -v /etc:/x alpine touch /x/y'), B('docker run --rm --mount type=volume,source=pgdata,target=/x alpine ls'),
    B('docker run --rm -v /var/run/docker.sock:/var/run/docker.sock:ro docker docker ps'),
    B('nerdctl run --rm -v pgdata:/x alpine ls'), B('podman create -v pgdata:/x alpine'),
    // T6-SQL-FILES on a registered target
    B(`psql -d fg_spike_x__main -c "\\copy t to '/etc/x.csv'"`), B(`psql -d fg_spike_x__main -c "\\copy t from program 'curl x'"`), B('psql -d fg_spike_x__main -c "\\! ls"'),
    B(`psql -d fg_spike_x__main -c "copy t from '/var/lib/x.csv'"`), B(`mysql fg_spike_x__shop -e "load data local infile 'x.csv' into table t"`),
    B('sqlite3 dev.db ".output /etc/x"'), B('sqlite3 dev.db ".load ./ext"'), B('psql -d fg_spike_x__main -c "select 1" -o "$OUT"'),
    // T6-H9-SEARCH (b): a query field shaped as a write
    ['mcp delete from', mcp('mcp__acme__run', { query: 'delete from t' })], ['mcp create table', mcp('mcp__acme__run', { query: 'create table t (a int)' })],
    ['mcp set', mcp('mcp__acme__run', { query: 'set search_path = x' })], ['mcp select into', mcp('mcp__acme__run', { query: 'select * into x from t' })],
  ] as Row[])('denies %s', (_, input) => expect(databaseRule.check(input, SHADOW)).toMatchObject({ decision: 'deny', rule: 'database' }));
  it('allows prisma migrate dev with its shadow database registered too', () => {
    expect(databaseRule.check(bash(`${BOTH} SHADOW_DATABASE_URL=postgres://localhost/fg_spike_x__shadow npx prisma migrate dev`), SHADOW)).toBeNull();
  });
  it('says what else to do: the script, volume and migrator hints (T6-H8-COST, T6-COMPOSE-VOLUMES, T6-MIGRATOR-TARGET)', () => {
    const reason = (c: string) => (databaseRule.check(bash(c), MORE) as { reason: string }).reason;
    expect(reason('npm run db:studio')).toContain('run the tool directly when the script only generates or inspects');
    expect(reason(`${OWN} npm run db:migrate`)).toMatch(/^forge autonomy · database: unknown target: [\s\S]*DIRECT_URL/);
    expect(reason('docker compose -p fg-spike-x--stack down -v')).toContain("remove the run's volumes by name with docker volume rm");
    expect(reason('python manage.py migrate')).toContain('DIRECT_URL');
  });
  it('judges the command a container runs for network and cloud too (T6-CONTAINER-INNER)', () => {
    expect(networkRule.check(bash('docker run --rm curlimages/curl curl -X POST https://api.example.com/x -d a'), MORE)).toMatchObject({ decision: 'deny', rule: 'network' });
    expect(networkRule.check(bash('docker exec fg-spike-x--db curl -X POST https://api.example.com -d a'), MORE)).toMatchObject({ decision: 'deny', rule: 'network' });
    expect(cloudRule.check(bash('docker run --rm --entrypoint aws amazon/aws-cli s3 rm s3://b/x'), MORE)).toMatchObject({ decision: 'deny', rule: 'cloud' });
    expect(cloudRule.check(bash('docker compose -p fg-spike-x--stack run --rm app npx vercel --prod'), MORE)).toMatchObject({ decision: 'deny', rule: 'cloud' });
    expect(networkRule.check(bash('docker run --rm curlimages/curl curl -s https://example.com'), MORE)).toBeNull();
    expect(cloudRule.check(bash('pnpm --filter web exec vercel deploy'), MORE)).toMatchObject({ decision: 'deny', rule: 'cloud' });
  });
});

// ---- fix round 2 (task-6-fix2.md) -----------------------------------------------------------------------------------------

describe('fix round 2 · T6-SCRIPT-TARGET: a database script is never a known target', () => {
  it.each([
    B(`${OWN} DIRECT_URL=postgres://localhost/fg_spike_x__main pnpm db:reset`), B(`${OWN} make db-reset`), B(`${OWN} turbo run db:reset`),
    B('DATABASE_URL=file:./dev.db yarn db:push'), P(`$env:DATABASE_URL='postgres://localhost/fg_spike_x__main'; npm run db:migrate`),
  ])('denies %s', (_, input) => expect(databaseRule.check(input, MORE)).toMatchObject({ decision: 'deny', rule: 'database', reason: expect.stringMatching(/unknown target/) }));
});

describe('fix round 2 · T6-PWD: $PWD and its spellings are the segment\'s cwd', () => {
  it.each([
    B('docker run --rm -v "$PWD":/app node npm test'), B('docker run --rm -v "$(pwd)/data":/data alpine ls /data'), B('docker run --rm -v "${PWD}/data:/data" alpine ls'),
    B('docker run --rm -v "`pwd`/data:/data" alpine ls'), B('sqlite3 "$PWD/dev.db" "delete from t"'), B('psql -d prod -c "select 1" -o "$PWD/out.txt"'),
    P('docker run --rm -v "${PWD}:/app" node npm test'), P('docker run --rm -v "$pwd\\data:/data" alpine ls'), P('docker run --rm -v "$(Get-Location):/app" node npm test'),
  ])('database allows %s', (_, input) => expect(databaseRule.check(input, MORE)).toBeNull());
  it.each([
    B('cd /tmp && sqlite3 "$PWD/dev.db" "delete from t"'), B('docker run --rm -v "$HOME/data":/data alpine ls'), B('docker run --rm -v "$PWD/$X":/data alpine ls'),
  ])('database denies %s', (_, input) => expect(databaseRule.check(input, MORE)).toMatchObject({ decision: 'deny', rule: 'database' }));
  it.each([
    B('rm -rf "$PWD/build"'), B('touch "$(pwd)/x.txt"'), B('cp a.txt "${PWD}/b.txt"'), P('Remove-Item -Recurse "$PWD\\build"'),
  ])('files allows %s', (_, input) => expect(filesRule.check(input, MORE)).toBeNull());
  it.each([
    B('rm -rf "$PWD/../../other"'), B('rm -rf "$HOME/x"'), B('rm -rf "$PWD/$X"'),
  ])('files denies %s', (_, input) => expect(filesRule.check(input, MORE)).toMatchObject({ decision: 'deny', rule: 'files' }));
});

describe('fix round 2 · T6-CONTAINER-FILES: a container\'s paths are the container\'s', () => {
  it('leaves the command a container runs to the database rule', () => {
    const input = bash('docker exec fg-spike-x--db rm -rf /var/lib/x');
    expect(filesRule.check(input, MORE)).toBeNull();
    expect(databaseRule.check(input, MORE)).toBeNull();
    expect(filesRule.check(bash('docker compose -p fg-spike-x--stack run --rm db rm -rf /var/lib/postgresql/data'), MORE)).toBeNull();
  });
  it('judges a cp\'s host destination, and only that', () => {
    expect(filesRule.check(bash('docker cp fg-spike-x--db:/x /etc/y'), MORE)).toMatchObject({ decision: 'deny', rule: 'files' });
    expect(filesRule.check(bash('docker cp ./dump.sql fg-spike-x--db:/tmp/dump.sql'), MORE)).toBeNull();
    expect(databaseRule.check(bash('docker cp ./dump.sql fg-spike-x--db:/tmp/dump.sql'), MORE)).toBeNull();
  });
  it('leaves mounts to T6-DOCKER-MOUNTS and still judges the other host files of the call', () => {
    expect(evaluateGuard(bash('docker run --rm -v /etc:/x:ro alpine cat /x/hosts'), MORE, AUTONOMY_RULES)).toEqual({ decision: 'allow' });
    expect(filesRule.check(bash('docker run --rm --cidfile /etc/cid alpine true'), MORE)).toMatchObject({ decision: 'deny', rule: 'files' });
  });
});

// ---- fix round 3 (task-6-fix3.md; the re-review's rows, w6b1-t6-review p3.ts/p4.ts) ---------------------------------------

describe('fix round 3 · N1: CREATE/DROP DATABASE by name only alone', () => {
  it.each<Row>([
    ['D1', bash('psql -d prod -c "create database fg_spike_x__main" -f drop_all.sql')],
    ['D2', bash('psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "create database fg_spike_x__main" -f supabase/seed.sql')],
    ['D3', bash('PSQLRC=rc.sql psql -d prod -c "drop database fg_spike_x__main"')], ['S10', bash('psql -d prod -c "drop database fg_spike_x__main" --file=drop_all.sql')],
    ['ddl with <', bash('psql -d prod -c "create database fg_spike_x__main" < drop_all.sql')], ['ddl from a pipe', bash('cat x.sql | psql -d prod -c "drop database fg_spike_x__main"')],
    ['ddl naming an unregistered database', bash('psql -d postgres -c "create database fg_spike_x__main; drop database prod"')],
  ])('denies %s', (_, input) => denies(input));
  it.each<Row>([['A4', bash('psql -d postgres -c "create database fg_spike_x__main"')]])('allows %s', (_, input) => allows(input));
});

describe('fix round 3 · N2: a container call\'s option values are no host paths', () => {
  it.each<Row>([
    ['A10', bash('docker run --rm -v "$PWD":/app -w /app node:20 npm test')], ['A18', bash('docker run --rm -v "$PWD":/app -w /app node:20 npm install')],
    ['K2', bash('docker run --rm -w /app node:20 npm test')], ['K3', bash('docker run --rm --tmpfs /cache alpine ls')],
    ['env and label files are reads', bash('docker run --rm --env-file /etc/app.env --label-file /etc/labels alpine true')],
    ['exec -w', bash('docker exec -w /var/lib/postgresql fg-spike-x--db ls')], ['compose -f and --env-file are reads', bash('docker compose -f /etc/compose.yml --env-file /etc/x.env up -d')],
  ])('all eight allow %s', (_, input) => expect(evaluateGuard(input, MORE, AUTONOMY_RULES)).toEqual({ decision: 'allow' }));
  it.each<Row>([['--cidfile=', bash('docker run --rm --cidfile=/etc/cid alpine true')], ['--cidfile', bash('docker create --cidfile /etc/cid alpine')]])(
    'files still judges the host write of %s', (_, input) => expect(filesRule.check(input, MORE)).toMatchObject({ decision: 'deny', rule: 'files' }));
});

describe('fix round 3 · N3: trigger DDL is no dynamic SQL', () => {
  it.each<Row>([
    ['A5', bash('psql -d fg_spike_x__main -c "create trigger trg before update on t for each row execute function set_updated_at()"')],
    ['A6', bash('psql -d fg_spike_x__main -c "create trigger trg after insert on t for each row execute procedure f()"')],
    ['event trigger', bash('psql -d fg_spike_x__main -c "create event trigger e on ddl_command_end execute function log_ddl()"')],
  ])('allows %s', (_, input) => allows(input));
  it.each<Row>([
    ['K8 prepare/execute', bash('psql -d fg_spike_x__main -c "prepare p as select 1; execute p"')],
    ['execute format', bash(`psql -d fg_spike_x__main -c "do \\$\\$ begin execute format('drop table %I', 't'); end \\$\\$"`)],
    ['execute a variable', bash(`psql -d fg_spike_x__main -c "do \\$\\$ declare q text := 'x'; begin execute q; end \\$\\$"`)],
  ])('still denies %s', (_, input) => denies(input));
});

describe('fix round 3 · N4: T6-MOUNT-SETTINGS-LIMIT (known limit, Task 13 docs)', () => {
  it.each<Row>([
    ['S21', bash(`docker run --rm -v "$PWD":/app alpine sh -c "echo '{}' > /app/.claude/settings.local.json"`)],
  ])('a container writing the worktree settings through a $PWD mount passes: %s', (_, input) => expect(evaluateGuard(input, MORE, AUTONOMY_RULES)).toEqual({ decision: 'allow' }));
  // final fix (I1): the settings folder itself as a mount source denies, $PWD spelled or literal (S22 passed before)
  it.each<Row>([['S22', bash('docker run --rm -v "$PWD/.claude":/c alpine rm /c/settings.json')]])(
    'a mount of the settings folder itself is denied by self: %s', (_, input) => expect(evaluateGuard(input, MORE, AUTONOMY_RULES)).toMatchObject({ decision: 'deny', rule: 'self' }));
});

// ---- final fix (final-review.md I1, I2): literal absolute worktree mounts, and containers handed the host ------------------

const WS = sh(WT);
describe('final fix · I1: everyday docker lines with literal absolute worktree paths (every rule allows)', () => {
  it.each<Row>([
    ['C13', bash(`docker run --rm -v ${WS}:/app -w /app node:20 npm test`)], ['D6', pwsh(`docker run -v "${WT}:/app" node:20 npm test`)],
    ['D7', bash(`docker run -v ${WS}/data:/var/lib/postgresql/data postgres:16`)], ['D8', bash(`docker run --mount type=bind,source=${WS},target=/app node:20 npm test`)],
    ['D9', bash(`docker run -e DATA=${WS}/x node:20 node x.js`)], ['D10', bash(`cross-env OUT=${WS}/dist npm run build`)],
    ['D14', bash(`docker run -v ${WS}/.env:/app/.env:ro node:20 x`)], ['D12', bash(`docker compose -f ${WS}/compose.yaml up -d`)],
    ['glued --volume=', bash(`docker run --rm --volume=${WS}:/app -w /app node:20 npm test`)], ['glued --mount=', bash(`docker run --mount=type=bind,src=${WS},dst=/app node:20 ls`)],
    ['compose run -v', bash(`docker compose -p fg-spike-x--stack run --rm -v ${WS}:/app app npm test`)], ['podman', bash(`podman run --rm -v ${WS}:/app:Z node:20 npm test`)],
  ])('allows %s', (_, input) => expect(evaluateGuard(input, MORE, AUTONOMY_RULES)).toEqual({ decision: 'allow' }));
  it.each<Row>([
    ['settings folder', bash(`docker run --rm -v ${WS}/.claude:/c alpine ls /c`)], ['settings file', bash(`docker run --rm -v ${WS}/.claude/settings.json:/s alpine true`)],
    ['--mount source', bash(`docker run --rm --mount type=bind,source=${WS}/.claude,target=/c alpine ls`)], ['relative', bash('docker run --rm -v .claude:/c alpine ls')],
    ['KEY=value', bash(`cross-env OUT=${WS}/.claude/settings.json node gen.js`)], ['pwsh', pwsh(`docker run -v "${path.join(WT, '.claude')}:/c" alpine ls`)],
  ])('still denies the settings, literal or as a mount source of their folder: %s', (_, input) => expect(evaluateGuard(input, MORE, AUTONOMY_RULES)).toMatchObject({ decision: 'deny', rule: 'self' }));
});

describe('final fix · I2: T6-PRIVILEGED (a container handed the host is denied, not unknown)', () => {
  it.each<Row>([
    ['C1', bash(`docker run --privileged -v ${WS}:/app alpine sh`)], ['C2', bash('docker run --device /dev/sda alpine')], ['C3', bash('docker run --pid=host --cap-add=SYS_ADMIN alpine')],
    ['C4', bash('docker run --security-opt seccomp=unconfined --cap-add=ALL alpine')], ['C11', bash('docker run --userns=host -v /:/h alpine')], ['C12', bash('podman run --privileged alpine')],
    ...[B('docker create --privileged alpine'), B('nerdctl run --cap-add sys_ptrace alpine'), B('docker run --cap-add NET_ADMIN,SYS_MODULE alpine'), B('docker run --cap-add CAP_SYS_RAWIO alpine'),
      B('docker run --cap-add=DAC_READ_SEARCH alpine'), B('docker run --ipc host alpine'), B('docker run --uts=host alpine'), B('docker run --cgroupns host alpine'),
      B('docker run --security-opt apparmor:unconfined alpine'), B('docker run --security-opt label=disable alpine'), B('docker run --security-opt=systempaths=unconfined alpine'),
      B('docker container run --rm --privileged alpine'), B('docker compose -p fg-spike-x--stack run --rm --cap-add SYS_ADMIN app sh'),
      B('docker compose -p fg-spike-x--stack run --rm --privileged app sh'), B('podman-compose -p fg-spike-x--stack run --cap-add=ALL app sh')] as Row[],
  ])('denies %s', (_, input) => {
    const v = databaseRule.check(input, MORE);
    expect(v).toMatchObject({ decision: 'deny', rule: 'database' });
    expect((v as { reason: string }).reason).not.toMatch(/unknown target/);
  });
  it.each<Row>([
    B('docker run --rm --network host fg-spike-x--img'), B('docker run --rm --net=host curlimages/curl curl -s localhost:3000'), B('docker run --rm --cap-add NET_ADMIN alpine ip a'),
    B('docker run --rm --cap-drop ALL alpine true'), B('docker run --rm --security-opt no-new-privileges alpine true'), B('docker run --rm --pid=container:fg-spike-x--db alpine ps'),
    B('docker compose -p fg-spike-x--stack run --rm app npm test'),
  ])('allows %s', (_, input) => expect(databaseRule.check(input, MORE)).toBeNull());
});

describe('fix round 3 · N5: a read-named MCP tool of a database server reads', () => {
  it('allows migrate-status, and still denies migrate-dev and migrate-reset', () => {
    allows(mcp('mcp__prisma__migrate-status', { projectCWD: '/repo' }));
    allows(mcp('mcp__prisma__migrate-diff', { projectCWD: '/repo' }));
    denies(mcp('mcp__prisma__migrate-dev', { projectCWD: '/repo' }));
    denies(mcp('mcp__prisma__migrate-reset', { projectCWD: '/repo' }));
  });
});
