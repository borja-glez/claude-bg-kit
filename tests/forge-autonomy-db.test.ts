import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { databaseRule, isReadSql, isDbScript } from '../src/forge/autonomy-db.js';
import { AUTONOMY_RULES } from '../src/forge/autonomy-rules.js';
import { WT, CTX, withAuto, sh, mcp, B } from './helpers/autonomy.js';
import { dbTarget } from '../src/forge/autonomy-db.js';
import { networkRule } from '../src/forge/autonomy-rules.js';
import { evaluateGuard } from '../src/forge/guard.js';
import { dbPrefix, dockerPrefix } from '../src/forge/resources.js';
import { shellSegments } from '../src/forge/shell-words.js';
import { ATTENDED, bash, P } from './helpers/autonomy.js';

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
  ])('denies a write on a database that is not the run\'s, or whose target is unknown: %s', (_, input) => {
    expect(databaseRule.check(input, REG)).toMatchObject({ decision: 'deny', rule: 'database' });
  });
  it.each([
    B('psql -d prod -c "select count(*) from users"'), B('psql -d fg_spike_x__main -h localhost -c "DROP TABLE t"'), B('dropdb fg_spike_x__main'),
    B(`sqlite3 ${sh(path.join(WT, 'dev.db'))} "delete from t"`), B('DATABASE_URL=postgres://localhost/fg_spike_x__main npx prisma migrate reset --force'),
    B('docker rm -f fg-spike-x--db'), B('docker compose -p fg-spike-x--stack down -v'), B('redis-cli -p 41379 FLUSHALL'), B('npm run build'), B('docker ps'),
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
  it('holds the eight rules, self first, each id once', () => {
    expect(AUTONOMY_RULES.map(r => r.id)).toEqual(['self', 'files', 'install', 'git', 'network', 'cloud', 'mcp-write', 'database']);
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
    B('DATABASE_URL=file:./dev.db npx prisma migrate reset --force'), B('DATABASE_URL=postgresql://localhost:5432/fg_spike_x__main bundle exec rails db:migrate'),
    B('DATABASE_URL=mysql://root@127.0.0.1/fg_spike_x__shop npm run db:reset'),
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
  ])('denies %s', (_, input) => denies(input));
  it.each([
    B('docker exec -it fg-spike-x--db psql -U postgres -c "drop database shop"'), B('docker volume rm fg-spike-x--pgdata'), B('docker stop fg-spike-x--db'),
    B('docker compose -p fg-spike-x--stack exec db psql -c "drop table t"'), B('docker rm -f fg-spike-x--stack-db-1'), B('docker volume rm fg-spike-x--stack_pgdata'),
    B('COMPOSE_PROJECT_NAME=fg-spike-x--stack docker compose down -v'), B('docker ps -a'), B('docker logs postgres'), B('docker volume ls'), B('docker compose up -d'),
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
