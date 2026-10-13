import { describe, it, expect } from 'vitest';
import { triage, implementerFor, isMechanical, announce, type RepoFacts } from '../src/forge/triage.js';

const FILES = ['src/app.ts', 'src/auth/login.ts', 'src/util/format.ts', 'src/db/migrations/001.sql', 'package.json', '.github/workflows/ci.yml',
  ...Array.from({ length: 20 }, (_, i) => `src/feature/f${i}.ts`)];
const repo = (grep: Record<string, string[]> = {}, over: Partial<RepoFacts> = {}): RepoFacts =>
  ({ files: FILES, commits: 40, gitOk: true, grep: w => grep[w] ?? [], ...over });

describe('triage', () => {
  it('one named file, short task → trivial', () => {
    const r = triage('fix the typo in src/util/format.ts', repo(), ['test']);
    expect(r).toMatchObject({ path: 'trivial', files: ['src/util/format.ts'], sensitive: [], greenfield: false, validators: ['test'] });
  });
  it('a named file sizes the task: other files where its symbol appears do not lift it', () => {
    const r = triage('Añade un comentario de una línea encima de createCart en src/util/format.ts', repo({ createCart: ['src/util/format.ts', 'test/format.test.ts'] }), ['test']);
    expect(r.path).toBe('trivial');
    expect(r.files).toEqual(['src/util/format.ts', 'test/format.test.ts']);
  });
  it('a rename stays at least small even when it names one file', () => {
    expect(triage('rename formatPrice in src/util/format.ts', repo({ formatPrice: ['src/util/format.ts', 'src/a.ts'] }), []).path).toBe('small');
    expect(triage('Renombra formatPrice en src/util/format.ts', repo(), []).path).toBe('small');
    // Commas and a final full stop are not a rename.
    expect(triage('Añade un parámetro (cents, currency) a formatPrice en src/util/format.ts.', repo(), []).path).toBe('trivial');
  });
  it('nothing located → small, with a reason', () => {
    const r = triage('add a dark mode toggle', repo(), []);
    expect(r.path).toBe('small');
    expect(r.reasons.join(' ')).toMatch(/no files located/);
  });
  it('a symbol found in three files → small', () => {
    const r = triage('rename formatPrice to formatMoney', repo({ formatPrice: ['src/a.ts', 'src/b.ts', 'src/c.ts'] }), []);
    expect(r.path).toBe('small');
    expect(r.files).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });
  it('auth zone lifts a one-file change to medium', () => {
    const r = triage('change the password check in src/auth/login.ts', repo(), []);
    expect(r.sensitive).toContain('auth');
    expect(r.path).toBe('medium');
  });
  it('detects data, deps and ci zones from paths', () => {
    expect(triage('edit src/db/migrations/001.sql', repo(), []).sensitive).toContain('data');
    expect(triage('bump a version in package.json', repo(), []).sensitive).toContain('deps');
    expect(triage('tweak .github/workflows/ci.yml', repo(), []).sensitive).toContain('ci');
  });
  it('more than ten files → large', () => {
    const many = FILES.filter(f => f.startsWith('src/feature/'));
    expect(triage('update useFeatureFlag everywhere', repo({ useFeatureFlag: many }), []).path).toBe('large');
  });
  it('architecture words → large', () => {
    expect(triage('redesign the plugin architecture', repo(), []).path).toBe('large');
  });
  it('Spanish architecture wording → large', () => {
    expect(triage('añade un subsistema de pedidos con una API REST mínima', repo(), []).path).toBe('large');
    expect(triage('Rediseña la arquitectura del plugin', repo(), []).path).toBe('large');
    expect(triage('Crea un nuevo servicio de notificaciones desde cero', repo(), []).path).toBe('large');
    expect(triage('Migración a Postgres', repo(), []).path).toBe('large');
    expect(triage('Añade una migración de la tabla de usuarios', repo(), []).path).not.toBe('large');
  });
  it('an empty repo is greenfield and large', () => {
    const r = triage('build a todo app', repo({}, { files: [], commits: 0 }), []);
    expect(r).toMatchObject({ greenfield: true, path: 'large' });
  });
  it('never greps short or common words', () => {
    const asked: string[] = [];
    triage('make the app load data from the api', { files: FILES, commits: 5, gitOk: true, grep: w => { asked.push(w); return []; } }, []);
    expect(asked).toEqual([]);
  });
  it('a git failure is not greenfield: it says so and the other rules pick the path', () => {
    const r = triage('add a dark mode toggle', repo({}, { files: [], commits: 0, gitOk: false }), []);
    expect(r).toMatchObject({ greenfield: false, path: 'small' });
    expect(r.reasons).toContain('git unavailable');
    expect(r.reasons.join(' ')).not.toMatch(/greenfield/);
  });
  it('Spanish wording marks sensitive zones', () => {
    expect(triage('Cambia la validación de la contraseña y la autenticación de usuarios', repo(), []).sensitive).toEqual(['auth']);
    expect(triage('Añade una migración nueva a la base de datos con otro esquema', repo(), []).sensitive).toEqual(['data']);
    expect(triage('Actualiza dependencias y revisa el despliegue de la integración continua', repo(), []).sensitive).toEqual(['deps', 'ci']);
    expect(triage('Expón la API pública con un endpoint nuevo', repo(), []).sensitive).toEqual(['public-api']);
    expect(triage('Gestiona la sesión del usuario', repo(), []).sensitive).toEqual(['auth']);
    // Unicode-aware boundaries: no match inside a longer word.
    expect(triage('Revisa la presesión del texto', repo(), []).sensitive).toEqual([]);
  });
  it('a one-line quoted text change is trivial: the session finds the file', () => {
    const tab = triage('Cambia el título de la pestaña del navegador a «Reparto · gastos del piso».', repo(), []);
    expect(tab.path).toBe('trivial');
    expect(tab.reasons).toContain('one quoted text change: the session finds the file');
    expect(triage('change the page title to "Reparto"', repo(), []).path).toBe('trivial');
    expect(triage('set the button label as “Guardar cambios”', repo(), []).path).toBe('trivial');
  });
  it('a quoted change with more work, or everywhere, or without a change verb is not trivial', () => {
    expect(triage('change the button text to "Save" and add validation', repo(), []).path).not.toBe('trivial');
    expect(triage('el botón «Añadir gasto» debería decir «Apuntar gasto» en todas partes', repo(), []).path).not.toBe('trivial');
    expect(triage('cambia el texto de todos los botones a «Guardar»', repo(), []).path).not.toBe('trivial');
    expect(triage('rename the heading label to "Totals"', repo(), []).path).not.toBe('trivial');
    const long = `change the page title to "Reparto" ${'because the old one reads oddly on small screens and people complain'}`;
    expect(triage(long, repo(), []).path).not.toBe('trivial');
  });
  it('a file found only through a quoted literal does not make a wider task trivial', () => {
    const one = (hit: string) => repo({ [hit]: ['src/app.ts'] });
    expect(triage('change the button text to "Save" and add validation', one('Save'), []).path).toBe('small');
    expect(triage('Cambia el texto del botón a «Guardar» y añade validación del importe', one('Guardar'), []).path).toBe('small');
    const r = triage('el botón «Añadir gasto» debería decir «Apuntar gasto» en todas partes', one('Añadir gasto'), []);
    expect(r.path).toBe('small');
    expect(r.files).toEqual(['src/app.ts']);
  });
  it('a quoted old value found in one file makes a short change trivial under the copy guards', () => {
    const one = (hit: string) => repo({ [hit]: ['src/feature/f1.ts'] });
    for (const t of ['cambia «Añadir gasto» por «Apuntar gasto»', 'Cambia el botón «Añadir gasto» por «Apuntar gasto»']) {
      const r = triage(t, one('Añadir gasto'), []);
      expect(r, t).toMatchObject({ path: 'trivial', files: ['src/feature/f1.ts'] });
      expect(r.reasons).toEqual(['one file, short task']);
    }
    expect(triage('change "Add expense" to "Log expense"', one('Add expense'), []).path).toBe('trivial');
    expect(triage('change the "Add expense" button to "Log expense"', one('Add expense'), []).path).toBe('trivial');
    // No change verb first: the session judges it, and the reason does not claim nothing was found.
    const prose = triage('el botón «Añadir gasto» debería decir «Apuntar gasto»', one('Añadir gasto'), []);
    expect(prose.path).toBe('small');
    expect(prose.reasons.join(' ')).not.toMatch(/no files located/);
    expect(prose.reasons).toEqual(['quoted text found in 1 file(s)']);
    expect(announce({ path: 'small', reasons: prose.reasons, implementer: { self: false, agent: 'forge-impl-light' }, fresh: [], catalog: [] }, 'es'))
      .toBe('Small → forge-impl-light: texto entre comillas en 1 fichero(s). Puedes corregirlo.');
    // Without a hit there is no file: still small.
    expect(triage('cambia «Añadir gasto» por «Apuntar gasto»', repo(), []).path).toBe('small');
  });
  it('the copy rule pairs verbs with their own prepositions and only a short of/in phrase after the noun', () => {
    for (const t of [
      'Replace the text input with a "textarea"',
      'Replace the tooltip with a "Popover"',
      'Change the label component to use a "Badge"',
      'Update the message queue to "durable"',
    ]) expect(triage(t, repo(), []).path, t).not.toBe('trivial');
    expect(triage('Cambia el título de la pestaña del navegador a «Reparto», gracias', repo(), []).path).toBe('trivial');
    expect(triage('Cambia el título de la pestaña del navegador a «Reparto · gastos del piso» por favor', repo(), []).path).toBe('trivial');
    expect(triage('change the title of the page to "Reparto", please.', repo(), []).path).toBe('trivial');
  });
  it('a copy change that names the method first or last is still a copy change (campaign E5.1 as typed)', () => {
    for (const t of [
      'Con forge: cambia el título de la pestaña del navegador a «Reparto · gastos del piso».',
      'Fórjame esto: cambia el título de la pestaña a «Reparto»',
      'With forge: change the page title to "Reparto"',
      'cambia el título de la pestaña a «Reparto», con forge',
    ]) expect(triage(t, repo(), []).path, t).toBe('trivial');
    expect(triage('Con forge: cambia el título a «Reparto» y añade un favicon', repo(), []).path).not.toBe('trivial');
  });
  it('quoted-literal hits never raise the size: a literal found in several files is left out', () => {
    const many = (n: number) => repo({ Save: FILES.filter(f => f.startsWith('src/feature/')).slice(0, n) });
    for (const n of [4, 12]) {
      const r = triage('change the button text to "Save"', many(n), []);
      expect(r.path).toBe('trivial');
      expect(r.files).toEqual([]);
    }
    expect(triage('change the page title to "Reparto"', repo({ Reparto: ['index.html', 'README.md'] }), []).path).toBe('trivial');
  });
  it('the copy rule wants the change verb first, one clause, no condition and the quoted value at the end', () => {
    for (const t of [
      'Add a settings page, set its title to "Settings"',
      'Create a settings page; set its title to "Settings"',
      'Refactor the cart store; update the heading to "Cart"',
      'Change the page title to "Reparto", add a favicon',
      'Change the page title to "Reparto". Add a favicon too.',
      'update the error message to "Invalid email" when the email field has no @',
      'Cambia la lógica para que el mensaje se muestre como «Error» solo si falla la red',
      'Change the message parser to "strict" mode',
      'Change how totals are computed so the summary text reads as "Total: X"',
    ]) expect(triage(t, repo(), []).path, t).not.toBe('trivial');
    expect(triage('please change the page title to "Reparto"', repo(), []).path).toBe('trivial');
    expect(triage('Por favor, cambia el título de la página a «Reparto».', repo(), []).path).toBe('trivial');
    expect(triage('can you set the button label to "Save"?', repo(), []).path).toBe('trivial');
  });
  it('a quoted text change on a sensitive zone is still raised', () => {
    expect(triage('cambia el mensaje de error del login a «Credenciales incorrectas»', repo(), []).path).toBe('medium');
  });
  it('greps up to three quoted literals as fixed strings, so a quoted old value locates its file', () => {
    const asked: string[] = [];
    const r = triage('cambia el texto del botón «Añadir gasto» a «Apuntar gasto»', { ...repo(), grep: w => { asked.push(w); return w === 'Añadir gasto' ? ['src/app.ts'] : []; } }, []);
    expect(asked).toEqual(['Añadir gasto', 'Apuntar gasto']);
    expect(r).toMatchObject({ path: 'trivial', files: ['src/app.ts'] });
    asked.length = 0;
    triage('replace "one1" "two2" "three3" "four4" "abc" “' + 'x'.repeat(61) + '”', { ...repo(), grep: w => { asked.push(w); return []; } }, []);
    expect(asked).toEqual(['one1', 'two2', 'three3']);
  });
  it('a huge task text stays fast and greps at most 20 symbols', () => {
    const asked: string[] = [];
    const big = Array.from({ length: 40 }, (_, i) => `symbolNumber${i}`).join(' ') + ' ' + 'a'.repeat(100_000) + ' ' + 'x.'.repeat(20_000);
    const t0 = Date.now();
    triage(big, { files: FILES, commits: 40, gitOk: true, grep: w => { asked.push(w); return []; } }, []);
    // About 0.3 s alone and about 1 s while the whole suite runs in parallel; runaway regex backtracking takes far longer.
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(asked).toHaveLength(20);
  });
});

