import { describe, it, expect } from 'vitest';
import { autoApprovable, similarRejected, similarOpen, safeZone } from '../src/forge/policy.js';
import type { ProposalDoc } from '../src/lib/proposals.js';

const doc = (over: Partial<ProposalDoc> = {}): ProposalDoc => ({ ts: '', category: 'quality', risk: 'low', title: 't', path: 'src/util/x.ts', rationale: '', evidence: '', pillar: 'p', status: 'proposed', source: 'scout', author: 'a', ...over });

describe('autoApprovable', () => {
  it('tests and quality at low risk', () => {
    expect(autoApprovable(doc({ category: 'tests', path: 'tests/app.test.ts' }))).toBe(true);
    expect(autoApprovable(doc({ category: 'quality' }))).toBe(true);
  });
  it('perf needs a benchmark in the evidence', () => {
    expect(autoApprovable(doc({ category: 'perf', evidence: 'bench: 40 ms -> 5 ms' }))).toBe(true);
    expect(autoApprovable(doc({ category: 'perf', evidence: '12k ops/s' }))).toBe(true);
    expect(autoApprovable(doc({ category: 'perf', evidence: 'feels faster' }))).toBe(false);
    expect(autoApprovable(doc({ category: 'perf', evidence: 'items 5' }))).toBe(false);
  });
  it('security needs a test in the evidence', () => {
    expect(autoApprovable(doc({ category: 'security', evidence: 'regression test added' }))).toBe(true);
    expect(autoApprovable(doc({ category: 'security', evidence: 'looks risky' }))).toBe(false);
  });
  it('negated or accidental evidence does not count', () => {
    for (const e of ['no benchmark yet', 'workbench', 'takes 40 ms', 'bench-less', 'sin benchmark']) expect(autoApprovable(doc({ category: 'perf', evidence: e }))).toBe(false);
    for (const e of ['no test exists', 'not tested yet', 'sin test', 'falta spec', 'without any test']) expect(autoApprovable(doc({ category: 'security', evidence: e }))).toBe(false);
    expect(autoApprovable(doc({ category: 'security', evidence: 'added regression test' }))).toBe(true);
    expect(autoApprovable(doc({ category: 'perf', evidence: 'bench: 40 ms → 5 ms' }))).toBe(true);
    expect(autoApprovable(doc({ category: 'perf', evidence: '40ms -> 5ms' }))).toBe(true);
    expect(autoApprovable(doc({ category: 'perf', evidence: 'no gain, but benchmark: 3 ops/s' }))).toBe(true);
  });
  it('a negator just after the keyword, or one of the wider negators, also counts', () => {
    for (const e of ['tests missing', 'nothing tested', 'there are zero tests', 'tests: none', 'test absent', 'untested path', 'test pending'])
      expect(autoApprovable(doc({ category: 'security', evidence: e }))).toBe(false);
    for (const e of ['benchmark pending', 'benchmarks would help', 'benchmark: none yet', 'zero benchmarks'])
      expect(autoApprovable(doc({ category: 'perf', evidence: e }))).toBe(false);
    expect(autoApprovable(doc({ category: 'security', evidence: 'regression test added in auth.test.ts' }))).toBe(true);
    expect(autoApprovable(doc({ category: 'perf', evidence: 'benchmark parse.bench.ts: 40 ms -> 5 ms' }))).toBe(true);
    // Only the 3 words after count: a negator further on does not cancel it.
    expect(autoApprovable(doc({ category: 'security', evidence: 'test covers the token check, nothing else' }))).toBe(true);
  });
  it('never feature or deps, never medium/high risk', () => {
    expect(autoApprovable(doc({ category: 'feature' }))).toBe(false);
    expect(autoApprovable(doc({ category: 'deps' }))).toBe(false);
    expect(autoApprovable(doc({ risk: 'medium' }))).toBe(false);
    expect(autoApprovable(doc({ category: 'tests', risk: 'high' }))).toBe(false);
  });
});

describe('similarRejected', () => {
  const rej = [{ ...doc({ status: 'rejected', title: 'Remove dead code from the parser module', rationale: 'unused helpers clutter parser', evidence: 'grep shows 4 unused helpers' }), id: 'p1' }];
  it('hits a similar proposal without new evidence', () => {
    expect(similarRejected({ title: 'Remove dead code from parser module', rationale: 'unused helpers clutter parser', evidence: 'unused helpers' }, rej)).toBe('p1');
  });
  it('misses when the evidence is new', () => {
    expect(similarRejected({ title: 'Remove dead code from parser module', rationale: 'unused helpers clutter parser', evidence: 'coverage report says 9 unused' }, rej)).toBeNull();
  });
  it('threshold: Jaccard 3/5 hits, 2/5 misses; short words ignored; accents count', () => {
    const r = (title: string) => [{ ...doc({ status: 'rejected', title, evidence: 'e' }), id: 'p1' }];
    // words a b c d (as long words) vs a b c e: inter 3, union 5 = 0.6
    expect(similarRejected({ title: 'alpha beta gamma delta', rationale: '', evidence: 'e' }, r('alpha beta gamma omega'))).toBe('p1');
    expect(similarRejected({ title: 'alpha beta gamma delta', rationale: '', evidence: 'e' }, r('alpha beta zeta omega'))).toBeNull();
    expect(similarRejected({ title: 'alpha beta gamma delta', rationale: '', evidence: 'e' }, r('alpha beta gamma delta is of to'))).toBe('p1');
    expect(similarRejected({ title: 'revisar configuración inicial', rationale: '', evidence: 'e' }, r('revisar configuración inicial'))).toBe('p1');
    expect(similarRejected({ title: 'revisar configuracion inicial', rationale: '', evidence: 'e' }, r('revisar configuración inicial'))).toBeNull();
  });
  it('evidence containment ignores case and whitespace', () => {
    const rj = [{ ...doc({ status: 'rejected', title: 'same title words', evidence: 'Grep  shows\n4 Unused' }), id: 'p1' }];
    expect(similarRejected({ title: 'same title words', rationale: '', evidence: 'grep shows 4 unused' }, rj)).toBe('p1');
  });
  it('misses a different proposal', () => {
    expect(similarRejected({ title: 'Cache price lookups', rationale: 'checkout is slow', evidence: 'unused helpers' }, rej)).toBeNull();
  });
});

describe('similarOpen', () => {
  const p = (id: string, status: ProposalDoc['status'], title: string) => ({ ...doc({ status, title }), id });
  it('finds a similar proposed, discussing, approved or auto_approved proposal whatever the evidence', () => {
    for (const status of ['proposed', 'discussing', 'approved', 'auto_approved'] as const)
      expect(similarOpen({ title: 'alpha beta gamma delta', rationale: '' }, [p('p1', status, 'alpha beta gamma omega')])).toBe('p1');
  });
  it('ignores rejected and done proposals and different ideas', () => {
    expect(similarOpen({ title: 'alpha beta gamma delta', rationale: '' }, [p('p1', 'rejected', 'alpha beta gamma delta'), p('p2', 'done', 'alpha beta gamma delta')])).toBeNull();
    expect(similarOpen({ title: 'alpha beta gamma delta', rationale: '' }, [p('p1', 'proposed', 'alpha beta zeta omega')])).toBeNull();
  });
});

describe('safeZone', () => {
  it('accepts plain relative paths and globs', () => {
    expect(safeZone('src/**')).toBe('src/**');
    expect(safeZone('a/b_c-d.ts')).toBe('a/b_c-d.ts');
  });
  it('refuses anything else', () => {
    for (const bad of ['../x', 'a/../x', '/etc', 'C:\\x', 'C:/x', '\\\\srv\\x', 'a;rm -rf', '-rf', '-x/y', '`x`', '$(x)', 'a b', '', undefined]) expect(safeZone(bad)).toBeNull();
  });
});