describe('implementerFor', () => {
  it('a small task is always delegated: mech when mechanical, impl-light otherwise', () => {
    expect(implementerFor({ path: 'small', sensitive: [] }, 'rename formatPrice to formatAmount')).toMatchObject({ role: 'mech', self: false });
    expect(implementerFor({ path: 'small', sensitive: [] }, 'Renombra formatPrice en src/util/format.ts')).toMatchObject({ role: 'mech', self: false });
    expect(implementerFor({ path: 'small', sensitive: [] }, 'aplica este parche a src/a.ts')).toMatchObject({ role: 'mech' });
    expect(implementerFor({ path: 'small', sensitive: [] }, 'add a guard for empty carts in src/cart.ts')).toMatchObject({ role: 'impl-light', self: false });
  });
  it('a trivial task is the session\'s own, except in a batch', () => {
    expect(implementerFor({ path: 'trivial', sensitive: [] }, 'fix the typo in src/a.ts')).toEqual({ role: null, self: true, why: 'trivial: the session does it' });
    expect(implementerFor({ path: 'trivial', sensitive: [] }, 'fix the typo in src/a.ts', { batch: true })).toMatchObject({ role: 'mech', self: false });
  });
  it('medium goes to impl, or impl-heavy on a sensitive zone; large has no implementer yet', () => {
    expect(implementerFor({ path: 'medium', sensitive: [] }, 'x').role).toBe('impl');
    expect(implementerFor({ path: 'medium', sensitive: ['auth'] }, 'x').role).toBe('impl-heavy');
    expect(implementerFor({ path: 'large', sensitive: [] }, 'x')).toMatchObject({ role: null, self: false });
  });
  it('isMechanical reads English and Spanish wording, not substrings', () => {
    expect(isMechanical('bump the version to 2.1.0')).toBe(true);
    expect(isMechanical('traduce los textos de la tarjeta')).toBe(true);
    expect(isMechanical('corrige la errata del README')).toBe(true);
    expect(isMechanical('add a remove button to the cart')).toBe(false);
    expect(isMechanical('fix the movement of the cart badge')).toBe(false);
  });
  it('isMechanical does not take a bare patch, move or typo in prose about real logic for mechanical', () => {
    expect(isMechanical('patch the retry logic to back off exponentially')).toBe(false);
    expect(isMechanical('move the validation logic into the cart reducer and handle empty carts')).toBe(false);
    expect(isMechanical('the typo handler should debounce input')).toBe(false);
    expect(isMechanical('apply the patch to src/a.ts')).toBe(true);
    expect(isMechanical('move src/a.ts to src/lib/a.ts')).toBe(true);
    expect(isMechanical('fix the typo in the README')).toBe(true);
  });
});