describe('autoApprovable: objective signals only (D-16, K2-16)', () => {
  it('a tests proposal needs the path of a test file', () => {
    expect(autoApprovable(doc({ category: 'tests', path: 'src/app.ts' }))).toBe(false);
    expect(autoApprovable(doc({ category: 'tests' }))).toBe(false);
    for (const p of ['tests/app.test.ts', 'src/__tests__/a.ts', 'spec/cart_spec.rb', 'src/cart.spec.ts', 'pkg/a.test.go']) expect(autoApprovable(doc({ category: 'tests', path: p })), p).toBe(true);
  });
  it('never when it proposes deleting or migrating data, in any inflection, and a negation never unlocks it (I1)', () => {
    const refused = ['drop the users table', 'Truncate the logs', 'migrate the orders to the new store', 'delete all old records', 'borrar los registros antiguos',
      'Drop the pending jobs table', 'Purge rows with no owner', 'Delete accounts without activity', 'Delete the users with no orders', 'Delete records missing an owner',
      'Erase all entries pending review', 'Truncate the table, nothing else changes', 'No-op cleanup: drop the users table', 'Zero-downtime: truncate the logs',
      'Borrar los registros sin due\u00f1o', 'Drops the legacy users table', 'Dropping unused tables', 'Purged stale rows', 'Truncating the logs table', 'Deletes orphaned rows',
      'Remove orphaned rows', 'Delete stale records', 'DELETE FROM users WHERE inactive', 'borrar el registro antiguo', 'eliminar la fila duplicada', 'eliminar la cuenta inactiva',
      'borra la columna vieja', 'eliminar usuario inactivo', 'Wipe the cache dir', 'Erases the old log', 'ALTER TABLE users ADD x', 'Suprimir los datos viejos', 'Vaciar la tabla',
      'Migraci\u00f3n de los pedidos', 'Migrar los pedidos', 'Removal of old rows', 'Deletion of the backups'];
    for (const t of refused) expect(autoApprovable(doc({ title: t })), t).toBe(false);
    for (const r of ['does not drop anything', 'nothing is deleted', 'nothing to migrate', 'no migration needed', 'never deletes data', 'sin borrar datos']) {
      expect(autoApprovable(doc({ title: 'Tidy the parser', rationale: r })), r).toBe(false);
    }
    expect(autoApprovable(doc({ title: 'Tidy the parser', rationale: 'Smaller functions' }))).toBe(true);
  });
  it('lookalikes and invisible characters do not hide a word (minor 4)', () => {
    const zwj = String.fromCharCode(0x200d), shy = String.fromCharCode(0xad);
    for (const t of ['dr\u043ep the users table', `de${zwj}lete the rows`, `au${zwj}th cleanup`, `Rotate the a${shy}uth key`, '\uff44\uff52\uff4f\uff50 the table', '\uff41\uff55\uff54\uff48 helper', 'Tidy \u0410uth helper']) {
      expect(autoApprovable(doc({ title: t })), t).toBe(false);
    }
    expect(autoApprovable(doc({ title: 'Tidy the parser', path: 'src/\u0430pp.ts' }))).toBe(false);
    expect(autoApprovable(doc({ title: 'Ordena el an\u00e1lisis \u2014 sin cambios' }))).toBe(true);
  });
  it('a path needs to be concrete, relative and safe (minor 7, I2)', () => {
    for (const p of [undefined, '', '**', '*', 'src/**', 'src/*.ts', '../x.ts', '/etc/x.ts', 'C:/x.ts', 'a b.ts']) expect(autoApprovable(doc({ path: p })), String(p)).toBe(false);
    expect(autoApprovable(doc({ category: 'tests', path: 'tests/**' }))).toBe(false);
    expect(autoApprovable(doc({ category: 'tests', path: 'tests/../src/app.ts' }))).toBe(false);
    expect(autoApprovable(doc({ category: 'tests', path: 'docs/spec/api.md' }))).toBe(false);
  });
  it('sensitive path segments, whatever the separator (I2)', () => {
    for (const p of ['src\\auth\\login.ts', 'src/login.ts', 'src/oauth/x.ts', 'src/authentication/x.ts', 'src/secrets/x.ts', 'src/permissions/x.ts', 'src/credentials.ts',
      'src/tokens/x.ts', 'src/session/x.ts', 'src/cryptography/x.ts', 'src/security/x.ts', 'src/migrate/x.ts']) expect(autoApprovable(doc({ path: p })), p).toBe(false);
  });
  it('never when its path or its words touch a sensitive zone', () => {
    expect(autoApprovable(doc({ path: 'src/auth/login.ts' }))).toBe(false);
    expect(autoApprovable(doc({ title: 'Rotate the JWT secret' }))).toBe(false);
    expect(autoApprovable(doc({ category: 'tests', path: 'tests/auth/login.test.ts' }))).toBe(false);
    expect(autoApprovable(doc({ title: 'Rename a helper', path: 'src/util/strings.ts' }))).toBe(true);
  });
  it('carry 5: the zone words the shared table misses, in the title or the rationale', () => {
    for (const t of ['Simplify the sign-in form', 'Tidy the sign in handler', 'Refactor the signin page', 'Refactor logins handler', 'Log in faster',
      'Store credentials in one place', 'Rotate the API keys', 'Move the api-key parsing', 'Use bcrypt for the hashes', 'Faster password hashing',
      'Split the cryptography helpers', 'Single sign-on cleanup', 'Ordenar las credenciales', 'Rotar las claves de la API']) {
      expect(autoApprovable(doc({ title: t })), t).toBe(false);
      expect(autoApprovable(doc({ title: 'Tidy the parser', rationale: t })), `rationale: ${t}`).toBe(false);
    }
    expect(autoApprovable(doc({ title: 'Design a cleaner key layout for the cache' }))).toBe(true);
  });
  it('carry 5: deleting or migrating data in the evidence refuses too', () => {
    for (const e of ['the job drops the users table each night', 'grep: 3 places delete old records', 'borra los registros antiguos'])
      expect(autoApprovable(doc({ title: 'Tidy the parser', evidence: e })), e).toBe(false);
    expect(autoApprovable(doc({ title: 'Tidy the parser', evidence: 'grep: 4 helpers in parser.ts' }))).toBe(true);
  });
});
